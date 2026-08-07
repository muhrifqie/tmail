import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { ingestRaw } from '../services/message.js';
import { isActiveDomain } from '../lib/domains.js';
import { getAddressByEmail } from '../services/address.js';

export async function ingestRoutes(app: FastifyInstance) {
  app.get('/internal/address-exists', async (req, reply) => {
    const key = req.headers['x-ingest-key'];
    if (key !== env.ingestKey) return reply.code(401).send({ error: 'unauthorized' });
    const email = String((req.query as { email?: string }).email || '').toLowerCase();
    if (!email.includes('@')) return reply.code(400).send({ error: 'email_required' });
    const domain = email.split('@')[1] || '';
    if (!isActiveDomain(domain)) return { exists: false, domainActive: false };
    const addr = getAddressByEmail(email);
    return { exists: !!addr, domainActive: true };
  });

  app.post<{
    Body: {
      envelopeTo?: string[];
      envelopeFrom?: string;
      raw?: string;
      rawBase64?: string;
    };
  }>('/internal/ingest', async (req, reply) => {
    const key = req.headers['x-ingest-key'];
    if (key !== env.ingestKey) return reply.code(401).send({ error: 'unauthorized' });

    const body = req.body || {};
    const envelopeTo = body.envelopeTo;
    if (!Array.isArray(envelopeTo) || !envelopeTo.length) {
      return reply.code(400).send({ error: 'envelopeTo_required' });
    }

    let raw: Buffer;
    if (body.rawBase64) raw = Buffer.from(body.rawBase64, 'base64');
    else if (typeof body.raw === 'string') raw = Buffer.from(body.raw);
    else return reply.code(400).send({ error: 'raw_required' });

    try {
      const result = await ingestRaw({
        envelopeTo,
        envelopeFrom: body.envelopeFrom,
        raw,
      });
      return reply.code(202).send(result);
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.message === 'message_too_large') {
        return reply.code(413).send({ error: 'message_too_large' });
      }
      throw e;
    }
  });
}
