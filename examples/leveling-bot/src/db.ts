import { and, count, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { COOLDOWN_SECONDS, LEADERBOARD_SIZE, XP_PER_MESSAGE } from './levels.ts';
import { levelRoles, members } from './schema.ts';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const orm = drizzle(pool);

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      guild_id text NOT NULL,
      user_id text NOT NULL,
      xp integer NOT NULL DEFAULT 0,
      last_xp_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS level_roles (
      guild_id text NOT NULL,
      level integer NOT NULL,
      role_id text NOT NULL,
      PRIMARY KEY (guild_id, level)
    )
  `);
}

/** 発言の XP を加算する。クールダウン中は `null` を返す。 */
export async function gainMessageXp(guildId: string, userId: string): Promise<number | null> {
  const [row] = await orm
    .insert(members)
    .values({ guildId, userId, xp: XP_PER_MESSAGE })
    .onConflictDoUpdate({
      target: [members.guildId, members.userId],
      set: { xp: sql`${members.xp} + ${XP_PER_MESSAGE}`, lastXpAt: sql`now()` },
      setWhere: sql`${members.lastXpAt} <= now() - make_interval(secs => ${COOLDOWN_SECONDS})`,
    })
    .returning();
  return row?.xp ?? null;
}

export async function addXp(guildId: string, userId: string, amount: number): Promise<number> {
  const [row] = await orm
    .insert(members)
    .values({ guildId, userId, xp: amount })
    .onConflictDoUpdate({
      target: [members.guildId, members.userId],
      set: { xp: sql`${members.xp} + ${amount}` },
    })
    .returning();
  return row!.xp;
}

export async function resetXp(guildId: string, userId: string): Promise<void> {
  await orm.delete(members).where(and(eq(members.guildId, guildId), eq(members.userId, userId)));
}

export async function getRank(guildId: string, userId: string): Promise<{ xp: number; rank: number }> {
  const [row] = await orm
    .select({ xp: members.xp })
    .from(members)
    .where(and(eq(members.guildId, guildId), eq(members.userId, userId)));
  const xp = row?.xp ?? 0;
  const [above] = await orm
    .select({ total: count() })
    .from(members)
    .where(and(eq(members.guildId, guildId), gt(members.xp, xp)));
  return { xp, rank: above!.total + 1 };
}

export function getLeaderboard(guildId: string) {
  return orm
    .select({ userId: members.userId, xp: members.xp })
    .from(members)
    .where(eq(members.guildId, guildId))
    .orderBy(desc(members.xp), members.userId)
    .limit(LEADERBOARD_SIZE);
}

export async function setLevelRole(guildId: string, level: number, roleId: string): Promise<void> {
  await orm
    .insert(levelRoles)
    .values({ guildId, level, roleId })
    .onConflictDoUpdate({ target: [levelRoles.guildId, levelRoles.level], set: { roleId } });
}

export async function removeLevelRole(guildId: string, level: number): Promise<boolean> {
  const removed = await orm
    .delete(levelRoles)
    .where(and(eq(levelRoles.guildId, guildId), eq(levelRoles.level, level)))
    .returning();
  return removed.length > 0;
}

/** 指定したレベルまでの報酬ロールを返す。 */
export function rewardRoles(guildId: string, level: number) {
  return orm
    .select({ roleId: levelRoles.roleId })
    .from(levelRoles)
    .where(and(eq(levelRoles.guildId, guildId), lte(levelRoles.level, level)));
}
