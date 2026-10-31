export type EngineKind = 'pg' | 'mysql' | 'sqlite' | 'sheets';

export type Row = Record<string, unknown>;

export interface DbColumn {
  name: string;
  type: string;
  primaryKey: boolean;
}

export interface DbTable {
  name: string;
  columns: DbColumn[];
  rows: Row[];
  /** 全体の行数。`rows` は先頭の `SNAPSHOT_ROW_LIMIT` 行まで。 */
  total: number;
}

export const SNAPSHOT_ROW_LIMIT = 1000;

/** テーブル名（シート）ごとの初期データ。 */
export type SeedData = Record<string, Row[]>;

export interface Engine {
  readonly kind: EngineKind;
  /** スキーマは残し、データだけを空にする。 */
  reset(): Promise<void>;
  /** DB Studio に表示するテーブルの内容を返す。 */
  snapshot(): Promise<DbTable[]> | DbTable[];
  close(): Promise<void>;
}
