import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { connection } from './connection.js';
import { runtime } from './runtime.js';

/**
 * テストの実行時に `--import` で読み込むエントリー。
 * Bot のコードを変えずに、DB ドライバーの import をインメモリ DB に差し替え、
 * discord.js の通信先を Mock サーバーに向ける。
 */

const shim = (name: string) => new URL(`./shims/${name}.js`, import.meta.url).href;

const REDIRECTS: Record<string, string> = {
  pg: shim('pg'),
  mysql2: shim('mysql2'),
  'mysql2/promise': shim('mysql2-promise'),
  'better-sqlite3': shim('better-sqlite3'),
  googleapis: shim('googleapis'),
  '@googleapis/sheets': shim('googleapis'),
};

interface RestLike {
  options: { api: string };
  setToken(token: string): unknown;
}

interface DiscordClientLike {
  rest: RestLike;
  login(token?: string): Promise<string>;
}

interface ModuleExports {
  REST?: { prototype: { queueRequest(request: unknown): Promise<unknown> } & RestLike };
  Client?: { prototype: DiscordClientLike };
}

const patched = new Set<string>();

function patchRest({ REST }: ModuleExports): void {
  if (!REST) return;
  const { queueRequest } = REST.prototype;
  // Bot が指定したトークンは Discord 用のものなので、Mock のトークンに置き換える。
  REST.prototype.queueRequest = async function (this: RestLike, request: unknown) {
    const { url, token } = connection();
    this.options.api = `${url}/api`;
    this.setToken(token);
    return queueRequest.call(this, request);
  } as never;
}

function patchClient({ Client }: ModuleExports): void {
  if (!Client) return;
  const { login } = Client.prototype;
  // 本物のトークンは使わず、Mock が発行したトークンでログインする。
  Client.prototype.login = async function (this: DiscordClientLike) {
    runtime.loginClients.push(this);
    const { url, token } = connection();
    this.rest.options.api = `${url}/api`;
    return login.call(this, token);
  };
}

function patchModule(url: string): void {
  if (patched.has(url) || !url.startsWith('file:')) return;
  patched.add(url);
  const exports = createRequire(url)(fileURLToPath(url)) as ModuleExports;
  patchRest(exports);
  patchClient(exports);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const redirect = REDIRECTS[specifier];
    if (redirect) return { url: redirect, shortCircuit: true };
    const resolved = nextResolve(specifier, context);
    if (specifier === 'discord.js' || specifier === '@discordjs/rest') patchModule(resolved.url);
    return resolved;
  },
});
