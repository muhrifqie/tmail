import type { FastifyInstance } from 'fastify';
import { getAddressByToken } from '../services/address.js';
import { getMessage, listMessages } from '../services/message.js';

export async function inboxRoutes(app: FastifyInstance) {
  app.get<{
    Params: { token: string };
    Querystring: { since?: string };
  }>('/api/inbox/:token', async (req, reply) => {
    const addr = getAddressByToken(req.params.token);
    if (!addr) return reply.code(404).send({ error: 'not_found' });
    const since = req.query.since ? Number(req.query.since) : undefined;
    const messages = listMessages(addr.id, Number.isFinite(since) ? since : undefined);
    return {
      email: addr.email,
      expiresAt: addr.expiresAt >= 8_000_000_000_000_000 ? null : addr.expiresAt,
      messages,
    };
  });

  app.get<{
    Params: { token: string; messageId: string };
  }>('/api/inbox/:token/:messageId', async (req, reply) => {
    const addr = getAddressByToken(req.params.token);
    if (!addr) return reply.code(404).send({ error: 'not_found' });
    const msg = getMessage(addr.id, req.params.messageId);
    if (!msg) return reply.code(404).send({ error: 'not_found' });
    return msg;
  });
}
