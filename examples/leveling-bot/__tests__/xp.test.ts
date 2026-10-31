import { describe, expect, test } from '@dismock/test';

const GUILD = '900';
const longAgo = new Date(Date.now() - 3600 * 1000);
const seedUser = { id: '100', username: 'alice' };

const memberRow = (db: any, userId = seedUser.id) =>
  db.pg().query('SELECT xp FROM members WHERE user_id = $1', [userId]).then((rows: { xp: number }[]) => rows[0]?.xp);

const settle = () => new Promise((done) => setTimeout(done, 150));

describe('発言による XP の獲得', () => {
  test('発言すると 15 XP を獲得する', { users: 'login' }, async ({ actor, user, db }) => {
    await actor.sendMessage('こんにちは');
    await expect.poll(() => memberRow(db, user.id)).toBe(15);
  });

  test('クールダウン中の発言では XP が増えない', { users: 'login' }, async ({ actor, user, db }) => {
    await actor.sendMessage('1');
    await expect.poll(() => memberRow(db, user.id)).toBe(15);
    await actor.sendMessage('2');
    await settle();
    await expect(memberRow(db, user.id)).resolves.toBe(15);
  });

  test('連続した発言が同時に処理されても 1 回分だけ加算する', { users: 'login' }, async ({ actor, user, db }) => {
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((text) => actor.sendMessage(text)));
    await expect.poll(() => memberRow(db, user.id)).toBe(15);
    await settle();
    await expect(memberRow(db, user.id)).resolves.toBe(15);
  });

  test(
    'クールダウンが明けると再び獲得する',
    { users: 'login', seed: { users: [seedUser], db: { pg: { members: [{ guild_id: GUILD, user_id: seedUser.id, xp: 30, last_xp_at: longAgo }] } }, guilds: [{ id: GUILD, name: 'G' }] } },
    async ({ actor, db }) => {
      await actor.sendMessage('お久しぶりです');
      await expect.poll(() => memberRow(db)).toBe(45);
    },
  );

  test(
    'Bot の発言では XP を獲得しない',
    { users: 'login', seed: { guilds: [{ name: 'G' }], users: [{ username: 'human' }, { username: 'other-bot', bot: true, guild: 'G' }] } },
    async ({ bot, seeded, db }) => {
      await bot.as(seeded.users[1]).sendMessage('beep');
      await settle();
      await expect(db.pg().rows('members')).resolves.toEqual([]);
    },
  );

  test('メンバーごとに別々に集計する', { users: 'login', seed: { users: [{ username: 'a' }, { username: 'b' }] } }, async ({ bot, seeded, db }) => {
    const [a, b] = seeded.users;
    await bot.as(a).sendMessage('1');
    await bot.as(b).sendMessage('2');
    await expect.poll(() => db.pg().rows('members')).toHaveLength(2);
    await expect(memberRow(db, a.id)).resolves.toBe(15);
    await expect(memberRow(db, b.id)).resolves.toBe(15);
  });

  test(
    'サーバーごとに別々に集計する',
    {
      users: 'login',
      seed: {
        guilds: [{ name: 'A' }, { name: 'B' }],
        channels: [{ name: 'a', guild: 'A' }, { name: 'b', guild: 'B' }],
        users: [{ username: 'traveler', guilds: ['A', 'B'] }],
      },
    },
    async ({ actor, seeded, user, db }) => {
      await actor.sendMessage('A で発言', { channelId: seeded.channels[0].id });
      await actor.sendMessage('B で発言', { channelId: seeded.channels[1].id });
      await expect.poll(() => db.pg().rows('members')).toHaveLength(2);
      const rows = await db.pg().rows<{ guild_id: string; user_id: string; xp: number }>('members');
      expect(rows.map((row) => row.guild_id).sort()).toEqual(seeded.guilds.map((guild: { id: string }) => guild.id).sort());
      expect(rows.every((row) => row.user_id === user.id && row.xp === 15)).toBe(true);
    },
  );
});

describe('レベルアップ', () => {
  const nearLevelUp = (xp: number) => ({
    guilds: [{ id: GUILD, name: 'G' }],
    users: [seedUser],
    db: { pg: { members: [{ guild_id: GUILD, user_id: seedUser.id, xp, last_xp_at: longAgo }] } },
  });
  const announcements = async (bot: any, channelId: string) =>
    (await bot.botMessages(channelId)).map((message: { content: string }) => message.content);

  test('必要 XP に達するとチャンネルでお知らせする', { users: 'login', seed: nearLevelUp(95) }, async ({ bot, actor, channel }) => {
    await actor.sendMessage('もう少し');
    await expect.poll(() => announcements(bot, channel.id)).toEqual([`🎉 <@${seedUser.id}> さんがレベル 1 になりました！`]);
  });

  test('ちょうど必要 XP に達してもレベルアップする', { users: 'login', seed: nearLevelUp(85) }, async ({ bot, actor, channel }) => {
    await actor.sendMessage('ぴったり');
    await expect.poll(() => bot.botMessages(channel.id)).toHaveLength(1);
  });

  test('必要 XP の手前ではお知らせしない', { users: 'login', seed: nearLevelUp(84) }, async ({ bot, actor, channel, db }) => {
    await actor.sendMessage('あと 1 XP');
    await expect.poll(() => memberRow(db)).toBe(99);
    await settle();
    await expect(bot.botMessages(channel.id)).resolves.toEqual([]);
  });

  test('発言でお知らせするのはレベルが上がったときだけ', { users: 'login', seed: nearLevelUp(100) }, async ({ bot, actor, channel, db }) => {
    await actor.sendMessage('レベル 1 のまま');
    await expect.poll(() => memberRow(db)).toBe(115);
    await settle();
    await expect(bot.botMessages(channel.id)).resolves.toEqual([]);
  });
});
