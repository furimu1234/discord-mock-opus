import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { google } from 'googleapis';
import mysql from 'mysql2';
import mysqlPromise from 'mysql2/promise';
import pg from 'pg';
import { beforeEach, describe, expect, test } from '@dismock/test';

describe('pg', () => {
  beforeEach(async ({ db }) => {
    await db.pg().query('DROP TABLE IF EXISTS items');
    await db.pg().query('CREATE TABLE items (id bigserial PRIMARY KEY, name text UNIQUE, at timestamptz)');
  });

  test('Client とパラメータ', async () => {
    const client = new pg.Client({ connectionString: 'postgres://u:p@db.example.com/app' });
    await client.connect();
    const inserted = await client.query('INSERT INTO items (name, at) VALUES ($1, $2) RETURNING *', ['a', new Date(0)]);
    expect(inserted.rowCount).toBe(1);
    expect(inserted.command).toBe('INSERT');
    // 本物の pg と同じく bigint は文字列で返る。
    expect(inserted.rows[0].id).toBe('1');
    expect(inserted.rows[0].at).toBeInstanceOf(Date);
    await client.end();
  });

  test('rowMode と複数文と一意制約', async () => {
    const pool = new pg.Pool();
    await pool.query('INSERT INTO items (name) VALUES ($1)', ['a']);
    const rows = await pool.query({ text: 'SELECT id, name FROM items', rowMode: 'array' });
    expect(rows.rows).toEqual([['1', 'a']]);
    const multi = (await pool.query('SELECT 1 AS a; SELECT 2 AS b')) as unknown as { rows: unknown[] }[];
    expect(multi[1]!.rows).toEqual([{ b: 2 }]);
    await expect(pool.query('INSERT INTO items (name) VALUES ($1)', ['a'])).rejects.toMatchObject({ code: '23505' });
  });

  test('トランザクションのロールバック', async () => {
    const pool = new pg.Pool();
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`INSERT INTO items (name) VALUES ('x')`);
    await client.query('ROLLBACK');
    client.release();
    expect((await pool.query('SELECT * FROM items')).rowCount).toBe(0);
  });

  test('コールバック形式', async () => {
    const pool = new pg.Pool();
    const result = await new Promise<pg.QueryResult>((resolve, reject) => {
      pool.query('SELECT 1 AS one', (error: Error | null, value: pg.QueryResult) => (error ? reject(error) : resolve(value)));
    });
    expect(result.rows).toEqual([{ one: 1 }]);
  });
});

