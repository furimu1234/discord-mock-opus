import { describe, expect, test } from '@dismock/test';
import { setLevelRole } from '../src/db.ts';
import { LEADERBOARD_SIZE, levelForXp, xpForLevel } from '../src/levels.ts';
import {
  clearGuildXp,
  expectedRank,
  memberXp,
  OTHER_CHANNEL,
  OTHER_GUILD,
  setMemberXp,
  topMembers,
} from './helpers.ts';

const MANAGE_GUILD = '32';
const EPHEMERAL = 64;
const HIGH_LEVEL = 3;
const LOW_LEVEL = 1;

const adminSeed = {
  roles: [{ name: 'staff', permissions: MANAGE_GUILD }, { name: 'bronze' }, { name: 'gold' }],
  users: [{ username: 'admin', roles: ['staff'] }, { username: 'target' }],
};
const memberSeed = { users: [{ username: 'target' }] };

type Seeded = Record<string, any>;

const usersOf = ({ users }: Seeded) => ({ admin: users[0], target: users[1] });
const rolesOf = ({ roles }: Seeded) => ({ bronze: roles[1].id as string, gold: roles[2].id as string });

const fieldsOf = (reply: Record<string, any>) =>
  Object.fromEntries(reply.embeds[0].fields.map((field: { name: string; value: string }) => [field.name, field.value]));
const rankFields = (xp: number, rank: number) => ({
  レベル: String(levelForXp(xp)),
  XP: `${xp} / ${xpForLevel(levelForXp(xp) + 1)}`,
  順位: `#${rank}`,
});
const levelUpMessage = (userId: string, level: number) => `🎉 <@${userId}> さんがレベル ${level} になりました！`;

const leaderboardLines = async (db: any, guildId: string) =>
  (await topMembers(db, guildId, LEADERBOARD_SIZE)).map(
    (row, i) => `${i + 1}. <@${row.user_id}> Lv.${levelForXp(row.xp)} (${row.xp} XP)`,
  );

const contents = async (bot: any, channelId: string) =>
  (await bot.botMessages(channelId)).map((message: { content: string }) => message.content);
const hasRole = async (bot: any, guildId: string, userId: string, roleId: string) =>
  (await bot.state()).guilds[guildId].members[userId].roles.includes(roleId);

