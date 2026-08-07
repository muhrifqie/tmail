import net from 'node:net';
import { env } from '../env.js';

export const PRIMARY_WEB = env.primaryWeb;
export const SHARED_MAIL = env.mailHostname || `mail.${env.primaryWeb}`;

export type DnsCheckItem = {
  id: string;
  ok: boolean;
  required: boolean;
  label: string;
  expected?: string;
  found: string[];
  detail?: string;
};

export type DnsCheckResult = {
  domain: string;
  mode: 'primary_web' | 'mail_only';
  ready: boolean;
  publicIp: string;
  sharedMailHost: string;
  checks: DnsCheckItem[];
  checkedAt: number;
};

type DohAnswer = { name?: string; type?: number; data?: string; TTL?: number };

async function doh(name: string, type: 'A' | 'MX' | 'AAAA'): Promise<string[]> {
  const q = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const ctrl = AbortSignal.timeout(8_000);
  try {
    const r = await fetch(q, {
      headers: { accept: 'application/dns-json' },
      signal: ctrl,
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { Answer?: DohAnswer[]; Status?: number };
    if (j.Status !== 0 && j.Status !== undefined && !j.Answer?.length) return [];
    const out: string[] = [];
    for (const a of j.Answer || []) {
      if (!a.data) continue;
      if (type === 'MX') {
        // "10 mail.example.com."
        const parts = a.data.trim().split(/\s+/);
        const host = (parts[parts.length - 1] || '').replace(/\.$/, '').toLowerCase();
        if (host) out.push(host);
      } else {
        out.push(a.data.replace(/\.$/, '').toLowerCase());
      }
    }
    return [...new Set(out)];
  } catch {
    return [];
  }
}

function tcpOpen(host: string, port: number, ms = 4_000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => {
      s.destroy();
      resolve(false);
    }, ms);
    s.on('connect', () => {
      clearTimeout(t);
      s.end();
      resolve(true);
    });
    s.on('error', () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

function normHost(h: string): string {
  return h.replace(/\.$/, '').toLowerCase().trim();
}

function mxOk(found: string[], domain: string): { ok: boolean; detail: string } {
  const shared = normHost(env.mailHostname || SHARED_MAIL);
  const own = `mail.${domain}`;
  const hit = found.map(normHost);
  if (hit.includes(shared)) return { ok: true, detail: `MX → ${shared}` };
  if (hit.includes(own)) return { ok: true, detail: `MX → ${own}` };
  // any mx host that we'll resolve next
  if (hit.length) return { ok: true, detail: `MX → ${hit.join(', ')} (akan dicek A-nya)` };
  return { ok: false, detail: `MX kosong — set ke ${shared} atau ${own}` };
}

export async function checkDomainDns(domain: string): Promise<DnsCheckResult> {
  const d = domain.toLowerCase().trim();
  const ip = env.publicIp || '';
  const shared = normHost(env.mailHostname || SHARED_MAIL);
  const isPrimary = d === PRIMARY_WEB || d === `www.${PRIMARY_WEB}`;
  const mode = isPrimary ? ('primary_web' as const) : ('mail_only' as const);
  const checks: DnsCheckItem[] = [];

  if (isPrimary) {
    const aRoot = await doh(d, 'A');
    checks.push({
      id: 'a_root',
      ok: !!ip && aRoot.includes(ip),
      required: true,
      label: `A @ ${d}`,
      expected: ip || 'PUBLIC_IP',
      found: aRoot,
      detail: aRoot.includes(ip) ? 'OK' : `Harus ${ip}`,
    });
    const aWww = await doh(`www.${d.replace(/^www\./, '')}`, 'A');
    const wwwHost = `www.${d.replace(/^www\./, '')}`;
    checks.push({
      id: 'a_www',
      ok: !!ip && aWww.includes(ip),
      required: false,
      label: `A ${wwwHost}`,
      expected: ip,
      found: aWww,
      detail: aWww.includes(ip) ? 'OK' : 'Opsional tapi disarankan',
    });
  }

  const mx = await doh(d, 'MX');
  const mxStatus = mxOk(mx, d);
  checks.push({
    id: 'mx',
    ok: mx.length > 0 && (mx.map(normHost).includes(shared) || mx.map(normHost).includes(`mail.${d}`) || mx.length > 0),
    required: true,
    label: `MX ${d}`,
    expected: `${shared} (prio 10) atau mail.${d}`,
    found: mx,
    detail: mxStatus.detail,
  });
  // tighten mx ok: prefer shared or own mail host
  const mxHosts = mx.map(normHost);
  const mxPreferred =
    mxHosts.includes(shared) || mxHosts.includes(`mail.${d}`) || mxHosts.some((h) => h.endsWith(`.${d}`) || h === shared);
  checks[checks.length - 1].ok = mxPreferred && mxHosts.length > 0;

  // Resolve A for each MX target (and shared)
  const targets = [...new Set([shared, `mail.${d}`, ...mxHosts])].filter(Boolean);
  let anyMailA = false;
  for (const host of targets) {
    const a = await doh(host, 'A');
    const ok = !!ip && a.includes(ip);
    if (ok) anyMailA = true;
    const isExpected = host === shared || host === `mail.${d}` || mxHosts.includes(host);
    if (!isExpected && !a.length) continue;
    checks.push({
      id: `a_mail_${host}`,
      ok,
      required: host === shared || mxHosts.includes(host),
      label: `A ${host}`,
      expected: ip,
      found: a,
      detail: ok ? 'Mail host ke VPS' : a.length ? `Resolve ${a.join(',')} ≠ ${ip}` : 'Tidak resolve',
    });
  }

  // SMTP :25 on PUBLIC_IP (from this host — usually ok)
  let smtpOk = false;
  if (ip) {
    smtpOk = await tcpOpen(ip, 25, 4_000);
    // if public IP is this machine's external, connecting to self public IP may fail on some VPS;
    // fallback 127.0.0.1
    if (!smtpOk) smtpOk = await tcpOpen('127.0.0.1', 25, 2_000);
  }
  checks.push({
    id: 'smtp25',
    ok: smtpOk,
    required: true,
    label: 'SMTP port 25',
    expected: `${ip || 'VPS'}:25 open`,
    found: smtpOk ? ['open'] : ['closed'],
    detail: smtpOk ? 'tmail-smtp listening' : 'Start tmail-smtp / buka port 25 provider',
  });

  const ready = checks.filter((c) => c.required).every((c) => c.ok) && anyMailA;
  // recompute ready strictly
  const need = checks.filter((c) => c.required);
  const readyStrict = need.every((c) => c.ok);

  return {
    domain: d,
    mode,
    ready: readyStrict,
    publicIp: ip,
    sharedMailHost: shared,
    checks,
    checkedAt: Date.now(),
  };
}

export async function checkManyDomains(names: string[]): Promise<DnsCheckResult[]> {
  const out: DnsCheckResult[] = [];
  for (const n of names) {
    out.push(await checkDomainDns(n));
  }
  return out;
}
