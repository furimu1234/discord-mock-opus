import type { PGlite, Results } from '@electric-sql/pglite';
import { SNAPSHOT_ROW_LIMIT, type DbTable, type Engine, type Row, type SeedData } from './types.js';

const INT8_OID = 20;

export interface PgQueryOptions {
  rowMode?: 'array';
  parsers?: Record<number, (value: string) => unknown>;
}

export interface PgResult {
  command: string;
  rowCount: number;
  rows: unknown[];
  fields: { name: string; dataTypeID: number }[];
  oid: number;
}

const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

function isMultiStatementError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('multiple commands');
}

/** PGlite（WASM 版の PostgreSQL）で動くインメモリ DB。 */
export class PgEngine implements Engine {
  readonly kind = 'pg';
  private database?: Promise<PGlite>;

  private open(): Promise<PGlite> {
    this.database ??= import('@electric-sql/pglite').then(({ PGlite }) =>
      PGlite.create({ parsers: { [INT8_OID]: (value) => value } }),
    );
    return this.database;
  }

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

  async tables(): Promise<string[]> {
    const rows = await this.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    return rows.map((row) => row.tablename);
  }

  rows<T = Row>(table: string): Promise<T[]> {
    return this.query<T>(`SELECT * FROM ${identifier(table)}`);
  }

  async seed(data: SeedData): Promise<void> {
    for (const [table, rows] of Object.entries(data)) {
      for (const row of rows) {
        const columns = Object.keys(row);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const names = columns.map(identifier).join(', ');
        await this.execute(
          `INSERT INTO ${identifier(table)} (${names}) VALUES (${placeholders})`,
          Object.values(row),
        );
      }
    }
  }

  async snapshot(): Promise<DbTable[]> {
    if (!this.database) return [];
    const columns = await this.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    );
    const keys = await this.query<{ table_name: string; column_name: string }>(
      `SELECT k.table_name, k.column_name FROM information_schema.key_column_usage k
       JOIN information_schema.table_constraints c USING (constraint_name, table_schema)
       WHERE c.constraint_type = 'PRIMARY KEY' AND k.table_schema = 'public'`,
    );
    const tables = [];
    for (const name of await this.tables()) {
      const [count] = await this.query<{ total: string }>(`SELECT count(*) AS total FROM ${identifier(name)}`);
      tables.push({
        name,
        columns: columns
          .filter((column) => column.table_name === name)
          .map((column) => ({
            name: column.column_name,
            type: column.data_type,
            primaryKey: keys.some((key) => key.table_name === name && key.column_name === column.column_name),
          })),
        rows: await this.query(`SELECT * FROM ${identifier(name)} LIMIT ${SNAPSHOT_ROW_LIMIT}`),
        total: Number(count!.total),
      });
    }
    return tables;
  }

  async reset(): Promise<void> {
    if (!this.database) return;
    const tables = await this.tables();
    if (tables.length === 0) return;
    await this.execute(`TRUNCATE ${tables.map(identifier).join(', ')} RESTART IDENTITY CASCADE`);
  }

  async close(): Promise<void> {
    const database = this.database;
    this.database = undefined;
    await (await database)?.close();
  }
}
