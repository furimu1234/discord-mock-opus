import type { EngineKind } from './types.js';

/** Drizzle のスキーマ。`import * as schema` の形で、テーブルをまとめたオブジェクト。 */
export type DrizzleSchema = Record<string, unknown>;

/** `drizzle-kit` はテストの実行に必須ではないので、使うときに読み込む。 */
const loadKit = () => import('drizzle-kit/api');

async function pgSql(schema: DrizzleSchema): Promise<string[]> {
  const { generateDrizzleJson, generateMigration } = await loadKit();
  const next = generateDrizzleJson(schema);
  const statements = await generateMigration(generateDrizzleJson({}), next);
  // `pgSchema` が export されていなくても、テーブルの作成先のスキーマは必要になる。
  const tables = Object.values(next.tables as Record<string, { schema: string }>);
  const schemas = new Set(tables.map((table) => table.schema));
  const creates = [...schemas].filter(Boolean).map((name) => `CREATE SCHEMA IF NOT EXISTS "${name}";`);
  return [...creates, ...statements];
}

async function mysqlSql(schema: DrizzleSchema): Promise<string[]> {
  const { generateMySQLDrizzleJson, generateMySQLMigration } = await loadKit();
  return generateMySQLMigration(await generateMySQLDrizzleJson({}), await generateMySQLDrizzleJson(schema));
}

async function sqliteSql(schema: DrizzleSchema): Promise<string[]> {
  const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await loadKit();
  return generateSQLiteMigration(await generateSQLiteDrizzleJson({}), await generateSQLiteDrizzleJson(schema));
}

const GENERATORS: Record<Exclude<EngineKind, 'sheets'>, (schema: DrizzleSchema) => Promise<string[]>> = {
  pg: pgSql,
  mysql: mysqlSql,
  sqlite: sqliteSql,
};

/**
 * Drizzle のスキーマからテーブルを作成する SQL を生成する。
 *
 * @internal
 */
export const generateSchemaSql = (kind: Exclude<EngineKind, 'sheets'>, schema: DrizzleSchema) =>
  GENERATORS[kind](schema);
