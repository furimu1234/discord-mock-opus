import { describe, expect, test } from '@dismock/test';

const fieldsOf = (reply: Record<string, any>) =>
  Object.fromEntries(reply.embeds[0].fields.map((field: { name: string; value: string }) => [field.name, field.value]));

const adminSeed = {
  guilds: [{ id: '900', name: 'G' }],
  roles: [{ id: '1', name: 'staff', permissions: '32' }],
  users: [
    { id: '100', username: 'admin', roles: ['staff'] },
    { id: '200', username: 'alice' },
    { id: '300', username: 'bob' },
  ],
};
const xpRows = (rows: [string, number][]) =>
  rows.map(([user_id, xp]) => ({ guild_id: '900', user_id, xp }));

const hasRole = async (bot: any, userId: string, roleId: string) =>
  (await bot.state()).guilds['900'].members[userId].roles.includes(roleId);

// 既定のチャンネルは 900 にあるため、901 のデータは表示されてはいけない。
const otherGuildSeed = {
  ...adminSeed,
  guilds: [...adminSeed.guilds, { id: '901', name: 'Other' }],
  db: {
    pg: {
      members: [
        { guild_id: '900', user_id: '100', xp: 100 },
        { guild_id: '901', user_id: '200', xp: 9000 },
      ],
    },
  },
};

describe('/rank', () => {
  test('自分のレベル、XP、順位を表示する', { users: 'login', seed: { ...adminSeed, db: { pg: { members: xpRows([['100', 450], ['200', 900]]) } } } }, async ({ actor }) => {
    const reply = await actor.command('rank');
    expect(reply.embeds[0].title).toBe('admin のランク');
    expect(fieldsOf(reply)).toEqual({ レベル: '2', XP: '450 / 900', 順位: '#2' });
  });

  test('他のユーザーを指定できる', { users: 'login', seed: { ...adminSeed, db: { pg: { members: xpRows([['200', 900]]) } } } }, async ({ actor }) => {
    const reply = await actor.command('rank', { user: '200' });
    expect(fieldsOf(reply)).toMatchObject({ レベル: '3', 順位: '#1' });
  });

  test('順位は他のサーバーの XP を含めない', { users: 'login', seed: otherGuildSeed }, async ({ actor }) => {
    const reply = await actor.command('rank');
    expect(fieldsOf(reply)).toMatchObject({ 順位: '#1' });
  });

  test('XP がないユーザーはレベル 0', { users: 'login' }, async ({ actor }) => {
    const reply = await actor.command('rank');
    expect(fieldsOf(reply)).toEqual({ レベル: '0', XP: '0 / 100', 順位: '#1' });
  });
});

describe('/leaderboard', () => {
  test('XP の高い順に表示する', { users: 'login', seed: { ...adminSeed, db: { pg: { members: xpRows([['100', 50], ['200', 900], ['300', 400]]) } } } }, async ({ actor }) => {
    const reply = await actor.command('leaderboard');
    expect(reply.embeds[0].description.split('\n')).toEqual([
      '1. <@200> Lv.3 (900 XP)',
      '2. <@300> Lv.2 (400 XP)',
      '3. <@100> Lv.0 (50 XP)',
    ]);
  });

  test('他のサーバーのメンバーを含めない', { users: 'login', seed: otherGuildSeed }, async ({ actor }) => {
    const reply = await actor.command('leaderboard');
    expect(reply.embeds[0].description).toBe('1. <@100> Lv.1 (100 XP)');
  });

  test('上位 10 件だけを表示する', { users: 'login', seed: { guilds: adminSeed.guilds, db: { pg: { members: xpRows(Array.from({ length: 12 }, (_, i) => [String(i), i])) } } } }, async ({ actor }) => {
    const reply = await actor.command('leaderboard');
    const lines = reply.embeds[0].description.split('\n');
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain('<@11>');
  });

  test('誰も XP がないときは案内を表示する', { users: 'login' }, async ({ actor }) => {
    const reply = await actor.command('leaderboard');
    expect(reply.embeds[0].description).toContain('まだ誰も');
  });
});

