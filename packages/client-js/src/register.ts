import { type EventEmitter, once } from 'node:events';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { connection, StartupError } from './connection.js';
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
  token: string | null;
  login(token?: string): Promise<string>;
}

interface ModuleExports {
  REST?: { prototype: { queueRequest(request: unknown): Promise<unknown> } & RestLike };
  Client?: { prototype: DiscordClientLike };
}

/** discord.js の login と同じように、先頭の種別を取り除いて比較する。 */
const TOKEN_PREFIX = /^(Bot|Bearer)\s*/i;
const TOKEN_MISSING =
  'Mock のトークンが指定されていません。client.login の引数か testClient の token オプションに指定してください';
const TOKEN_MISMATCH =
  'client.login に渡されたトークンが Mock のトークンと一致しません。トークンは送信していません。Mock のトークンに切り替えてください';

/** Mock の Voice Gateway は TLS を使わないので、`@discordjs/voice` の接続先を差し替える。 */
const VOICE_PACKAGE = /[\\/]@discordjs[\\/]voice[\\/]/;

/** Sapphire がコマンドの登録を終えたときのイベント。 */
const SAPPHIRE_COMMANDS_REGISTERED = 'applicationCommandRegistriesRegistered';

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

function rejectLogin(message: string): never {
  runtime.loginError = new StartupError(message);
  throw runtime.loginError;
}

function patchClient({ Client }: ModuleExports): void {
  if (!Client) return;
  const { login } = Client.prototype;
  // 開発者が指定したトークンが Mock のものでなければ、どこにも送らずに起動を止める。
  Client.prototype.login = async function (this: DiscordClientLike, botToken: string | null = this.token) {
    const { url, token } = connection();
    const specified = botToken || runtime.overrides.token;
    if (!specified) rejectLogin(TOKEN_MISSING);
    if (specified.replace(TOKEN_PREFIX, '') !== token) rejectLogin(TOKEN_MISMATCH);
    runtime.loginClients.push(this);
    if ('stores' in this) {
      runtime.commandsRegistered = once(this as unknown as EventEmitter, SAPPHIRE_COMMANDS_REGISTERED);
    }
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
    if (specifier === 'ws' && VOICE_PACKAGE.test(context.parentURL ?? '')) return { url: shim('ws'), shortCircuit: true };
    const resolved = nextResolve(specifier, context);
    if (specifier === 'discord.js' || specifier === '@discordjs/rest') patchModule(resolved.url);
    return resolved;
  },
});
