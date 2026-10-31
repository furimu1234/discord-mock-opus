import { startServer, type MockServer } from '@dismock/server';
import type { Engine, EngineKind } from './db/types.js';

const KEY = Symbol.for('dismock.runtime');

export interface Runtime {
  mockUrl?: string;
  server?: MockServer;
  starting?: Promise<string>;
  engines: Map<EngineKind, Engine>;
  /** login を呼んだ本物の Client。`entry` で読み込んだ Bot の取得に使う。 */
  loginClients: unknown[];
  testClient?: unknown;
}

type Global = typeof globalThis & { [KEY]?: Runtime };

/** register フックとテストランナーで同じ実体を共有するため、グローバルに置く。 */
export const runtime: Runtime = ((globalThis as Global)[KEY] ??= {
  engines: new Map(),
  loginClients: [],
});

/** Mock サーバーの URL を返す。未指定なら同じプロセスで起動する。 */
export function ensureServer(): Promise<string> {
  if (runtime.mockUrl) return Promise.resolve(runtime.mockUrl);
  runtime.starting ??= startServer().then((server) => {
    runtime.server = server;
    runtime.mockUrl = server.url;
    return server.url;
  });
  return runtime.starting;
}

/** Mock サーバーが発行した Bot のトークンを返す。 */
export async function mockToken(): Promise<string> {
  const response = await fetch(`${await ensureServer()}/api/mock/token`);
  return ((await response.json()) as { token: string }).token;
}

export async function stopServer(): Promise<void> {
  await runtime.server?.close();
  runtime.server = undefined;
  runtime.mockUrl = undefined;
  runtime.starting = undefined;
}
