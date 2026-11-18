import { EventEmitter } from 'node:events';
import { db } from '../db/index.js';
import { expandParameters, escapeId as quoteId } from '../db/mysql-translate.js';

type QueryInput = string | { sql: string; values?: unknown[]; rowsAsArray?: boolean; typeCast?: never };

export const escapeId = quoteId;

export function escape(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function format(sql: string, values: unknown[] = []): string {
  const expanded = expandParameters(sql, values);
  let index = 0;
  return expanded.sql.replace(/\?/g, () => {
    index += 1;
    return escape(expanded.values[index - 1]);
  });
}

export class PromiseConnection extends EventEmitter {
  readonly config: unknown;

  constructor(config?: unknown) {
    super();
    this.config = config;
  }

  async query(input: QueryInput, values?: unknown) {
    const options = typeof input === 'string' ? {} : input;
    const sql = typeof input === 'string' ? input : input.sql;
    const params = values ?? (options as { values?: unknown }).values ?? [];
    return db.mysql().execute(sql, Array.isArray(params) ? params : [params], options);
  }

  execute(input: QueryInput, values?: unknown) {
    return this.query(input, values);
  }

  async beginTransaction(): Promise<void> {
    db.mysql().execute('BEGIN');
  }

  async commit(): Promise<void> {
    db.mysql().execute('COMMIT');
  }

  async rollback(): Promise<void> {
    db.mysql().execute('ROLLBACK');
  }

  async connect(): Promise<void> {}
  async ping(): Promise<void> {}
  async end(): Promise<void> {}
  async changeUser(): Promise<void> {}
  destroy(): void {}
  release(): void {}
  unprepare(): void {}
  format = format;
  escape = escape;
  escapeId = escapeId;
}

export class PromisePool extends PromiseConnection {
  async getConnection(): Promise<PromiseConnection> {
    return new PromiseConnection(this.config);
  }

  releaseConnection(): void {}
}

export async function createConnection(config?: unknown): Promise<PromiseConnection> {
  return new PromiseConnection(config);
}

export function createPool(config?: unknown): PromisePool {
  return new PromisePool(config);
}

export default { createConnection, createPool, escape, escapeId, format };
