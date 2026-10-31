import { describe, expect, test } from '@dismock/test';

const fieldOf = (reply: Record<string, any>) => Number(/\d+/.exec(reply.content)![0]);

describe('pg + drizzle', () => {
  test('Bot の接続がインメモリ DB に届く', { users: 'login' }, async ({ actor, user, db }) => {
    await actor.command('levelup');
    const before = fieldOf(await actor.command('level'));
    const reply = await actor.command('levelup');
    expect(fieldOf(reply)).toBe(before + 1);
    await expect(db.pg().query('SELECT level FROM levels WHERE user_id = $1', [user.id])).resolves.toEqual([{ level: before + 1 }]);
  });

  test('テストコードから投入したデータを Bot が参照できる', { users: 'login' }, async ({ actor, user, db }) => {
    const level = 41;
    await db.pg().query(
      'INSERT INTO levels (user_id, level) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET level = $2',
      [user.id, level],
    );
    await expect(actor.command('levelup')).resolves.toMatchObject({ content: `Level ${level + 1}` });
  });
});

describe('mysql2', () => {
  test('INSERT と SELECT', { users: 'login' }, async ({ actor, user, db }) => {
    const bodies = ['first', "it's second"];
    const notes = () =>
      db.mysql().query<{ id: number; body: string; created_at: Date }>('SELECT * FROM notes WHERE user_id = ? ORDER BY id', [user.id]);
    const before = notes().length;
    await actor.command('note', { body: bodies[0] });
    const reply = await actor.command('note', { body: bodies[1] });
    expect(reply.content).toBe(`Notes: ${before + bodies.length}`);
    const rows = notes().slice(before);
    expect(rows.map((row) => row.body)).toEqual(bodies);
    expect(rows[1]!.id).toBe(rows[0]!.id + 1);
    expect(rows[1]!.created_at).toBeInstanceOf(Date);
  });
});

describe('better-sqlite3', () => {
  test('サブコマンドで保存して読み出す', { users: 'login' }, async ({ actor, db }) => {
    const name = `rule-${Date.now()}`;
    const content = 'be nice';
    await actor.command('tag set', { name, content });
    await expect(actor.command('tag get', { name })).resolves.toMatchObject({ content });
    expect(db.sqlite().query('SELECT content FROM tags WHERE name = ?', name as never)).toEqual([{ content }]);
  });
});

describe('Google スプレッドシート', () => {
  const header = ['name', 'score'];
  const rows: [string, number][] = [['alice', 10], ['bob', 30]];
  const seed = { db: { sheets: { scores: { Scores: [header, ...rows] } } } };
  const nextRow = rows.length + 2;

  test('初期データを読み取る', { users: 'login', seed }, async ({ actor }) => {
    await expect(actor.command('top')).resolves.toMatchObject({ content: 'Top: bob' });
  });

  test('行を追加する', { users: 'login', seed }, async ({ actor, user, db }) => {
    const score = Math.max(...rows.map(([, value]) => value)) + 1;
    await actor.command('score', { value: score });
    await expect(actor.command('top')).resolves.toMatchObject({ content: `Top: ${user.username}` });
    expect(db.sheets().values('scores', `Scores!A${nextRow}:B${nextRow}`)).toEqual([[user.username, String(score)]]);
  });
});
