import { env } from '../env.js';
import { getRedis, isRedisOk } from './redis.js';

/** In-memory fallback when Redis down (single API process). */
const fails = new Map<string, { n: number; resetAt: number }>();
const bans = new Map<string, number>(); // ip → banUntil ms

function failKey(ip: string) {
  return `admin:fail:${ip}`;
}
function banKey(ip: string) {
  return `admin:ban:${ip}`;
}

export function clientIp(req: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  const xf = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xf) ? xf[0] : xf;
  if (raw) {
    const first = raw.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers['x-real-ip'];
  const r = Array.isArray(real) ? real[0] : real;
  if (r) return r.trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export async function isBanned(ip: string): Promise<{ banned: boolean; until: number | null }> {
  const now = Date.now();
  const mem = bans.get(ip);
  if (mem && mem > now) return { banned: true, until: mem };
  if (mem && mem <= now) bans.delete(ip);

  const r = getRedis();
  if (r && isRedisOk()) {
    try {
      const v = await r.get(banKey(ip));
      if (v) {
        const until = Number(v);
        if (until > now) {
          bans.set(ip, until);
          return { banned: true, until };
        }
        await r.del(banKey(ip));
      }
    } catch {
      /* ignore */
    }
  }
  return { banned: false, until: null };
}

export async function recordAdminFail(ip: string): Promise<{
  banned: boolean;
  fails: number;
  remaining: number;
  until: number | null;
}> {
  const max = env.adminMaxFails;
  const windowMs = env.adminFailWindowSec * 1000;
  const banMs = env.adminBanTtlSec * 1000;
  const now = Date.now();

  let n = 0;
  const r = getRedis();
  if (r && isRedisOk()) {
    try {
      const k = failKey(ip);
      n = await r.incr(k);
      if (n === 1) await r.expire(k, env.adminFailWindowSec);
    } catch {
      /* fall through memory */
    }
  }
  if (!n) {
    let row = fails.get(ip);
    if (!row || row.resetAt <= now) {
      row = { n: 0, resetAt: now + windowMs };
    }
    row.n += 1;
    fails.set(ip, row);
    n = row.n;
  }

  if (n >= max) {
    const until = now + banMs;
    bans.set(ip, until);
    if (r && isRedisOk()) {
      try {
        await r.set(banKey(ip), String(until), 'EX', env.adminBanTtlSec);
        await r.del(failKey(ip));
      } catch {
        /* ignore */
      }
    }
    fails.delete(ip);
    return { banned: true, fails: n, remaining: 0, until };
  }
  return { banned: false, fails: n, remaining: Math.max(0, max - n), until: null };
}

export async function clearAdminFails(ip: string): Promise<void> {
  fails.delete(ip);
  const r = getRedis();
  if (r && isRedisOk()) {
    try {
      await r.del(failKey(ip));
    } catch {
      /* ignore */
    }
  }
}
