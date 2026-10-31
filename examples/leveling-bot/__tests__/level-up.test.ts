import { expect, test } from '@dismock/test';

const seed = {
  roles: [{ name: 'staff', permissions: '32' }],
  users: [{ username: 'alice', roles: ['staff'] }],
};

test('レベルを上げる', { users: 'login', seed }, async ({ actor, user }) => {
  await actor.command('xp add', { user: user.id, amount: 400 });
  const reply = await actor.command('rank');
  expect(reply.embeds[0].fields[0]).toMatchObject({ name: 'レベル', value: '2' });
});