describe('mysql2', () => {
  const users = mysqlTable('users', {
    id: int('id').autoincrement().primaryKey(),
    name: varchar('name', { length: 64 }).notNull().unique(),
    points: int('points').notNull().default(0),
    joinedAt: timestamp('joined_at').defaultNow(),
  });

  beforeEach(async ({ db }) => {
    db.mysql().query('DROP TABLE IF EXISTS users');
    db.mysql().query(`
      CREATE TABLE IF NOT EXISTS \`users\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'pk',
        \`name\` VARCHAR(64) CHARACTER SET utf8mb4 NOT NULL,
        \`points\` INT NOT NULL DEFAULT 0,
        \`role\` ENUM('a', 'b') DEFAULT 'a',
        \`meta\` JSON,
        \`joined_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_name\` (\`name\`),
        KEY \`idx_points\` (\`points\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='users'
    `);
  });

  test('drizzle', async () => {
    const database = drizzleMysql(mysqlPromise.createPool({ host: 'db.example.com' }));
    await database.insert(users).values([{ name: 'a' }, { name: 'b', points: 5 }]);
    const rows = await database.select().from(users).where(eq(users.name, 'b'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 2, name: 'b', points: 5 });
    expect(rows[0]!.joinedAt).toBeInstanceOf(Date);
  });

  test('一括 INSERT と ON DUPLICATE KEY UPDATE', async () => {
    const connection = await mysqlPromise.createConnection({ host: 'db.example.com' });
    const [bulk] = await connection.query('INSERT INTO users (name, points) VALUES ?', [[['a', 1], ['b', 2]]]);
    expect(bulk).toMatchObject({ affectedRows: 2 });
    await connection.execute(
      'INSERT INTO users (name, points) VALUES (?, ?) ON DUPLICATE KEY UPDATE points = points + VALUES(points)',
      ['a', 10],
    );
    const [rows] = await connection.query('SELECT points FROM users WHERE name IN (?)', [['a', 'b']]);
    expect(rows).toEqual([{ points: 11 }, { points: 2 }]);
  });

  test('一意制約のエラーコードと JSON と SET ?', async () => {
    const connection = await mysqlPromise.createConnection({});
    await connection.query('INSERT INTO users SET ?', { name: 'a', meta: { x: 1 } });
    await expect(connection.query(`INSERT INTO users (name) VALUES ('a')`)).rejects.toMatchObject({
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    const [rows] = await connection.query('SELECT meta, joined_at FROM users');
    expect(rows).toEqual([{ meta: { x: 1 }, joined_at: expect.any(Date) }]);
  });

  test('文字列内の記号を SQL として解釈しない', async () => {
    const connection = await mysqlPromise.createConnection({});
    await connection.query(`INSERT INTO users (name) VALUES ('it\\'s; ON DUPLICATE KEY ?')`);
    const [rows] = await connection.query('SELECT name FROM users');
    expect(rows).toEqual([{ name: "it's; ON DUPLICATE KEY ?" }]);
  });

  test('コールバック形式と promise()', async () => {
    const pool = mysql.createPool({});
    const rows = await new Promise((resolve, reject) => {
      pool.query('SELECT 1 + 1 AS two', (error: Error | null, value: unknown) => (error ? reject(error) : resolve(value)));
    });
    expect(rows).toEqual([{ two: 2 }]);
    await expect(pool.promise().query('SELECT 2 AS n')).resolves.toMatchObject([[{ n: 2 }], expect.anything()]);
  });

  test('トランザクションのロールバック', async () => {
    const connection = await mysqlPromise.createConnection({});
    await connection.beginTransaction();
    await connection.query(`INSERT INTO users (name) VALUES ('x')`);
    await connection.rollback();
    const [rows] = await connection.query('SELECT * FROM users');
    expect(rows).toEqual([]);
  });
});

describe('better-sqlite3', () => {
  const memos = sqliteTable('memos', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    body: text('body').notNull().unique(),
  });

  beforeEach(({ db }) => {
    db.sqlite().query('DROP TABLE IF EXISTS memos');
    db.sqlite().query('CREATE TABLE memos (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL UNIQUE)');
  });

  test('drizzle', () => {
    const database = drizzleSqlite(new Database('/var/lib/bot/app.db'));
    database.insert(memos).values({ body: 'a' }).run();
    expect(database.select().from(memos).all()).toEqual([{ id: 1, body: 'a' }]);
    expect(database.select({ body: memos.body }).from(memos).where(eq(memos.id, 1)).get()).toEqual({ body: 'a' });
  });

  test('prepare、pluck、名前付きパラメータ', () => {
    const database = new Database(':memory:');
    const insert = database.prepare('INSERT INTO memos (body) VALUES (@body)');
    expect(insert.run({ body: 'a' })).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(insert.reader).toBe(false);
    expect(database.prepare('SELECT body FROM memos').pluck().get()).toBe('a');
    expect(database.prepare('SELECT id, body FROM memos').raw().all()).toEqual([[1, 'a']]);
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  test('transaction は失敗するとロールバックする', () => {
    const database = new Database('x.db');
    const insert = database.prepare('INSERT INTO memos (body) VALUES (?)');
    const run = database.transaction((body: string) => {
      insert.run(body);
      insert.run(body);
    });
    expect(() => run('a')).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
    expect(database.prepare('SELECT * FROM memos').all()).toEqual([]);
  });
});

describe('Google スプレッドシート', () => {
  const sheets = google.sheets({ version: 'v4' });
  const seed = { db: { sheets: { book: { Data: [['a', 1], ['b', 2], ['c', 3]] } } } };

  test('A1 形式の範囲とシート名', { seed }, async () => {
    const values = async (range: string) => (await sheets.spreadsheets.values.get({ spreadsheetId: 'book', range })).data.values;
    await expect(values('Data!A1:B2')).resolves.toEqual([['a', '1'], ['b', '2']]);
    await expect(values('Data!B:B')).resolves.toEqual([['1'], ['2'], ['3']]);
    await expect(values('Data!2:2')).resolves.toEqual([['b', '2']]);
    await expect(values('Data')).resolves.toHaveLength(3);
    await expect(values('A1')).resolves.toEqual([['a']]);
  });

  test('update と clear と UNFORMATTED_VALUE', { seed }, async () => {
    const spreadsheetId = 'book';
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Data!B1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['42']] },
    });
    const raw = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Data!B1',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    expect(raw.data.values).toEqual([[42]]);
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Data!A2:B2' });
    const rest = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Data' });
    expect(rest.data.values).toEqual([['a', '42'], [], ['c', '3']]);
  });

  test('シートの追加と取得', { seed }, async () => {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: 'book',
      requestBody: { requests: [{ addSheet: { properties: { title: 'New' } } }] },
    });
    const { data } = await sheets.spreadsheets.get({ spreadsheetId: 'book' });
    expect(data.sheets!.map((sheet) => sheet.properties!.title)).toEqual(expect.arrayContaining(['Data', 'New']));
  });

  test('存在しないものは本物と同じエラー', { seed }, async () => {
    const get = (spreadsheetId: string, range: string) => sheets.spreadsheets.values.get({ spreadsheetId, range });
    await expect(get('missing', 'A1')).rejects.toMatchObject({ code: 404 });
    await expect(get('book', 'Nope!A1')).rejects.toMatchObject({ code: 400 });
  });

  test('対応していない Google API はエラーになる', () => {
    expect(() => (google as unknown as { drive: unknown }).drive).toThrow('対応していません');
  });
});
