import type { PGlite, Results } from '@electric-sql/pglite';
import { type DrizzleSchema, generateSchemaSql } from './schema-sql.js';
import { SNAPSHOT_ROW_LIMIT, type DbTable, type Engine, type Row, type SeedData } from './types.js';

const INT8_OID = 20;

/** @internal */
export interface PgQueryOptions {
  rowMode?: 'array';
  parsers?: Record<number, (value: string) => unknown>;
}

/** @internal */
export interface PgResult {
  command: string;
  rowCount: number;
  rows: unknown[];
  fields: { name: string; dataTypeID: number }[];
  oid: number;
}

const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** 既定のスキーマ。このスキーマのテーブルはスキーマ名を付けずに書く。 */
const DEFAULT_SCHEMA = 'public';
/** PostgreSQL が内部で使うスキーマ。`pg_` で始まるものも含めて、テーブルの一覧に出さない。 */
const SYSTEM_SCHEMAS = ['information_schema'];

/** `public` 以外のスキーマのテーブルは `スキーマ.テーブル` と書く（Drizzle の `pgSchema` など）。 */
const tableName = (schema: string, table: string) => (schema === DEFAULT_SCHEMA ? table : `${schema}.${table}`);
/** テーブル名を SQL の識別子にする。`スキーマ.テーブル` はスキーマを付けて参照する。 */
const tableRef = (name: string) => name.split('.').map(identifier).join('.');
/** `column` が利用者のスキーマであることを表す SQL の条件。 */
const userSchema = (column: string) =>
  `${column} NOT LIKE 'pg\\_%' AND ${column} NOT IN (${SYSTEM_SCHEMAS.map((schema) => `'${schema}'`).join(', ')})`;

/** トランザクションを始める SQL。 */
const BEGIN_SQL = /^\s*(BEGIN|START\s+TRANSACTION)\b/i;
/** トランザクションを終える SQL（最後の文）。`ROLLBACK TO` はセーブポイントまでなので、終わりではない。 */
const END_SQL = /(^|;)\s*(COMMIT|END|ABORT|ROLLBACK(?!\s+(WORK\s+|TRANSACTION\s+)?TO\b))\b[^;]*;?\s*$/i;
/** 別の接続のトランザクションの終わりを待つ時間。過ぎたらエラーにする。 */
export const TRANSACTION_WAIT_MS = 10_000;

function isMultiStatementError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('multiple commands');
}

/**
 * PGlite（WASM 版の PostgreSQL）で動くインメモリ DB。
 *
 * @remarks
 * PGlite の接続は 1 本なので、Bot の接続がトランザクションを始めると、終わるまで他の SQL を待たせる。
 * テストのコード、DB Studio、Bot の別の接続の SQL が、Bot のトランザクションに入り込んで一緒にロールバックされないようにするため。
 * 待つのは `TRANSACTION_WAIT_MS` までで、過ぎるとエラーになる（トランザクションの中で、`tx` ではなく別の接続を使ったときなど）。
 */
export class PgEngine implements Engine {
  /** {@inheritDoc Engine.kind} */
  readonly kind = 'pg';
  private database?: Promise<PGlite>;
  /** トランザクションの途中の接続。 */
  private owner?: object;
  /** トランザクションが終わったときに解決する。 */
  private ownerReleased = Promise.resolve();
  private releaseOwner = () => {};

  private open(): Promise<PGlite> {
    this.database ??= import('@electric-sql/pglite').then(({ PGlite }) =>
      PGlite.create({ parsers: { [INT8_OID]: (value) => value } }),
    );
    return this.database;
  }

  /** トランザクションを始めた接続を、終えるまで記録する。 */
  private hold(connection: object): void {
    this.owner = connection;
    this.ownerReleased = new Promise((resolve) => {
      this.releaseOwner = resolve;
    });
  }

  private release(connection: object): void {
    if (this.owner !== connection) return;
    this.owner = undefined;
    this.releaseOwner();
  }

