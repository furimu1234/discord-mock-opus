import { expect, test } from '@dismock/test';

test('Client を渡す形式でログインし、本物のメソッドも呼べる', { users: 'login' }, async ({ bot }) => {
  const proxied = bot as unknown as { isReady(): boolean; ws: { ping: number } };
  expect(proxied.isReady()).toBe(true);
  expect(proxied.ws).toBeDefined();
});

test('継承したクラスと CommonJS の Bot', { users: 'login' }, async ({ bot, actor, user, channel }) => {
  const before = (await (bot as unknown as { visitNames(): Promise<string[]> }).visitNames()).length;
  const sent = (await bot.botMessages(channel.id)).length;
  await actor.sendMessage('hello');
  await expect.poll(() => bot.botMessages(channel.id)).toHaveLength(sent + 1);
  const message = (await bot.botMessages(channel.id)).at(-1);
  expect(message!.content).toBe(`Visits: ${before + 1}`);
  await expect((bot as unknown as { visitNames(): Promise<string[]> }).visitNames()).resolves.toContain(user.username);
});

test('commands オプションで登録したコマンド', { users: 'login' }, async ({ actor, user }) => {
  await expect(actor.command('hi')).resolves.toMatchObject({ content: `Hi ${user.username}` });
});
