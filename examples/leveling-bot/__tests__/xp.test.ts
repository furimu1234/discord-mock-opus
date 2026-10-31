import { describe, expect, test } from '@dismock/test';
import { setLevelRole } from '../src/db.ts';
import { levelForXp, xpForLevel, XP_PER_MESSAGE } from '../src/levels.ts';
import { expireCooldown, memberXp, OTHER_CHANNEL, OTHER_GUILD, setMemberXp, settle } from './helpers.ts';

describe('メッセージ', () => {
  describe('発言による XP の獲得', () => {
    test('発言すると規定の XP を獲得する', { users: 'login' }, async ({ actor, user, guild, db }) => {
      const before = await expireCooldown(db, guild.id, user.id);
      await actor.sendMessage('こんにちは');
      await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(before + XP_PER_MESSAGE);
    });

    test('クールダウン中の発言では XP が増えない', { users: 'login' }, async ({ actor, user, guild, db }) => {
      const before = await expireCooldown(db, guild.id, user.id);
      await actor.sendMessage('1');
      await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(before + XP_PER_MESSAGE);
      await actor.sendMessage('2');
      await settle();
      await expect(memberXp(db, guild.id, user.id)).resolves.toBe(before + XP_PER_MESSAGE);
    });

    test('連続した発言が同時に処理されても 1 回分だけ加算する', { users: 'login' }, async ({ actor, user, guild, db }) => {
      const before = await expireCooldown(db, guild.id, user.id);
      await Promise.all(['a', 'b', 'c', 'd', 'e'].map((text) => actor.sendMessage(text)));
      await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(before + XP_PER_MESSAGE);
      await settle();
      await expect(memberXp(db, guild.id, user.id)).resolves.toBe(before + XP_PER_MESSAGE);
    });

    test('Bot の発言では XP を獲得しない', { users: 'login' }, async ({ bot, guild, db }) => {
      const [otherBot] = (await bot.seed({ users: [{ username: 'other-bot', bot: true, guild: guild.id }] })).users;
      await bot.as(otherBot).sendMessage('beep');
      await settle();
      await expect(memberXp(db, guild.id, otherBot.id)).resolves.toBeUndefined();
    });

    test('メンバーごとに別々に集計する', { users: ['alice', 'bob'] }, async ({ actors, guild, db }) => {
      const before = await Promise.all(actors.map((actor) => expireCooldown(db, guild.id, actor.id)));
      for (const actor of actors) await actor.sendMessage('発言');
      for (const [i, actor] of actors.entries()) {
        await expect.poll(() => memberXp(db, guild.id, actor.id)).toBe(before[i]! + XP_PER_MESSAGE);
      }
    });

    test('サーバーごとに別々に集計する', { users: 'login' }, async ({ bot, actor, user, guild, db }) => {
      await bot.seed({
        guilds: [{ id: OTHER_GUILD, name: 'サブサーバー' }],
        channels: [{ id: OTHER_CHANNEL, name: 'サブ', guild: OTHER_GUILD }],
      });
      const before = await expireCooldown(db, guild.id, user.id);
      const otherBefore = await expireCooldown(db, OTHER_GUILD, user.id);
      await actor.sendMessage('開いているチャンネルで発言');
      await actor.sendMessage('別のサーバーで発言', { channelId: OTHER_CHANNEL });
      await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(before + XP_PER_MESSAGE);
      await expect.poll(() => memberXp(db, OTHER_GUILD, user.id)).toBe(otherBefore + XP_PER_MESSAGE);
    });
  });

  describe('レベルアップ', () => {
    const announcements = async (bot: any, channelId: string, userId: string): Promise<string[]> =>
      (await bot.botMessages(channelId))
        .map((message: { content: string }) => message.content)
        .filter((content: string) => content.includes(`<@${userId}>`));
    const nextLevel = async (db: any, guildId: string, userId: string) =>
      levelForXp((await memberXp(db, guildId, userId)) ?? 0) + 1;

    test('必要 XP を超えるとチャンネルでお知らせする', { users: 'login' }, async ({ bot, actor, user, guild, channel, db }) => {
      const level = await nextLevel(db, guild.id, user.id);
      await setMemberXp(db, guild.id, user.id, xpForLevel(level) - XP_PER_MESSAGE + 1);
      const before = await announcements(bot, channel.id, user.id);
      await actor.sendMessage('もう少し');
      await expect.poll(() => announcements(bot, channel.id, user.id)).toEqual([
        ...before,
        `🎉 <@${user.id}> さんがレベル ${level} になりました！`,
      ]);
    });

    test('ちょうど必要 XP に達してもレベルアップする', { users: 'login' }, async ({ bot, actor, user, guild, channel, db }) => {
      const level = await nextLevel(db, guild.id, user.id);
      await setMemberXp(db, guild.id, user.id, xpForLevel(level) - XP_PER_MESSAGE);
      const before = await announcements(bot, channel.id, user.id);
      await actor.sendMessage('ぴったり');
      await expect.poll(() => announcements(bot, channel.id, user.id)).toHaveLength(before.length + 1);
    });

    test('必要 XP の手前ではお知らせしない', { users: 'login' }, async ({ bot, actor, user, guild, channel, db }) => {
      const threshold = xpForLevel(await nextLevel(db, guild.id, user.id));
      await setMemberXp(db, guild.id, user.id, threshold - XP_PER_MESSAGE - 1);
      const before = await announcements(bot, channel.id, user.id);
      await actor.sendMessage('あと 1 XP');
      await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(threshold - 1);
      await settle();
      await expect(announcements(bot, channel.id, user.id)).resolves.toEqual(before);
    });

    test('発言でお知らせするのはレベルが上がったときだけ', { users: 'login' }, async ({ bot, actor, user, guild, channel, db }) => {
      const level = (await nextLevel(db, guild.id, user.id)) - 1;
      const xp = xpForLevel(level);
      await setMemberXp(db, guild.id, user.id, xp);
      const before = await announcements(bot, channel.id, user.id);
      await actor.sendMessage('レベルは変わらない');
      await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(xp + XP_PER_MESSAGE);
      expect(levelForXp(xp + XP_PER_MESSAGE)).toBe(level);
      await settle();
      await expect(announcements(bot, channel.id, user.id)).resolves.toEqual(before);
    });

    test(
      '発言によるレベルアップでも報酬ロールを付与する',
      { users: 'login', seed: { roles: [{ name: 'bronze' }] } },
      async ({ bot, actor, user, guild, seeded, db }) => {
        const [role] = seeded.roles;
        const level = await nextLevel(db, guild.id, user.id);
        await setLevelRole(guild.id, level, role.id);
        await setMemberXp(db, guild.id, user.id, xpForLevel(level) - XP_PER_MESSAGE);
        await actor.sendMessage('レベルアップ');
        await expect
          .poll(async () => (await bot.state()).guilds[guild.id].members[user.id].roles.includes(role.id))
          .toBe(true);
      },
    );
  });
});
