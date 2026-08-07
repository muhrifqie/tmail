# PRD — TMail Multi-Domain Inbox

> **For Hermes:** Planning only. Implement after user approve stack + scope MVP.

**Goal:** Website temp-mail multi-domain: user buka inbox alamat random/custom di domain milik kita; email masuk tampil real-time; support banyak domain (Spaceship + registrar lain).

**Architecture:** SvelteKit app (UI + API) + inbound mail pipeline (SMTP atau webhook provider) + Postgres store pesan + realtime push ke browser.

**Tech Stack (rekomendasi final di bawah):** SvelteKit, Postgres, inbound mail layer, optional Redis/WS.

---

## 1. Problem

Butuh inbox disposable multi-domain:
- Domain dari Spaceship / Namecheap / Cloudflare Registrar, dll
- Terima email masuk ke `*@domain.tld`
- Tampil pesan di web (list + detail)
- Bukan full email hosting; disposable / catch-all viewer

## 2. Goals / Non-goals

### Goals (MVP)
- Multi domain aktif (admin on/off)
- Generate alamat: random prefix @ domain terpilih
- Optional custom prefix (validasi)
- Inbox list + buka pesan (from, subject, date, body text/html aman)
- Attachment metadata (download opsional fase 2)
- Auto-expire pesan (TTL)
- Realtime refresh saat email baru
- Rate limit + anti-abuse dasar

### Non-goals (MVP)
- Kirim email (SMTP outbound)
- Login user full / multi-tenant SaaS billing
- IMAP client
- Custom domain user bawaan sendiri (self-serve DNS)
- Full search body / folder / labels

## 3. User stories

1. **Visitor:** buka site → pilih domain → dapat alamat → copy → pakai di form → pesan muncul di inbox.
2. **Visitor:** ganti alamat / refresh random tanpa login.
3. **Visitor:** buka pesan HTML (sanitized) + plain text fallback.
4. **Admin:** tambah domain, set catch-all MX status, matikan domain.
5. **Admin:** set TTL pesan, purge manual.

## 4. Domain model (ringkas)

| Entity | Field penting |
|--------|----------------|
| `domains` | id, name, status(active/disabled), provider_note, created_at |
| `addresses` | id, local_part, domain_id, token/slug public, created_at, last_seen_at, expires_at |
| `messages` | id, address_id, message_id, from_raw, from_addr, subject, text_body, html_body_safe, headers_json, size, received_at, expires_at |
| `attachments` (fase 2) | id, message_id, filename, content_type, size, storage_key |

Public access model MVP:
- URL secret: `/i/{token}` atau cookie session alamat
- Token random panjang (bukan tebak `user@domain`)

## 5. Inbound mail — pilihan arsitektur

Spaceship = registrar. **Bukan** mail receive API. Harus set **MX** domain ke sistem yang terima mail.

### Opsi A — Self-host SMTP (paling fleksibel multi-provider domain)
```
Internet → MX domain → VPS:25 (Haraka / smtp-server)
  → parse (mailparser) → Postgres → WS/SSE ke SvelteKit client
```
**Plus:** semua domain asal MX benar; kontrol penuh; murah skala kecil.  
**Minus:** port 25 sering diblok cloud; IP reputation; reverse DNS; maintenance.

### Opsi B — Cloudflare Email Routing + Worker (paling cepat ops)
```
MX → Cloudflare Email Routing (catch-all)
  → Worker email handler → D1/Postgres / R2 raw
  → SvelteKit (Pages/Workers) baca store
```
**Plus:** no port 25, scale, murah.  
**Minus:** domain ideal di Cloudflare DNS; raw MIME limits; multi-registrar tetap bisa asalkan NS/MX CF.

### Opsi C — Provider inbound webhook (Mailgun / SES / Postal / ForwardEmail)
```
MX → provider → HTTP webhook → SvelteKit API → DB
```
**Plus:** deliverability ops di provider; multi-domain native di banyak panel.  
**Minus:** biaya per domain/msg; vendor lock; webhook auth wajib.

