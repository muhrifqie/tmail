# TMail VPS — panduan agent (copy-paste)

Self-contained. Agent lain bisa connect + operate tanpa chat history.

## Target

| Item | Value |
|------|--------|
| SSH host alias | `your-vps` |
| User | `ubuntu` (default ssh config) |
| Public IP | `203.0.113.10` |
| App root | `/srv/tmail` |
| Domain contoh | `example.com` |
| Local repo | folder repo ini di mesin kamu |

## PM2 processes

| Name | Port | Role |
|------|------|------|
| `tmail-api` | `3100` | Fastify API + SQLite writer |
| `tmail-web` | `3173` | static SvelteKit (`serve -s build`) |
| `tmail-smtp` | `25` | inbound SMTP → `/internal/ingest` |

## Secrets (server only)

File: `/srv/tmail/.env`

| Key | Notes |
|-----|--------|
| `ADMIN_KEY` | Password panel `/admin`. **Prod target: `change-me-admin-key`** |
| `INGEST_KEY` | SMTP/internal ingest only — jangan pakai di FE |
| `PUBLIC_IP` | `203.0.113.10` |
| `ADMIN_MAX_FAILS` | default `3` |
| `ADMIN_FAIL_WINDOW_SEC` | default `900` (15m counter window) |
| `ADMIN_BAN_TTL_SEC` | default `86400` (24h ban) |

Baca key di VPS (jangan paste chat publik):

```bash
ssh your-vps 'grep -E "^(ADMIN_KEY|INGEST_KEY|PUBLIC_IP|ADMIN_)" /srv/tmail/.env'
```

Set / ganti admin password:

```bash
ssh your-vps 'bash -s' <<'EOF'
set -e
cd /srv/tmail
grep -q '^ADMIN_KEY=' .env && sed -i 's/^ADMIN_KEY=.*/ADMIN_KEY=change-me-admin-key/' .env \
  || echo 'ADMIN_KEY=change-me-admin-key' >> .env
# optional lockout knobs
grep -q '^ADMIN_MAX_FAILS=' .env || echo 'ADMIN_MAX_FAILS=3' >> .env
grep -q '^ADMIN_BAN_TTL_SEC=' .env || echo 'ADMIN_BAN_TTL_SEC=86400' >> .env
pm2 restart tmail-api --update-env
pm2 save
grep -E '^(ADMIN_KEY|ADMIN_MAX_FAILS|ADMIN_BAN_TTL_SEC)=' .env
EOF
```

## First connect checklist (agent)

1. SSH works: `ssh your-vps 'hostname; pm2 status'`
2. Health: `curl -sS http://127.0.0.1:3100/health` → `ok: true`
3. Ports: `ss -tlnp | grep -E ':25|:3100|:3173'`
4. Admin unlock (dari mesin agent / VPS loopback):

```bash
curl -sS -H 'x-admin-key: change-me-admin-key' http://127.0.0.1:3100/api/admin/meta
# expect publicIp + adminMaxFails
```

5. Public UI: `http://203.0.113.10:3173/` atau `https://example.com/`
6. Admin UI: `…/admin` — paste `ADMIN_KEY`

## Deploy dari Windows (git-bash)

```bash
bash deploy/deploy-vps.sh
# override: TMAIL_SSH_HOST=your-vps TMAIL_REMOTE_DIR=/srv/tmail
```

Deploy **tidak** overwrite `.env` yang sudah ada. Upload = `tar|ssh` (no local rsync).

Setelah deploy code-only:

```bash
ssh your-vps 'pm2 restart tmail-api tmail-web; curl -sS http://127.0.0.1:3100/health'
```

SMTP tidak di-restart otomatis deploy script — restart manual kalau `smtp/` berubah:

```bash
ssh your-vps 'pm2 restart tmail-smtp'
```

## Admin lockout (salah 3×)

- Header auth: `x-admin-key: <ADMIN_KEY>`
- Setiap request admin route cek ban dulu.
- Key salah → counter per IP (+ Redis `admin:fail:<ip>` bila Redis up; else memory process).
- **Fail ke-3** (default) → IP **banned** 24 jam (`admin:ban:<ip>`).
- Response:
  - `401` `{ error: "unauthorized", fails, remaining, message }`
  - `403` `{ error: "ip_banned", until, message }`
