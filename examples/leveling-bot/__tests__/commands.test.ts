import { describe, expect, test } from '@dismock/test';
import { LEADERBOARD_SIZE, levelForXp, xpForLevel } from '../src/levels.ts';

const GUILD = '900';
const OTHER_GUILD = '901';
const ADMIN = '100';
const ALICE = '200';
const BOB = '300';
const MANAGE_GUILD = '32';
const REWARD_ROLE = '10';
const HIGH_REWARD_ROLE = '30';

const fieldsOf = (reply: Record<string, any>) =>
  Object.fromEntries(reply.embeds[0].fields.map((field: { name: string; value: string }) => [field.name, field.value]));

const adminSeed = {
  guilds: [{ id: GUILD, name: 'G' }],
  roles: [{ id: '1', name: 'staff', permissions: MANAGE_GUILD }],
  users: [
    { id: ADMIN, username: 'admin', roles: ['staff'] },
    { id: ALICE, username: 'alice' },
    { id: BOB, username: 'bob' },
  ],
};

const xpRows = (rows: [string, number][], guild_id = GUILD) => rows.map(([user_id, xp]) => ({ guild_id, user_id, xp }));
const rewardRows = (rewards: [number, string][]) =>
  rewards.map(([level, role_id]) => ({ guild_id: GUILD, level, role_id }));

const hasRole = async (bot: any, userId: string, roleId: string) =>
  (await bot.state()).guilds[GUILD].members[userId].roles.includes(roleId);

const rankFields = (xp: number, rank: number) => ({
  レベル: String(levelForXp(xp)),
  XP: `${xp} / ${xpForLevel(levelForXp(xp) + 1)}`,
  順位: `#${rank}`,
});
const leaderboardLine = (position: number, userId: string, xp: number) =>
  `${position}. <@${userId}> Lv.${levelForXp(xp)} (${xp} XP)`;
const levelUpMessage = (userId: string, level: number) => `🎉 <@${userId}> さんがレベル ${level} になりました！`;

// 既定のチャンネルは GUILD にあるため、OTHER_GUILD のデータは表示されてはいけない。
const ADMIN_XP = xpForLevel(1);
const otherGuildSeed = {
  ...adminSeed,
  guilds: [...adminSeed.guilds, { id: OTHER_GUILD, name: 'Other' }],
  db: { pg: { members: [...xpRows([[ADMIN, ADMIN_XP]]), ...xpRows([[ALICE, ADMIN_XP * 2]], OTHER_GUILD)] } },
};

describe('/rank', () => {
  const adminXp = xpForLevel(2) + 1;
  const aliceXp = xpForLevel(3);

  test('自分のレベル、XP、順位を表示する', { users: 'login', seed: { ...adminSeed, db: { pg: { members: xpRows([[ADMIN, adminXp], [ALICE, aliceXp]]) } } } }, async ({ actor }) => {
    const reply = await actor.command('rank');
    expect(reply.embeds[0].title).toBe('admin のランク');
    expect(fieldsOf(reply)).toEqual(rankFields(adminXp, 2));
  });

  test('他のユーザーを指定できる', { users: 'login', seed: { ...adminSeed, db: { pg: { members: xpRows([[ALICE, aliceXp]]) } } } }, async ({ actor }) => {
    const reply = await actor.command('rank', { user: ALICE });
    expect(fieldsOf(reply)).toEqual(rankFields(aliceXp, 1));
  });

  test('順位は他のサーバーの XP を含めない', { users: 'login', seed: otherGuildSeed }, async ({ actor }) => {
    const reply = await actor.command('rank');
    expect(fieldsOf(reply)).toEqual(rankFields(ADMIN_XP, 1));
  });

  test('XP がないユーザーは最初のレベル', { users: 'login' }, async ({ actor }) => {
    const reply = await actor.command('rank');
    expect(fieldsOf(reply)).toEqual(rankFields(0, 1));
  });
});

describe('/leaderboard', () => {
  test('XP の高い順に表示する', { users: 'login', seed: { ...adminSeed, db: { pg: { members: xpRows([[ADMIN, xpForLevel(1)], [ALICE, xpForLevel(3)], [BOB, xpForLevel(2)]]) } } } }, async ({ actor }) => {
    const reply = await actor.command('leaderboard');
    expect(reply.embeds[0].description.split('\n')).toEqual([
      leaderboardLine(1, ALICE, xpForLevel(3)),
      leaderboardLine(2, BOB, xpForLevel(2)),
      leaderboardLine(3, ADMIN, xpForLevel(1)),
    ]);
  });

  test('他のサーバーのメンバーを含めない', { users: 'login', seed: otherGuildSeed }, async ({ actor }) => {
    const reply = await actor.command('leaderboard');
    expect(reply.embeds[0].description).toBe(leaderboardLine(1, ADMIN, ADMIN_XP));
  });

  const manyMembers = Array.from({ length: LEADERBOARD_SIZE + 1 }, (_, i): [string, number] => [String(i), i]);

  test('上限の人数だけを表示する', { users: 'login', seed: { guilds: adminSeed.guilds, db: { pg: { members: xpRows(manyMembers) } } } }, async ({ actor }) => {
    const reply = await actor.command('leaderboard');
    const lines = reply.embeds[0].description.split('\n');
    expect(lines).toHaveLength(LEADERBOARD_SIZE);
    const [topId, topXp] = manyMembers.at(-1)!;
    expect(lines[0]).toBe(leaderboardLine(1, topId, topXp));
  });

  test('誰も XP がないときは案内を表示する', { users: 'login' }, async ({ actor }) => {
    const reply = await actor.command('leaderboard');
    expect(reply.embeds[0].description).toContain('まだ誰も');
  });
});

