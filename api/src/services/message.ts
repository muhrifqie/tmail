import { eq, and, gt, desc } from 'drizzle-orm';
import { simpleParser } from 'mailparser';
import { db } from '../db/client.js';
import { messages } from '../db/schema.js';
import { env, expiresAtFrom } from '../env.js';
import { sanitizeEmailHtml, previewText } from '../lib/sanitize.js';
import { newId, nowMs } from '../lib/token.js';
import { getAddressByEmail, createAddress } from './address.js';
import { isActiveDomain } from '../lib/domains.js';
import { publishInbox } from '../lib/redis.js';

export type AttachmentMeta = {
  filename: string;
  contentType: string;
  size: number;
};

export type MessageSummary = {
  id: string;
  from: string;
  subject: string;
  receivedAt: number;
  hasAttachments: boolean;
  preview: string;
};

function toSummary(row: typeof messages.$inferSelect): MessageSummary {
  return {
    id: row.id,
    from: row.fromRaw || row.fromAddress,
    subject: row.subject,
    receivedAt: row.receivedAt,
    hasAttachments: !!row.hasAttachments,
    preview: previewText(row.textBody || row.subject),
  };
}

export function listMessages(addressId: string, since?: number): MessageSummary[] {
  const cond =
    env.inboxTtlSec <= 0
      ? eq(messages.addressId, addressId)
      : and(eq(messages.addressId, addressId), gt(messages.expiresAt, nowMs()));
  const rows = db
    .select()
    .from(messages)
    .where(cond)
    .orderBy(desc(messages.receivedAt))
    .all();
  const filtered = since ? rows.filter((r) => r.receivedAt > since) : rows;
  return filtered.map(toSummary);
}

export function getMessage(addressId: string, messageId: string, opts?: { raw?: boolean }) {
  const cond =
    env.inboxTtlSec <= 0
      ? and(eq(messages.id, messageId), eq(messages.addressId, addressId))
      : and(
          eq(messages.id, messageId),
          eq(messages.addressId, addressId),
          gt(messages.expiresAt, nowMs()),
        );
  const row = db.select().from(messages).where(cond).get();
  if (!row) return null;
  return {
    id: row.id,
    from: row.fromRaw || row.fromAddress,
    fromAddress: row.fromAddress,
    subject: row.subject,
    textBody: row.textBody,
    htmlBody: row.htmlBody,
    raw: opts?.raw === false ? undefined : row.rawBody || '',
    headers: JSON.parse(row.headersJson || '{}') as Record<string, unknown>,
    size: row.size,
    hasAttachments: !!row.hasAttachments,
    attachments: JSON.parse(row.attachmentMeta || '[]') as AttachmentMeta[],
    receivedAt: row.receivedAt,
    expiresAt: env.inboxTtlSec <= 0 ? null : row.expiresAt,
  };
}

/** Full messages for public REST (text + html + raw, not preview-only) */
export function listMessagesFull(
  addressId: string,
  opts?: { since?: number; limit?: number; from?: string; subject?: string },
) {
  const cond =
    env.inboxTtlSec <= 0
      ? eq(messages.addressId, addressId)
      : and(eq(messages.addressId, addressId), gt(messages.expiresAt, nowMs()));
  let rows = db
    .select()
    .from(messages)
    .where(cond)
    .orderBy(desc(messages.receivedAt))
    .all();
  if (opts?.since) rows = rows.filter((r) => r.receivedAt > opts.since!);
  if (opts?.from) {
    const q = opts.from.toLowerCase();
    rows = rows.filter(
      (r) => r.fromRaw.toLowerCase().includes(q) || r.fromAddress.toLowerCase().includes(q),
    );
  }
  if (opts?.subject) {
    const q = opts.subject.toLowerCase();
    rows = rows.filter((r) => r.subject.toLowerCase().includes(q));
  }
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 200);
  return rows.slice(0, limit).map((row) => ({
    id: row.id,
    from: row.fromRaw || row.fromAddress,
    fromAddress: row.fromAddress,
    subject: row.subject,
    text: row.textBody,
    html: row.htmlBody,
    raw: row.rawBody || '',
    headers: JSON.parse(row.headersJson || '{}') as Record<string, unknown>,
    size: row.size,
    hasAttachments: !!row.hasAttachments,
    attachments: JSON.parse(row.attachmentMeta || '[]') as AttachmentMeta[],
    receivedAt: row.receivedAt,
    code: extractCode(`${row.subject}\n${row.textBody}\n${row.htmlBody}`),
  }));
}

