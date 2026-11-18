import { EventEmitter } from 'node:events';
import {
  escape,
  escapeId,
  format,
  PromiseConnection,
  PromisePool,
} from './mysql2-promise.js';

export { escape, escapeId, format };

type Callback = (error: Error | null, ...results: any[]) => void;

function deliver(promise: Promise<any[] | void>, callback?: Callback): void {
  promise.then(
    (result) => callback?.(null, ...(result ?? [])),
    (error: Error) => {
      if (!callback) throw error;
      callback(error);
    },
  );
}

/** コールバック形式の接続。処理は Promise 形式の接続に委譲する。 */
class CallbackConnection<T extends PromiseConnection> extends EventEmitter {
  constructor(protected readonly inner: T) {
    super();
  }

  query(input: never, values?: unknown, callback?: Callback): void {
    const done = typeof values === 'function' ? (values as Callback) : callback;
    const params = typeof values === 'function' ? undefined : values;
    deliver(this.inner.query(input, params), done);
  }

  execute(input: never, values?: unknown, callback?: Callback): void {
    this.query(input, values, callback);
  }

  connect(callback?: Callback): void {
    callback?.(null);
  }

  ping(callback?: Callback): void {
    callback?.(null);
  }

  end(callback?: Callback): void {
    callback?.(null);
  }

  destroy(): void {}
  release(): void {}

  beginTransaction(callback?: Callback): void {
    deliver(this.inner.beginTransaction(), callback);
  }

  commit(callback?: Callback): void {
    deliver(this.inner.commit(), callback);
  }

  rollback(callback?: Callback): void {
    deliver(this.inner.rollback(), callback);
  }

  promise(): T {
    return this.inner;
  }

  format = format;
  escape = escape;
  escapeId = escapeId;
}

class CallbackPool extends CallbackConnection<PromisePool> {
  getConnection(callback: Callback): void {
    callback(null, new CallbackConnection(new PromiseConnection()));
  }

  releaseConnection(): void {}
}

export function createConnection(config?: unknown) {
  return new CallbackConnection(new PromiseConnection(config));
}

export function createPool(config?: unknown) {
  return new CallbackPool(new PromisePool(config));
}

export default { createConnection, createPool, escape, escapeId, format };
