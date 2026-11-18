import type { Connection } from './connection.js';
import type { Engine, EngineKind } from './db/types.js';

const KEY = Symbol.for('dismock.runtime');

/** @internal */
export interface Runtime {
  /** `testClient` のオプションで指定された接続先。 */
  overrides: Partial<Connection>;
  connection?: Connection;
  engines: Map<EngineKind, Engine>;
  /** login を呼んだ本物の Client。`entry` で読み込んだ Bot の取得に使う。 */
  loginClients: unknown[];
  /** login を拒否した理由。Bot が例外を捕まえても、起動エラーとして扱う。 */
  loginError?: Error;
  /** Sapphire のように `ready` の後でコマンドを登録する Bot の、登録の完了。 */
  commandsRegistered?: Promise<unknown>;
  testClient?: unknown;
}

type Global = typeof globalThis & { [KEY]?: Runtime };

/**
 * register フックとテストランナーで同じ実体を共有するため、グローバルに置く。
 *
 * @internal
 */
export const runtime: Runtime = ((globalThis as Global)[KEY] ??= {
  overrides: {},
  engines: new Map(),
  loginClients: [],
});
