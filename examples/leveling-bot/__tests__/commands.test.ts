import { describe, expect, test } from '@dismock/test';
import { LEADERBOARD_SIZE, levelForXp, xpForLevel } from '../src/levels.ts';

const MANAGE_GUILD = '32';
const EPHEMERAL = 64;
const HIGH_LEVEL = 3;
const LOW_LEVEL = 1;

// 順位やランキングはサーバー全体の値なので、テストごとに新しいサーバーを使う。
const guildSeed = {
  guilds: [{ name: 'ランキング' }],
  roles: [{ name: 'staff', permissions: MANAGE_GUILD }, { name: 'bronze' }, { name: 'gold' }],
  users: [{ username: 'admin', roles: ['staff'] }, { username: 'alice' }, { username: 'bob' }],
};
const otherGuildSeed = { ...guildSeed, guilds: [...guildSeed.guilds, { name: 'Other' }] };

type Seeded = Record<string, any>;

const usersOf = ({ users }: Seeded) => ({ admin: users[0], alice: users[1], bob: users[2] });
const rolesOf = ({ roles }: Seeded) => ({ bronze: roles[1].id as string, gold: roles[2].id as string });

const seedXp = (db: any, guildId: string, rows: [string, number][]) =>
  db.pg().seed({ members: rows.map(([user_id, xp]) => ({ guild_id: guildId, user_id, xp })) });
const seedRewards = (db: any, guildId: string, rewards: [number, string][]) =>
  db.pg().seed({ level_roles: rewards.map(([level, role_id]) => ({ guild_id: guildId, level, role_id })) });

const fieldsOf = (reply: Record<string, any>) =>
  Object.fromEntries(reply.embeds[0].fields.map((field: { name: string; value: string }) => [field.name, field.value]));
const rankFields = (xp: number, rank: number) => ({
  レベル: String(levelForXp(xp)),
  XP: `${xp} / ${xpForLevel(levelForXp(xp) + 1)}`,
  順位: `#${rank}`,
});
const leaderboardLine = (position: number, userId: string, xp: number) =>
  `${position}. <@${userId}> Lv.${levelForXp(xp)} (${xp} XP)`;
const levelUpMessage = (userId: string, level: number) => `🎉 <@${userId}> さんがレベル ${level} になりました！`;

const contents = async (bot: any, channelId: string) =>
  (await bot.botMessages(channelId)).map((message: { content: string }) => message.content);
const hasRole = async (bot: any, guildId: string, userId: string, roleId: string) =>
  (await bot.state()).guilds[guildId].members[userId].roles.includes(roleId);

describe('/rank', () => {
  const adminXp = xpForLevel(2) + 1;
  const aliceXp = xpForLevel(3);

  test('自分のレベル、XP、順位を表示する', { users: 'login', seed: guildSeed }, async ({ actor, guild, seeded, db }) => {
    const { admin, alice } = usersOf(seeded);
    await seedXp(db, guild.id, [[admin.id, adminXp], [alice.id, aliceXp]]);
    const reply = await actor.command('rank');
    expect(reply.embeds[0].title).toBe(`${admin.username} のランク`);
    expect(fieldsOf(reply)).toEqual(rankFields(adminXp, 2));
  });

  test('他のユーザーを指定できる', { users: 'login', seed: guildSeed }, async ({ actor, guild, seeded, db }) => {
    const { alice } = usersOf(seeded);
    await seedXp(db, guild.id, [[alice.id, aliceXp]]);
    const reply = await actor.command('rank', { user: alice.id });
    expect(fieldsOf(reply)).toEqual(rankFields(aliceXp, 1));
  });

  test('順位は他のサーバーの XP を含めない', { users: 'login', seed: otherGuildSeed }, async ({ actor, guild, seeded, db }) => {
    const { admin, alice } = usersOf(seeded);
    await seedXp(db, guild.id, [[admin.id, adminXp]]);
    await seedXp(db, seeded.guilds[1].id, [[alice.id, aliceXp]]);
    const reply = await actor.command('rank');
    expect(fieldsOf(reply)).toEqual(rankFields(adminXp, 1));
  });

  test('XP がないユーザーは最初のレベル', { users: 'login', seed: guildSeed }, async ({ actor }) => {
    const reply = await actor.command('rank');
    expect(fieldsOf(reply)).toEqual(rankFields(0, 1));
  });
});

