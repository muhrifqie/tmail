import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '../env.js';
import * as schema from './schema.js';

mkdirSync(dirname(env.sqlitePath), { recursive: true });

const sqlite = new Database(env.sqlitePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
CREATE TABLE IF NOT EXISTS addresses (
  id TEXT PRIMARY KEY NOT NULL,
  token TEXT NOT NULL UNIQUE,
  local_part TEXT NOT NULL,
  domain TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  address_id TEXT NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  message_id_hdr TEXT,
  from_raw TEXT NOT NULL DEFAULT '',
  from_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '(no subject)',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  raw_body TEXT NOT NULL DEFAULT '',
  headers_json TEXT NOT NULL DEFAULT '{}',
  size INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  attachment_meta TEXT NOT NULL DEFAULT '[]',
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_address_received
  ON messages(address_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_addresses_token ON addresses(token);
CREATE INDEX IF NOT EXISTS idx_addresses_email ON addresses(email);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_addresses_expires ON addresses(expires_at);
`);

try {
  sqlite.exec(`ALTER TABLE messages ADD COLUMN raw_body TEXT NOT NULL DEFAULT ''`);
} catch {
  /* already exists */
}

export const db = drizzle(sqlite, { schema });
export { sqlite };
