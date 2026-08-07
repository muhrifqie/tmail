# PRD — TMail (Multi-Domain Temp Mail)

**Document ID:** TM-PRD-001  
**Version:** 2.0  
**Status:** Ready for implementation  
**Date:** 2026-07-26  
**Owner:** TMail maintainers  
**Handoff:** Copy this file + `docs/` into any new workspace; implementer needs zero prior chat context.

---

## 0. One-liner

Disposable multi-domain inbox: user gets `random@domain`, mail hits Haraka catch-all, Fastify stores + SSE-pushes to one-page SvelteKit UI. Auto-delete after 1 hour.

---

## 1. Problem & goal

**Problem:** Need self-hosted temp-mail for many domains (Spaceship / any registrar). Registrar only hosts DNS; we own receive + UI.

**Goal:** Ship a one-screen product: pick domain → generate address → see mail live → messages die after TTL.

**Success (MVP):**
- Gmail → test address appears in UI ≤ 3s after SMTP end-of-DATA (same VPS, best effort)
- ≥ 1 domain live; schema supports N domains via `domains.json`
- HTML mail safe (no script exec)
- Messages older than TTL gone (job + read-path filter)
- `docker compose up` boots smtp + api + web + redis

---

## 2. Non-goals (MVP)

- Outbound SMTP / reply
- User accounts, OAuth, billing
- Public multi-tenant custom domains (user points own MX)
- IMAP / POP
- Full-text search, folders, labels
- Attachment download (metadata only optional stub)
- Mobile native apps
- Admin UI (edit `domains.json` + env is enough)

---

## 3. Locked stack (do not renegotiate without owner)

| Layer | Choice | Notes |
|-------|--------|--------|
| SMTP | **Haraka** | Plugin-based, Node, catch-all |
| API | **Fastify** | Schema validation, SSE routes |
| Parse | **mailparser** | Raw → structured |
| Realtime | **SSE first** | Socket.io only if SSE proven insufficient |
| DB | **SQLite + Drizzle + WAL** | File DB; enough for this scale |
| Cache / TTL index | **Redis** | inbox session keys, pub/sub fanout, rate limit |
| Scale escape hatch | Postgres | Later only; keep Drizzle dialect swappable |
| Web | **SvelteKit** | SPA-ish one page + adapter-node or static+proxy |
| CSS | **Tailwind only** | No shadcn / bits-ui / big kit |
| Font | Inter / Geist, system fallback | |
| Theme | Dark-first, indigo/violet accent | |
| Orchestration | **docker-compose** | smtp, api, web, redis |

**Improvisasi vs draft user (accepted into this PRD):**
1. **SSE default, Socket.io optional** — fewer moving parts; Redis pub/sub → SSE.
2. **SQLite WAL + single writer** — Haraka plugin HTTP-posts to API (only API writes DB). Avoid multi-process SQLite corruption.
3. **`domains.json` hot-reload** optional; MVP read-on-start + `SIGHUP` or admin `POST /internal/reload-domains`.
4. **Tokenized inbox** — public URL uses `token`, not guessable `local@domain` alone.
5. **Iframe sandbox for HTML** — sanitize + `sandbox` without `allow-scripts`.
6. **Internal ingest auth** — shared secret Haraka → Fastify (`X-Ingest-Key`).
7. **Compose network only for smtp↔api** — ingest port not public.
8. **No big UI library** — as user asked.
9. **Attachment: store size/name only in MVP** — no disk blobs until phase 2.
10. **Rate limit** IP on generate + SSE open via Redis.

---

## 4. Architecture

```
                    ┌─────────────┐
   MX domain ──────►│ Haraka :25  │
                    └──────┬──────┘
                           │ HTTP POST /internal/ingest
                           │ header X-Ingest-Key
                    ┌──────▼──────┐     ┌────────┐
   Browser ────────►│ Fastify API │────►│ SQLite │
   REST + SSE       │             │────►│ Redis  │
                    └──────▲──────┘     └────────┘
                           │
                    ┌──────┴──────┐
                    │ SvelteKit   │
                    │ (web)       │
                    └─────────────┘
```

**Why API owns DB:** Haraka plugin stays thin (accept + forward raw/parsed). One writer → SQLite safe.

**Realtime path:**
1. Ingest saves message
2. `PUBLISH inbox:{token} {messageSummary}`
3. SSE handler subscribed to that channel pushes event
4. Client appends to list

**Fallback if Redis down:** SSE client falls back to poll `GET /api/inbox/:token?since=` every 5s (document in code).

---

## 5. Project layout (canonical)

