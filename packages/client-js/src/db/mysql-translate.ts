/** MySQL の SQL を、エンジンである SQLite が解釈できる形に変換する。 */

interface Segment {
  type: 'code' | 'string' | 'identifier';
  text: string;
}

function tokenize(sql: string): Segment[] {
  const segments: Segment[] = [];
  let code = '';
  let i = 0;
  const flush = () => {
    if (code) segments.push({ type: 'code', text: code });
    code = '';
  };
  while (i < sql.length) {
    const char = sql[i]!;
    const next = sql[i + 1];
    if (char === "'" || char === '"') {
      flush();
      let value = '';
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '\\') {
          value += sql[i + 1] ?? '';
          i += 2;
        } else if (sql[i] === char && sql[i + 1] === char) {
          value += char;
          i += 2;
        } else if (sql[i] === char) {
          i += 1;
          break;
        } else {
          value += sql[i];
          i += 1;
        }
      }
      segments.push({ type: 'string', text: `'${value.replaceAll("'", "''")}'` });
    } else if (char === '`') {
      flush();
      const end = sql.indexOf('`', i + 1);
      segments.push({ type: 'identifier', text: sql.slice(i, end + 1) });
      i = end + 1;
    } else if (char === '#' || (char === '-' && next === '-')) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
    } else if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', i);
      i = end === -1 ? sql.length : end + 2;
    } else {
      code += char;
      i += 1;
    }
  }
  flush();
  return segments;
}

/** セミコロンで複数の文に分割する。 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  for (const segment of tokenize(sql)) {
    if (segment.type !== 'code') {
      current += segment.text;
      continue;
    }
    const parts = segment.text.split(';');
    current += parts[0];
    for (const part of parts.slice(1)) {
      statements.push(current);
      current = part;
    }
  }
  statements.push(current);
  return statements.filter((statement) => statement.trim().length > 0);
}

/** 文字列リテラルの中を除いた、プレースホルダーの数を返す。 */
export function countPlaceholders(sql: string): number {
  return tokenize(sql)
    .filter((segment) => segment.type === 'code')
    .reduce((total, segment) => total + (segment.text.match(/\?\??/g) ?? []).length, 0);
}

export const escapeId = (name: string) =>
  name
    .split('.')
    .map((part) => `\`${part.replaceAll('`', '``')}\``)
    .join('.');

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  );
}

/** `?` に配列やオブジェクトを渡す mysql2 の `query` の展開を再現する。 */
export function expandParameters(sql: string, values: unknown[]): { sql: string; values: unknown[] } {
  const binds: unknown[] = [];
  let index = 0;
  const output = tokenize(sql).map((segment) => {
    if (segment.type !== 'code') return segment.text;
    return segment.text.replace(/\?\??/g, (mark) => {
      const value = values[index];
      index += 1;
      if (mark === '??') return escapeId(String(value));
      if (Array.isArray(value)) {
        if (value.length === 0) return 'NULL';
        return value
          .map((item) => {
            if (!Array.isArray(item)) {
              binds.push(item);
              return '?';
            }
            binds.push(...item);
            return `(${item.map(() => '?').join(', ')})`;
          })
          .join(', ');
      }
      if (isPlainObject(value)) {
        return Object.entries(value)
          .map(([key, item]) => {
            binds.push(item);
            return `${escapeId(key)} = ?`;
          })
          .join(', ');
      }
      binds.push(value);
      return '?';
    });
  });
  return { sql: output.join(''), values: binds };
}

/** 文字列リテラルを退避し、正規表現での書き換えの対象から外す。 */
function mask(sql: string): { masked: string; restore: (text: string) => string } {
  const strings: string[] = [];
  const masked = tokenize(sql)
    .map((segment) => {
      if (segment.type !== 'string') return segment.text;
      strings.push(segment.text);
      return `\u0000${strings.length - 1}\u0000`;
    })
    .join('');
  return {
    masked,
    restore: (text) => text.replace(/\u0000(\d+)\u0000/g, (_match, i: string) => strings[Number(i)]!),
  };
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function translateColumn(definition: string): string {
  return definition
    .replace(/\b(CHARACTER\s+SET|CHARSET)\s+\w+/gi, '')
    .replace(/\bCOLLATE\s+\w+/gi, '')
    .replace(/\bCOMMENT\s+\u0000\d+\u0000/gi, '')
    .replace(/\bON\s+UPDATE\s+(CURRENT_TIMESTAMP|now)(\s*\(\s*\d*\s*\))?/gi, '')
    .replace(/\b(ENUM|SET)\s*\([^)]*\)/gi, 'TEXT')
    .replace(/\bDEFAULT\s+(CURRENT_TIMESTAMP|now)(\s*\(\s*\d*\s*\))?/gi, 'DEFAULT (now())')
    .replace(/\bDEFAULT\s+NULL\b/gi, '');
}

