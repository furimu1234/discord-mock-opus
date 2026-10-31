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

/** テスト用の別サーバーのデータを空にする。DB だけを使うときは、Mock にサーバーがなくてもよい。 */
export const OTHER_GUILD = '1000000000000000001';
export const OTHER_CHANNEL = '1000000000000000002';

export function clearGuildXp(db: Database, guildId: string) {
  return db.pg().query('DELETE FROM members WHERE guild_id = $1', [guildId]);
}

/** メンバーの順位を DB の内容から求める。Bot の計算と独立に確認するため。 */
export async function expectedRank(db: Database, guildId: string, xp: number): Promise<number> {
  const rows = await db
    .pg()
    .query<{ total: string }>('SELECT count(*) AS total FROM members WHERE guild_id = $1 AND xp > $2', [guildId, xp]);
  return Number(rows[0]!.total) + 1;
}

/** サーバーの XP の上位を DB の内容から求める。 */
export function topMembers(db: Database, guildId: string, limit: number) {
  return db
    .pg()
    .query<{ user_id: string; xp: number }>(
      'SELECT user_id, xp FROM members WHERE guild_id = $1 ORDER BY xp DESC, user_id LIMIT $2',
      [guildId, limit],
    );
}

/** 現在の XP を保ったまま、クールダウンを明けた状態にする。 */
export async function expireCooldown(db: Database, guildId: string, userId: string): Promise<number> {
  const xp = (await memberXp(db, guildId, userId)) ?? 0;
  await setMemberXp(db, guildId, userId, xp);
  return xp;
}
