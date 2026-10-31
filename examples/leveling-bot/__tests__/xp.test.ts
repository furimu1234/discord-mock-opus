import { describe, expect, test } from '@dismock/test';
import { COOLDOWN_SECONDS, levelForXp, xpForLevel, XP_PER_MESSAGE } from '../src/levels.ts';

const GUILD = '900';
const REWARD_ROLE = '10';
const seedUser = { id: '100', username: 'alice' };
const cooldownExpiredAt = () => new Date(Date.now() - (COOLDOWN_SECONDS + 1) * 1000);

const memberXp = (db: any, userId = seedUser.id) =>
  db.pg().query('SELECT xp FROM members WHERE user_id = $1', [userId]).then((rows: { xp: number }[]) => rows[0]?.xp);

const settle = () => new Promise((done) => setTimeout(done, 150));

const memberSeed = (xp: number, extra: Record<string, unknown> = {}) => ({
  guilds: [{ id: GUILD, name: 'G' }],
  users: [seedUser],
  ...extra,
  db: { pg: { members: [{ guild_id: GUILD, user_id: seedUser.id, xp, last_xp_at: cooldownExpiredAt() }] } },
});

describe('発言による XP の獲得', () => {
  test('発言すると規定の XP を獲得する', { users: 'login' }, async ({ actor, user, db }) => {
    await actor.sendMessage('こんにちは');
    await expect.poll(() => memberXp(db, user.id)).toBe(XP_PER_MESSAGE);
  });

  test('クールダウン中の発言では XP が増えない', { users: 'login' }, async ({ actor, user, db }) => {
    await actor.sendMessage('1');
    await expect.poll(() => memberXp(db, user.id)).toBe(XP_PER_MESSAGE);
    await actor.sendMessage('2');
    await settle();
    await expect(memberXp(db, user.id)).resolves.toBe(XP_PER_MESSAGE);
  });

  test('連続した発言が同時に処理されても 1 回分だけ加算する', { users: 'login' }, async ({ actor, user, db }) => {
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((text) => actor.sendMessage(text)));
    await expect.poll(() => memberXp(db, user.id)).toBe(XP_PER_MESSAGE);
    await settle();
    await expect(memberXp(db, user.id)).resolves.toBe(XP_PER_MESSAGE);
  });

  test('クールダウンが明けると再び獲得する', { users: 'login', seed: memberSeed(XP_PER_MESSAGE) }, async ({ actor, db }) => {
    const before = await memberXp(db);
    await actor.sendMessage('お久しぶりです');
    await expect.poll(() => memberXp(db)).toBe(before + XP_PER_MESSAGE);
  });

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
    await expect.poll(() => db.pg().rows('members')).toHaveLength(seeded.users.length);
    await expect(memberXp(db, a.id)).resolves.toBe(XP_PER_MESSAGE);
    await expect(memberXp(db, b.id)).resolves.toBe(XP_PER_MESSAGE);
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
      await expect.poll(() => db.pg().rows('members')).toHaveLength(seeded.guilds.length);
      const rows = await db.pg().rows<{ guild_id: string; user_id: string; xp: number }>('members');
      expect(rows.map((row) => row.guild_id).sort()).toEqual(seeded.guilds.map((guild: { id: string }) => guild.id).sort());
      expect(rows.every((row) => row.user_id === user.id && row.xp === XP_PER_MESSAGE)).toBe(true);
    },
  );
});

describe('レベルアップ', () => {
  const TARGET_LEVEL = 1;
  const threshold = xpForLevel(TARGET_LEVEL);
  const announcements = async (bot: any, channelId: string) =>
    (await bot.botMessages(channelId)).map((message: { content: string }) => message.content);

  test('必要 XP を超えるとチャンネルでお知らせする', { users: 'login', seed: memberSeed(threshold - XP_PER_MESSAGE + 1) }, async ({ bot, actor, channel }) => {
    await actor.sendMessage('もう少し');
    await expect.poll(() => announcements(bot, channel.id)).toEqual([`🎉 <@${seedUser.id}> さんがレベル ${TARGET_LEVEL} になりました！`]);
  });

  test('ちょうど必要 XP に達してもレベルアップする', { users: 'login', seed: memberSeed(threshold - XP_PER_MESSAGE) }, async ({ bot, actor, channel }) => {
    await actor.sendMessage('ぴったり');
    await expect.poll(() => bot.botMessages(channel.id)).toHaveLength(1);
  });

  test('必要 XP の手前ではお知らせしない', { users: 'login', seed: memberSeed(threshold - XP_PER_MESSAGE - 1) }, async ({ bot, actor, channel, db }) => {
    await actor.sendMessage('あと 1 XP');
    await expect.poll(() => memberXp(db)).toBe(threshold - 1);
    await settle();
    await expect(bot.botMessages(channel.id)).resolves.toEqual([]);
  });

  test('発言でお知らせするのはレベルが上がったときだけ', { users: 'login', seed: memberSeed(threshold) }, async ({ bot, actor, channel, db }) => {
    await actor.sendMessage('レベルは変わらない');
    await expect.poll(() => memberXp(db)).toBe(threshold + XP_PER_MESSAGE);
    expect(levelForXp(threshold + XP_PER_MESSAGE)).toBe(TARGET_LEVEL);
    await settle();
    await expect(bot.botMessages(channel.id)).resolves.toEqual([]);
  });

  test(
    '発言によるレベルアップでも報酬ロールを付与する',
    {
      users: 'login',
      seed: memberSeed(threshold - XP_PER_MESSAGE, {
        roles: [{ id: REWARD_ROLE, name: 'bronze' }],
      }),
    },
    async ({ bot, actor, db }) => {
      await db.pg().seed({ level_roles: [{ guild_id: GUILD, level: TARGET_LEVEL, role_id: REWARD_ROLE }] });
      await actor.sendMessage('レベルアップ');
      await expect
        .poll(async () => (await bot.state()).guilds[GUILD].members[seedUser.id].roles.includes(REWARD_ROLE))
        .toBe(true);
    },
  );
});
