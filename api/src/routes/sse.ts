import type { FastifyInstance } from 'fastify';
import { getAddressByToken } from '../services/address.js';
import { rateLimit, subscribeInbox, isRedisOk } from '../lib/redis.js';
import { env, isExpired } from '../env.js';

export async function sseRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string } }>(
    '/api/inbox/:token/stream',
    async (req, reply) => {
      const ip = req.ip || 'unknown';
      const rl = await rateLimit(`sse:${ip}`, 20, 60);
      if (!rl.ok) return reply.code(429).send({ error: 'rate_limit' });

      const addr = getAddressByToken(req.params.token);
      if (!addr) return reply.code(404).send({ error: 'not_found' });

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',')[0]!.trim(),
      });

      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      send('ready', { ok: true, redis: isRedisOk() });

      const sub = subscribeInbox(addr.token, (raw) => {
        try {
          send('message', JSON.parse(raw));
        } catch {
          send('message', raw);
        }
      });

      const ping = setInterval(() => {
        if (isExpired(addr.expiresAt)) {
          send('expired', {});
          cleanup();
          return;
        }
        send('ping', {});
      }, 15_000);

      const cleanup = () => {
        clearInterval(ping);
        sub.stop();
        try {
          res.end();
        } catch {
          /* ignore */
        }
      };

      req.raw.on('close', cleanup);
    },
  );
}