### Rekomendasi jalur
| Fase | Pilih | Alasan |
|------|--------|--------|
| **MVP cepat** | **C (Mailgun inbound atau ForwardEmail)** ATAU **B (CF Email Routing)** | skip hell port 25 |
| **Kontrol penuh / banyak domain murah** | **A (Haraka di VPS)** | domain Spaceship cuma set MX + A/AAAA |

**Praktis buat kamu (banyak domain Spaceship):**  
1. VPS IP clean + rDNS  
2. Haraka catch-all semua domain  
3. SvelteKit + Postgres di VPS sama / terpisah  
4. Di Spaceship: MX → `mail.tmail.example` priority 10  

Fallback MVP tanpa VPS mail: Mailgun routes per domain (lebih mahal saat domain numpuk).

## 6. Stack saran (SvelteKit + “framework lainnya”)

### Core (rekomendasi)
| Layer | Pilih | Kenapa |
|-------|--------|--------|
| App | **SvelteKit 2** | UI cepat, form actions, API routes |
| Adapter | **adapter-node** (VPS) | cocok SMTP side-car + WS |
| Alternatif edge | adapter-cloudflare | kalau pilih Email Routing path |
| DB | **Postgres 16** | pesan, index, TTL job |
| ORM | **Drizzle** | tipis, type-safe, SQL jujur |
| Auth admin | **Lucia** atau session cookie simple + env password | admin doang di MVP |
| Validasi | **Zod** | address, domain, webhook payload |
| HTML sanitize | **sanitize-html** atau **DOMPurify** (isomorphic) | cegah XSS di body email |
| MIME parse | **mailparser** | di SMTP worker / webhook normalizer |
| Realtime | **SSE dulu** (native) | WS only jika perlu; YAGNI |
| Queue (opsional) | Postgres LISTEN/NOTIFY atau BullMQ+Redis | parse async bila volume naik |
| Object storage lampiran | local disk → lalu S3/R2 | fase 2 |
| UI | Tailwind + bits-ui / shadcn-svelte | compact, dark warm optional |
| Deploy | Docker Compose: `web` + `smtp` + `db` (+ `caddy`) | satu VPS |

### Jangan pakai di MVP
- Prisma (lebih berat, oke tapi Drizzle cukup)
- Next.js (kamu minta SvelteKit)
- Firebase (query/TTL/email raw jelek)
- Full Mailcow/iRedMail (overkill; itu mail server produk, bukan temp UI)

### Struktur monorepo usulan
```
C:\BOT\Hermes\tmail\
  apps/web/                 # SvelteKit
  apps/smtp-ingest/         # Haraka plugin atau node smtp-server
  packages/shared/          # zod schemas, types
  docker-compose.yml
  PRD / plans
```

## 7. Functional requirements

### FR-1 Domain
- Admin CRUD domain
- Domain unique, lowercase
- Status active → terima mail; disabled → reject/drop

### FR-2 Address
- Generate: `{random8}@domain`
- Custom: charset `[a-z0-9._-]{1,64}` + blocklist (`admin`,`abuse`,`postmaster` optional allow catch-all tetap simpan)
- Public token ≥ 24 bytes base32/base64url
- Satu browser session bisa “current address”

### FR-3 Receive
- Catch-all per domain aktif
- Idempotent by `Message-ID` + address
- Simpan envelope recipients yang match domain kita
- Max size e.g. 5–10 MB; reject lebih besar

### FR-4 Inbox UI
- List: from, subject, time, unread
- Detail: headers ringkas, text, html sandboxed/sanitized
- Empty state jelas
- Poll 5s **atau** SSE `message.created`
- Auto-purge UI saat expired

### FR-5 Retention
- Default TTL 24h (config)
- Cron/job hapus expired row (+ file)

### FR-6 Abuse
- Rate limit create address / IP
- Rate limit poll
- Optional captcha generate address (fase 2)
- Jangan expose listing semua address global

### FR-7 Admin
- Login simple
- Domain list + health MX hint
- Stats: msg/day, domain count
- Purge address/messages

## 8. Non-functional

- XSS-safe render HTML email
- Secrets di env
- Backup DB
- Logs ingest tanpa full body di log prod
- Target latency inbox appear < 3s setelah SMTP DATA selesai (MVP best-effort)

