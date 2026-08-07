import type { FastifyInstance } from 'fastify';
import { getAddressByEmail } from '../services/address.js';
import { extractCode, getMessage, listMessagesFull } from '../services/message.js';

function normalizeEmail(raw: string): string {
  return decodeURIComponent(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^mailto:/i, '');
}

function isEmailParam(s: string): boolean {
  return s.includes('@') && s.includes('.');
}

export async function publicEmailRoutes(app: FastifyInstance) {
  // Public, no key, no rate limit:
  //   GET /api/:email
  //   GET /api/:email/latest
  //   GET /api/:email/:messageId
  //   GET /api/:email/:messageId/raw
  // also keep /api/email/... aliases

  async function mailboxList(
    emailRaw: string,
    query: { since?: string; limit?: string; from?: string; subject?: string },
  ) {
    const email = normalizeEmail(emailRaw);
    if (!isEmailParam(email)) {
      const err = new Error('email_invalid') as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }
    const addr = getAddressByEmail(email);
    if (!addr) {
      const err = new Error('not_found') as Error & { statusCode: number; email: string };
      err.statusCode = 404;
      (err as { email?: string }).email = email;
      throw err;
    }

    const since = query.since ? Number(query.since) : undefined;
    let messages = listMessagesFull(addr.id, {
      since: Number.isFinite(since) ? since : undefined,
      limit: Number(query.limit) || 100,
      from: query.from,
      subject: query.subject,
    });

    return {
      email: addr.email,
      count: messages.length,
      messages,
    };
  }

  async function mailboxLatest(
    emailRaw: string,
    query: { from?: string; subject?: string },
  ) {
    const email = normalizeEmail(emailRaw);
    const addr = getAddressByEmail(email);
    if (!addr) {
      const err = new Error('not_found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const list = listMessagesFull(addr.id, {
      limit: 100,
      from: query.from,
      subject: query.subject,
    });
    const top = list[0];
    if (!top) {
      const err = new Error('empty') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const code = extractCode(`${top.subject}\n${top.text}\n${top.html}`);
    return { email: addr.email, code, message: top };
  }

  async function mailboxOne(emailRaw: string, messageId: string) {
    const email = normalizeEmail(emailRaw);
    const addr = getAddressByEmail(email);
    if (!addr) {
      const err = new Error('not_found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const full = getMessage(addr.id, messageId, { raw: true });
    if (!full) {
      const err = new Error('not_found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const code = extractCode(`${full.subject}\n${full.textBody}\n${full.htmlBody}`);
    return {
      email: addr.email,
      code,
      message: {
        id: full.id,
        from: full.from,
        fromAddress: full.fromAddress,
        subject: full.subject,
        text: full.textBody,
        html: full.htmlBody,
        raw: (full as { raw?: string }).raw || '',
        headers: full.headers,
        size: full.size,
        hasAttachments: full.hasAttachments,
        attachments: full.attachments,
        receivedAt: full.receivedAt,
      },
    };
  }

  async function mailboxRaw(
    emailRaw: string,
    messageId: string,
    reply: { type: (t: string) => { header: (k: string, v: string) => { send: (b: string) => unknown } } },
  ) {
    const email = normalizeEmail(emailRaw);
    const addr = getAddressByEmail(email);
    if (!addr) {
      const err = new Error('not_found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const full = getMessage(addr.id, messageId, { raw: true });
    if (!full) {
      const err = new Error('not_found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const raw = (full as { raw?: string }).raw || '';
    const body =
      raw ||
      [
        `From: ${full.from}`,
        `Subject: ${full.subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        full.textBody || '',
      ].join('\r\n');
    return reply
      .type('text/plain; charset=utf-8')
      .header('content-disposition', `inline; filename="${full.id}.eml"`)
      .send(body);
  }

  function mapErr(e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    const err = e as Error & { statusCode?: number; email?: string };
    const code = err.statusCode || 500;
    if (code === 404) return reply.code(404).send({ error: err.message || 'not_found' });
    if (code === 400) return reply.code(400).send({ error: err.message || 'bad_request' });
    throw e;
  }

  // short URL: /api/user@domain.com
  app.get<{
    Params: { email: string };
    Querystring: { since?: string; limit?: string; from?: string; subject?: string };
  }>('/api/:email', async (req, reply) => {
    if (!isEmailParam(req.params.email)) return reply.callNotFound();
    try {
      return await mailboxList(req.params.email, req.query);
    } catch (e) {
      return mapErr(e, reply);
    }
  });

  app.get<{
    Params: { email: string };
    Querystring: { from?: string; subject?: string };
  }>('/api/:email/latest', async (req, reply) => {
    if (!isEmailParam(req.params.email)) return reply.callNotFound();
    try {
      return await mailboxLatest(req.params.email, req.query);
    } catch (e) {
      return mapErr(e, reply);
    }
  });

  app.get<{
    Params: { email: string; messageId: string };
  }>('/api/:email/:messageId', async (req, reply) => {
    if (!isEmailParam(req.params.email)) return reply.callNotFound();
    if (req.params.messageId === 'latest') return reply.callNotFound();
    if (req.params.messageId === 'raw') return reply.callNotFound();
    try {
      return await mailboxOne(req.params.email, req.params.messageId);
    } catch (e) {
      return mapErr(e, reply);
    }
  });

  app.get<{
    Params: { email: string; messageId: string };
  }>('/api/:email/:messageId/raw', async (req, reply) => {
    if (!isEmailParam(req.params.email)) return reply.callNotFound();
    try {
      return await mailboxRaw(req.params.email, req.params.messageId, reply as never);
    } catch (e) {
      return mapErr(e, reply);
    }
  });

  // aliases /api/email/...
  app.get('/api/email/:email', async (req, reply) => {
    try {
      return await mailboxList((req.params as { email: string }).email, req.query as never);
    } catch (e) {
      return mapErr(e, reply);
    }
  });
  app.get('/api/email/:email/latest', async (req, reply) => {
    try {
      return await mailboxLatest((req.params as { email: string }).email, req.query as never);
    } catch (e) {
      return mapErr(e, reply);
    }
  });
  app.get('/api/email/:email/:messageId', async (req, reply) => {
    const p = req.params as { email: string; messageId: string };
    if (p.messageId === 'latest') return reply.callNotFound();
    try {
      return await mailboxOne(p.email, p.messageId);
    } catch (e) {
      return mapErr(e, reply);
    }
  });
  app.get('/api/email/:email/:messageId/raw', async (req, reply) => {
    const p = req.params as { email: string; messageId: string };
    try {
      return await mailboxRaw(p.email, p.messageId, reply as never);
    } catch (e) {
      return mapErr(e, reply);
    }
  });
}
