function resolveApiBase(): string {
  const fromEnv = (import.meta.env.VITE_API_URL as string) || '';
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window === 'undefined') return '';
  // vite dev proxy
  if (window.location.port === '5173') return '';
  // prod static on :3173 → API on same host :3100
  if (window.location.port === '3173') {
    return `${window.location.protocol}//${window.location.hostname}:3100`;
  }
  // reverse-proxy same origin
  return '';
}

export const API_BASE = resolveApiBase();

export type MessageSummary = {
  id: string;
  from: string;
  subject: string;
  receivedAt: number;
  hasAttachments: boolean;
  preview: string;
};

export type AddressCreated = {
  id: string;
  email: string;
  token: string;
  expiresAt: number | null;
  reused?: boolean;
};

export type AdminDomain = {
  name: string;
  active: boolean;
  note?: string;
  createdAt?: number;
};

export type DnsGuide = {
  domain?: string;
  publicIp: string;
  steps: {
    title: string;
    records: {
      type: string;
      host: string;
      value: string;
      priority?: number;
      ttl?: number;
    }[];
    note: string;
  }[];
  checklist: string[];
  spaceship: string[];
};

export async function fetchDomains(): Promise<string[]> {
  const r = await fetch(`${API_BASE}/api/domains`);
  if (!r.ok) throw new Error('domains');
  const j = (await r.json()) as { domains: string[] };
  return j.domains;
}

export async function createAddress(
  domain: string,
  localPart?: string,
): Promise<AddressCreated> {
  const body: { domain: string; localPart?: string } = { domain };
  if (localPart && localPart.trim()) body.localPart = localPart.trim();
  const r = await fetch(`${API_BASE}/api/addresses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = await r.text();
    try {
      const j = JSON.parse(msg) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep */
    }
    throw new Error(msg);
  }
  return r.json();
}

export async function fetchInbox(token: string, since?: number) {
  const q = since ? `?since=${since}` : '';
  const r = await fetch(`${API_BASE}/api/inbox/${token}${q}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{
    email: string;
    expiresAt: number | null;
    messages: MessageSummary[];
  }>;
}

export async function fetchMessage(token: string, id: string) {
  const r = await fetch(`${API_BASE}/api/inbox/${token}/${id}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{
    id: string;
    from: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    receivedAt: number;
    attachments: { filename: string; contentType: string; size: number }[];
  }>;
}

function adminHeaders(key: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-admin-key': key,
  };
}

async function throwAdmin(r: Response): Promise<never> {
  let body: { error?: string; message?: string; remaining?: number; fails?: number } = {};
  try {
    body = await r.json();
  } catch {
    /* ignore */
  }
  if (r.status === 403 || body.error === 'ip_banned') {
    throw new Error(body.message || 'IP diblokir (admin key salah 3x)');
  }
  if (r.status === 401) {
    const rem = body.remaining;
    throw new Error(
      rem != null
        ? `Admin key salah (sisa ${rem} percobaan)`
        : body.message || 'unauthorized',
    );
  }
  throw new Error(body.message || body.error || `admin error ${r.status}`);
}

export async function adminListDomains(key: string): Promise<{
  domains: AdminDomain[];
  publicIp: string;
}> {
  const r = await fetch(`${API_BASE}/api/admin/domains`, {
    headers: adminHeaders(key),
  });
  if (!r.ok) await throwAdmin(r);
  return r.json();
}

export async function adminAddDomain(
  key: string,
  name: string,
  note?: string,
): Promise<{ domain: AdminDomain; guide: DnsGuide }> {
  const r = await fetch(`${API_BASE}/api/admin/domains`, {
    method: 'POST',
    headers: adminHeaders(key),
    body: JSON.stringify({ name, active: true, note }),
  });
  if (!r.ok) await throwAdmin(r);
  return r.json();
}

export async function adminToggleDomain(
  key: string,
  name: string,
  active: boolean,
): Promise<AdminDomain> {
  const r = await fetch(`${API_BASE}/api/admin/domains/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: adminHeaders(key),
    body: JSON.stringify({ active }),
  });
  if (!r.ok) await throwAdmin(r);
  const j = (await r.json()) as { domain: AdminDomain };
  return j.domain;
}

export async function adminDeleteDomain(key: string, name: string): Promise<void> {
  const r = await fetch(`${API_BASE}/api/admin/domains/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: adminHeaders(key),
  });
  if (!r.ok) await throwAdmin(r);
}

export async function adminDomainGuide(key: string, name: string): Promise<DnsGuide & { domain: string }> {
  const r = await fetch(
    `${API_BASE}/api/admin/domains/${encodeURIComponent(name)}/guide`,
    { headers: adminHeaders(key) },
  );
  if (!r.ok) await throwAdmin(r);
  return r.json();
}

const LS_KEY = 'tmail_session_v2';
const THEME_KEY = 'tmail_theme';
const ADMIN_KEY = 'tmail_admin_key';

export function saveSession(s: {
  email: string;
  token: string;
  expiresAt: number | null;
  domain: string;
  localPart?: string;
}) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

export function loadSession(): {
  email: string;
  token: string;
  expiresAt: number | null;
  domain: string;
  localPart?: string;
} | null {
  try {
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem('tmail_session_v1');
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j.token) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    if (
      typeof j.expiresAt === 'number' &&
      j.expiresAt > 0 &&
      j.expiresAt < 8e15 &&
      j.expiresAt < Date.now()
    ) {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem('tmail_session_v1');
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem('tmail_session_v1');
}

export type Theme = 'light' | 'dark';

export function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark' || t === 'light') return t;
  } catch {
    /* ignore */
  }
  return 'dark';
}

export function saveTheme(t: Theme) {
  localStorage.setItem(THEME_KEY, t);
}

export function loadAdminKey(): string {
  try {
    return localStorage.getItem(ADMIN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveAdminKey(k: string) {
  localStorage.setItem(ADMIN_KEY, k);
}
