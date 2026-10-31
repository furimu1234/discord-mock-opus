export type EngineKind = 'pg' | 'mysql' | 'sqlite' | 'sheets';

export type Row = Record<string, unknown>;

/** テーブル名（シート）ごとの初期データ。 */
export type SeedData = Record<string, Row[]>;

export interface Engine {
  readonly kind: EngineKind;
  /** スキーマは残し、データだけを空にする。 */
  reset(): Promise<void>;
  close(): Promise<void>;
}
