import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Gateway } from './gateway.js';
import { Interactions } from './interactions.js';
import { Rest } from './rest.js';
import { Store } from './store.js';

export { Store } from './store.js';
export type { Json, SeedChannel, SeedGuild, SeedInput, SeedRole, SeedUser } from './store.js';
export type { InteractRequest, InteractResult } from './interactions.js';

export interface MockServerOptions {
  /** 既定は `127.0.0.1`。 */
  host?: string;
  /** 既定は `0`（空いているポートを自動で割り当てる）。 */
  port?: number;
  /** 状態を保存する JSON ファイル。省略するとメモリ上にのみ保持する。 */
  dataFile?: string;
}

export interface MockServer {
  url: string;
  store: Store;
  close(): Promise<void>;
}

export async function startServer(options: MockServerOptions = {}): Promise<MockServer> {
  const host = options.host ?? '127.0.0.1';
  const store = new Store(options.dataFile);
  let url = '';

  const gatewayUrl = () => `${url.replace(/^http/, 'ws')}/gateway`;
  const gateway = new Gateway(store, gatewayUrl);
  const interactions = new Interactions(store, (event, data) => gateway.broadcast(event, data));
  const rest = new Rest(store, interactions, gatewayUrl);

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
