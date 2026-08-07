# AGENTS.md — TMail

Entry point for AI agents (Claude Code, Cursor, etc.). Read this first, then the linked
docs. Self-contained: you can operate without prior chat history.

## What this is

Multi-domain **temp / disposable mail**. Flow:

```text
inbound SMTP (Haraka :25) --POST /internal/ingest--> Fastify API --> SQLite (WAL)
                                                          |
                                          Redis pub/sub --+--> SSE --> SvelteKit inbox UI
```

Only addresses created via the API accept mail. No accounts, no outbound, no attachment download.

## Layout

| Path | What |
|------|------|
| `api/` | Fastify + Drizzle + `better-sqlite3` + `ioredis` + `mailparser` + `sanitize-html`. TypeScript, run with `tsx`. |
| `web/` | SvelteKit (static adapter) + Tailwind 4. One-page inbox. |
| `smtp/` | Haraka plugin (`plugins/`) + `dev-forward-smtp.mjs` dev catcher on `:2525`. |
| `domains.json` | Active domains list (also editable via admin API). |
| `deploy/` | `deploy-vps.sh`, `ecosystem.config.cjs` (PM2), nginx template, prod env example. |
| `docs/` | `VPS-AGENT-GUIDE.md` (deployment/ops), `MULTI-DOMAIN-DNS.md`. |
| `docker-compose.yml` | redis + api + web (smtp commented; needs host net + port 25). |

## Run (dev)

Windows: `start.bat` (API :3100 + Web :5173 + browser), `start-smtp.bat` (dev SMTP :2525), `stop.bat`.

Manual: `cp .env.example .env`, then `cd api && npm i && npm run dev`, and in another
terminal `cd web && npm i && npm run dev`.

Smoke test: `cd api && npm run smoke` (create address, ingest sample, assert message shows).

- UI: `http://127.0.0.1:5173` · API health: `http://127.0.0.1:3100/health`

## HTTP API (source of truth: `api/src/routes/`)

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/health` | liveness |
| `GET` | `/api/domains` | active domains for picker |
| `POST` | `/api/addresses` | create address `{ domain?, localPart? }`, returns token |
| `GET` | `/api/inbox/:token` | list messages |
| `GET` | `/api/inbox/:token/:messageId` | message detail (sanitized HTML + plain) |
| `GET` | `/api/inbox/:token/stream` | SSE realtime push |
| `GET` | `/api/email/:email` | public read-by-email (list / `/latest` / `/:messageId` / `/:messageId/raw`) |
| `POST` | `/internal/ingest` | SMTP to API. Header `X-Ingest-Key`. Body `{ envelopeTo[], raw }` |
| `GET` | `/internal/address-exists` | SMTP RCPT check |
| various | `/api/admin/domains…`, `/api/admin/meta` | admin panel, header `x-admin-key` |

## Config (`.env`, see `.env.example`)

Key vars: `INGEST_KEY` (SMTP to API auth, change in prod), `ADMIN_KEY` (panel `/admin`;
wrong N times triggers an IP ban), `PRIMARY_WEB` (main web domain, default `example.com`),
`MAIL_HOSTNAME`, `PUBLIC_IP`, `INBOX_TTL_SEC` (0 = keep forever), `SQLITE_PATH`,
`REDIS_URL` (memory fallback if down), `API_PORT`, `CORS_ORIGIN`, `CATCHALL_CREATE` (0 = only pre-generated addresses).

The primary domain and mail host are **not** hardcoded — they come from `PRIMARY_WEB` /
`MAIL_HOSTNAME`. Don't reintroduce a literal domain in `api/src/lib/dns-check.ts` or
`api/src/routes/admin.ts`.

## Constraints (from `HANDOFF.md` / `PRD.md`)

- SSE first, **not** Socket.io. Tailwind only, no big UI kit.
- MVP scope only — no custom prefix, no TTL extend, no attachment download, no user accounts/outbound.
- Only pre-generated addresses accept mail (`CATCHALL_CREATE=0`).

## Production / VPS

Runs under PM2 (`tmail-api`, `tmail-web`, `tmail-smtp`) behind nginx + certbot, or via
`docker compose`. Full ops (SSH, secrets, deploy, DNS) in
[`docs/VPS-AGENT-GUIDE.md`](./docs/VPS-AGENT-GUIDE.md) and
[`docs/MULTI-DOMAIN-DNS.md`](./docs/MULTI-DOMAIN-DNS.md). Needs port 25 + rDNS for Haraka.
The box may host other PM2 apps — restart TMail processes by name, never `pm2 kill`.

## Do-not-leak (public repo)

No real domains, server IPs, admin keys, SSH aliases, or absolute local paths in committed
files. Use placeholders (`example.com`, `203.0.113.10`, `your-vps`). Real values live only
in the server's `.env`, which is git-ignored.

Deeper detail: [`PRD.md`](./PRD.md) · [`README.md`](./README.md).
