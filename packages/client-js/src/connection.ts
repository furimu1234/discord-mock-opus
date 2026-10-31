import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_HOST, DEFAULT_PORT } from '@dismock/server/constants';
import { runtime } from './runtime.js';

const DATA_FILE = join('data', 'discord-mock-state.json');
const DEFAULT_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

/** Mock への接続情報。 */
export interface Connection {
  /** Mock の URL。 */
  url: string;
  /** Mock のトークン。 */
  token: string;
}

/** テストを始められない状態を表す。テストの失敗とは区別する。 */
export class StartupError extends Error {
  /** エラーの名前。 */
  override name = 'StartupError';
}

function findDataFile(directory = process.cwd()): string | undefined {
  const candidate = join(directory, DATA_FILE);
  if (existsSync(candidate)) return candidate;
  const parent = dirname(directory);
  return parent === directory ? undefined : findDataFile(parent);
}

function readSavedConnection(): Partial<Connection> {
  const file = findDataFile();
  if (!file) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Partial<Connection>;
  } catch (error) {
    throw new StartupError(`${file} を読み込めません: ${(error as Error).message}`);
  }
}

function resolveConnection(): Connection {
  const url = runtime.overrides.url ?? process.env.DISMOCK_URL;
  const token = runtime.overrides.token ?? process.env.DISMOCK_TOKEN;
  if (url && token) return { url, token };
  const saved = readSavedConnection();
  if (!token && !saved.token) {
    throw new StartupError('Mock のトークンが見つかりません。先に `pnpm web` で Mock を起動してください');
  }
  return { url: url ?? saved.url ?? DEFAULT_URL, token: (token ?? saved.token)! };
}

/** Mock の URL とトークンを返す。オプション、環境変数、JSON の順に優先する。 */
export function connection(): Connection {
  runtime.connection ??= resolveConnection();
  return runtime.connection;
}

/** Mock に接続でき、トークンが一致することを確認する。 */
export async function verifyConnection(): Promise<void> {
  const { url, token } = connection();
  const response = await fetch(`${url}/api/v10/users/@me`, {
    headers: { authorization: `Bot ${token}` },
  }).catch(() => {
    throw new StartupError(`Mock (${url}) に接続できません。\`pnpm web\` で起動しているか確認してください`);
  });
  if (response.status === 401) throw new StartupError(`Mock (${url}) のトークンと一致しません`);
  if (!response.ok) throw new StartupError(`Mock (${url}) が ${response.status} を返しました`);
}
