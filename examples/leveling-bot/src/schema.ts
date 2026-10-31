import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const members = pgTable(
  'members',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    xp: integer('xp').notNull().default(0),
    lastXpAt: timestamp('last_xp_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const levelRoles = pgTable(
  'level_roles',
  {
    guildId: text('guild_id').notNull(),
    level: integer('level').notNull(),
    roleId: text('role_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.level] })],
);
