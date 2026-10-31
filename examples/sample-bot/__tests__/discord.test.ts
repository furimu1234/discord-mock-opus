import { REST, Routes } from 'discord.js';
import { beforeEach, describe, expect, test } from '@dismock/test';

describe('通信先', () => {
  test('Bot が自分で作った REST も Mock に向く', { users: 'login' }, async () => {
    const rest = new REST().setToken('real-looking-token');
    await expect(rest.get(Routes.user())).resolves.toMatchObject({ username: 'mock-bot' });
    expect((rest as unknown as { options: { api: string } }).options.api).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });
});

describe('スラッシュコマンド', () => {
  test('Embed を返す', { users: 'login' }, async ({ actor, channel }) => {
    const reply = await actor.command('ping');
    expect(reply.embeds[0].title).toBe('Pong');
    expect(reply.embeds[0].description).toBe(channel.id);
    expect(reply.interaction_metadata.name).toBe('ping');
  });

  test('実行者はログイン中のダミーユーザーになる', { users: 'login' }, async ({ bot, actor, channel }) => {
    await expect(actor.command('whoami')).resolves.toMatchObject({ content: 'You are test-user' });

    const other = await bot.users.create({ username: 'alice' });
    const reply = await bot.as(other).command('whoami', {}, { channelId: channel.id });
    expect(reply.content).toBe('You are alice');
  });

  test('deferReply の後の編集を受け取る', { users: 'login' }, async ({ actor }) => {
    const reply = await actor.command('slow');
    expect(reply.content).toBe('Finished');
  });

  test('応答がないとタイムアウトする', { users: 'login' }, async ({ actor }) => {
    await expect(actor.command('silent', {}, { timeoutMs: 250 })).rejects.toThrow('250ms');
  });

  test('未登録のコマンドはエラーになる', { users: 'login' }, async ({ actor }) => {
    await expect(actor.command('unknown')).rejects.toThrow('not registered');
  });
});

describe('メッセージ', () => {
  test('ダミーユーザーの発言に Bot が返信する', { users: 'login' }, async ({ bot, actor, channel }) => {
    await actor.sendMessage('!hello');
    await expect.poll(() => bot.botMessages(channel.id)).toHaveLength(1);
    const [reply] = await bot.botMessages(channel.id);
    expect(reply!.content).toBe('Hello, test-user!');
    expect(reply!.type).toBe(19);
  });
});

describe('ボタン', () => {
  test('押下者はログイン中のダミーユーザーになる', { users: 'login' }, async ({ actor }) => {
    const message = await actor.command('confirm');
    const result = await actor.click(message, 'confirm');
    expect(result.message!.content).toBe('Confirmed by test-user');
    expect(result.message!.components).toEqual([]);
  });
});

describe('初期データ', () => {
  const seed = {
    guilds: [{ name: 'Seed Guild' }],
    roles: [{ name: 'admin', permissions: '8' }, { name: 'member' }],
    channels: [{ name: 'rules' }, { name: 'lobby', type: 'voice' as const }],
    users: [{ username: 'owner', roles: ['admin'] }, { username: 'guest', roles: ['member'] }],
  };

  test('テストコードから投入したデータを Bot が参照できる', { users: 'login', seed }, async ({ bot, actor, user, seeded }) => {
    expect(user.username).toBe('owner');
    const admin = seeded.roles.find((role: { name: string }) => role.name === 'admin');
    const member = seeded.roles.find((role: { name: string }) => role.name === 'member');
    await expect(actor.command('hasrole', { role: admin })).resolves.toMatchObject({ content: 'Yes' });
    await expect(actor.command('hasrole', { role: member })).resolves.toMatchObject({ content: 'No' });

    const guild = bot.client.guilds.cache.get(seeded.guilds[0].id) as { name: string; channels: { cache: Map<string, unknown> } };
    expect(guild.name).toBe('Seed Guild');
    expect(guild.channels.cache.size).toBe(2);
  });

  test('前のテストのデータは残らない', { users: 'login' }, async ({ bot }) => {
    const state = await bot.state();
    expect(Object.values(state.users).map((user: any) => user.username)).not.toContain('owner');
  });
});

describe('DM', () => {
  let target: Record<string, any>;

  beforeEach(async ({ bot }) => {
    target = await bot.users.create({ username: 'receiver' });
  });

  test('宛先のユーザーでログインすると読める', { users: 'login' }, async ({ bot, actor }) => {
    const reply = await actor.command('dm', { target });
    expect(reply.flags & 64).toBe(64);

    const dms = await bot.as(target).dms();
    expect(dms.map((message) => message.content)).toEqual(['Secret message']);
    await expect(actor.dms()).resolves.toEqual([]);
  });

  test('別のユーザーでログイン中は DM チャンネルを読めない', { users: 'login' }, async ({ bot, actor }) => {
    await actor.command('dm', { target });
    await actor.login();
    const state = await bot.state();
    const dm = Object.values<any>(state.channels).find((channel) => channel.recipients);
    await expect(bot.messages(dm.id)).rejects.toThrow('ログイン');
    const all = await bot.messages();
    expect(all.map((message) => message.content)).not.toContain('Secret message');
  });
});