describe('コマンド', () => {
  describe('/rank', () => {
    test(
      '自分のレベル、XP、順位を表示する',
      { users: 'login', description: 'ログイン中のユーザーが開いているチャンネルで /rank を実行します' },
      async ({ actor, user, guild, db }) => {
        const xp = (await memberXp(db, guild.id, user.id)) ?? 0;
        const reply = await actor.command('rank');
        expect(reply.embeds[0].title).toBe(`${user.username} のランク`);
        expect(fieldsOf(reply)).toEqual(rankFields(xp, await expectedRank(db, guild.id, xp)));
      },
    );

    test('他のユーザーを指定できる', { users: 'login', seed: memberSeed }, async ({ actor, user, guild, db }) => {
      const xp = xpForLevel(HIGH_LEVEL);
      await setMemberXp(db, guild.id, user.id, xp);
      const reply = await actor.command('rank', { user: user.id });
      expect(fieldsOf(reply)).toEqual(rankFields(xp, await expectedRank(db, guild.id, xp)));
    });

    test('XP の高いメンバーが増えると順位が下がる', { users: 'login', seed: { users: [{ username: 'a' }, { username: 'b' }] } }, async ({ actor, guild, seeded, user, db }) => {
      const xp = xpForLevel(LOW_LEVEL);
      await setMemberXp(db, guild.id, user.id, xp);
      const before = await expectedRank(db, guild.id, xp);
      await setMemberXp(db, guild.id, seeded.users[1].id, xp + 1);
      const reply = await actor.command('rank');
      expect(fieldsOf(reply)).toEqual(rankFields(xp, before + 1));
    });

    test('順位は他のサーバーの XP を含めない', { users: 'login', seed: memberSeed }, async ({ actor, guild, user, db }) => {
      const xp = xpForLevel(LOW_LEVEL);
      await setMemberXp(db, guild.id, user.id, xp);
      await setMemberXp(db, OTHER_GUILD, 'other-guild-member', xp + 1);
      const reply = await actor.command('rank');
      expect(fieldsOf(reply)).toEqual(rankFields(xp, await expectedRank(db, guild.id, xp)));
    });

    test('XP がないユーザーは最初のレベル', { users: 'login', seed: memberSeed }, async ({ actor, guild, db }) => {
      const reply = await actor.command('rank');
      expect(fieldsOf(reply)).toEqual(rankFields(0, await expectedRank(db, guild.id, 0)));
    });
  });

  describe('/leaderboard', () => {
    const newMembers = { users: [{ username: 'a' }, { username: 'b' }, { username: 'c' }] };

    test('XP の高い順に表示する', { users: 'login', seed: newMembers }, async ({ actor, guild, seeded, db }) => {
      for (const [i, member] of seeded.users.entries()) {
        await setMemberXp(db, guild.id, member.id, xpForLevel(i + 1));
      }
      const reply = await actor.command('leaderboard');
      expect(reply.embeds[0].description.split('\n')).toEqual(await leaderboardLines(db, guild.id));
    });

    test('他のサーバーのメンバーを含めない', { users: 'login', seed: memberSeed }, async ({ actor, guild, user, db }) => {
      await setMemberXp(db, guild.id, user.id, xpForLevel(LOW_LEVEL));
      const otherMember = 'other-guild-leader';
      await setMemberXp(db, OTHER_GUILD, otherMember, xpForLevel(HIGH_LEVEL));
      const reply = await actor.command('leaderboard');
      expect(reply.embeds[0].description).not.toContain(otherMember);
    });

    test('上限の人数だけを表示する', { users: 'login' }, async ({ actor, guild, db }) => {
      const firstFillerId = 2000000000000000000n;
      for (let i = 0; i <= LEADERBOARD_SIZE; i += 1) await setMemberXp(db, guild.id, String(firstFillerId + BigInt(i)), i);
      const reply = await actor.command('leaderboard');
      expect(reply.embeds[0].description.split('\n')).toEqual(await leaderboardLines(db, guild.id));
      expect(reply.embeds[0].description.split('\n')).toHaveLength(LEADERBOARD_SIZE);
    });

    // XP を持つメンバーがいない状態は、今のサーバーでは作れないため、別のサーバーで確認する。
    test(
      '誰も XP がないときは案内を表示する',
      {
        users: 'login',
        seed: {
          guilds: [{ id: OTHER_GUILD, name: 'サブサーバー' }],
          channels: [{ id: OTHER_CHANNEL, name: 'サブ', guild: OTHER_GUILD }],
          users: [{ username: 'target', guilds: [OTHER_GUILD] }],
        },
      },
      async ({ actor, db }) => {
        await clearGuildXp(db, OTHER_GUILD);
        const reply = await actor.command('leaderboard');
        expect(reply.embeds[0].description).toContain('まだ誰も');
      },
    );
  });

  describe('/xp', () => {
    test('管理者は XP を加算でき、複数レベル上がっても 1 回お知らせする', { users: 'login', seed: adminSeed }, async ({ bot, actor, channel, seeded }) => {
      const { target } = usersOf(seeded);
      const amount = xpForLevel(HIGH_LEVEL);
      const reply = await actor.command('xp add', { user: target.id, amount });
      expect(reply.content).toBe(`${target.username} に ${amount} XP を加算しました（合計 ${amount} XP）`);
      const levelUps = async () => (await contents(bot, channel.id)).filter((c: string) => c.includes(`<@${target.id}>`));
      await expect.poll(levelUps).toEqual([levelUpMessage(target.id, levelForXp(amount))]);
    });

    test('管理者は XP をリセットできる', { users: 'login', seed: adminSeed }, async ({ actor, guild, seeded, db }) => {
      const { target } = usersOf(seeded);
      await setMemberXp(db, guild.id, target.id, xpForLevel(LOW_LEVEL));
      await expect(actor.command('xp reset', { user: target.id })).resolves.toMatchObject({ content: `${target.username} の XP をリセットしました` });
      await expect(memberXp(db, guild.id, target.id)).resolves.toBeUndefined();
    });

    test('サーバーの管理権限がないと拒否する', { users: 'login', seed: adminSeed }, async ({ bot, guild, seeded, db }) => {
      const { target } = usersOf(seeded);
      const reply = await bot.as(target).command('xp add', { user: target.id, amount: xpForLevel(LOW_LEVEL) });
      expect(reply.content).toBe('このコマンドを使う権限がありません');
      expect(reply.flags & EPHEMERAL).toBe(EPHEMERAL);
      await expect(memberXp(db, guild.id, target.id)).resolves.toBeUndefined();
    });
  });

  describe('レベル報酬ロール', () => {
    test('設定したレベルに達するとロールを付与する', { users: 'login', seed: adminSeed }, async ({ bot, actor, guild, seeded }) => {
      const { target } = usersOf(seeded);
      const { bronze } = rolesOf(seeded);
      await setLevelRole(guild.id, LOW_LEVEL, bronze);
      await actor.command('xp add', { user: target.id, amount: xpForLevel(LOW_LEVEL) });
      await expect.poll(() => hasRole(bot, guild.id, target.id, bronze)).toBe(true);
    });

    test('レベルを飛び越えても途中の報酬を付与する', { users: 'login', seed: adminSeed }, async ({ bot, actor, guild, seeded }) => {
      const { target } = usersOf(seeded);
      const { bronze, gold } = rolesOf(seeded);
      await setLevelRole(guild.id, LOW_LEVEL, bronze);
      await setLevelRole(guild.id, HIGH_LEVEL, gold);
      await actor.command('xp add', { user: target.id, amount: xpForLevel(HIGH_LEVEL) });
      await expect.poll(() => hasRole(bot, guild.id, target.id, gold)).toBe(true);
      await expect(hasRole(bot, guild.id, target.id, bronze)).resolves.toBe(true);
    });

    test('必要なレベルに達するまで付与しない', { users: 'login', seed: adminSeed }, async ({ bot, actor, channel, guild, seeded }) => {
      const { target } = usersOf(seeded);
      const { gold } = rolesOf(seeded);
      await setLevelRole(guild.id, HIGH_LEVEL, gold);
      await actor.command('xp add', { user: target.id, amount: xpForLevel(HIGH_LEVEL - 1) });
      await expect.poll(() => contents(bot, channel.id)).toContain(levelUpMessage(target.id, HIGH_LEVEL - 1));
      await expect(hasRole(bot, guild.id, target.id, gold)).resolves.toBe(false);
    });

    test('/levelrole set で設定した報酬が付与される', { users: 'login', seed: adminSeed }, async ({ bot, actor, guild, seeded }) => {
      const { target } = usersOf(seeded);
      const { bronze } = rolesOf(seeded);
      const reply = await actor.command('levelrole set', { level: LOW_LEVEL, role: bronze });
      expect(reply.content).toBe(`レベル ${LOW_LEVEL} の報酬を bronze に設定しました`);
      await actor.command('xp add', { user: target.id, amount: xpForLevel(LOW_LEVEL) });
      await expect.poll(() => hasRole(bot, guild.id, target.id, bronze)).toBe(true);
    });

    test('/levelrole remove で解除すると付与されない', { users: 'login', seed: adminSeed }, async ({ bot, actor, channel, guild, seeded }) => {
      const { target } = usersOf(seeded);
      const { bronze } = rolesOf(seeded);
      await setLevelRole(guild.id, LOW_LEVEL, bronze);
      await expect(actor.command('levelrole remove', { level: LOW_LEVEL })).resolves.toMatchObject({ content: `レベル ${LOW_LEVEL} の報酬を解除しました` });
      await expect(actor.command('levelrole remove', { level: LOW_LEVEL })).resolves.toMatchObject({ content: `レベル ${LOW_LEVEL} に報酬はありません` });
      await actor.command('xp add', { user: target.id, amount: xpForLevel(LOW_LEVEL) });
      await expect.poll(() => contents(bot, channel.id)).toContain(levelUpMessage(target.id, LOW_LEVEL));
      await expect(hasRole(bot, guild.id, target.id, bronze)).resolves.toBe(false);
    });
  });
});