describe('/leaderboard', () => {
  test('XP の高い順に表示する', { users: 'login', seed: guildSeed }, async ({ actor, guild, seeded, db }) => {
    const { admin, alice, bob } = usersOf(seeded);
    await seedXp(db, guild.id, [[admin.id, xpForLevel(1)], [alice.id, xpForLevel(3)], [bob.id, xpForLevel(2)]]);
    const reply = await actor.command('leaderboard');
    expect(reply.embeds[0].description.split('\n')).toEqual([
      leaderboardLine(1, alice.id, xpForLevel(3)),
      leaderboardLine(2, bob.id, xpForLevel(2)),
      leaderboardLine(3, admin.id, xpForLevel(1)),
    ]);
  });

  test('他のサーバーのメンバーを含めない', { users: 'login', seed: otherGuildSeed }, async ({ actor, guild, seeded, db }) => {
    const { admin, alice } = usersOf(seeded);
    await seedXp(db, guild.id, [[admin.id, xpForLevel(1)]]);
    await seedXp(db, seeded.guilds[1].id, [[alice.id, xpForLevel(2)]]);
    const reply = await actor.command('leaderboard');
    expect(reply.embeds[0].description).toBe(leaderboardLine(1, admin.id, xpForLevel(1)));
  });

  test('上限の人数だけを表示する', { users: 'login', seed: guildSeed }, async ({ actor, guild, db }) => {
    const members = Array.from({ length: LEADERBOARD_SIZE + 1 }, (_, i): [string, number] => [String(i), i]);
    await seedXp(db, guild.id, members);
    const reply = await actor.command('leaderboard');
    const lines = reply.embeds[0].description.split('\n');
    expect(lines).toHaveLength(LEADERBOARD_SIZE);
    const [topId, topXp] = members.at(-1)!;
    expect(lines[0]).toBe(leaderboardLine(1, topId, topXp));
  });

  test('誰も XP がないときは案内を表示する', { users: 'login', seed: guildSeed }, async ({ actor }) => {
    const reply = await actor.command('leaderboard');
    expect(reply.embeds[0].description).toContain('まだ誰も');
  });
});

describe('/xp', () => {
  test('管理者は XP を加算でき、複数レベル上がっても 1 回お知らせする', { users: 'login', seed: guildSeed }, async ({ bot, actor, channel, seeded }) => {
    const { alice } = usersOf(seeded);
    const amount = xpForLevel(HIGH_LEVEL);
    const reply = await actor.command('xp add', { user: alice.id, amount });
    expect(reply.content).toBe(`${alice.username} に ${amount} XP を加算しました（合計 ${amount} XP）`);
    const levelUps = async () => (await contents(bot, channel.id)).filter((c: string) => c.startsWith('🎉'));
    await expect.poll(levelUps).toEqual([levelUpMessage(alice.id, levelForXp(amount))]);
  });

  test('管理者は XP をリセットできる', { users: 'login', seed: guildSeed }, async ({ actor, guild, seeded, db }) => {
    const { alice } = usersOf(seeded);
    await seedXp(db, guild.id, [[alice.id, xpForLevel(1)]]);
    await expect(actor.command('xp reset', { user: alice.id })).resolves.toMatchObject({ content: `${alice.username} の XP をリセットしました` });
    await expect(db.pg().query('SELECT * FROM members WHERE guild_id = $1', [guild.id])).resolves.toEqual([]);
  });

  test('サーバーの管理権限がないと拒否する', { users: 'login', seed: guildSeed }, async ({ bot, guild, seeded, db }) => {
    const { alice } = usersOf(seeded);
    const reply = await bot.as(alice).command('xp add', { user: alice.id, amount: xpForLevel(1) });
    expect(reply.content).toBe('このコマンドを使う権限がありません');
    expect(reply.flags & EPHEMERAL).toBe(EPHEMERAL);
    await expect(db.pg().query('SELECT * FROM members WHERE guild_id = $1', [guild.id])).resolves.toEqual([]);
  });
});