/** Extract common OTP patterns from subject/text/html */
export function extractCode(text: string): string | null {
  const s = text || '';
  const patterns = [
    /verification code[:：\s]*([0-9]{4,8})/i,
    /otp[:：\s]*([0-9]{4,8})/i,
    /kode[:：\s]*([0-9]{4,8})/i,
    /\b([0-9]{6})\b/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export async function ingestRaw(opts: {
  envelopeTo: string[];
  envelopeFrom?: string;
  raw: Buffer | string;
}): Promise<{ stored: number; skipped: string[] }> {
  const rawBuf = Buffer.isBuffer(opts.raw) ? opts.raw : Buffer.from(opts.raw);
  if (rawBuf.length > env.inboundMaxBytes) {
    const err = new Error('message_too_large') as Error & { statusCode: number };
    err.statusCode = 413;
    throw err;
  }

  const parsed = await simpleParser(rawBuf);
  const fromRaw = parsed.from?.text || opts.envelopeFrom || '';
  const fromAddress = parsed.from?.value?.[0]?.address || opts.envelopeFrom || '';
  const subject = parsed.subject || '(no subject)';
  const textBody = parsed.text || '';
  const htmlBody = sanitizeEmailHtml(parsed.html || '');
  const messageIdHdr = parsed.messageId || null;
  const headers: Record<string, string> = {};
  for (const k of ['date', 'to', 'cc', 'reply-to', 'message-id']) {
    const v = parsed.headers.get(k);
    if (v != null) headers[k] = String(v);
  }
  const atts: AttachmentMeta[] = (parsed.attachments || []).map((a) => ({
    filename: a.filename || 'attachment',
    contentType: a.contentType || 'application/octet-stream',
    size: a.size || (a.content ? a.content.length : 0),
  }));

  const rawBody = rawBuf.toString('utf8');
  let stored = 0;
  const skipped: string[] = [];
  const recipients = opts.envelopeTo.map((e) => e.toLowerCase().trim());

  for (const rcpt of recipients) {
    let addr = getAddressByEmail(rcpt);
    if (!addr) {
      // ponytail: auto-create address on first inbound email if domain is active
      const [local, domain] = rcpt.split('@');
      if (domain && isActiveDomain(domain)) {
        const created = await createAddress(domain, local);
        addr = getAddressByEmail(rcpt);
      }
      if (!addr) {
        skipped.push(rcpt);
        continue;
      }
    }
    if (messageIdHdr) {
      const dup = db
        .select()
        .from(messages)
        .where(and(eq(messages.addressId, addr.id), eq(messages.messageIdHdr, messageIdHdr)))
        .get();
      if (dup) {
        skipped.push(rcpt + ':dup');
        continue;
      }
    }
    const id = newId();
    const receivedAt = nowMs();
    const expiresAt = expiresAtFrom(receivedAt);
    db.insert(messages)
      .values({
        id,
        addressId: addr.id,
        messageIdHdr,
        fromRaw,
        fromAddress,
        subject,
        textBody,
        htmlBody,
        rawBody,
        headersJson: JSON.stringify(headers),
        size: rawBuf.length,
        hasAttachments: atts.length ? 1 : 0,
        attachmentMeta: JSON.stringify(atts),
        receivedAt,
        expiresAt,
      })
      .run();
    const summary = toSummary({
      id,
      addressId: addr.id,
      messageIdHdr,
      fromRaw,
      fromAddress,
      subject,
      textBody,
      htmlBody,
      rawBody,
      headersJson: JSON.stringify(headers),
      size: rawBuf.length,
      hasAttachments: atts.length ? 1 : 0,
      attachmentMeta: JSON.stringify(atts),
      receivedAt,
      expiresAt,
    });
    await publishInbox(addr.token, summary);
    stored++;
  }

  return { stored, skipped };
}
