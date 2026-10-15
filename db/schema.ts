import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('duko_rooms', {
  code: text('code').primaryKey(), payload: text('payload').notNull(),
  version: integer('version').notNull().default(0), updatedAt: integer('updated_at').notNull(),
}, t => [index('duko_rooms_updated').on(t.updatedAt)]);
export const sessions = sqliteTable('duko_sessions', {
  tokenHash: text('token_hash').primaryKey(), playerId: text('player_id').notNull().unique(),
  name: text('name').notNull(), roomCode: text('room_code'), clientId: text('client_id'),
  expiresAt: integer('expires_at').notNull(), lastSeen: integer('last_seen').notNull(),
}, t => [index('duko_sessions_room').on(t.roomCode), index('duko_sessions_expiry').on(t.expiresAt)]);
export const rates = sqliteTable('duko_rates', {
  key: text('key').primaryKey(), count: integer('count').notNull(), expiresAt: integer('expires_at').notNull(),
}, t => [index('duko_rates_expiry').on(t.expiresAt)]);
