import { runtime } from '../runtime.js';
import { MysqlEngine } from './mysql.js';
import { PgEngine } from './pg.js';
import { SheetsEngine } from './sheets.js';
import { SqliteEngine } from './sqlite.js';
import type { Engine, EngineKind } from './types.js';

export { MysqlEngine, PgEngine, SheetsEngine, SqliteEngine };
export type { Engine, EngineKind, Row, SeedData } from './types.js';
export type { CellValue, SheetSeed } from './sheets.js';

function engine<T extends Engine>(kind: EngineKind, create: () => T): T {
  let found = runtime.engines.get(kind) as T | undefined;
  if (!found) {
    found = create();
    runtime.engines.set(kind, found);
  }
  return found;
}

/** ドライバーごとに 1 つのインメモリ DB を共有する。Bot の接続もここに届く。 */
export const db = {
  pg: () => engine('pg', () => new PgEngine()),
  mysql: () => engine('mysql', () => new MysqlEngine()),
  sqlite: () => engine('sqlite', () => new SqliteEngine()),
  sheets: () => engine('sheets', () => new SheetsEngine()),
};

export async function resetEngines(): Promise<void> {
  for (const found of runtime.engines.values()) await found.reset();
}

export async function closeEngines(): Promise<void> {
  for (const found of runtime.engines.values()) await found.close();
  runtime.engines.clear();
}
