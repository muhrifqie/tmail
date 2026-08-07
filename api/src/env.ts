import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(__dirname, '../../.env');
const localEnv = resolve(__dirname, '../.env');
if (existsSync(rootEnv)) config({ path: rootEnv });
else if (existsSync(localEnv)) config({ path: localEnv });
else config();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing env ${name}`);
  return v;
}

/** 0 = never expire (no auto-delete) */
const inboxTtlSec = Number(process.env.INBOX_TTL_SEC ?? 0);

const adminMaxFails = Number(process.env.ADMIN_MAX_FAILS ?? 3);
const adminFailWindowSec = Number(process.env.ADMIN_FAIL_WINDOW_SEC ?? 900);
const adminBanTtlSec = Number(process.env.ADMIN_BAN_TTL_SEC ?? 86_400);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  ingestKey: req('INGEST_KEY', 'dev-ingest-key-change-me'),
  adminKey: process.env.ADMIN_KEY || process.env.INGEST_KEY || 'dev-admin-key-change-me',
  publicIp: process.env.PUBLIC_IP || '',
  mailHostname: process.env.MAIL_HOSTNAME || '',
  /** primary web domain (UI + admin). Set PRIMARY_WEB in prod .env */
  primaryWeb: process.env.PRIMARY_WEB || 'example.com',
  inboxTtlSec: Number.isFinite(inboxTtlSec) ? inboxTtlSec : 0,
  /** far-future ms when TTL disabled */
  neverExpiresAt: 8_640_000_000_000_000, // ~year 274760
  inboundMaxBytes: Number(process.env.INBOUND_MAX_BYTES || 5_242_880),
  sqlitePath: req('SQLITE_PATH', resolve(__dirname, '../data/tmail.sqlite')),
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  apiPort: Number(process.env.API_PORT || 3100),
  corsOrigin: process.env.CORS_ORIGIN || 'http://127.0.0.1:5173',
  catchallCreate: process.env.CATCHALL_CREATE === '1',
  // Prefer data/ so deploy tar never clobbers live domain list (exclude data/)
  domainsPath:
    process.env.DOMAINS_PATH || resolve(__dirname, '../../data/domains.json'),
  /** wrong admin key attempts before IP ban (default 3) */
  adminMaxFails: Number.isFinite(adminMaxFails) && adminMaxFails > 0 ? adminMaxFails : 3,
  /** fail counter window seconds (default 15m) */
  adminFailWindowSec:
    Number.isFinite(adminFailWindowSec) && adminFailWindowSec > 0 ? adminFailWindowSec : 900,
  /** ban duration seconds after max fails (default 24h) */
  adminBanTtlSec: Number.isFinite(adminBanTtlSec) && adminBanTtlSec > 0 ? adminBanTtlSec : 86_400,
};

export function expiresAtFrom(now: number): number {
  if (env.inboxTtlSec <= 0) return env.neverExpiresAt;
  return now + env.inboxTtlSec * 1000;
}

export function isExpired(expiresAt: number, now = Date.now()): boolean {
  if (env.inboxTtlSec <= 0) return false;
  return expiresAt < now;
}
