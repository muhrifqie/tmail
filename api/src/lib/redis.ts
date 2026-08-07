import { Redis } from 'ioredis';
import { env } from '../env.js';

let redis: Redis | null = null;
let redisOk = false;

export function getRedis(): Redis | null {
  if (redis) return redis;
  try {
    redis = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: (times: number) => (times > 3 ? null : 200),
    });
    redis.on('error', () => {
      redisOk = false;
    });
    redis.on('connect', () => {
      redisOk = true;
    });
    return redis;
  } catch {
    return null;
  }
}

export async function ensureRedis(): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    if (r.status === 'wait' || r.status === 'end') await r.connect();
    await r.ping();
    redisOk = true;
    return true;
  } catch {
    redisOk = false;
    return false;
  }
}

export function isRedisOk(): boolean {
  return redisOk;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; remaining: number }> {
  const r = getRedis();
  if (!r || !redisOk) return { ok: true, remaining: limit };
  try {
    const k = `rl:${key}`;
    const n = await r.incr(k);
    if (n === 1) await r.expire(k, windowSec);
    return { ok: n <= limit, remaining: Math.max(0, limit - n) };
  } catch {
    return { ok: true, remaining: limit };
  }
}

export async function publishInbox(token: string, payload: unknown): Promise<void> {
  const r = getRedis();
  if (!r || !redisOk) return;
  try {
    await r.publish(`inbox:${token}`, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function subscribeInbox(
  token: string,
  onMessage: (data: string) => void,
): { stop: () => void } {
  const r = getRedis();
  if (!r || !redisOk) {
    return { stop: () => undefined };
  }
  const sub = r.duplicate();
  let stopped = false;
  (async () => {
    try {
      if (sub.status === 'wait' || sub.status === 'end') await sub.connect();
      await sub.subscribe(`inbox:${token}`);
      sub.on('message', (_ch: string, msg: string) => {
        if (!stopped) onMessage(msg);
      });
    } catch {
      /* ignore */
    }
  })();
  return {
    stop: () => {
      stopped = true;
      sub.unsubscribe().catch(() => undefined);
      sub.quit().catch(() => undefined);
    },
  };
}
