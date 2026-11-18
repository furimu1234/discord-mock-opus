import type { StatementSync } from 'node:sqlite';
import { db } from '../db/index.js';
import { isDuplicateError, toBindable } from '../db/sqlite-core.js';

export class SqliteError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SqliteError';
  }
}

function translateError(error: unknown): Error {
  const failure = error as Error;
  return new SqliteError(failure.message, isDuplicateError(error) ? 'SQLITE_CONSTRAINT_UNIQUE' : 'SQLITE_ERROR');
}

function guard<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw translateError(error);
  }
}

function toBinds(params: unknown[]): never[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((param) => {
    if (typeof param === 'object' && param !== null && !Buffer.isBuffer(param) && !(param instanceof Uint8Array)) {
      return Object.fromEntries(Object.entries(param).map(([key, value]) => [key, toBindable(value)]));
    }
    return toBindable(param);
  }) as never[];
}

class Statement {
  private pluckMode = false;
  private rawMode = false;
  private readonly statement: StatementSync;

  constructor(
    readonly database: Database,
    readonly source: string,
  ) {
    this.statement = guard(() => database.core.db.prepare(source));
  }

  get reader(): boolean {
    return this.statement.columns().length > 0;
  }

  pluck(enabled = true): this {
    this.pluckMode = enabled;
    return this;
  }

  raw(enabled = true): this {
    this.rawMode = enabled;
    return this;
  }

  columns() {
    return this.statement.columns();
  }

  private shape(row: unknown): unknown {
    if (!this.pluckMode) return row;
    return (row as unknown[])[0];
  }

  private prepareRead(): void {
    this.statement.setReturnArrays(this.pluckMode || this.rawMode);
  }

  run(...params: unknown[]) {
    return guard(() => {
      const { changes, lastInsertRowid } = this.statement.run(...toBinds(params));
      return { changes: Number(changes), lastInsertRowid: Number(lastInsertRowid) };
    });
  }

  get(...params: unknown[]) {
    this.prepareRead();
    const row = guard(() => this.statement.get(...toBinds(params)));
    return row === undefined ? undefined : this.shape(row);
  }

  all(...params: unknown[]) {
    this.prepareRead();
    return guard(() => this.statement.all(...toBinds(params))).map((row) => this.shape(row));
  }

  *iterate(...params: unknown[]) {
    this.prepareRead();
    for (const row of this.statement.iterate(...toBinds(params))) yield this.shape(row);
  }
}

/** ファイル名は無視し、同じインメモリ DB に接続する。 */
export default class Database {
  readonly name: string;
  readonly memory = true;
  readonly readonly = false;
  open = true;
  private depth = 0;

  constructor(filename = ':memory:', _options?: unknown) {
    this.name = filename;
  }

  get core() {
    return db.sqlite().core;
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  exec(sql: string): this {
    guard(() => this.core.db.exec(sql));
    return this;
  }

  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.prepare(`PRAGMA ${source}`).all() as Record<string, unknown>[];
    return options.simple ? Object.values(rows[0] ?? {})[0] : rows;
  }

  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    const wrapped = (...args: A): R => {
      const savepoint = `dismock_${this.depth}`;
      this.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
      this.depth += 1;
      try {
        const result = fn(...args);
        this.depth -= 1;
        this.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        this.depth -= 1;
        this.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`);
        throw error;
      }
    };
    return Object.assign(wrapped, { deferred: wrapped, immediate: wrapped, exclusive: wrapped });
  }

  function(name: string, ...args: unknown[]): this {
    const fn = args.at(-1) as (...values: unknown[]) => never;
    this.core.db.function(name, { varargs: true }, fn);
    return this;
  }

  close(): this {
    this.open = false;
    return this;
  }
}

export { Database };
