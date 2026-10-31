import { describe, expect, test } from '@dismock/test';
import { levelForXp, xpForLevel, XP_PER_MESSAGE } from '../src/levels.ts';
import { memberXp, OTHER_CHANNEL, OTHER_GUILD, setMemberXp, settle } from './helpers.ts';
import { setLevelRole } from '../src/db.ts';

// ユーザーごとに XP とクールダウンがあるため、テストごとに新しいユーザーを使う。
const newMember = { users: [{ username: 'member' }] };

describe('発言による XP の獲得', () => {
  test('発言すると規定の XP を獲得する', { users: 'login', seed: newMember }, async ({ actor, user, guild, db }) => {
    await actor.sendMessage('こんにちは');
    await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(XP_PER_MESSAGE);
  });

  test('クールダウン中の発言では XP が増えない', { users: 'login', seed: newMember }, async ({ actor, user, guild, db }) => {
    await actor.sendMessage('1');
    await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(XP_PER_MESSAGE);
    await actor.sendMessage('2');
    await settle();
    await expect(memberXp(db, guild.id, user.id)).resolves.toBe(XP_PER_MESSAGE);
  });

  test('連続した発言が同時に処理されても 1 回分だけ加算する', { users: 'login', seed: newMember }, async ({ actor, user, guild, db }) => {
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((text) => actor.sendMessage(text)));
    await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(XP_PER_MESSAGE);
    await settle();
    await expect(memberXp(db, guild.id, user.id)).resolves.toBe(XP_PER_MESSAGE);
  });

  test('クールダウンが明けると再び獲得する', { users: 'login', seed: newMember }, async ({ actor, user, guild, db }) => {
    await setMemberXp(db, guild.id, user.id, XP_PER_MESSAGE);
    await actor.sendMessage('お久しぶりです');
    await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(XP_PER_MESSAGE * 2);
  });

  test(
    'Bot の発言では XP を獲得しない',
    { users: 'login' },
    async ({ bot, guild, db }) => {
      const [otherBot] = (await bot.seed({ users: [{ username: 'other-bot', bot: true, guild: guild.id }] })).users;
      await bot.as(otherBot).sendMessage('beep');
      await settle();
      await expect(memberXp(db, guild.id, otherBot.id)).resolves.toBeUndefined();
    },
  );

  test('メンバーごとに別々に集計する', { users: 'login', seed: { users: [{ username: 'a' }, { username: 'b' }] } }, async ({ bot, seeded, guild, db }) => {
    const [a, b] = seeded.users;
    await bot.as(a).sendMessage('1');
    await bot.as(b).sendMessage('2');
    await expect.poll(() => memberXp(db, guild.id, a.id)).toBe(XP_PER_MESSAGE);
    await expect.poll(() => memberXp(db, guild.id, b.id)).toBe(XP_PER_MESSAGE);
  });

  test('サーバーごとに別々に集計する', { users: 'login', seed: newMember }, async ({ bot, actor, user, guild, db }) => {
    await bot.seed({
      guilds: [{ id: OTHER_GUILD, name: 'サブサーバー' }],
      channels: [{ id: OTHER_CHANNEL, name: 'サブ', guild: OTHER_GUILD }],
    });
    await actor.sendMessage('開いているチャンネルで発言');
    await actor.sendMessage('別のサーバーで発言', { channelId: OTHER_CHANNEL });
    for (const guildId of [guild.id, OTHER_GUILD]) {
      await expect.poll(() => memberXp(db, guildId, user.id)).toBe(XP_PER_MESSAGE);
    }
  });
});

describe('レベルアップ', () => {
  const TARGET_LEVEL = 1;
  const threshold = xpForLevel(TARGET_LEVEL);
  const announcements = async (bot: any, channelId: string, userId: string) =>
    (await bot.botMessages(channelId))
      .map((message: { content: string }) => message.content)
      .filter((content: string) => content.includes(`<@${userId}>`));

  test('必要 XP を超えるとチャンネルでお知らせする', { users: 'login', seed: newMember }, async ({ bot, actor, user, guild, channel, db }) => {
    await setMemberXp(db, guild.id, user.id, threshold - XP_PER_MESSAGE + 1);
    await actor.sendMessage('もう少し');
    await expect.poll(() => announcements(bot, channel.id, user.id)).toEqual([`🎉 <@${user.id}> さんがレベル ${TARGET_LEVEL} になりました！`]);
  });

  test('ちょうど必要 XP に達してもレベルアップする', { users: 'login', seed: newMember }, async ({ bot, actor, user, guild, channel, db }) => {
    await setMemberXp(db, guild.id, user.id, threshold - XP_PER_MESSAGE);
    await actor.sendMessage('ぴったり');
    await expect.poll(() => announcements(bot, channel.id, user.id)).toHaveLength(1);
  });

  test('必要 XP の手前ではお知らせしない', { users: 'login', seed: newMember }, async ({ bot, actor, user, guild, channel, db }) => {
    await setMemberXp(db, guild.id, user.id, threshold - XP_PER_MESSAGE - 1);
    await actor.sendMessage('あと 1 XP');
    await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(threshold - 1);
    await settle();
    await expect(announcements(bot, channel.id, user.id)).resolves.toEqual([]);
  });

  test('発言でお知らせするのはレベルが上がったときだけ', { users: 'login', seed: newMember }, async ({ bot, actor, user, guild, channel, db }) => {
    await setMemberXp(db, guild.id, user.id, threshold);
    await actor.sendMessage('レベルは変わらない');
    await expect.poll(() => memberXp(db, guild.id, user.id)).toBe(threshold + XP_PER_MESSAGE);
    expect(levelForXp(threshold + XP_PER_MESSAGE)).toBe(TARGET_LEVEL);
    await settle();
    await expect(announcements(bot, channel.id, user.id)).resolves.toEqual([]);
  });

  test(
    '発言によるレベルアップでも報酬ロールを付与する',
    { users: 'login', seed: { roles: [{ name: 'bronze' }], users: [{ username: 'member' }] } },
    async ({ bot, actor, user, guild, seeded, db }) => {
      const role = seeded.roles[0];
      await setLevelRole(guild.id, TARGET_LEVEL, role.id);
      await setMemberXp(db, guild.id, user.id, threshold - XP_PER_MESSAGE);
      await actor.sendMessage('レベルアップ');
      await expect
        .poll(async () => (await bot.state()).guilds[guild.id].members[user.id].roles.includes(role.id))
        .toBe(true);
    },
  );
});
