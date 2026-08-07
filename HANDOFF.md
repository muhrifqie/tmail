# TMail — Agent Handoff Brief

Copy `PRD.md` + this file into target repo root. Implement PRD v2.0 only.

## Command
Implement TMail per `PRD.md` v2.0.

## Stack (locked)
- SMTP: Haraka → HTTP POST `/internal/ingest` + `X-Ingest-Key`
- API: Fastify + mailparser + Drizzle + SQLite WAL
- Redis: rate limit + pub/sub for SSE
- Web: SvelteKit + Tailwind only (no big UI kit)
- Realtime: SSE first (not Socket.io)
- Compose: smtp + api + web + redis

## MVP must
- Random address + domain picker (`domains.json`)
- Inbox list/detail HTML(sanitized)+plain
- SSE push + poll fallback
- Auto-delete 1h
- Copy email 1-click
- One-page dark indigo/violet split UI
- Only pre-generated addresses accept mail

## MVP must not
- Custom prefix, extend TTL, attachment download
- User accounts, outbound mail, Socket.io unless SSE blocked
- Big component libraries

## Layout
```
tmail/{smtp,api,web,domains.json,docker-compose.yml,PRD.md}
```

## Done when
`docker compose up` + smoke: create address → ingest sample.eml → message in GET inbox / SSE.

Full detail: `PRD.md`.
