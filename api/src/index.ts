import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import './db/client.js';
import { ensureRedis, isRedisOk } from './lib/redis.js';
import { purgeExpired } from './services/address.js';
import { domainRoutes } from './routes/domains.js';
import { addressRoutes } from './routes/addresses.js';
import { inboxRoutes } from './routes/inbox.js';
import { sseRoutes } from './routes/sse.js';
import { ingestRoutes } from './routes/internal_ingest.js';
import { adminRoutes } from './routes/admin.js';
import { publicEmailRoutes } from './routes/public_email.js';
import { loadDomains } from './lib/domains.js';

const app = Fastify({
  logger: env.nodeEnv !== 'test',
  bodyLimit: env.inboundMaxBytes + 64_000,
});

// empty body + Content-Type: application/json → {} (fix FST_ERR_CTP_EMPTY_JSON_BODY)
app.removeContentTypeParser('application/json');
app.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (req, body, done) => {
    const str = typeof body === 'string' ? body : body?.toString?.() || '';
    if (!str.trim()) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(str));
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

await app.register(cors, {
  origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((s) => s.trim()),
});

app.get('/health', async () => ({
  ok: true,
  redis: isRedisOk(),
  domains: loadDomains().filter((d) => d.active).length,
  ttlSec: env.inboxTtlSec,
  publicIp: env.publicIp || null,
}));

await app.register(domainRoutes);
await app.register(addressRoutes);
await app.register(inboxRoutes);
await app.register(sseRoutes);
await app.register(ingestRoutes);
await app.register(adminRoutes);
await app.register(publicEmailRoutes);

const redisUp = await ensureRedis();
if (!redisUp) {
  app.log.warn('Redis unavailable — SSE fanout/rate-limit degraded; poll fallback OK');
}

purgeExpired();
setInterval(() => {
  try {
    purgeExpired();
  } catch (e) {
    app.log.error(e);
  }
}, 60_000);

await app.listen({ port: env.apiPort, host: '0.0.0.0' });
app.log.info(`TMail API :${env.apiPort} redis=${isRedisOk()}`);
