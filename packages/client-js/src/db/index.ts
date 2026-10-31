import { runtime } from '../runtime.js';
import { MysqlEngine } from './mysql.js';
import { PgEngine } from './pg.js';
import { SheetsEngine } from './sheets.js';
import { SqliteEngine } from './sqlite.js';
import type { DbTable, Engine, EngineKind, Row } from './types.js';

export { MysqlEngine, PgEngine, SheetsEngine, SqliteEngine };
export type { MysqlField, MysqlQueryOptions } from './mysql.js';
export type { PgQueryOptions, PgResult } from './pg.js';
export type { DbColumn, DbTable, Engine, EngineKind, Row, SeedData } from './types.js';
export type { CellValue, SheetSeed, ValueOptions } from './sheets.js';
export type { SqliteCore } from './sqlite-core.js';

function engine<T extends Engine>(kind: EngineKind, create: () => T): T {
  let found = runtime.engines.get(kind) as T | undefined;
  if (!found) {
    found = create();
    runtime.engines.set(kind, found);
  }
  return found;
}

/**
 * ドライバーごとに 1 つのインメモリ DB を共有する。Bot の接続もここに届く。
 *
 * @example
 * ```ts
 * await db.pg().seed({ users: [{ id: 1, name: 'alice' }] });
 * const rows = await db.pg().rows('users');
 * ```
 */
export const db = {
  pg: () => engine('pg', () => new PgEngine()),
  mysql: () => engine('mysql', () => new MysqlEngine()),
  sqlite: () => engine('sqlite', () => new SqliteEngine()),
  sheets: () => engine('sheets', () => new SheetsEngine()),
};

/** @internal */
export type DbSnapshot = { kind: EngineKind; tables: DbTable[] }[];

/** JSON で送れない値を、画面に表示する文字列へ変換する。 */
function toDisplayValue(value: unknown): unknown {
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  return value;
}

function toDisplayRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toDisplayValue(value)]));
}

/**
 * Bot が使っている DB の内容を返す。
 *
 * @internal
 */
export async function snapshotEngines(): Promise<DbSnapshot> {
  const snapshot: DbSnapshot = [];
  for (const found of runtime.engines.values()) {
    const tables = await found.snapshot();
    if (tables.length === 0) continue;
    snapshot.push({
      kind: found.kind,
      tables: tables.map((table) => ({ ...table, rows: table.rows.map(toDisplayRow) })),
    });
  }
  return snapshot;
}

/** @internal */
export async function closeEngines(): Promise<void> {
  for (const found of runtime.engines.values()) await found.close();
  runtime.engines.clear();
}