- IP ambil dari `X-Forwarded-For` (first hop) → `X-Real-IP` → socket.
- Nginx reverse proxy **wajib** forward real IP (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`).

Unban manual (Redis):

```bash
ssh your-vps 'redis-cli KEYS "admin:*" ; redis-cli DEL admin:ban:CLIENT_IP admin:fail:CLIENT_IP'
# memory-only ban: pm2 restart tmail-api
```

## Multi-domain model (penting)

| Peran | Domain | DNS |
|-------|--------|-----|
| **Website utama** (UI + admin) | `example.com` (+ www) | A `@`/`www`/`mail` → `203.0.113.10` + MX → `mail.example.com` |
| **Domain mail-only** (Spaceship dll) | mis. `example-extra.com`, `example-extra.net` | **MX saja** → `mail.example.com` prio 10. **Tidak wajib** A `@` web |

Alur user:
1. Buka **https://example.com** (bukan domain ekstra)
2. Admin aktifkan domain di `/admin`
3. Di UI pilih domain ekstra → generate `user@example-extra.com`
4. Internet kirim mail ke alamat itu → MX domain ekstra → VPS :25 → API store → inbox di example.com (token session / deep-link path)

### MX yang bener

MX **harus hostname**, bukan IP mentah.

**Disarankan (shared mail host):**

```
# di DNS domain ekstra (Spaceship)
MX  @    mail.example.com    10
```

Syarat: `mail.example.com` sudah A → `203.0.113.10` (sudah live).

**Alternatif per-domain** (kalau registrar/provider rewel MX ke domain lain):

```
# di DNS domain ekstra
A   mail   203.0.113.10
MX  @      mail.<domain-ekstra>   10
```

### Website utama saja

```
# example.com
A   @      203.0.113.10
A   www    203.0.113.10
A   mail   203.0.113.10
MX  @      mail.example.com   10
```

Nginx `server_name` cuma example.com — domain ekstra **tidak** perlu vhost.

### Domain → ops steps

1. Login `https://example.com/admin` + `ADMIN_KEY`
2. Add domain ekstra → aktif
3. Spaceship domain ekstra: set **MX** (lihat di atas)
4. Verify:

```bash
dig +short A example.com          # 203.0.113.10
dig +short A mail.example.com     # 203.0.113.10
dig +short MX example.com         # 10 mail.example.com.
dig +short MX example-extra.com           # 10 mail.example.com.  (atau mail.example-extra.com.)
```

5. UI example.com → pilih domain → generate alamat
6. Deep-link opsional: `https://example.com/user@example-extra.com` (path di **web utama**, bukan di domain ekstra)
7. Hanya address pre-generated yang `stored:1`

Optional env: `MAIL_HOSTNAME=mail.example.com` di `/srv/tmail/.env` (guide admin pakai shared host).

## Inbound SMTP

Tanpa `tmail-smtp` di `:25` → 0 mail meski MX benar.

```bash
sudo setcap 'cap_net_bind_service=+ep' "$(readlink -f $(which node))"
cd /srv/tmail/smtp && npm install
# prod-smtp.mjs reads INGEST_KEY + posts to http://127.0.0.1:3100/internal/ingest
pm2 start prod-smtp.mjs --name tmail-smtp --cwd /srv/tmail/smtp --time
pm2 save
ss -tlnp | grep :25
```

## Nginx + SSL

Template: `deploy/nginx-example.com.conf`

- `/api/` + `/health` → `127.0.0.1:3100` (SSE: `proxy_buffering off`)
- `/` → `127.0.0.1:3173`
- `/internal/` → 404 public
- Forward client IP headers

```bash
# A record harus sudah ke 203.0.113.10 dulu
sudo certbot --nginx -d example.com -d www.example.com --redirect
# CORS
# set CORS_ORIGIN=https://example.com,https://www.example.com in .env
pm2 restart tmail-api
```

## Layout remote

```
/srv/tmail/
  .env                 secrets (not in git upload)
  domains.json         admin CRUD source of truth
  data/tmail.sqlite    WAL DB (API sole writer)
  api/                 Fastify + tsx entry
  web/build/           static
  smtp/prod-smtp.mjs   port 25
  deploy/
```

## Verify matrix

```bash
ssh your-vps 'pm2 status; curl -sS localhost:3100/health; ss -tlnp | grep -E ":25|:3100|:3173"'
curl -sS -o /dev/null -w '%{http_code}\n' http://203.0.113.10:3173/
curl -sS -o /dev/null -w '%{http_code}\n' http://203.0.113.10:3173/admin
curl -sS -H 'x-admin-key: change-me-admin-key' http://203.0.113.10:3100/api/admin/meta
# wrong key x3 from same IP → 403 ip_banned (jangan test dari IP prod yang dipakai admin live tanpa unban plan)
```

## Pitfalls agent

| Issue | Fix |
|-------|-----|
| `tsx` missing | `cd /srv/tmail/api && npm install` full (not `--omit=dev`) |
| deploy keep old `.env` | expected; set `ADMIN_KEY` manually |
| source `.env` shell break | special chars; app loads via dotenv — prefer Node/sed over `source` |
| kill all pm2 | bisa matiin app lain di server yang sama — restart per-nama (`pm2 restart tmail-api`), jangan `pm2 kill` |
| mail before SMTP up | gone; resend after `:25` listen |
| ban self testing | unban redis keys / restart api |
| Windows no rsync | use `deploy/deploy-vps.sh` tar\|ssh |

## Related files in repo

- `deploy/deploy-vps.sh` — main ship
- `deploy/env.production.example` — first-boot template
- `deploy/nginx-example.com.conf`
- `api/src/routes/admin.ts` + `api/src/lib/admin-ban.ts`
- skill: `disposable-mail-inbox` → `references/vps-deploy-admin.md`