describe('/xp', () => {
  test('管理者は XP を加算でき、複数レベル上がっても 1 回お知らせする', { users: 'login', seed: adminSeed }, async ({ bot, actor, channel, db }) => {
    const reply = await actor.command('xp add', { user: '200', amount: 900 });
    expect(reply.content).toBe('alice に 900 XP を加算しました（合計 900 XP）');
    const levelUps = async () => (await bot.botMessages(channel.id)).map((m) => m.content).filter((c) => c.startsWith('🎉'));
    await expect.poll(levelUps).toEqual(['🎉 <@200> さんがレベル 3 になりました！']);
    await expect(db.pg().rows('members')).resolves.toMatchObject([{ user_id: '200', xp: 900 }]);
  });

  test('管理者は XP をリセットできる', { users: 'login', seed: { ...adminSeed, db: { pg: { members: xpRows([['200', 900]]) } } } }, async ({ actor, db }) => {
    await expect(actor.command('xp reset', { user: '200' })).resolves.toMatchObject({ content: 'alice の XP をリセットしました' });
    await expect(db.pg().rows('members')).resolves.toEqual([]);
  });

  test('サーバーの管理権限がないと拒否する', { users: 'login', seed: adminSeed }, async ({ bot, seeded, channel, db }) => {
    const alice = seeded.users[1];
    const reply = await bot.as(alice).command('xp add', { user: alice.id, amount: 100 });
    expect(reply.content).toBe('このコマンドを使う権限がありません');
    expect(reply.flags & 64).toBe(64);
    await expect(db.pg().rows('members')).resolves.toEqual([]);
  });
});

describe('レベル報酬ロール', () => {
  const rewardSeed = {
    ...adminSeed,
    roles: [...adminSeed.roles, { id: '10', name: 'bronze' }, { id: '30', name: 'gold' }],
  };

  test('設定したレベルに達するとロールを付与する', { users: 'login', seed: { ...rewardSeed, db: { pg: { level_roles: [{ guild_id: '900', level: 1, role_id: '10' }] } } } }, async ({ bot, actor }) => {
    await actor.command('xp add', { user: '200', amount: 100 });
    await expect.poll(() => hasRole(bot, '200', '10')).toBe(true);
  });

  test('発言によるレベルアップでも付与する', { users: 'login', seed: { ...rewardSeed, users: [{ id: '200', username: 'alice' }], db: { pg: { level_roles: [{ guild_id: '900', level: 1, role_id: '10' }], members: [{ guild_id: '900', user_id: '200', xp: 90, last_xp_at: new Date(0) }] } } } }, async ({ bot, actor }) => {
    await actor.sendMessage('レベルアップ');
    await expect.poll(() => hasRole(bot, '200', '10')).toBe(true);
  });

  test('レベルを飛び越えても途中の報酬を付与する', { users: 'login', seed: { ...rewardSeed, db: { pg: { level_roles: [{ guild_id: '900', level: 1, role_id: '10' }, { guild_id: '900', level: 3, role_id: '30' }] } } } }, async ({ bot, actor }) => {
    await actor.command('xp add', { user: '200', amount: 900 });
    await expect.poll(() => hasRole(bot, '200', '30')).toBe(true);
    await expect(hasRole(bot, '200', '10')).resolves.toBe(true);
  });

  test('必要なレベルに達するまで付与しない', { users: 'login', seed: { ...rewardSeed, db: { pg: { level_roles: [{ guild_id: '900', level: 3, role_id: '30' }] } } } }, async ({ bot, actor, channel }) => {
    await actor.command('xp add', { user: '200', amount: 400 });
    await expect.poll(() => bot.botMessages(channel.id)).toHaveLength(2);
    await expect(hasRole(bot, '200', '30')).resolves.toBe(false);
  });

  test('/levelrole set で設定した報酬が付与される', { users: 'login', seed: rewardSeed }, async ({ bot, actor }) => {
    const reply = await actor.command('levelrole set', { level: 1, role: '10' });
    expect(reply.content).toBe('レベル 1 の報酬を bronze に設定しました');
    await actor.command('xp add', { user: '200', amount: 100 });
    await expect.poll(() => hasRole(bot, '200', '10')).toBe(true);
  });

  test('/levelrole remove で解除すると付与されない', { users: 'login', seed: { ...rewardSeed, db: { pg: { level_roles: [{ guild_id: '900', level: 1, role_id: '10' }] } } } }, async ({ bot, actor, channel, db }) => {
    await expect(actor.command('levelrole remove', { level: 1 })).resolves.toMatchObject({ content: 'レベル 1 の報酬を解除しました' });
    await expect(actor.command('levelrole remove', { level: 1 })).resolves.toMatchObject({ content: 'レベル 1 に報酬はありません' });
    await actor.command('xp add', { user: '200', amount: 100 });
    await expect.poll(() => db.pg().rows('members')).toHaveLength(1);
    await expect.poll(async () => (await bot.botMessages(channel.id)).some((m) => m.content.startsWith('🎉'))).toBe(true);
    await expect(hasRole(bot, '200', '10')).resolves.toBe(false);
  });
});
