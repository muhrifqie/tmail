import type { FastifyInstance } from 'fastify';
import { createAddress } from '../services/address.js';
import { rateLimit } from '../lib/redis.js';

export async function addressRoutes(app: FastifyInstance) {
  app.post<{ Body: { domain?: string; localPart?: string } }>(
    '/api/addresses',
    async (req, reply) => {
      const ip = req.ip || 'unknown';
      const rl = await rateLimit(`gen:${ip}`, 20, 60);
      if (!rl.ok) return reply.code(429).send({ error: 'rate_limit' });

      const domain = req.body?.domain;
      if (!domain || typeof domain !== 'string') {
        return reply.code(400).send({ error: 'domain_required' });
      }
      const localPart =
        typeof req.body?.localPart === 'string' ? req.body.localPart : undefined;

      try {
        const row = await createAddress(domain, localPart);
        return reply.code(201).send(row);
      } catch (e) {
        const err = e as Error & { statusCode?: number };
        const known = new Set([
          'domain_not_active',
          'local_required',
          'local_too_long',
          'local_invalid',
          'local_reserved',
        ]);
        if (err.message && known.has(err.message)) {
          return reply.code(400).send({ error: err.message });
        }
        throw e;
      }
    },
  );
}
