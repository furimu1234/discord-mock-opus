import { SqliteCore } from './sqlite-core.js';
import type { DbTable, Engine, Row, SeedData } from './types.js';

/** node:sqlite で動くインメモリ DB。better-sqlite3 のシムから使う。 */
export class SqliteEngine implements Engine {
  /** {@inheritDoc Engine.kind} */
  readonly kind = 'sqlite';
  /** @internal */
  readonly core = new SqliteCore();

  /** テストコードから SQL を実行し、行を返す。 */
  query<T = Row>(sql: string, ...values: never[]): T[] {
    const statement = this.core.db.prepare(sql);
    if (statement.columns().length > 0) return statement.all(...values) as T[];
    statement.run(...values);
    return [];
  }

  /** テーブル名の一覧を返す。 */
  tables(): string[] {
    return this.core.tables();
  }

  /** テーブルのすべての行を返す。 */
  rows<T = Row>(table: string): T[] {
    return this.core.rows(table) as T[];
  }

  /** テーブルに行を追加する。 */
  seed(data: SeedData): void {
    this.core.seed(data);
  }

  /** {@inheritDoc Engine.snapshot} */
  snapshot(): DbTable[] {
    return this.core.snapshot();
  }

  /** {@inheritDoc Engine.reset} */
  async reset(): Promise<void> {
    this.core.reset();
  }

  /** {@inheritDoc Engine.close} */
  async close(): Promise<void> {
    this.core.close();
  }
}
