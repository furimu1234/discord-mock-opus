import { expect, test } from '@dismock/test';
import { getRank } from '../src/db.ts';
import { levelForXp, xpForLevel, XP_PER_MESSAGE } from '../src/levels.ts';
import { setMemberXp } from './helpers.ts';

test('レベルを上げる', { users: 'login' }, async ({ actor, user, guild, db }) => {
  const rank = () => getRank(guild.id, user.id);

  // 1 回の発言で次のレベルに届く XP にする。
  const nextLevel = levelForXp((await rank()).xp) + 1;
  await setMemberXp(db, guild.id, user.id, xpForLevel(nextLevel) - XP_PER_MESSAGE);
  const before = await rank();

  await actor.sendMessage('レベルを上げる');

  const expectedXp = before.xp + XP_PER_MESSAGE;
  await expect.poll(async () => (await rank()).xp).toBe(expectedXp);
  expect(levelForXp(expectedXp)).toBe(nextLevel);
});
