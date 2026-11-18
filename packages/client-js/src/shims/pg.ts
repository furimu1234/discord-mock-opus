import { EventEmitter } from 'node:events';
import { db } from '../db/index.js';
import type { PgQueryOptions, PgResult } from '../db/pg.js';

type Callback = (error: Error | null, ...results: any[]) => void;

interface QueryConfig {
  text: string;
  values?: unknown[];
  rowMode?: 'array';
  types?: { getTypeParser(oid: number, format?: string): (value: string) => unknown };
}

// drizzle-orm が `types` で文字列のまま受け取ろうとする日付型とその配列。
const OVERRIDABLE_TYPES = [1082, 1114, 1184, 1186, 1115, 1182, 1185, 1187, 1231];

const customParsers = new Map<number, (value: string) => unknown>();

export const types = {
  builtins: {
    BOOL: 16,
    INT8: 20,
    INT2: 21,
    INT4: 23,
    TEXT: 25,
    JSON: 114,
    FLOAT4: 700,
    FLOAT8: 701,
    DATE: 1082,
    TIMESTAMP: 1114,
    TIMESTAMPTZ: 1184,
    INTERVAL: 1186,
    NUMERIC: 1700,
    JSONB: 3802,
  },
  getTypeParser: (oid: number) => customParsers.get(oid) ?? ((value: string) => value),
  setTypeParser: (oid: number, ...args: unknown[]) => {
    customParsers.set(oid, args.at(-1) as (value: string) => unknown);
  },
};

function normalize(input: string | QueryConfig, values?: unknown[]): QueryConfig {
  return typeof input === 'string' ? { text: input, values } : { ...input, values: values ?? input.values };
}

function queryOptions(config: QueryConfig): PgQueryOptions {
  const parsers: Record<number, (value: string) => unknown> = Object.fromEntries(customParsers);
  if (config.types) {
    for (const oid of OVERRIDABLE_TYPES) parsers[oid] = config.types.getTypeParser(oid, 'text');
  }
  return { rowMode: config.rowMode, parsers };
}

/** `connection` は `Client` のときだけ渡す。トランザクションはその接続の中で区別する。 */
function run(
  input: string | QueryConfig,
  values: unknown,
  callback: Callback | undefined,
  connection?: object,
): Promise<PgResult | PgResult[]> | void {
  const done = typeof values === 'function' ? (values as Callback) : callback;
  const config = normalize(input, Array.isArray(values) ? values : undefined);
  const result = db.pg().execute(config.text, config.values ?? [], queryOptions(config), connection);
  if (!done) return result;
  result.then(
    (value) => done(null, value),
    (error: Error) => done(error),
  );
}

export class Client extends EventEmitter {
  readonly database?: string;

  constructor(_config?: unknown) {
    super();
  }

  async connect(callback?: Callback): Promise<void> {
    callback?.(null, this);
  }

  query(input: string | QueryConfig, values?: unknown, callback?: Callback) {
    return run(input, values, callback, this);
  }

  async end(callback?: Callback): Promise<void> {
    await db.pg().abandon(this);
    this.emit('end');
    callback?.(null);
  }

  /** プールに返す。トランザクションの途中なら、他の SQL を止めたままにしないようロールバックする。 */
  release(): void {
    void db.pg().abandon(this).catch(() => {});
  }
}

export class Pool extends EventEmitter {
  readonly options: unknown;
  totalCount = 0;
  idleCount = 0;
  waitingCount = 0;
  ended = false;

  constructor(config?: unknown) {
    super();
    this.options = config;
  }

  async connect(callback?: Callback): Promise<Client> {
    const client = new Client();
    callback?.(null, client, () => {});
    return client;
  }

  query(input: string | QueryConfig, values?: unknown, callback?: Callback) {
    return run(input, values, callback);
  }

  async end(callback?: Callback): Promise<void> {
    this.ended = true;
    this.emit('end');
    callback?.(null);
  }
}

export const native = null;

export default { Client, Pool, types, native };