```
tmail/
├── README.md
├── PRD.md                      ← this file (or docs/PRD.md)
├── domains.json                ← active domains
├── docker-compose.yml
├── .env.example
├── smtp/                       ← Haraka
│   ├── config/
│   ├── plugins/
│   │   └── tmail_forward.js    ← forward to API
│   └── package.json
├── api/                        ← Fastify
│   ├── src/
│   │   ├── index.ts
│   │   ├── env.ts
│   │   ├── db/
│   │   │   ├── schema.ts
│   │   │   ├── client.ts
│   │   │   └── migrate.ts
│   │   ├── routes/
│   │   │   ├── domains.ts
│   │   │   ├── addresses.ts
│   │   │   ├── inbox.ts
│   │   │   ├── sse.ts
│   │   │   └── internal_ingest.ts
│   │   ├── services/
│   │   │   ├── address.ts
│   │   │   ├── message.ts
│   │   │   ├── ttl.ts
│   │   │   └── realtime.ts
│   │   └── lib/
│   │       ├── redis.ts
│   │       ├── sanitize.ts
│   │       └── token.ts
│   ├── drizzle.config.ts
│   └── package.json
└── web/                        ← SvelteKit
    ├── src/
    │   ├── routes/
    │   │   ├── +page.svelte    ← one-screen app
    │   │   └── +layout.svelte
    │   ├── lib/
    │   │   ├── api.ts
    │   │   ├── sse.ts
    │   │   └── components/
    │   │       ├── DomainSelect.svelte
    │   │       ├── AddressBar.svelte
    │   │       ├── MessageList.svelte
    │   │       ├── MessageView.svelte
    │   │       └── EmptyState.svelte
    │   └── app.css
    └── package.json
```

---

## 6. Domain config

`domains.json` (example):

```json
{
  "domains": [
    { "name": "mail1.example.com", "active": true },
    { "name": "mail2.example.com", "active": true },
    { "name": "old.example.com", "active": false }
  ]
}
```

DNS per active domain (Spaceship / any):

```
MX  @    mail.<platform-host>    10
A   mail <VPS_IP>
```

Haraka hosts all names; accept if RCPT domain ∈ active set (reloadable list synced from same file or API).

---

## 7. Data model (Drizzle / SQLite)

### `addresses`
| Column | Type | Notes |
|--------|------|--------|
| id | text pk | ulid/uuid |
| token | text unique | public inbox key, 32+ bytes entropy |
| local_part | text | |
| domain | text | |
| email | text unique | `local@domain` |
| created_at | integer | unix ms |
| expires_at | integer | created + TTL |

Index: `token`, `email`

### `messages`
| Column | Type | Notes |
|--------|------|--------|
| id | text pk | |
| address_id | text fk | |
| message_id_hdr | text | RFC Message-ID, nullable |
| from_raw | text | |
| from_address | text | |
| subject | text | |
| text_body | text | |
| html_body | text | pre-sanitized store OR sanitize on read (prefer sanitize on write) |
| headers_json | text | subset JSON |
| size | integer | bytes |
| has_attachments | integer | 0/1 |
| attachment_meta | text | JSON `[{filename,contentType,size}]` no binary |
| received_at | integer | |
| expires_at | integer | |

Index: `(address_id, received_at desc)`, unique partial `(address_id, message_id_hdr)` where message_id not null

### Redis keys
| Key | TTL | Purpose |
|-----|-----|---------|
| `inbox:sess:{token}` | address TTL | optional cache of last list |
| `rl:gen:{ip}` | 1m | rate limit generate |
| `rl:sse:{ip}` | 1m | rate limit SSE |
| channel `inbox:{token}` | pub/sub | new message events |

**Default TTL messages + addresses: 3600s (1 hour).** Env: `INBOX_TTL_SEC=3600`.

---

## 8. API contract

Base: `http://api:3000` internal, public via reverse proxy `/api/*`.

### Public

#### `GET /api/domains`
→ `{ domains: string[] }` active only

#### `POST /api/addresses`
Body:
```json
{ "domain": "mail1.example.com" }
```
MVP: no custom prefix.  
→ `201 { id, email, token, expiresAt }`  
Errors: `400` bad domain, `429` rate limit

#### `GET /api/inbox/:token`
Query: `since?: number` (received_at ms)  
→ `{ email, expiresAt, messages: MessageSummary[] }`  
`404` unknown/expired token

#### `GET /api/inbox/:token/:messageId`
→ full message (text + html sanitized)  
`404` if wrong token / expired

#### `GET /api/inbox/:token/stream` (SSE)
Headers: `Content-Type: text/event-stream`  
Events:
```
event: ready
data: {"ok":true}

event: message
data: {MessageSummary}

event: ping
data: {}
```
Ping every 15s. Close on token expiry.

