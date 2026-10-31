import { describe, expect, test } from '@dismock/test';

describe('pg + drizzle', () => {
  test('Bot の接続がインメモリ DB に届く', { users: 'login' }, async ({ actor, user, db }) => {
    await actor.command('levelup');
    const reply = await actor.command('levelup');
    expect(reply.content).toBe('Level 2');
    await expect(db.pg().rows('levels')).resolves.toEqual([{ user_id: user.id, level: 2 }]);
  });

  test('テストごとにデータは空になる', { users: 'login' }, async ({ db }) => {
    await expect(db.pg().rows('levels')).resolves.toEqual([]);
  });

  test('初期データを投入できる', { users: 'login', seed: { users: [{ id: '100', username: 'veteran' }], db: { pg: { levels: [{ user_id: '100', level: 41 }] } } } }, async ({ actor }) => {
    await expect(actor.command('levelup')).resolves.toMatchObject({ content: 'Level 42' });
  });
});

describe('mysql2', () => {
  test('INSERT と SELECT', { users: 'login' }, async ({ actor, user, db }) => {
    await actor.command('note', { body: 'first' });
    const reply = await actor.command('note', { body: "it's second" });
    expect(reply.content).toBe('Notes: 2');
    const rows = db.mysql().rows<{ id: number; body: string; created_at: Date; user_id: string }>('notes');
    expect(rows.map((row) => row.id)).toEqual([1, 2]);
    expect(rows[1]!.body).toBe("it's second");
    expect(rows[1]!.user_id).toBe(user.id);
    expect(rows[1]!.created_at).toBeInstanceOf(Date);
  });

  test('連番はテストごとに戻る', { users: 'login' }, async ({ actor, db }) => {
    await actor.command('note', { body: 'again' });
    expect(db.mysql().rows<{ id: number }>('notes')[0]!.id).toBe(1);
  });
});

describe('better-sqlite3', () => {
  test('サブコマンドで保存して読み出す', { users: 'login' }, async ({ actor, db }) => {
    await actor.command('tag set', { name: 'rule', content: 'be nice' });
    await expect(actor.command('tag get', { name: 'rule' })).resolves.toMatchObject({ content: 'be nice' });
    expect(db.sqlite().rows('tags')).toEqual([{ name: 'rule', content: 'be nice' }]);
  });
});

describe('Google スプレッドシート', () => {
  const seed = {
    db: { sheets: { scores: { Scores: [['name', 'score'], ['alice', 10], ['bob', 30]] } } },
  };

  test('初期データを読み取る', { users: 'login', seed }, async ({ actor }) => {
    await expect(actor.command('top')).resolves.toMatchObject({ content: 'Top: bob' });
  });

  test('行を追加する', { users: 'login', seed }, async ({ actor, db }) => {
    await actor.command('score', { value: 99 });
    await expect(actor.command('top')).resolves.toMatchObject({ content: 'Top: test-user' });
    expect(db.sheets().values('scores', 'Scores!A4:B4')).toEqual([['test-user', '99']]);
  });
});
