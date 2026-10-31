import { SqliteCore } from './sqlite-core.js';
import type { DbTable, Engine, Row, SeedData } from './types.js';

/** node:sqlite で動くインメモリ DB。better-sqlite3 のシムから使う。 */
export class SqliteEngine implements Engine {
  readonly kind = 'sqlite';
  readonly core = new SqliteCore();

  /** テストコードから SQL を実行し、行を返す。 */
  query<T = Row>(sql: string, ...values: never[]): T[] {
    const statement = this.core.db.prepare(sql);
    if (statement.columns().length > 0) return statement.all(...values) as T[];
    statement.run(...values);
    return [];
  }

  tables(): string[] {
    return this.core.tables();
  }

  rows<T = Row>(table: string): T[] {
    return this.core.rows(table) as T[];
  }

  seed(data: SeedData): void {
    this.core.seed(data);
  }

  snapshot(): DbTable[] {
    return this.core.snapshot();
  }

  async reset(): Promise<void> {
    this.core.reset();
  }

  async close(): Promise<void> {
    this.core.close();
  }
}