### Internal (network-restricted)

#### `POST /internal/ingest`
Header: `X-Ingest-Key: $INGEST_KEY`  
Body (JSON):
```json
{
  "envelopeTo": ["user@mail1.example.com"],
  "envelopeFrom": "x@gmail.com",
  "raw": "<optional base64 or string>",
  "parsed": {
    "messageId": "...",
    "from": "...",
    "subject": "...",
    "text": "...",
    "html": "...",
    "headers": {},
    "attachments": [{ "filename": "a.pdf", "contentType": "application/pdf", "size": 123 }]
  }
}
```
Prefer plugin sends **parsed** via mailparser inside Haraka or API parses `raw`. Pick one path; recommend **API parses raw** for single sanitize point.

Logic:
1. Auth key
2. For each rcpt matching known address row (by email) **or** auto-create address if catch-all policy = create-on-receive?  

**MVP policy (explicit):**  
- Only deliver if address already generated via API (exists in `addresses` and not expired).  
- Unknown rcpt → Haraka `DENYSOFT` or discard after 550.  
- Rationale: prevents DB flood from spam to random locals; temp-mail UX still OK (user generates first).

Alternative policy `CATCHALL_CREATE=1` later.

3. Insert message, set expires_at  
4. Redis publish  
5. `202 { stored: n }`

### MessageSummary shape
```ts
{
  id: string
  from: string
  subject: string
  receivedAt: number
  hasAttachments: boolean
  preview: string  // first 120 chars text
}
```

---

## 9. Haraka plugin duties

1. Load active domains (file or env)
2. `rcpt` hook: domain active? else DENY  
3. Optional: check API `GET /internal/address-exists?email=` — **or** always accept domain and let API drop unknown (simpler; risk spam traffic). Prefer **accept domain + API drop** for less latency; rate-limit connection.
4. `queue` or `data` hook: POST raw to API with ingest key
5. On API 2xx → OK; else DENYSOFT (temp fail)

Max message size: **5MB** (`INBOUND_MAX_BYTES`).

---

## 10. TTL worker

In Fastify `setInterval` every 60s (or Redis expiry + lazy delete):
- `DELETE FROM messages WHERE expires_at < now`
- `DELETE FROM addresses WHERE expires_at < now`
- SQLite `PRAGMA optimize` occasional

Also filter expired on every read (defense in depth).

---

## 11. Frontend UX (one page)

**Inspirasi:** temp-mail.org / guerrillamail — single screen.

### Desktop
```
┌──────────────────────────────────────────────────────────┐
│  TMail          [domain ▾]  [Generate]  [Copy]  email@…  │
├────────────────────┬─────────────────────────────────────┤
│ Message list       │ Subject                             │
│ · from / subject   │ From / date                         │
│ · time             │ ─────────────────                   │
│                    │ HTML iframe sandbox / plain toggle  │
│ empty state        │                                     │
└────────────────────┴─────────────────────────────────────┘
Footer: expires in mm:ss | auto-delete 1h
```

### Mobile
- Top: address bar + actions  
- Tabs or stack: List | Read  
- Back from read → list

### Behavior
1. Load domains  
2. If `localStorage.tmail_token` valid → restore inbox else generate  
3. Open SSE  
4. Copy button → clipboard + toast 1.5s “Tersalin” / “Copied”  
5. Select message → detail panel  
6. On expiry → clear state + prompt regenerate  

**i18n MVP:** Indonesian primary UI strings (owner preference) with short English ok for system labels if mixed — pick **ID** for user-facing copy.

### Visual
- bg dark `#0f0f12` / card `#17171c`
- accent indigo-500 / violet-500
- no shimmer text, no glow spam
- compact spacing

---

## 12. Security requirements

| Item | Rule |
|------|------|
| XSS | Sanitize HTML on write; render in iframe `sandbox=""` (no scripts). CSP on app. |
| Ingest | Shared secret; bind ingest to docker network |
| Tokens | `crypto.randomBytes(32).toString('base64url')` |
| Rate limit | generate: 10/min/IP; SSE: 20 open/min/IP |
| Listing | No global message search API |
| Admin | No public admin in MVP |
| Logs | No full body in prod logs |
| Headers | noindex robots |

---

## 13. Env (`.env.example`)

```bash
NODE_ENV=production
INGEST_KEY=change-me-long-random
INBOX_TTL_SEC=3600
INBOUND_MAX_BYTES=5242880
SQLITE_PATH=/data/tmail.sqlite
REDIS_URL=redis://redis:6379
API_PORT=3000
PUBLIC_API_URL=https://tmail.example.com/api
CORS_ORIGIN=https://tmail.example.com
# optional
# CATCHALL_CREATE=0
```