  /** 別の接続のトランザクションが終わるまで待つ。 */
  private async waitTurn(connection: object | undefined): Promise<void> {
    const deadline = Date.now() + TRANSACTION_WAIT_MS;
    while (this.owner && this.owner !== connection) {
      const remaining = deadline - Date.now();
      let timer: NodeJS.Timeout | undefined;
      const timedOut = await Promise.race([
        this.ownerReleased.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), Math.max(remaining, 0));
        }),
      ]);
      clearTimeout(timer);
      if (timedOut && this.owner && this.owner !== connection) {
        throw new Error(
          `別の接続のトランザクションが ${TRANSACTION_WAIT_MS}ms 終わらないため、SQL を実行できません。` +
            'dismock の DB は接続が 1 本なので、トランザクションの中では、そのトランザクションの接続（Drizzle の tx など）を使ってください',
        );
      }
    }
  }

  /**
   * SQL を実行する。`connection` は Bot の接続（`pg` の `Client`）で、トランザクションを区別するのに使う。
   * 省略したもの（テストのコード、`Pool.query`）は、どの接続のトランザクションにも入らない。
   *
   * @internal
   */
  async execute(text: string, values: unknown[] = [], options: PgQueryOptions = {}, connection?: object): Promise<PgResult | PgResult[]> {
    await this.waitTurn(connection);
    const ends = END_SQL.test(text);
    const begins = Boolean(connection) && BEGIN_SQL.test(text) && !ends;
    // 実行を待つ間に他の SQL が入り込まないよう、始める前に記録する。
    if (begins && connection) this.hold(connection);
    try {
      return await this.run(text, values, options);
    } catch (error) {
      if (begins && connection) this.release(connection);
      throw error;
    } finally {
      if (ends && connection) this.release(connection);
    }
  }

  /**
   * トランザクションの途中なら、ロールバックして終える。Bot が接続を返したり閉じたりしたときに呼ぶ。
   *
   * @internal
   */
  async abandon(connection: object): Promise<void> {
    if (this.owner === connection) await this.execute('ROLLBACK', [], {}, connection);
  }

  private async run(text: string, values: unknown[], options: PgQueryOptions): Promise<PgResult | PgResult[]> {
    const database = await this.open();
    try {
      return this.toResult(text, await database.query(text, values, options));
    } catch (error) {
      if (values.length > 0 || !isMultiStatementError(error)) throw error;
    }
    const results = await database.exec(text, options);
    const mapped = results.map((result) => this.toResult('', result));
    return mapped.length === 1 ? mapped[0]! : mapped;
  }

  private toResult(text: string, result: Results<unknown>): PgResult {
    const command = /^\s*(\w+)/.exec(text)?.[1]?.toUpperCase() ?? '';
    return {
      command,
      rowCount: result.affectedRows || result.rows.length,
      rows: result.rows,
      fields: result.fields.map(({ name, dataTypeID }) => ({ name, dataTypeID })),
      oid: 0,
    };
  }

  /** テストコードから SQL を実行し、行を返す。 */
  async query<T = Row>(text: string, values: unknown[] = []): Promise<T[]> {
    const result = await this.execute(text, values);
    return (Array.isArray(result) ? (result.at(-1)?.rows ?? []) : result.rows) as T[];
  }

  /**
   * Drizzle のスキーマからテーブルを作成する SQL を生成する。
   *
   * @param schema - `import * as schema` の形でまとめたテーブル。
   * @returns SQL 文の一覧。実行はしない。
   */
  schemaSql(schema: DrizzleSchema): Promise<string[]> {
    return generateSchemaSql(this.kind, schema);
  }

  /**
   * Drizzle のスキーマからテーブルを作成する。`setupDb` での使用を想定する。
   *
   * @param schema - `import * as schema` の形でまとめたテーブル。
   */
  async createTables(schema: DrizzleSchema): Promise<void> {
    for (const statement of await this.schemaSql(schema)) await this.query(statement);
  }

  /** テーブル名の一覧を返す。`public` 以外のスキーマのテーブルは `スキーマ.テーブル` の形。 */
  async tables(): Promise<string[]> {
    return (await this.schemaTables()).map((table) => table.name);
  }

  private async schemaTables(): Promise<{ schema: string; name: string }[]> {
    const rows = await this.query<{ schemaname: string; tablename: string }>(
      `SELECT schemaname, tablename FROM pg_tables WHERE ${userSchema('schemaname')} ORDER BY schemaname, tablename`,
    );
    return rows.map((row) => ({ schema: row.schemaname, name: tableName(row.schemaname, row.tablename) }));
  }

  /** テーブルのすべての行を返す。`public` 以外のスキーマのテーブルは `スキーマ.テーブル` で指定する。 */
  rows<T = Row>(table: string): Promise<T[]> {
    return this.query<T>(`SELECT * FROM ${tableRef(table)}`);
  }

  /** テーブルに行を追加する。 */
  async seed(data: SeedData): Promise<void> {
    for (const [table, rows] of Object.entries(data)) {
      for (const row of rows) {
        const columns = Object.keys(row);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const names = columns.map(identifier).join(', ');
        await this.execute(
          `INSERT INTO ${tableRef(table)} (${names}) VALUES (${placeholders})`,
          Object.values(row),
        );
      }
    }
  }

  /** {@inheritDoc Engine.snapshot} */
  async snapshot(): Promise<DbTable[]> {
    if (!this.database) return [];
    const columns = await this.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(
      `SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns
       WHERE ${userSchema('table_schema')} ORDER BY table_schema, table_name, ordinal_position`,
    );
    const keys = await this.query<{ table_schema: string; table_name: string; column_name: string }>(
      `SELECT k.table_schema, k.table_name, k.column_name FROM information_schema.key_column_usage k
       JOIN information_schema.table_constraints c USING (constraint_name, table_schema)
       WHERE c.constraint_type = 'PRIMARY KEY' AND ${userSchema('k.table_schema')}`,
    );
    const named = <T extends { table_schema: string; table_name: string }>(row: T) => tableName(row.table_schema, row.table_name);
    const tables = [];
    for (const { schema, name } of await this.schemaTables()) {
      const [count] = await this.query<{ total: string }>(`SELECT count(*) AS total FROM ${tableRef(name)}`);
      tables.push({
        name,
        schema,
        columns: columns
          .filter((column) => named(column) === name)
          .map((column) => ({
            name: column.column_name,
            type: column.data_type,
            primaryKey: keys.some((key) => named(key) === name && key.column_name === column.column_name),
          })),
        rows: await this.query(`SELECT * FROM ${tableRef(name)} LIMIT ${SNAPSHOT_ROW_LIMIT}`),
        total: Number(count!.total),
      });
    }
    return tables;
  }

  /** {@inheritDoc Engine.reset} */
  async reset(): Promise<void> {
    if (!this.database) return;
    const tables = await this.tables();
    if (tables.length === 0) return;
    await this.execute(`TRUNCATE ${tables.map(tableRef).join(', ')} RESTART IDENTITY CASCADE`);
  }

  /** {@inheritDoc Engine.close} */
  async close(): Promise<void> {
    const database = this.database;
    this.database = undefined;
    await (await database)?.close();
  }
}
