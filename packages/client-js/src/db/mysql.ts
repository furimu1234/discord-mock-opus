import type { StatementSync } from 'node:sqlite';
import { countPlaceholders, expandParameters, splitStatements, translate } from './mysql-translate.js';
import { isDuplicateError, SqliteCore, toBindable } from './sqlite-core.js';
import type { Engine, Row, SeedData } from './types.js';

const ER_DUP_ENTRY = 1062;
const ER_NO_SUCH_TABLE = 1146;
const ER_PARSE_ERROR = 1064;

export interface MysqlHeader {
  fieldCount: number;
  affectedRows: number;
  insertId: number;
  info: string;
  serverStatus: number;
  warningStatus: number;
  changedRows: number;
}

export interface MysqlField {
  name: string;
  type: string;
}

export interface MysqlQueryOptions {
  rowsAsArray?: boolean;
  typeCast?: boolean | ((field: unknown, next: () => unknown) => unknown);
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

function formatDate(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${day} ${time}.${pad(date.getMilliseconds(), 3)}`;
}

function bindMysql(value: unknown): unknown {
  return value instanceof Date ? formatDate(value) : toBindable(value);
}

/** mysql2 が返す JavaScript の型に合わせる。 */
function convert(value: unknown, declaredType: string): unknown {
  if (value === null) return null;
  if (/^(DATETIME|TIMESTAMP|DATE)\b/.test(declaredType)) return new Date(String(value).replace(' ', 'T'));
  if (/^JSON\b/.test(declaredType)) return JSON.parse(String(value));
  if (/^(DECIMAL|NUMERIC)\b/.test(declaredType)) return String(value);
  return value;
}

function mysqlError(error: unknown, sql: string): Error {
  const failure = error as Error & { code?: string; errno?: number; sqlMessage?: string; sql?: string };
  const message = failure.message;
  if (isDuplicateError(error)) {
    failure.code = 'ER_DUP_ENTRY';
    failure.errno = ER_DUP_ENTRY;
  } else if (message.includes('no such table')) {
    failure.code = 'ER_NO_SUCH_TABLE';
    failure.errno = ER_NO_SUCH_TABLE;
  } else {
    failure.code = 'ER_PARSE_ERROR';
    failure.errno = ER_PARSE_ERROR;
  }
  failure.sqlMessage = message;
  failure.sql = sql;
  return failure;
}

/**
 * MySQL の SQL を変換して SQLite で実行するインメモリ DB。
 * MySQL 固有の構文のうち、変換に対応していないものはエラーになる。
 */
export class MysqlEngine implements Engine {
  readonly kind = 'mysql';
  readonly core = new SqliteCore();

  constructor() {
    const { db } = this.core;
    const variadic = { varargs: true, deterministic: false };
    db.function('now', variadic, () => formatDate(new Date()).slice(0, 19));
    db.function('curdate', variadic, () => formatDate(new Date()).slice(0, 10));
    db.function('rand', variadic, () => Math.random());
    db.function('unix_timestamp', variadic, () => Math.floor(Date.now() / 1000));
    db.function('uuid', variadic, () => crypto.randomUUID());
    db.function('concat', variadic, (...args) =>
      args.some((arg) => arg === null) ? null : args.join(''),
    );
    db.function('char_length', { deterministic: true }, (value) => String(value).length);
  }

  /** mysql2 と同じ `[rows, fields]` または `[header, undefined]` を返す。 */
  execute(
    sql: string,
    values: unknown[] = [],
    options: MysqlQueryOptions = {},
  ): [unknown, MysqlField[] | undefined] {
    let last: [unknown, MysqlField[] | undefined] = [this.header(0, 0), undefined];
    let offset = 0;
    for (const statement of splitStatements(sql)) {
      const count = countPlaceholders(statement);
      last = this.run(statement, values.slice(offset, offset + count), options);
      offset += count;
    }
    return last;
  }

  private run(sql: string, values: unknown[], options: MysqlQueryOptions): [unknown, MysqlField[] | undefined] {
    try {
      const expanded = expandParameters(sql, values);
      const translated = translate(expanded.sql, (table, column) => this.columnDefault(table, column));
      if (translated === null) return [this.header(0, 0), undefined];
      const statement = this.core.db.prepare(translated);
      const binds = expanded.values.map(bindMysql) as never[];
      if (statement.columns().length > 0) return this.select(statement, binds, options);
      const { changes, lastInsertRowid } = statement.run(...binds);
      const isInsert = /^\s*(INSERT|REPLACE)\b/i.test(translated);
      return [this.header(Number(changes), isInsert ? Number(lastInsertRowid) : 0), undefined];
    } catch (error) {
      throw mysqlError(error, sql);
    }
  }

  private columnDefault(table: string, column: string): string {
    const columns = this.core.db.prepare(`SELECT name, dflt_value FROM pragma_table_info(?)`).all(table) as {
      name: string;
      dflt_value: string | null;
    }[];
    return columns.find((c) => c.name === column)?.dflt_value ?? 'NULL';
  }

  private select(
    statement: StatementSync,
    binds: never[],
    options: MysqlQueryOptions,
  ): [unknown, MysqlField[]] {
    const columns = statement.columns();
    const fields = columns.map((column) => ({
      name: column.name,
      type: (column.type ?? '').toUpperCase(),
    }));
    statement.setReturnArrays(true);
    const raw = statement.all(...binds) as unknown as unknown[][];
    const rows = raw.map((row) => {
      const converted = row.map((value, i) => this.castValue(value, fields[i]!, options));
      if (options.rowsAsArray) return converted;
      return Object.fromEntries(fields.map((field, i) => [field.name, converted[i]]));
    });
    return [rows, fields];
  }

  private castValue(value: unknown, field: MysqlField, options: MysqlQueryOptions): unknown {
    const next = () => convert(value, field.type);
    if (typeof options.typeCast !== 'function') return next();
    return options.typeCast(
      {
        name: field.name,
        type: field.type.replace(/\W.*$/, ''),
        string: () => (value === null ? null : String(value)),
        buffer: () => (value === null ? null : Buffer.from(String(value))),
      },
      next,
    );
  }

  private header(affectedRows: number, insertId: number): MysqlHeader {
    return {
      fieldCount: 0,
      affectedRows,
      insertId,
      info: '',
      serverStatus: 2,
      warningStatus: 0,
      changedRows: affectedRows,
    };
  }

  /** テストコードから SQL を実行し、行を返す。 */
  query<T = Row>(sql: string, values: unknown[] = []): T[] {
    const [rows] = this.execute(sql, values);
    return (Array.isArray(rows) ? rows : []) as T[];
  }

  tables(): string[] {
    return this.core.tables();
  }

  rows<T = Row>(table: string): T[] {
    return this.query<T>(`SELECT * FROM \`${table}\``);
  }

  seed(data: SeedData): void {
    this.core.seed(data);
  }

  async reset(): Promise<void> {
    this.core.reset();
  }

  async close(): Promise<void> {
    this.core.close();
  }
}
