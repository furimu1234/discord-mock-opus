import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { google } from 'googleapis';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { levels } from './schema.ts';

// 本番と同じように各ドライバーへ接続する。テストではこのファイルを変更しない。
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const orm = drizzle(pool);

const mysqlPool = mysql.createPool({ uri: process.env.MYSQL_URL });

const sqlite = new Database('bot.sqlite');

const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }),
});
const SPREADSHEET_ID = process.env.SPREADSHEET_ID ?? 'scores';

export async function levelUp(userId: string): Promise<number> {
  const [row] = await orm
    .insert(levels)
    .values({ userId, level: 1 })
    .onConflictDoUpdate({ target: levels.userId, set: { level: sql`${levels.level} + 1` } })
    .returning();
  return row!.level;
}

export async function getLevel(userId: string): Promise<number> {
  const [row] = await orm.select().from(levels).where(eq(levels.userId, userId));
  return row?.level ?? 0;
}

export async function addNote(userId: string, body: string): Promise<number> {
  const [result] = await mysqlPool.execute('INSERT INTO notes (user_id, body) VALUES (?, ?)', [userId, body]);
  return (result as { insertId: number }).insertId;
}

export async function countNotes(userId: string): Promise<number> {
  const [rows] = await mysqlPool.query('SELECT COUNT(*) AS total FROM notes WHERE user_id = ?', [userId]);
  return (rows as { total: number }[])[0]!.total;
}

export function saveTag(name: string, content: string): void {
  sqlite.prepare('INSERT INTO tags (name, content) VALUES (?, ?)').run(name, content);
}

export function findTag(name: string): string | undefined {
  const row = sqlite.prepare('SELECT content FROM tags WHERE name = ?').get(name) as
    | { content: string }
    | undefined;
  return row?.content;
}

export async function addScore(name: string, score: number): Promise<void> {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Scores!A:B',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[name, score]] },
  });
}

export async function topScore(): Promise<string> {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Scores!A2:B' });
  const rows = response.data.values ?? [];
  const sorted = [...rows].sort((a, b) => Number(b[1]) - Number(a[1]));
  return sorted[0]?.[0] ?? 'none';
}
