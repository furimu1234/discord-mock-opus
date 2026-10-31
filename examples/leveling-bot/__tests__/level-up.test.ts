import { expect, test } from '@dismock/test';
import { getRank } from '../src/db.ts';
import { COOLDOWN_SECONDS, levelForXp, xpForLevel, XP_PER_MESSAGE } from '../src/levels.ts';

test('レベルを上げる', { users: 'login' }, async ({ actor, user, guild, db }) => {
  // 1 回の発言で次のレベルに届く XP を持ち、クールダウンも明けた状態にする。
  await db.pg().seed({
    members: [
      {
        guild_id: guild.id,
        user_id: user.id,
        xp: xpForLevel(levelForXp(0) + 1) - XP_PER_MESSAGE,
        last_xp_at: new Date(Date.now() - (COOLDOWN_SECONDS + 1) * 1000),
      },
    ],
  });
  const rank = () => getRank(guild.id, user.id);
  const before = await rank();

  await actor.sendMessage('レベルを上げる');

  const expectedXp = before.xp + XP_PER_MESSAGE;
  await expect.poll(async () => (await rank()).xp).toBe(expectedXp);
  expect(levelForXp(expectedXp)).toBe(levelForXp(before.xp) + 1);
});
