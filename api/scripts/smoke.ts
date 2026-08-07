/**
 * Smoke: create address → ingest sample eml → list inbox.
 * Run: npm run smoke (api must be up, or we start inline — expects API on PUBLIC_API_URL)
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) config({ path: rootEnv });
else config({ path: resolve(__dirname, '../.env') });

const base = process.env.PUBLIC_API_URL || 'http://127.0.0.1:3100';
const ingestKey = process.env.INGEST_KEY || 'dev-ingest-key-change-me';

async function main() {
  const health = await fetch(`${base}/health`);
  if (!health.ok) throw new Error('health failed');
  console.log('health', await health.json());

  const dom = await fetch(`${base}/api/domains`).then((r) => r.json()) as { domains: string[] };
  if (!dom.domains?.length) throw new Error('no domains');
  const domain = dom.domains[0]!;
  console.log('domain', domain);

  const created = await fetch(`${base}/api/addresses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain }),
  }).then(async (r) => {
    if (!r.ok) throw new Error('create ' + (await r.text()));
    return r.json() as Promise<{ email: string; token: string }>;
  });
  console.log('address', created.email);

  const raw = [
    'From: Smoke Test <smoke@example.com>',
    `To: ${created.email}`,
    'Subject: Halo TMail',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Message-ID: <smoke-' + Date.now() + '@test.local>',
    '',
    '<p>Pesan uji <b>TMail</b> <script>alert(1)</script></p>',
  ].join('\r\n');

  const ing = await fetch(`${base}/internal/ingest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ingest-key': ingestKey,
    },
    body: JSON.stringify({
      envelopeTo: [created.email],
      envelopeFrom: 'smoke@example.com',
      raw,
    }),
  }).then(async (r) => {
    if (!r.ok) throw new Error('ingest ' + (await r.text()));
    return r.json();
  });
  console.log('ingest', ing);

  const inbox = await fetch(`${base}/api/inbox/${created.token}`).then((r) => r.json()) as {
    messages: { subject: string; id: string }[];
  };
  if (!inbox.messages?.length) throw new Error('inbox empty');
  console.log('inbox count', inbox.messages.length, 'subject', inbox.messages[0]?.subject);

  const detail = await fetch(
    `${base}/api/inbox/${created.token}/${inbox.messages[0]!.id}`,
  ).then((r) => r.json()) as { htmlBody: string; subject: string };
  if (detail.htmlBody.includes('<script')) throw new Error('XSS not sanitized');
  console.log('detail ok, html sanitized');

  console.log('SMOKE PASS');
}

main().catch((e) => {
  console.error('SMOKE FAIL', e);
  process.exit(1);
});