---

## 14. docker-compose (services)

| Service | Image/build | Ports |
|---------|-------------|-------|
| redis | redis:7-alpine | internal 6379 |
| api | ./api | 3000 (proxy) |
| web | ./web | 5173/3001 (proxy) |
| smtp | ./smtp | **25** host |

Volumes: `api-data` → SQLite file.

---

## 15. Feature matrix

| Feature | MVP | Later |
|---------|-----|-------|
| Random address | yes | |
| Domain picker | yes | |
| SSE inbox | yes | |
| HTML + plain | yes | |
| Auto-delete 1h | yes | |
| Copy 1-click | yes | |
| Custom prefix | | yes |
| Extend TTL | | yes |
| Attachment download | | yes |
| Public API keys | | yes |
| Multi-tab inboxes | | yes |
| Light mode | | yes |
| Socket.io | only if SSE fails | |
| Postgres | scale only | |
| Admin UI | | yes |

---

## 16. Implementation phases (handoff checklist)

### Phase 0 — Skeleton
- [ ] monorepo folders + package.json each
- [ ] docker-compose redis + api stub health `GET /health`
- [ ] domains.json + read helper
- [ ] .env.example + README quickstart

### Phase 1 — DB + address API
- [ ] Drizzle schema migrate
- [ ] POST /api/addresses + GET /api/domains
- [ ] Redis rate limit
- [ ] unit: token uniqueness, domain reject

### Phase 2 — Ingest + messages
- [ ] POST /internal/ingest + mailparser
- [ ] sanitize HTML
- [ ] GET inbox list/detail
- [ ] TTL sweeper
- [ ] Haraka plugin forward

### Phase 3 — SSE
- [ ] Redis pub/sub bridge
- [ ] GET stream + ping
- [ ] poll fallback documented

### Phase 4 — Web UI
- [ ] one-page layout split panel
- [ ] wire API + SSE
- [ ] copy + countdown expiry
- [ ] mobile list/detail

### Phase 5 — Hardening
- [ ] size limits, error shapes
- [ ] compose prod proxy sample (Caddy)
- [ ] load smoke: send mail → UI

**Definition of done MVP:** Phase 0–4 complete + smoke test written in README.

---

## 17. Test plan (minimal)

1. **API:** create address → ingest fixture.eml → list contains subject  
2. **TTL:** set `INBOX_TTL_SEC=2` → message disappears after sweep  
3. **Security:** ingest without key → 401; HTML with `<script>` → stripped / inert in iframe  
4. **SSE:** connect → ingest → event received (manual or script)  
5. **SMTP e2e (VPS):** `swaks --to user@domain --server 127.0.0.1`

Ship one script: `api/scripts/smoke.mjs`.

---

## 18. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Port 25 blocked by host | VPS provider allowlist / use provider with mail ports |
| SQLite lock under burst | single writer API; WAL; busy_timeout |
| Spam to active addresses | short TTL; rate limits; max size |
| XSS in mail | sanitize + sandbox iframe |
| Redis down | poll fallback; still serve REST |
| MX misconfig | README dig MX checklist |

---

## 19. Copy-paste agent brief (other project)

```
Implement TMail per PRD.md v2.0.
Stack locked: Haraka + Fastify + mailparser + SQLite/Drizzle/WAL + Redis + SvelteKit + Tailwind.
SSE not Socket.io unless blocked.
MVP: random address, domain list, SSE inbox, HTML/plain, TTL 1h, copy button.
No custom prefix, no attachments download, no auth users.
Haraka forwards to POST /internal/ingest with X-Ingest-Key.
Only pre-generated addresses receive mail.
Dark-first indigo/violet, one-page split inbox, no big UI kit.
Path layout as PRD §5. Ship docker-compose + smoke script.
```

---

## 20. Open decisions (defaults applied)

| Topic | Default in this PRD |
|-------|---------------------|
| Custom prefix | **No** (nice-to-have) |
| Unknown RCPT | **Drop** (must generate first) |
| Realtime | **SSE** |
| Attachment bytes | **Not stored** |
| UI language | **Indonesian** |
| TTL | **3600s** |

Owner can flip defaults by editing §20 before coding.

---

## Changelog

- **v2.0** — User stack lock + improvisasi (SSE-first, SQLite single-writer, token inbox, ingest secret, no big UI lib). Handoff-ready.
- **v1.0** — Exploratory multi-option PRD (superseded).
