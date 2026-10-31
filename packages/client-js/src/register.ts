import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ensureServer, mockToken, runtime } from './runtime.js';

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
  REST.prototype.queueRequest = async function (this: RestLike, request: unknown) {
    this.options.api = `${await ensureServer()}/api`;
    return queueRequest.call(this, request);
  } as never;
}

function patchClient({ Client }: ModuleExports): void {
  if (!Client) return;
  const { login } = Client.prototype;
  // 本物のトークンは使わず、Mock サーバーが発行したトークンでログインする。
  Client.prototype.login = async function (this: DiscordClientLike) {
    runtime.loginClients.push(this);
    this.rest.options.api = `${await ensureServer()}/api`;
    return login.call(this, await mockToken());
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
