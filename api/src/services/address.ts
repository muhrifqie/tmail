import { eq, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { addresses, messages } from '../db/schema.js';
import { env, expiresAtFrom, isExpired } from '../env.js';
import { isActiveDomain } from '../lib/domains.js';
import { newId, newToken, randomLocalPart, nowMs } from '../lib/token.js';

const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i;
const BLOCKED = new Set(['postmaster', 'abuse', 'admin', 'root', 'webmaster', 'noreply', 'no-reply']);

export function normalizeLocalPart(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateLocalPart(local: string): string | null {
  if (!local) return 'local_required';
  if (local.length > 64) return 'local_too_long';
  if (!LOCAL_RE.test(local)) return 'local_invalid';
  if (BLOCKED.has(local)) return 'local_reserved';
  return null;
}

export async function createAddress(domain: string, localPart?: string | null) {
  const d = domain.toLowerCase().trim();
  if (!isActiveDomain(d)) {
    const err = new Error('domain_not_active') as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }

  let local: string;
  if (localPart != null && String(localPart).trim() !== '') {
    local = normalizeLocalPart(String(localPart));
    const bad = validateLocalPart(local);
    if (bad) {
      const err = new Error(bad) as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }
  } else {
    local = randomLocalPart(10);
  }

  const email = `${local}@${d}`;
  const existing = db.select().from(addresses).where(eq(addresses.email, email)).get();
  if (existing && !isExpired(existing.expiresAt)) {
    // reuse live address so custom username "claim" is stable
    return {
      id: existing.id,
      email: existing.email,
      token: existing.token,
      expiresAt: env.inboxTtlSec <= 0 ? null : existing.expiresAt,
      reused: true as const,
    };
  }

  const id = newId();
  const token = newToken();
  const createdAt = nowMs();
  const expiresAt = expiresAtFrom(createdAt);
  db.insert(addresses)
    .values({
      id,
      token,
      localPart: local,
      domain: d,
      email,
      createdAt,
      expiresAt,
    })
    .run();
  return {
    id,
    email,
    token,
    expiresAt: env.inboxTtlSec <= 0 ? null : expiresAt,
    reused: false as const,
  };
}

export function getAddressByToken(token: string) {
  const row = db.select().from(addresses).where(eq(addresses.token, token)).get();
  if (!row) return null;
  if (isExpired(row.expiresAt)) return null;
  return row;
}

export function getAddressByEmail(email: string) {
  const e = email.toLowerCase().trim();
  const row = db.select().from(addresses).where(eq(addresses.email, e)).get();
  if (!row) return null;
  if (isExpired(row.expiresAt)) return null;
  return row;
}

export function purgeExpired() {
  if (env.inboxTtlSec <= 0) return;
  const t = nowMs();
  db.delete(messages).where(lt(messages.expiresAt, t)).run();
  db.delete(addresses).where(lt(addresses.expiresAt, t)).run();
}
