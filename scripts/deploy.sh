#!/usr/bin/env bash
# VM-side deploy script for claude-sessions.
# Invoked by .github/workflows/deploy.yml over SSH after rsyncing fresh dist/ artifacts.
# Fully idempotent: bootstraps Node, pm2, Docker-managed Postgres, and Caddy on first run.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/claude-sessions}"
PM2_PROCESS="${PM2_PROCESS:-claude-sessions-api}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
DEPLOY_SHA="${DEPLOY_SHA:-unknown}"

log() { printf "[deploy %s] %s\n" "$(date +%H:%M:%S)" "$*"; }
die() { printf "[deploy ERROR] %s\n" "$*" >&2; exit 1; }

cd "$APP_DIR" || die "APP_DIR not found: $APP_DIR"
log "Deploying SHA=$DEPLOY_SHA into $APP_DIR"

# 0a. Bootstrap Node 20.x if missing.
if ! command -v node >/dev/null 2>&1; then
  log "node not found; installing Node.js 20.x via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# 0b. Bootstrap pm2 if missing.
if ! command -v pm2 >/dev/null 2>&1; then
  log "pm2 not found; installing globally"
  sudo npm install -g pm2
  sudo env PATH="$PATH:$(dirname "$(command -v node)")" \
    pm2 startup systemd -u "$USER" --hp "$HOME" || true
fi

# 0d. Bootstrap bun if missing (used for workspace-aware production install).
# Pin to the version used in CI so the lockfile format matches exactly.
BUN_VERSION="${BUN_VERSION:-1.2.19}"
export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version 2>/dev/null)" != "$BUN_VERSION" ]; then
  log "Installing bun v$BUN_VERSION"
  curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION"
fi

# 0c. Bootstrap Caddy if missing (provides TLS for the public hostname).
if ! command -v caddy >/dev/null 2>&1; then
  log "caddy not found; installing official Caddy package"
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

# 1. Sanity: .env exists and is 0600.
[ -f .env ] || die "missing .env at $APP_DIR/.env (workflow should have rendered it)"
chmod 600 .env

# 2. Sanity: required dist artifacts exist.
required_paths=(
  "packages/core/dist"
  "packages/adapter-claude/dist"
  "packages/server/dist/src/main.js"
  "packages/server/dist/src/db/migrate.js"
  "packages/server/src/db/migrations"
  "packages/web/dist/index.html"
  "docker-compose.prod.yml"
  "scripts/Caddyfile.template"
)
for p in "${required_paths[@]}"; do
  [ -e "$p" ] || die "missing required artifact: $p (rsync incomplete?)"
done

# 3. Load .env.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}"
: "${PUBLIC_DOMAIN:?PUBLIC_DOMAIN must be set in .env (e.g. chitta.exe.xyz)}"

# 4. Start (or ensure-running) Postgres via docker compose.
log "Ensuring Postgres container is up"
sudo docker compose -f docker-compose.prod.yml up -d postgres

# Wait for Postgres to accept connections (compose healthcheck is async).
log "Waiting for Postgres to be healthy..."
for i in $(seq 1 30); do
  if sudo docker exec claude-sessions-postgres pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-claude_sessions}" >/dev/null 2>&1; then
    log "Postgres healthy after ${i}s"
    break
  fi
  [ "$i" = "30" ] && die "Postgres did not become healthy within 30s"
  sleep 1
done

# 5. Render Caddyfile and reload Caddy.
log "Rendering Caddyfile for $PUBLIC_DOMAIN"
sudo sed "s/__DOMAIN__/$PUBLIC_DOMAIN/g" scripts/Caddyfile.template \
  | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl enable --now caddy
sudo systemctl reload caddy || sudo systemctl restart caddy

# 6a. Install deps so compiled JS can resolve node_modules.
# Note: --production is intentionally omitted. bun 1.2.x flags it as a
# lockfile change under workspaces, even when the lock is unchanged.
# Dev deps are harmless on the VM (we only run `node dist/...`).
log "Installing dependencies via bun"
bun install --frozen-lockfile

# 6b. Mirror migrations into dist for the compiled migrate.js.
mkdir -p packages/server/dist/src/db/migrations
cp -f packages/server/src/db/migrations/*.sql packages/server/dist/src/db/migrations/

# 7. Run migrations.
log "Running migrations..."
( cd packages/server && node dist/src/db/migrate.js )

# 8. Start (first deploy) or restart (subsequent) pm2 process.
if pm2 describe "$PM2_PROCESS" >/dev/null 2>&1; then
  log "Restarting pm2 process: $PM2_PROCESS"
  pm2 restart "$PM2_PROCESS" --update-env
else
  log "First-time start of pm2 process: $PM2_PROCESS"
  ( cd packages/server && pm2 start dist/src/main.js --name "$PM2_PROCESS" --update-env )
fi
pm2 save >/dev/null

# 9. Local health probe.
log "Probing $HEALTH_URL..."
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 "$HEALTH_URL" | grep -q '"ok"'; then
    log "Health OK after ${i} attempts. Deploy complete (SHA=$DEPLOY_SHA)."
    exit 0
  fi
  sleep 1
done

die "Local health probe failed after 30s. Check 'pm2 logs $PM2_PROCESS'."
