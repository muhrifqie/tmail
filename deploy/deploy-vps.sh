#!/usr/bin/env bash
# Deploy TMail to your-vps (PM2). Works without local rsync (tar|ssh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${TMAIL_SSH_HOST:-your-vps}"
REMOTE="${TMAIL_REMOTE_DIR:-/srv/tmail}"

echo "== build web =="
cd "$ROOT/web"
npm install --no-fund --no-audit
npm run build

echo "== prepare remote dirs =="
ssh "$HOST" "sudo mkdir -p $REMOTE $REMOTE/data $REMOTE/logs && sudo chown -R ubuntu:ubuntu $REMOTE"

echo "== upload via tar|ssh =="
cd "$ROOT"
# NEVER ship live domain list / sqlite / secrets — VPS is source of truth for domains
tar czf - \
  --exclude=node_modules \
  --exclude=./.env \
  --exclude=./domains.json \
  --exclude=./data \
  --exclude=api/data \
  --exclude=api/node_modules \
  --exclude=web/node_modules \
  --exclude=smtp/node_modules \
  --exclude=.hermes \
  --exclude=web/.svelte-kit \
  --exclude='*.sqlite' \
  --exclude='*.sqlite-*' \
  . | ssh "$HOST" "mkdir -p $REMOTE && tar xzf - -C $REMOTE"

echo "== remote install + pm2 =="
ssh "$HOST" "bash -s" <<'REMOTE'
set -euo pipefail
cd /srv/tmail

if [[ ! -f .env ]]; then
  cp deploy/env.production.example .env
  INGEST=$(openssl rand -hex 24)
  sed -i "s/CHANGE_ME_LONG_RANDOM/${INGEST}/" .env
  # ADMIN_KEY default from example: change-me-admin-key (override later if needed)
  grep -q '^ADMIN_KEY=.' .env || echo 'ADMIN_KEY=change-me-admin-key' >> .env
  grep -q '^ADMIN_MAX_FAILS=' .env || echo 'ADMIN_MAX_FAILS=3' >> .env
  grep -q '^ADMIN_BAN_TTL_SEC=' .env || echo 'ADMIN_BAN_TTL_SEC=86400' >> .env
  echo "=== SAVE THESE KEYS ==="
  grep -E '^(INGEST_KEY|ADMIN_KEY|PUBLIC_IP|ADMIN_MAX_FAILS|ADMIN_BAN_TTL_SEC)=' .env
  echo "======================="
else
  echo ".env exists — keeping"
  # ensure PUBLIC_IP
  if ! grep -q '^PUBLIC_IP=.' .env; then
    sed -i 's/^PUBLIC_IP=.*/PUBLIC_IP=203.0.113.10/' .env || echo 'PUBLIC_IP=203.0.113.10' >> .env
  fi
  # ensure lockout knobs present (do not overwrite ADMIN_KEY)
  grep -q '^ADMIN_MAX_FAILS=' .env || echo 'ADMIN_MAX_FAILS=3' >> .env
  grep -q '^ADMIN_FAIL_WINDOW_SEC=' .env || echo 'ADMIN_FAIL_WINDOW_SEC=900' >> .env
  grep -q '^ADMIN_BAN_TTL_SEC=' .env || echo 'ADMIN_BAN_TTL_SEC=86400' >> .env
fi

mkdir -p data logs
# Domains live under data/domains.json (survives deploy). Migrate legacy root file once.
if [[ -f data/domains.json ]]; then
  echo "domains: keep data/domains.json ($(grep -c '\"name\"' data/domains.json || true) name keys)"
elif [[ -f domains.json ]]; then
  cp -a domains.json data/domains.json
  echo "domains: migrated domains.json → data/domains.json"
else
  echo '{"domains":[]}' > data/domains.json
  echo "domains: created empty data/domains.json"
fi
# Ensure DOMAINS_PATH points at durable file
if grep -q '^DOMAINS_PATH=' .env 2>/dev/null; then
  sed -i 's|^DOMAINS_PATH=.*|DOMAINS_PATH=/srv/tmail/data/domains.json|' .env
else
  echo 'DOMAINS_PATH=/srv/tmail/data/domains.json' >> .env
fi

cd /srv/tmail/api
# tsx needed at runtime (TypeScript entry); install all deps for now
npm install --no-fund --no-audit
npm rebuild better-sqlite3 2>/dev/null || true

if ! command -v serve >/dev/null 2>&1; then
  sudo npm install -g serve
fi

# export env for pm2 processes
set -a
# shellcheck disable=SC1091
source /srv/tmail/.env
set +a

pm2 delete tmail-api 2>/dev/null || true
pm2 delete tmail-web 2>/dev/null || true

cd /srv/tmail/api
pm2 start ./node_modules/tsx/dist/cli.mjs \
  --name tmail-api \
  --cwd /srv/tmail/api \
  --time \
  -- src/index.ts

cd /srv/tmail/web
pm2 start npx \
  --name tmail-web \
  --cwd /srv/tmail/web \
  --time \
  -- serve -s build -l 3173

pm2 save
sleep 2
pm2 status
echo "--- health ---"
curl -sS http://127.0.0.1:3100/health || true
echo
echo "Web :3173  API :3100  Admin /admin"
REMOTE

echo "== done =="
ssh "$HOST" 'curl -sS http://127.0.0.1:3100/health; echo; pm2 jlist 2>/dev/null | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c);process.stdin.on(\"end\",()=>{JSON.parse(d).forEach(p=>console.log(p.name,p.pm2_env.status))})"'