describe('レベル報酬ロール', () => {
  test('設定したレベルに達するとロールを付与する', { users: 'login', seed: guildSeed }, async ({ bot, actor, guild, seeded, db }) => {
    const { alice } = usersOf(seeded);
    const { bronze } = rolesOf(seeded);
    await seedRewards(db, guild.id, [[LOW_LEVEL, bronze]]);
    await actor.command('xp add', { user: alice.id, amount: xpForLevel(LOW_LEVEL) });
    await expect.poll(() => hasRole(bot, guild.id, alice.id, bronze)).toBe(true);
  });

  test('レベルを飛び越えても途中の報酬を付与する', { users: 'login', seed: guildSeed }, async ({ bot, actor, guild, seeded, db }) => {
    const { alice } = usersOf(seeded);
    const { bronze, gold } = rolesOf(seeded);
    await seedRewards(db, guild.id, [[LOW_LEVEL, bronze], [HIGH_LEVEL, gold]]);
    await actor.command('xp add', { user: alice.id, amount: xpForLevel(HIGH_LEVEL) });
    await expect.poll(() => hasRole(bot, guild.id, alice.id, gold)).toBe(true);
    await expect(hasRole(bot, guild.id, alice.id, bronze)).resolves.toBe(true);
  });

  test('必要なレベルに達するまで付与しない', { users: 'login', seed: guildSeed }, async ({ bot, actor, channel, guild, seeded, db }) => {
    const { alice } = usersOf(seeded);
    const { gold } = rolesOf(seeded);
    await seedRewards(db, guild.id, [[HIGH_LEVEL, gold]]);
    await actor.command('xp add', { user: alice.id, amount: xpForLevel(HIGH_LEVEL - 1) });
    await expect.poll(() => contents(bot, channel.id)).toContain(levelUpMessage(alice.id, HIGH_LEVEL - 1));
    await expect(hasRole(bot, guild.id, alice.id, gold)).resolves.toBe(false);
  });

  test('/levelrole set で設定した報酬が付与される', { users: 'login', seed: guildSeed }, async ({ bot, actor, guild, seeded }) => {
    const { alice } = usersOf(seeded);
    const { bronze } = rolesOf(seeded);
    const reply = await actor.command('levelrole set', { level: LOW_LEVEL, role: bronze });
    expect(reply.content).toBe(`レベル ${LOW_LEVEL} の報酬を bronze に設定しました`);
    await actor.command('xp add', { user: alice.id, amount: xpForLevel(LOW_LEVEL) });
    await expect.poll(() => hasRole(bot, guild.id, alice.id, bronze)).toBe(true);
  });

  test('/levelrole remove で解除すると付与されない', { users: 'login', seed: guildSeed }, async ({ bot, actor, channel, guild, seeded, db }) => {
    const { alice } = usersOf(seeded);
    const { bronze } = rolesOf(seeded);
    await seedRewards(db, guild.id, [[LOW_LEVEL, bronze]]);
    await expect(actor.command('levelrole remove', { level: LOW_LEVEL })).resolves.toMatchObject({ content: `レベル ${LOW_LEVEL} の報酬を解除しました` });
    await expect(actor.command('levelrole remove', { level: LOW_LEVEL })).resolves.toMatchObject({ content: `レベル ${LOW_LEVEL} に報酬はありません` });
    await actor.command('xp add', { user: alice.id, amount: xpForLevel(LOW_LEVEL) });
    await expect.poll(() => contents(bot, channel.id)).toContain(levelUpMessage(alice.id, LOW_LEVEL));
    await expect(hasRole(bot, guild.id, alice.id, bronze)).resolves.toBe(false);
  });
});
