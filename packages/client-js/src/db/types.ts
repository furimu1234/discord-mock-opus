/** インメモリ DB の種類。 */
export type EngineKind = 'pg' | 'mysql' | 'sqlite' | 'sheets';

/** テーブルの 1 行。カラム名と値の組。 */
export type Row = Record<string, unknown>;

/** テーブルのカラム。 */
export interface DbColumn {
  /** カラム名。 */
  name: string;
  /** カラムの型。 */
  type: string;
  /** 主キーか。 */
  primaryKey: boolean;
}

/** DB Studio に送るテーブルの内容。 */
export interface DbTable {
  /** テーブル名。 */
  name: string;
  /** カラムの一覧。 */
  columns: DbColumn[];
  /** 先頭の行。 */
  rows: Row[];
  /** 全体の行数。`rows` は先頭の `SNAPSHOT_ROW_LIMIT` 行まで。 */
  total: number;
}

export const SNAPSHOT_ROW_LIMIT = 1000;

/** テーブル名（シート）ごとの初期データ。 */
export type SeedData = Record<string, Row[]>;

/** インメモリ DB に共通の操作。 */
export interface Engine {
  /** インメモリ DB の種類。 */
  readonly kind: EngineKind;
  /** スキーマは残し、データだけを空にする。 */
  reset(): Promise<void>;
  /** DB Studio に表示するテーブルの内容を返す。 */
  snapshot(): Promise<DbTable[]> | DbTable[];
  /** DB を閉じる。 */
  close(): Promise<void>;
}
