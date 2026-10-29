import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const hostedEmbeddingCache = sqliteTable('hosted_embedding_cache', {
  id: text('id').primaryKey(),
  vector: text('vector').notNull(),
});
export const hostedRequestLimits = sqliteTable('hosted_request_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
