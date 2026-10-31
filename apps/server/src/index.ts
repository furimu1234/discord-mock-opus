import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_HOST } from './constants.js';
import { Gateway } from './gateway.js';
import { Interactions } from './interactions.js';
import { Rest } from './rest.js';
import { TestRegistry } from './tests.js';
import { Store } from './store.js';

export { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_USERS } from './constants.js';
export { ChannelType, Store } from './store.js';
export type { Json, SeedChannel, SeedGuild, SeedInput, SeedRole, SeedUser } from './store.js';
export type { InteractRequest, InteractResult } from './interactions.js';
export type { TestCaseInfo, TestProject, TestResult, TrafficEntry } from './tests.js';

export interface MockServerOptions {
  /** 既定は `DEFAULT_HOST`。 */
  host?: string;
  /** 既定は `0`（空いているポートを自動で割り当てる）。 */
  port?: number;
  /** 状態を保存する JSON ファイル。省略するとメモリ上にのみ保持する。 */
  dataFile?: string;
  /** 開発者が指定する Mock のトークン。省略すると保存済みの値を使い、なければ発行する。 */
  token?: string;
  /** Web UI のビルド結果のディレクトリ。 */
  webDir?: string;
  /** トークン以外のデータを消してから起動する。 */
  clearOnStart?: boolean;
  /** ダミーデータが空のとき、初期データを投入する。 */
  seedDefaults?: boolean;
}

export interface MockServer {
  url: string;
  store: Store;
  close(): Promise<void>;
}

export async function startServer(options: MockServerOptions = {}): Promise<MockServer> {
  const host = options.host ?? DEFAULT_HOST;
  const store = new Store(options.dataFile, options.token);
  let url = '';

  const gatewayUrl = () => `${url.replace(/^http/, 'ws')}/gateway`;
  const gateway = new Gateway(store, gatewayUrl);
  const interactions = new Interactions(store, (event, data) => store.emit('dispatch', event, data));
  const tests = new TestRegistry(store);
  const rest = new Rest(store, interactions, tests, gatewayUrl, () => gateway.hasBot, options.webDir);
  if (options.clearOnStart) store.clearAll();
  if (options.seedDefaults) store.seedDefaults();

  const server: Server = createServer((req, res) => void rest.handle(req, res));
  gateway.attach(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  url = `http://${host}:${port}`;
  store.published(url);

  return {
    url,
    store,
    close: async () => {
      store.flush();
      gateway.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
