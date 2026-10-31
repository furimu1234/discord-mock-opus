import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const levels = pgTable('levels', {
  userId: text('user_id').primaryKey(),
  level: integer('level').notNull().default(0),
});
