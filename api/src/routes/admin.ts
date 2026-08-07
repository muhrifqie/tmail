import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';
import {
  loadDomains,
  upsertDomain,
  removeDomain,
  saveDomains,
} from '../lib/domains.js';
import {
  clientIp,
  clearAdminFails,
  isBanned,
  recordAdminFail,
} from '../lib/admin-ban.js';

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function keyFrom(req: FastifyRequest): string | undefined {
  const h = req.headers['x-admin-key'];
  return Array.isArray(h) ? h[0] : h;
}

/** Auth gate: ban check → key check → fail/ban on wrong key. */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const ip = clientIp(req);
  const ban = await isBanned(ip);
  if (ban.banned) {
    reply.code(403).send({
      error: 'ip_banned',
      until: ban.until,
      message: 'IP diblokir karena admin key salah berulang',
    });
    return false;
  }

  const key = keyFrom(req);
  if (!key || !env.adminKey || !safeEq(key, env.adminKey)) {
    const fail = await recordAdminFail(ip);
    if (fail.banned) {
      reply.code(403).send({
        error: 'ip_banned',
        until: fail.until,
        fails: fail.fails,
        message: `Admin key salah ${fail.fails}x — IP diblokir`,
      });
      return false;
    }
    reply.code(401).send({
      error: 'unauthorized',
      fails: fail.fails,
      remaining: fail.remaining,
      message: `Admin key salah (${fail.fails}/${env.adminMaxFails})`,
    });
    return false;
  }

  await clearAdminFails(ip);
  return true;
}

function publicIp(): string {
  return env.publicIp || 'SET_PUBLIC_IP';
}

/** Primary site that hosts UI. Other domains = mail-only MX → same VPS. Set PRIMARY_WEB in .env */
const PRIMARY_WEB = env.primaryWeb;
/** Shared mail host (A already on VPS). Prefer this for extra domains. */
const SHARED_MAIL = env.mailHostname || `mail.${env.primaryWeb}`;