## 9. DNS checklist (per domain Spaceship)

```
MX   @     mail.yourplatform.com   10
A    mail  <VPS_IP>
TXT  @     v=spf1 a:mail.yourplatform.com -all   (opsional, inbound not critical)
```
PTR/rDNS di VPS provider untuk IP mail (penting outbound nanti; inbound juga bagus).

Webhook path (kalau Mailgun):
```
MX → Mailgun
Route catch_all → https://tmail.example/api/inbound/mailgun
```

## 10. API sketch (SvelteKit)

```
POST /api/addresses          { domain, localPart? } → { email, token }
GET  /api/inbox/:token       → messages[]
GET  /api/inbox/:token/:id   → message detail
GET  /api/inbox/:token/stream  SSE
POST /api/inbound/webhook    provider signature
POST /api/admin/domains
GET  /api/domains            public active domains only
```

## 11. UI pages MVP

| Route | Isi |
|-------|-----|
| `/` | pilih domain, generate, copy email, inbox list |
| `/i/[token]` | deep link inbox |
| `/m/[token]/[id]` | detail pesan (atau modal di `/`) |
| `/admin` | domains + stats |
| `/admin/login` | password |

Design: compact, minimal (Claude-ish / dark warm dashboard style kalau mau).

## 12. Security

- Sanitize HTML (strip script, iframe rapi, no on*)
- CSP ketat; html email di `srcdoc` iframe sandbox **tanpa** allow-scripts
- Webhook HMAC verify
- Admin session httpOnly secure
- Token entropy tinggi
- Jangan index inbox by Google (noindex)

## 13. Phased delivery

### Phase 0 — PRD approve + repo scaffold
- SvelteKit + Drizzle + Postgres compose
- 1 domain hardcode config

### Phase 1 — Inbox mock
- Generate address + fake messages seed
- UI list/detail

### Phase 2 — Ingest real
- Pilih A atau B/C
- Parse → DB → UI poll/SSE

### Phase 3 — Multi domain admin + TTL job

### Phase 4 — Attachments + captcha + metrics

## 14. Risks

| Risk | Mitigasi |
|------|----------|
| Port 25 blocked | pakai provider webhook / CF routing dulu |
| Spam flood DB | size limit, rate limit, TTL pendek |
| XSS email | iframe sandbox + sanitize |
| Domain MX salah | admin health check dig MX |
| Legal abuse (phishing catch-all) | ToS, block patterns, abuse contact, logging |

## 15. Open questions (butuh jawaban user)

1. **Hosting mail:** VPS self-SMTP vs Cloudflare Email Routing vs Mailgun?
2. **Domain first:** berapa domain awal? sudah di Spaceship semua?
3. **TTL default?** 1 jam / 24 jam / 7 hari?
4. **Custom prefix** boleh di MVP atau random only?
5. **Public product** atau internal tool?
6. **Lampiran** perlu MVP atau nanti?
7. **Brand/domain platform** (URL app) apa?

## 16. Keputusan stack default (kalau user bilang “gas aja”)

```
SvelteKit 2 + adapter-node
Tailwind + shadcn-svelte
Postgres + Drizzle
mailparser
SSE realtime
Admin: single password env
Ingest: apps/smtp-ingest (smtp-server) di VPS — catch-all
Docker Compose
Path: C:\BOT\Hermes\tmail
```

Alternatif edge-first:
```
SvelteKit + CF adapter
Email Routing → Worker
D1 atau Neon Postgres
R2 raw mime
```

## 17. Success metrics MVP

- Email test Gmail → inbox tampil < 3s (best effort)
- 3+ domain aktif bersamaan
- 0 XSS di HTML sample malicious
- Purge job hapus expired 100%

## 18. Next after approve

1. Jawab open questions §15  
2. Scaffold `C:\BOT\Hermes\tmail`  
3. Phase 0–2 implement berurutan  

---

**Skipped for later:** billing multi-tenant, send mail, user accounts, mobile app, full IMAP.  
**Add when:** public SaaS / revenue / power users.
