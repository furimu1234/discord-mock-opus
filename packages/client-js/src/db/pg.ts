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

function isMultiStatementError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('multiple commands');
}

/** PGlite（WASM 版の PostgreSQL）で動くインメモリ DB。 */
export class PgEngine implements Engine {
  /** {@inheritDoc Engine.kind} */
  readonly kind = 'pg';
  private database?: Promise<PGlite>;

  private open(): Promise<PGlite> {
    this.database ??= import('@electric-sql/pglite').then(({ PGlite }) =>
      PGlite.create({ parsers: { [INT8_OID]: (value) => value } }),
    );
    return this.database;
  }

  /** @internal */
  async execute(text: string, values: unknown[] = [], options: PgQueryOptions = {}): Promise<PgResult | PgResult[]> {
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