function dnsGuide(domain: string) {
  const ip = publicIp();
  const isPrimary = domain === PRIMARY_WEB || domain === `www.${PRIMARY_WEB}`;
  const ownMailHost = `mail.${domain}`;

  if (isPrimary) {
    return {
      publicIp: ip,
      mode: 'primary_web' as const,
      primaryWeb: PRIMARY_WEB,
      steps: [
        {
          title: 'A record — website utama',
          records: [
            { type: 'A', host: '@', value: ip, ttl: 300 },
            { type: 'A', host: 'www', value: ip, ttl: 300 },
            { type: 'A', host: 'mail', value: ip, ttl: 300 },
          ],
          note: `Hanya domain web utama yang perlu A @ / www. Nginx server_name = ${PRIMARY_WEB}.`,
        },
        {
          title: `MX — terima email @${PRIMARY_WEB}`,
          records: [{ type: 'MX', host: '@', value: SHARED_MAIL, priority: 10, ttl: 300 }],
          note: `MX harus hostname (bukan IP). ${SHARED_MAIL} resolve ke VPS :25.`,
        },
      ],
      checklist: [
        `dig +short A ${PRIMARY_WEB} → ${ip}`,
        `dig +short A ${SHARED_MAIL} → ${ip}`,
        `dig +short MX ${PRIMARY_WEB} → 10 ${SHARED_MAIL}.`,
        `UI: https://${PRIMARY_WEB} — admin domain list aktif`,
      ],
      spaceship: [
        `Spaceship → ${PRIMARY_WEB} → DNS`,
        `A @ → ${ip}`,
        `A www → ${ip}`,
        `A mail → ${ip}`,
        `MX @ → ${SHARED_MAIL} priority 10`,
      ],
    };
  }

  // Mail-only extra domain (Spaceship etc.) — no web A required
  return {
    publicIp: ip,
    mode: 'mail_only' as const,
    primaryWeb: PRIMARY_WEB,
    sharedMailHost: SHARED_MAIL,
    steps: [
      {
        title: 'MX saja (disarankan) — pakai mail host bersama',
        records: [{ type: 'MX', host: '@', value: SHARED_MAIL, priority: 10, ttl: 300 }],
        note:
          `Domain ini TIDAK perlu A @ ke VPS. Web tetap dibuka di https://${PRIMARY_WEB}. ` +
          `Cukup MX mengarah ke ${SHARED_MAIL} (sudah A → ${ip}). SMTP di VPS terima RCPT *@${domain} ` +
          'asalkan domain aktif di admin + alamat sudah di-generate di UI.',
      },
      {
        title: 'Alternatif: MX per-domain',
        records: [
          { type: 'A', host: 'mail', value: ip, ttl: 300 },
          { type: 'MX', host: '@', value: ownMailHost, priority: 10, ttl: 300 },
        ],
        note: `Kalau registrar/provider menolak MX ke domain lain, buat A mail.${domain} → ${ip} lalu MX @ → mail.${domain}.`,
      },
      {
        title: 'Jangan (kecuali mau site terpisah)',
        records: [
          { type: 'A', host: '@', value: ip, ttl: 300 },
          { type: 'A', host: 'www', value: ip, ttl: 300 },
        ],
        note: `A @ pada domain ekstra tidak wajib untuk temp-mail. Tanpa nginx server_name, HTTP ke domain ini gak melayani UI. UI = ${PRIMARY_WEB} saja.`,
      },
    ],
    checklist: [
      `Admin panel: domain ${domain} active`,
      `dig +short MX ${domain} → 10 ${SHARED_MAIL}.  (atau 10 mail.${domain}.)`,
      `dig +short A ${SHARED_MAIL} → ${ip}`,
      `Buka https://${PRIMARY_WEB} → pilih domain ${domain} → generate alamat`,
      'Kirim email uji ke alamat itu (bukan random local)',
    ],
    spaceship: [
      `Spaceship → ${domain} → DNS`,
      `Hapus / jangan set A @ web kecuali perlu`,
      `MX @ → ${SHARED_MAIL}  priority 10   ← cara paling simpel`,
      `ATAU: A mail → ${ip} + MX @ → mail.${domain} priority 10`,
      `UI inbox tetap di https://${PRIMARY_WEB} (bukan di ${domain})`,
      'Tunggu propagasi, dig MX, generate alamat di panel',
    ],
  };
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/meta', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return {
      publicIp: publicIp(),
      mailHostname: env.mailHostname || null,
      ttlSec: env.inboxTtlSec,
      nodeEnv: env.nodeEnv,
      adminMaxFails: env.adminMaxFails,
      adminBanTtlSec: env.adminBanTtlSec,
    };
  });

  app.get('/api/admin/domains', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const domains = loadDomains(true);
    return {
      domains,
      publicIp: publicIp(),
      guideTemplate: dnsGuide('example.com'),
    };
  });

  app.get<{ Params: { domain: string } }>(
    '/api/admin/domains/:domain/guide',
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;
      const domain = decodeURIComponent(req.params.domain).toLowerCase().trim();
      if (!domain.includes('.')) {
        return reply.code(400).send({ error: 'domain_invalid' });
      }
      return { domain, ...dnsGuide(domain) };
    },
  );

  app.post<{
    Body: { name?: string; active?: boolean; note?: string };
  }>('/api/admin/domains', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const name = req.body?.name;
    if (!name || typeof name !== 'string') {
      return reply.code(400).send({ error: 'name_required' });
    }
    try {
      const row = upsertDomain({
        name,
        active: req.body?.active,
        note: req.body?.note,
      });
      return reply.code(201).send({ domain: row, guide: dnsGuide(row.name) });
    } catch (e) {
      const err = e as Error;
      if (err.message === 'domain_invalid') {
        return reply.code(400).send({ error: 'domain_invalid' });
      }
      throw e;
    }
  });

  app.patch<{
    Params: { domain: string };
    Body: { active?: boolean; note?: string };
  }>('/api/admin/domains/:domain', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const name = decodeURIComponent(req.params.domain);
    try {
      const row = upsertDomain({
        name,
        active: req.body?.active,
        note: req.body?.note,
      });
      return { domain: row };
    } catch (e) {
      const err = e as Error;
      if (err.message === 'domain_invalid') {
        return reply.code(400).send({ error: 'domain_invalid' });
      }
      throw e;
    }
  });

  app.delete<{ Params: { domain: string } }>(
    '/api/admin/domains/:domain',
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;
      const name = decodeURIComponent(req.params.domain);
      const ok = removeDomain(name);
      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );

  app.put<{ Body: { domains?: { name: string; active?: boolean; note?: string }[] } }>(
    '/api/admin/domains',
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;
      const list = req.body?.domains;
      if (!Array.isArray(list)) {
        return reply.code(400).send({ error: 'domains_required' });
      }
      const saved = saveDomains(
        list.map((d) => ({
          name: d.name,
          active: d.active ?? true,
          note: d.note,
        })),
      );
      return { domains: saved };
    },
  );
}
