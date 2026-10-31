import type { db as Db } from '@dismock/client';
import { COOLDOWN_SECONDS } from '../src/levels.ts';

type Database = typeof Db;

export const cooldownExpiredAt = () => new Date(Date.now() - (COOLDOWN_SECONDS + 1) * 1000);

/** クールダウンが明けた状態で、メンバーの XP を設定する。 */
export function setMemberXp(db: Database, guildId: string, userId: string, xp: number) {
  return db.pg().query(
    `INSERT INTO members (guild_id, user_id, xp, last_xp_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = $3, last_xp_at = $4`,
    [guildId, userId, xp, cooldownExpiredAt()],
  );
}

export async function memberXp(db: Database, guildId: string, userId: string): Promise<number | undefined> {
  const rows = await db
    .pg()
    .query<{ xp: number }>('SELECT xp FROM members WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return rows[0]?.xp;
}

/** 発言の処理が終わるのを待つ。何も起きないことを確認するときに使う。 */
export const settle = () => new Promise((done) => setTimeout(done, 150));