describe('/xp', () => {
  test('管理者は XP を加算でき、複数レベル上がっても 1 回お知らせする', { users: 'login', seed: adminSeed }, async ({ bot, actor, channel, db }) => {
    const amount = xpForLevel(3);
    const reply = await actor.command('xp add', { user: ALICE, amount });
    expect(reply.content).toBe(`alice に ${amount} XP を加算しました（合計 ${amount} XP）`);
    const levelUps = async () => (await bot.botMessages(channel.id)).map((m) => m.content).filter((c) => c.startsWith('🎉'));
    await expect.poll(levelUps).toEqual([levelUpMessage(ALICE, levelForXp(amount))]);
    await expect(db.pg().rows('members')).resolves.toMatchObject([{ user_id: ALICE, xp: amount }]);
  });

  test('管理者は XP をリセットできる', { users: 'login', seed: { ...adminSeed, db: { pg: { members: xpRows([[ALICE, xpForLevel(1)]]) } } } }, async ({ actor, db }) => {
    await expect(actor.command('xp reset', { user: ALICE })).resolves.toMatchObject({ content: 'alice の XP をリセットしました' });
    await expect(db.pg().rows('members')).resolves.toEqual([]);
  });

  test('サーバーの管理権限がないと拒否する', { users: 'login', seed: adminSeed }, async ({ bot, seeded, db }) => {
    const alice = seeded.users[1];
    const reply = await bot.as(alice).command('xp add', { user: alice.id, amount: xpForLevel(1) });
    expect(reply.content).toBe('このコマンドを使う権限がありません');
    expect(reply.flags & 64).toBe(64);
    await expect(db.pg().rows('members')).resolves.toEqual([]);
  });
});

describe('レベル報酬ロール', () => {
  const LOW_LEVEL = 1;
  const HIGH_LEVEL = 3;
  const rewardSeed = {
    ...adminSeed,
    roles: [...adminSeed.roles, { id: REWARD_ROLE, name: 'bronze' }, { id: HIGH_REWARD_ROLE, name: 'gold' }],
  };

  test('設定したレベルに達するとロールを付与する', { users: 'login', seed: { ...rewardSeed, db: { pg: { level_roles: rewardRows([[LOW_LEVEL, REWARD_ROLE]]) } } } }, async ({ bot, actor }) => {
    await actor.command('xp add', { user: ALICE, amount: xpForLevel(LOW_LEVEL) });
    await expect.poll(() => hasRole(bot, ALICE, REWARD_ROLE)).toBe(true);
  });

  test('レベルを飛び越えても途中の報酬を付与する', { users: 'login', seed: { ...rewardSeed, db: { pg: { level_roles: rewardRows([[LOW_LEVEL, REWARD_ROLE], [HIGH_LEVEL, HIGH_REWARD_ROLE]]) } } } }, async ({ bot, actor }) => {
    await actor.command('xp add', { user: ALICE, amount: xpForLevel(HIGH_LEVEL) });
    await expect.poll(() => hasRole(bot, ALICE, HIGH_REWARD_ROLE)).toBe(true);
    await expect(hasRole(bot, ALICE, REWARD_ROLE)).resolves.toBe(true);
  });

  test('必要なレベルに達するまで付与しない', { users: 'login', seed: { ...rewardSeed, db: { pg: { level_roles: rewardRows([[HIGH_LEVEL, HIGH_REWARD_ROLE]]) } } } }, async ({ bot, actor, channel }) => {
    await actor.command('xp add', { user: ALICE, amount: xpForLevel(HIGH_LEVEL - 1) });
    await expect.poll(async () => (await bot.botMessages(channel.id)).map((m) => m.content)).toContain(levelUpMessage(ALICE, HIGH_LEVEL - 1));
    await expect(hasRole(bot, ALICE, HIGH_REWARD_ROLE)).resolves.toBe(false);
  });

  test('/levelrole set で設定した報酬が付与される', { users: 'login', seed: rewardSeed }, async ({ bot, actor }) => {
    const reply = await actor.command('levelrole set', { level: LOW_LEVEL, role: REWARD_ROLE });
    expect(reply.content).toBe(`レベル ${LOW_LEVEL} の報酬を bronze に設定しました`);
    await actor.command('xp add', { user: ALICE, amount: xpForLevel(LOW_LEVEL) });
    await expect.poll(() => hasRole(bot, ALICE, REWARD_ROLE)).toBe(true);
  });

  test('/levelrole remove で解除すると付与されない', { users: 'login', seed: { ...rewardSeed, db: { pg: { level_roles: rewardRows([[LOW_LEVEL, REWARD_ROLE]]) } } } }, async ({ bot, actor, channel }) => {
    await expect(actor.command('levelrole remove', { level: LOW_LEVEL })).resolves.toMatchObject({ content: `レベル ${LOW_LEVEL} の報酬を解除しました` });
    await expect(actor.command('levelrole remove', { level: LOW_LEVEL })).resolves.toMatchObject({ content: `レベル ${LOW_LEVEL} に報酬はありません` });
    await actor.command('xp add', { user: ALICE, amount: xpForLevel(LOW_LEVEL) });
    await expect.poll(async () => (await bot.botMessages(channel.id)).map((m) => m.content)).toContain(levelUpMessage(ALICE, LOW_LEVEL));
    await expect(hasRole(bot, ALICE, REWARD_ROLE)).resolves.toBe(false);
  });
});