function translateCreateTable(masked: string): string {
  const open = masked.indexOf('(');
  let depth = 0;
  let close = -1;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === '(') depth += 1;
    if (masked[i] === ')') depth -= 1;
    if (depth === 0) {
      close = i;
      break;
    }
  }
  const head = masked.slice(0, open);
  const definitions = splitTopLevel(masked.slice(open + 1, close));

  const output: string[] = [];
  let autoIncrementColumn: string | undefined;
  for (const definition of definitions) {
    if (/^(KEY|INDEX|FULLTEXT|SPATIAL)\b/i.test(definition)) continue;
    const unique = /^UNIQUE\s+(?:KEY|INDEX)\s*(?:\S+\s*)?(\(.*\))/is.exec(definition);
    if (unique) {
      output.push(`UNIQUE ${unique[1]!.replace(/\(\d+\)/g, '')}`);
    } else if (/^(PRIMARY\s+KEY|UNIQUE|CONSTRAINT|FOREIGN\s+KEY|CHECK)\b/i.test(definition)) {
      output.push(definition.replace(/\bUSING\s+\w+/gi, ''));
    } else if (/\bAUTO_INCREMENT\b/i.test(definition)) {
      const name = /^(`[^`]+`|\S+)/.exec(definition)![1]!;
      autoIncrementColumn = name.replaceAll('`', '');
      output.push(`${name} INTEGER PRIMARY KEY AUTOINCREMENT`);
    } else {
      output.push(translateColumn(definition));
    }
  }
  const columns = autoIncrementColumn
    ? output.filter((line) => {
        const primary = /^PRIMARY\s+KEY\s*\(\s*`?(\w+)`?\s*\)/i.exec(line);
        return primary?.[1] !== autoIncrementColumn;
      })
    : output;
  return `${head}(${columns.join(', ')})`;
}

/** `INSERT INTO t SET a = 1` を `INSERT INTO t (a) VALUES (1)` に置き換える。 */
function replaceInsertSet(text: string): string {
  const insert = /^((?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+\S+)\s+SET\s+(.*?)(\s+ON\s+DUPLICATE\s+KEY\s+UPDATE\b.*)?$/is.exec(text);
  if (!insert) return text;
  const assignments = splitTopLevel(insert[2]!).map((assignment) => {
    const index = assignment.indexOf('=');
    return [assignment.slice(0, index).trim(), assignment.slice(index + 1).trim()];
  });
  const columns = assignments.map(([column]) => column).join(', ');
  const values = assignments.map(([, value]) => value).join(', ');
  return `${insert[1]} (${columns}) VALUES (${values})${insert[3] ?? ''}`;
}

export type DefaultResolver = (table: string, column: string) => string;

/** SQLite にはない `VALUES (DEFAULT, ...)` を、カラムの既定値の式に置き換える。 */
function replaceDefaults(text: string, resolveDefault: DefaultResolver): string {
  const insert = /^((?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+([^\s(]+)\s*\(([^)]*)\)\s*VALUES\s*)(.*)$/is.exec(text);
  if (!insert || !/\bDEFAULT\b/i.test(insert[4]!)) return text;
  const [, head, tableName, columnList, tail] = insert;
  const table = tableName!.replaceAll('`', '');
  const columns = columnList!.split(',').map((column) => column.trim().replaceAll('`', ''));
  const clause = /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.exec(tail!);
  const valueList = clause ? tail!.slice(0, clause.index) : tail!;
  const rows = splitTopLevel(valueList).map((row) => {
    const values = splitTopLevel(row.slice(row.indexOf('(') + 1, row.lastIndexOf(')')));
    const replaced = values.map((value, i) =>
      /^DEFAULT$/i.test(value) ? resolveDefault(table, columns[i]!) : value,
    );
    return `(${replaced.join(', ')})`;
  });
  return `${head}${rows.join(', ')} ${clause ? tail!.slice(clause.index) : ''}`;
}

/** 変換後の SQL を返す。SQLite では不要な文には `null` を返す。 */
export function translate(sql: string, resolveDefault: DefaultResolver = () => 'NULL'): string | null {
  const { masked, restore } = mask(sql);
  let text = masked.trim();

  if (/^(SET|USE|LOCK|UNLOCK)\b/i.test(text) || /^(CREATE|DROP)\s+(DATABASE|SCHEMA)\b/i.test(text)) {
    return null;
  }
  if (/^START\s+TRANSACTION\b/i.test(text)) return 'BEGIN';
  if (/^SHOW\s+TABLES\b/i.test(text)) {
    return `SELECT name AS Tables_in_mock FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`;
  }
  const truncate = /^TRUNCATE\s+(?:TABLE\s+)?(\S+)/i.exec(text);
  if (truncate) return `DELETE FROM ${truncate[1]}`;
  if (/^CREATE\s+(TEMPORARY\s+)?TABLE\b/i.test(text)) return restore(translateCreateTable(text));

  text = replaceDefaults(replaceInsertSet(text), resolveDefault)
    .replace(/^INSERT\s+IGNORE\b/i, 'INSERT OR IGNORE')
    .replace(/\s+FOR\s+UPDATE\s*$/i, '')
    .replace(/\s+LOCK\s+IN\s+SHARE\s+MODE\s*$/i, '')
    .replace(/\bCURRENT_TIMESTAMP(\s*\(\s*\d*\s*\))?/gi, 'now()')
    .replace(/\bLAST_INSERT_ID\s*\(\s*\)/gi, 'last_insert_rowid()');
  const duplicate = /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.exec(text);
  if (duplicate) {
    const assignments = text
      .slice(duplicate.index + duplicate[0].length)
      .replace(/\bVALUES\s*\(\s*`?(\w+)`?\s*\)/gi, 'excluded.$1');
    text = `${text.slice(0, duplicate.index)}ON CONFLICT DO UPDATE SET${assignments}`;
  }
  return restore(text);
}
