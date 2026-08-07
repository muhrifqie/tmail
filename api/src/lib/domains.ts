import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../env.js';

export type DomainRow = {
  name: string;
  active: boolean;
  note?: string;
  createdAt?: number;
  /** last DNS check snapshot (optional, non-authoritative) */
  dnsReady?: boolean;
  dnsCheckedAt?: number;
};

let cache: DomainRow[] = [];
let loadedAt = 0;
let migrated = false;

/** Prefer data/domains.json; one-time copy from legacy root domains.json. */
function ensureDomainsFile(): void {
  if (migrated) return;
  migrated = true;
  const primary = env.domainsPath;
  if (existsSync(primary)) return;
  const legacy = resolve(dirname(primary), '../domains.json');
  const legacyRoot = resolve(dirname(primary), '../../domains.json');
  for (const leg of [legacy, legacyRoot]) {
    if (existsSync(leg) && leg !== primary) {
      try {
        mkdirSync(dirname(primary), { recursive: true });
        copyFileSync(leg, primary);
        return;
      } catch {
        /* ignore */
      }
    }
  }
}

function readRaw(): DomainRow[] {
  ensureDomainsFile();
  if (!existsSync(env.domainsPath)) return [];
  const raw = JSON.parse(readFileSync(env.domainsPath, 'utf8')) as {
    domains?: DomainRow[];
  };
  return (raw.domains || [])
    .map((d) => ({
      name: String(d.name).toLowerCase().trim(),
      active: !!d.active,
      note: d.note ? String(d.note) : undefined,
      createdAt: d.createdAt,
      dnsReady: d.dnsReady,
      dnsCheckedAt: d.dnsCheckedAt,
    }))
    .filter((d) => d.name.includes('.'));
}

export function loadDomains(force = false): DomainRow[] {
  if (!force && cache.length && Date.now() - loadedAt < 2_000) return cache;
  cache = readRaw();
  loadedAt = Date.now();
  return cache;
}

export function saveDomains(rows: DomainRow[]): DomainRow[] {
  const cleaned = rows
    .map((d) => ({
      name: String(d.name).toLowerCase().trim(),
      active: !!d.active,
      note: d.note || undefined,
      createdAt: d.createdAt || Date.now(),
      dnsReady: d.dnsReady,
      dnsCheckedAt: d.dnsCheckedAt,
    }))
    .filter((d) => d.name.includes('.'));

  // unique by name
  const map = new Map<string, DomainRow>();
  for (const d of cleaned) map.set(d.name, d);
  const list = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));

  mkdirSync(dirname(env.domainsPath), { recursive: true });
  const tmp = `${env.domainsPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ domains: list }, null, 2) + '\n', 'utf8');
  try {
    renameSync(tmp, env.domainsPath);
  } catch {
    copyFileSync(tmp, env.domainsPath);
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
  cache = list;
  loadedAt = Date.now();
  return list;
}

export function patchDomainMeta(
  name: string,
  patch: Partial<Pick<DomainRow, 'dnsReady' | 'dnsCheckedAt' | 'note' | 'active'>>,
): DomainRow | null {
  const n = name.toLowerCase().trim();
  const rows = loadDomains(true);
  const row = rows.find((r) => r.name === n);
  if (!row) return null;
  Object.assign(row, patch);
  saveDomains(rows);
  return row;
}

export function activeDomainNames(): string[] {
  return loadDomains()
    .filter((d) => d.active)
    .map((d) => d.name);
}

export function isActiveDomain(domain: string): boolean {
  const d = domain.toLowerCase().trim();
  return activeDomainNames().includes(d);
}

export function upsertDomain(input: {
  name: string;
  active?: boolean;
  note?: string;
}): DomainRow {
  const name = String(input.name).toLowerCase().trim();
  if (!name.includes('.')) {
    const err = new Error('domain_invalid') as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }
  const rows = loadDomains(true);
  const existing = rows.find((r) => r.name === name);
  if (existing) {
    existing.active = input.active ?? existing.active;
    if (input.note !== undefined) existing.note = input.note;
  } else {
    rows.push({
      name,
      active: input.active ?? true,
      note: input.note,
      createdAt: Date.now(),
    });
  }
  saveDomains(rows);
  return loadDomains(true).find((r) => r.name === name)!;
}

export function removeDomain(name: string): boolean {
  const n = name.toLowerCase().trim();
  const rows = loadDomains(true);
  const next = rows.filter((r) => r.name !== n);
  if (next.length === rows.length) return false;
  saveDomains(next);
  return true;
}
