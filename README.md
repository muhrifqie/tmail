# TMail — Multi-Domain Temporary Mail

Self-hosted **disposable / temp email**. Generate a throwaway address on one of your
domains, receive mail in real time in a clean one-page inbox, and let it auto-expire.
No sign-up, no passwords, no outbound mail.

```text
        ┌────────────┐   POST /internal/ingest    ┌────────────┐        ┌────────────┐
 inbound│  Haraka    │  (X-Ingest-Key header)     │  Fastify   │  write │  SQLite    │
  email │  SMTP :25  │ ─────────────────────────▶ │   API      │ ─────▶ │  (WAL)     │
────────▶            │                            │  :3100     │        └────────────┘
        └────────────┘                            └─────┬──────┘
                                                        │ publish (Redis pub/sub)
                                                        ▼
                                        ┌──────────────────────────┐
                                        │  SvelteKit inbox (SSE)    │  live push to browser
                                        │  :5173 dev / :3173 prod   │
                                        └──────────────────────────┘
```

**Stack:** Haraka SMTP → Fastify + Drizzle + `better-sqlite3` → Redis (SSE pub/sub) → SvelteKit + Tailwind.

> **AI agents / LLM tools:** start at [`AGENTS.md`](./AGENTS.md) — it's the compact machine-readable map (architecture, routes, env, constraints).

---

## Table of contents

