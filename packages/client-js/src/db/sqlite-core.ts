import { DatabaseSync } from 'node:sqlite';
import { SNAPSHOT_ROW_LIMIT, type DbTable, type Row, type SeedData } from './types.js';

const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;

export function toBindable(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value === null || Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

export function isDuplicateError(error: unknown): boolean {
  const code = (error as { errcode?: number }).errcode;
  return code === SQLITE_CONSTRAINT_UNIQUE || code === SQLITE_CONSTRAINT_PRIMARYKEY;
}

/** SQLite と MySQL のエンジンが共有する node:sqlite の接続。 */
export class SqliteCore {
  readonly db = new DatabaseSync(':memory:');

  tables(): string[] {
    const rows = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as { name: string }[];
    return rows.map((row) => row.name);
  }

  rows(table: string): Row[] {
    return this.db.prepare(`SELECT * FROM ${identifier(table)}`).all() as Row[];
  }

  snapshot(): DbTable[] {
    return this.tables().map((name) => {
      const quoted = identifier(name);
      const columns = this.db.prepare('SELECT name, type, pk FROM pragma_table_info(?)').all(name) as {
        name: string;
        type: string;
        pk: number;
      }[];
      const { total } = this.db.prepare(`SELECT count(*) AS total FROM ${quoted}`).get() as { total: number };
      return {
        name,
        columns: columns.map((column) => ({ name: column.name, type: column.type, primaryKey: column.pk > 0 })),
        rows: this.db.prepare(`SELECT * FROM ${quoted} LIMIT ${SNAPSHOT_ROW_LIMIT}`).all() as Row[],
        total,
      };
    });
  }

  seed(data: SeedData): void {
    for (const [table, rows] of Object.entries(data)) {
      for (const row of rows) {
        const columns = Object.keys(row);
        const names = columns.map(identifier).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        this.db
          .prepare(`INSERT INTO ${identifier(table)} (${names}) VALUES (${placeholders})`)
          .run(...(Object.values(row).map(toBindable) as never[]));
      }
    }
  }

  reset(): void {
    this.db.exec('PRAGMA foreign_keys = OFF');
    for (const table of this.tables()) this.db.exec(`DELETE FROM ${identifier(table)}`);
    const hasSequence = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'`)
      .get();
    if (hasSequence) this.db.exec('DELETE FROM sqlite_sequence');
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  close(): void {
    this.db.close();
  }
}
