# Multi-domain DNS — web 1, mail banyak

## Goal

- **Satu website:** `https://example.com` (inbox + admin)
- **Banyak domain email:** domain Spaceship lain cuma buat alamat `*@domain` yang masuk VPS yang sama
- Domain ekstra **bukan** mini-site terpisah

```
                    ┌─────────────────────────┐
  user browser ───► │ example.com (nginx) │──► :3173 web + :3100 API
                    └─────────────────────────┘
                                      ▲
  Gmail→user@example-extra.com            │ POST /internal/ingest
       MX ──► mail.example.com ───┼──► :25 tmail-smtp
       (A) 203.0.113.10              │
```

## example.com (primary)

| Type | Host | Value | Wajib? |
|------|------|-------|--------|
| A | `@` | `203.0.113.10` | ya (web) |
| A | `www` | `203.0.113.10` | ya |
| A | `mail` | `203.0.113.10` | ya (target MX bersama) |
| MX | `@` | `mail.example.com` prio **10** | ya |

## Domain ekstra (Spaceship) — mail only

Contoh: `example-extra.com`, `example-extra.net`, domain baru.

### Opsi A — paling simpel (recommended)

| Type | Host | Value |
|------|------|-------|
| MX | `@` | `mail.example.com` prio **10** |

- **Tidak** set A `@` / www ke VPS (kecuali mau landing sendiri)
- MX boleh cross-domain asalkan hostname resolve publik ke IP kita
- Cek: `dig +short MX example-extra.com` → `10 mail.example.com.`
- Cek: `dig +short A mail.example.com` → `203.0.113.10`

### Opsi B — MX host di domain sendiri

Kalau Spaceship/provider nolak MX ke domain lain:

| Type | Host | Value |
|------|------|-------|
| A | `mail` | `203.0.113.10` |
| MX | `@` | `mail.<domain-ekstra>` prio **10** |

## App side (wajib sama)

1. Domain ada di admin TMail / `domains.json` **active**
2. User generate alamat lewat UI example.com (bukan tebak local)
3. `tmail-smtp` listen `:25`, `INGEST_KEY` cocok
4. Nginx cukup `server_name example.com` — **tidak** perlu server block per domain mail

## Yang salah

| Salah | Kenapa |
|-------|--------|
| MX value = IP `203.0.113.10` | Spec MX = hostname |
| Cuma A `@` tanpa MX | Mail gak ke VPS |
| Domain ekstra A `@` ke VPS, harap UI jalan | Nginx gak punya server_name → default site / 404 |
| Buka `http://example-extra.com` harap inbox | Inbox di **example.com** |
| Kirim ke random@domain sebelum generate di UI | `stored:0` (anti-flood) |

## Spaceship checklist domain baru

1. Admin TMail → Add `nama.tld` → active
2. Spaceship DNS domain itu → MX `@` = `mail.example.com` / 10
3. Tunggu TTL
4. `dig +short MX nama.tld`
5. example.com → pilih domain → generate → kirim uji dari Gmail
6. Inbox muncul di web utama

## Deep link

`https://example.com/local@nama.tld` — path di **web utama**, email domain ekstra.