1. [What you get](#what-you-get)
2. [Requirements](#requirements)
3. [Quick start (5 minutes, local dev)](#quick-start-5-minutes-local-dev)
4. [How to use it](#how-to-use-it)
5. [Configuration (`.env`)](#configuration-env)
6. [Project structure](#project-structure)
7. [HTTP API reference](#http-api-reference)
8. [Adding / managing domains](#adding--managing-domains)
9. [Deploying to a server (production)](#deploying-to-a-server-production)
10. [Troubleshooting](#troubleshooting)
11. [FAQ](#faq)
12. [Docs index](#docs-index)

---

## What you get

- **Random address generator** — pick an active domain, get `random@yourdomain`.
- **Live inbox** — new mail appears instantly via Server-Sent Events (SSE), with polling fallback.
- **Read HTML + plain text** — HTML is sanitized (no scripts, no tracking pixels executing).
- **Auto-expire** — set a TTL (e.g. 1 hour) or keep messages forever.
- **Multi-domain** — serve many domains from one server; toggle them in an admin panel.
- **Admin panel** — add/remove domains, see DNS setup guidance, protected by a single key with IP lockout on repeated wrong attempts.
- **No accounts, no outbound** — receive-only by design. Only addresses you generate accept mail.

---

## Requirements

| For | You need |
|-----|----------|
| Local development | [Node.js 20+](https://nodejs.org) and npm |
| Live SSE (optional locally) | [Redis](https://redis.io) — app falls back to in-memory if absent |
| Receiving real internet email | A **server (VPS)** with a public IP, port 25 open, and a domain you control |

You do **not** need Redis or a VPS just to try TMail locally.

---

## Quick start (5 minutes, local dev)

### Windows (easiest)

Double-click or run in a terminal:

```bat
start.bat        :: starts API (:3100) + Web (:5173) and opens your browser
start-smtp.bat   :: optional: dev SMTP catcher on :2525
stop.bat         :: kills ports 3100 / 5173 / 2525
```

### Any OS (manual)

```bash
# 1. copy the example env
cp .env.example .env

# 2. (optional) start Redis for live SSE
docker run -d -p 6379:6379 redis:7-alpine

# 3. start the API
cd api && npm install && npm run dev
#    -> http://127.0.0.1:3100/health should return { "ok": true }

# 4. in a second terminal, start the web UI
cd web && npm install && npm run dev
#    -> open http://127.0.0.1:5173

# 5. (optional) dev SMTP catcher on :2525
cd smtp && npm install && npm run dev
```

### Verify it works (smoke test)

```bash
cd api && npm run smoke
```

This creates an address, ingests a sample email, and asserts the message shows up. If it passes, the core pipeline is healthy.

> **Note (local dev):** without a real SMTP server wired to a domain, you won't receive
> *internet* mail locally. Use `npm run smoke` or `POST /internal/ingest` (below) to
> feed test messages in. Real inbound mail requires the [production setup](#deploying-to-a-server-production).

---

## How to use it

1. Open the UI (`http://127.0.0.1:5173`).
2. Pick a **domain** from the dropdown (comes from `domains.json`).
3. Click **generate** — you get an address like `sunny-fox-12@tmail.local`.
4. **Copy** it with one click and use it wherever you need a throwaway address.
5. Incoming mail appears in the list **live**. Click a message to read HTML or plain text.
6. When the TTL expires (if set), messages auto-delete.

---

## Configuration (`.env`)

Copy `.env.example` to `.env` and edit. All keys have sane defaults:

| Key | Default | What it does |
|-----|---------|--------------|
| `NODE_ENV` | `development` | Runtime mode. |
| `INGEST_KEY` | `dev-ingest-key-change-me` | Shared secret between the SMTP server and the API. **Change in production.** |
| `ADMIN_KEY` | `change-me-admin-key` | Password for the `/admin` panel. **Change in production.** |
| `INBOX_TTL_SEC` | `0` | Auto-delete after N seconds. `0` = keep forever. `3600` = 1 hour. |
| `INBOUND_MAX_BYTES` | `5242880` | Max size (5 MB) of an accepted email. |
| `SQLITE_PATH` | `./data/tmail.sqlite` | SQLite database file. |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis for SSE fan-out. Falls back to memory if unreachable. |
| `API_PORT` | `3100` | API port (3100 avoids clashing with apps on 3000). |
| `PUBLIC_API_URL` | `http://127.0.0.1:3100` | Base API URL the web UI calls. |
| `CORS_ORIGIN` | `http://127.0.0.1:5173` | Allowed browser origin(s), comma-separated. |
| `PRIMARY_WEB` | `example.com` | Your main web domain (UI + admin). Set this in production. |
| `MAIL_HOSTNAME` | *(empty)* | Shared mail host, e.g. `mail.example.com`. |
| `PUBLIC_IP` | *(empty)* | Your server's public IP (used in DNS setup guidance). |
| `CATCHALL_CREATE` | `0` | `1` = auto-create any address that receives mail. `0` = only pre-generated addresses accept mail (recommended). |
| `ADMIN_MAX_FAILS` | `3` | Wrong admin-key attempts before the IP is banned. |
| `ADMIN_FAIL_WINDOW_SEC` | `900` | Time window (15 min) for counting failed attempts. |
| `ADMIN_BAN_TTL_SEC` | `86400` | Ban duration (24 h) after too many fails. |

> **Never commit your real `.env`** — it's already in `.gitignore`. Only `.env.example`
> (with placeholder values) belongs in git.

---

## Project structure

```text
tmail/
├── api/            Fastify API — the brain
│   ├── src/
│   │   ├── routes/     HTTP endpoints (addresses, inbox, admin, ingest, sse, ...)
│   │   ├── services/   address + message logic
│   │   ├── lib/        redis, sanitize, tokens, dns-check, admin-ban
│   │   ├── db/         Drizzle schema + SQLite client
│   │   └── env.ts      all config, read from .env
│   └── scripts/smoke.ts   end-to-end pipeline test
├── web/            SvelteKit one-page inbox (Tailwind, static build)
├── smtp/           Haraka plugin + dev-forward-smtp.mjs (:2525 dev catcher)
├── deploy/         VPS deploy script, PM2 config, nginx template, prod env example
├── docs/           deep guides (deployment, multi-domain DNS)
├── domains.json    list of domains shown in the picker
├── docker-compose.yml   redis + api + web (smtp commented; needs port 25)
├── AGENTS.md       machine-readable map for AI agents
├── README.md       this file
└── PRD.md          full product spec
```

---

## HTTP API reference

Base URL: `http://127.0.0.1:3100` (dev). Source of truth: `api/src/routes/`.

### Public

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/health` | Liveness check, returns `{ ok: true }`. |
| `GET` | `/api/domains` | Active domains for the picker. |
| `POST` | `/api/addresses` | Create an address. Body: `{ "domain"?: string, "localPart"?: string }`. Returns the address + a `token`. |
| `GET` | `/api/inbox/:token` | List messages for that address token. |
| `GET` | `/api/inbox/:token/:messageId` | One message (sanitized HTML + plain text). |
| `GET` | `/api/inbox/:token/stream` | **SSE** stream, live new-message events. |
| `GET` | `/api/email/:email` | Read by email address (list). |
| `GET` | `/api/email/:email/latest` | Latest message for an address. |
| `GET` | `/api/email/:email/:messageId` | One message; append `/raw` for the raw source. |

### Internal (SMTP server only, needs `X-Ingest-Key`)

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/internal/address-exists` | RCPT check, does this address accept mail? |
| `POST` | `/internal/ingest` | Deliver a parsed email into the system. |

Example, inject a test message manually:

```http
POST /internal/ingest
X-Ingest-Key: dev-ingest-key-change-me
Content-Type: application/json

{ "envelopeTo": ["sunny-fox-12@tmail.local"], "raw": "From: a@b.com\r\nSubject: hi\r\n\r\nhello" }
```

### Admin (needs `x-admin-key` header)

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/admin/meta` | Panel metadata (public IP, lockout settings). |
| `GET` | `/api/admin/domains` | List all domains. |
| `POST` | `/api/admin/domains` | Add a domain. |
| `PUT` | `/api/admin/domains` | Bulk update (`[{ name, active?, note? }]`). |
| `DELETE` | `/api/admin/domains/:domain` | Remove a domain. |
| `GET` | `/api/admin/domains/:domain/guide` | DNS setup guidance for a domain. |

---

## Adding / managing domains

Two ways:

1. **Edit `domains.json`** (simplest for local/dev):

   ```json
   {
     "domains": [
       { "name": "tmail.local", "active": true },
       { "name": "mail.test", "active": true },
       { "name": "disabled.example", "active": false }
     ]
   }
   ```

   Only `active: true` domains appear in the UI picker.

2. **Admin panel** (`/admin`) — add, toggle, or remove domains at runtime; it also shows
   the exact DNS records to set.

For real inbound mail, each domain needs an **MX record** pointing at your mail host, and
your Haraka `smtp/config/host_list` should include the active domains. See
[`docs/MULTI-DOMAIN-DNS.md`](./docs/MULTI-DOMAIN-DNS.md).

---

## Deploying to a server (production)

Full step-by-step lives in [`docs/VPS-AGENT-GUIDE.md`](./docs/VPS-AGENT-GUIDE.md). The short version:

1. **Get a VPS** with a public IP and **port 25 open** (many providers block 25 by default — ask support to unblock). Set up **reverse DNS (rDNS)** for the mail host so other servers accept your mail.
2. **Point DNS** at the server: an `A` record for your web + mail host, and an `MX` record per mail domain pointing at your mail host (priority 10). Details in [`docs/MULTI-DOMAIN-DNS.md`](./docs/MULTI-DOMAIN-DNS.md).
3. **Set secrets** in the server's `.env`: a strong `ADMIN_KEY`, a fresh `INGEST_KEY`, `PRIMARY_WEB`, `MAIL_HOSTNAME`, `PUBLIC_IP`, and `CORS_ORIGIN` set to your https origin.
4. **Deploy**, either:
   - `docker compose up -d` (starts redis + api + web; wire SMTP separately since it needs port 25), or
   - the PM2 flow in [`deploy/`](./deploy) (`deploy-vps.sh`, `ecosystem.config.cjs`).
5. **Nginx + HTTPS** — use [`deploy/nginx-example.com.conf`](./deploy/nginx-example.com.conf) as a template and run `certbot` for TLS. The config forwards SSE correctly (`proxy_buffering off`) and blocks `/internal/` from the public.
6. **Verify** — `curl https://yourdomain/health`, send a test email from Gmail, watch it land in the inbox.

> **Security in production:** always change `ADMIN_KEY` and `INGEST_KEY` from their
> defaults, keep `.env` out of git, keep `CATCHALL_CREATE=0`, and never expose `/internal/`
> publicly (the nginx template returns 404 for it).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `/health` not responding | API didn't start — check the `api` terminal; run `npm install` in `api/`. |
| No live updates in the inbox | Redis down, so SSE falls back to polling (still works, just slower). Start Redis for instant push. |
| `Missing env INGEST_KEY` | You didn't copy `.env.example` to `.env`. |
| Port already in use | Another app on 3100/5173. Change `API_PORT` / web port, or run `stop.bat` (Windows). |
| Receiving no real email | Port 25 blocked by provider, missing/incorrect MX record, or `tmail-smtp` not running. See the VPS guide. |
| `tsx` not found on server | Run a **full** `npm install` in `api/` (not `--omit=dev`). |
| Locked out of `/admin` | Too many wrong keys, IP banned. Wait out `ADMIN_BAN_TTL_SEC`, restart the API, or clear the Redis ban keys. |

---

## FAQ

**Can people reply to these addresses?** No — TMail is receive-only. There's no outbound mail.

**Do old emails stick around?** Depends on `INBOX_TTL_SEC`. `0` keeps them forever; set seconds to auto-delete.

**Is the HTML safe to open?** Yes — HTML is sanitized with `sanitize-html` (scripts and dangerous tags stripped) before it reaches your browser.

**Can any address receive mail?** Only addresses generated through the app, unless you set `CATCHALL_CREATE=1`.

**Do I need Redis?** Not for local dev — the app uses an in-memory fallback. Recommended in production for reliable SSE across processes.

---

## Docs index

| Doc | For |
|-----|-----|
| [`AGENTS.md`](./AGENTS.md) | AI agents — compact architecture + API map. |
| [`PRD.md`](./PRD.md) | Full product requirements & scope. |
| [`docs/VPS-AGENT-GUIDE.md`](./docs/VPS-AGENT-GUIDE.md) | End-to-end server deployment & operations. |
| [`docs/MULTI-DOMAIN-DNS.md`](./docs/MULTI-DOMAIN-DNS.md) | DNS / MX setup for one or many domains. |

---

## License

No license file yet — treat as all-rights-reserved unless the owner adds one.
