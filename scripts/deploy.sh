#!/usr/bin/env bash
# VM-side deploy script for claude-sessions on exe.dev.
# Invoked by .github/workflows/deploy.yml over SSH after rsyncing fresh dist/ artifacts.
# Idempotent and safe to re-run by hand.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/claude-sessions}"
PM2_PROCESS="${PM2_PROCESS:-claude-sessions-api}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
DEPLOY_SHA="${DEPLOY_SHA:-unknown}"

log() { printf "[deploy %s] %s\n" "$(date +%H:%M:%S)" "$*"; }
die() { printf "[deploy ERROR] %s\n" "$*" >&2; exit 1; }

cd "$APP_DIR" || die "APP_DIR not found: $APP_DIR"
log "Deploying SHA=$DEPLOY_SHA into $APP_DIR"

# 1. Sanity: .env exists and is 0600.
[ -f .env ] || die "missing .env at $APP_DIR/.env"
env_mode=$(stat -c '%a' .env 2>/dev/null || stat -f '%A' .env)
[ "$env_mode" = "600" ] || die ".env must be mode 600 (got $env_mode). Run: chmod 600 .env"

# 2. Sanity: required dist artifacts exist.
required_paths=(
  "packages/core/dist"
  "packages/adapter-claude/dist"
  "packages/server/dist/src/main.js"
  "packages/server/dist/src/db/migrate.js"
  "packages/server/src/db/migrations"
  "packages/web/dist/index.html"
)
for p in "${required_paths[@]}"; do
  [ -e "$p" ] || die "missing required artifact: $p (rsync incomplete?)"
done

# 3. Load .env (handles values with spaces, unlike `export $(cat .env | xargs)`).
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# 4. Ensure migrations are reachable from the compiled migrate.js.
# migrate.js loads ./migrations relative to itself (dist/src/db/migrations).
# We rsync the SQL files to packages/server/src/db/migrations; mirror them into dist.
mkdir -p packages/server/dist/src/db/migrations
cp -f packages/server/src/db/migrations/*.sql packages/server/dist/src/db/migrations/

# 5. Run migrations using compiled JS (no bun/tsx needed).
log "Running migrations..."
( cd packages/server && node dist/src/db/migrate.js )

# 6. Restart pm2. --update-env picks up changes to .env on subsequent deploys.
log "Restarting pm2 process: $PM2_PROCESS"
if ! pm2 describe "$PM2_PROCESS" >/dev/null 2>&1; then
  die "pm2 process '$PM2_PROCESS' not found. First-time install must be done manually (see docs/deploy.md)."
fi
pm2 restart "$PM2_PROCESS" --update-env

# 7. Local health probe (up to ~30s).
log "Probing $HEALTH_URL..."
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 "$HEALTH_URL" | grep -q '"ok"'; then
    log "Health OK after ${i} attempts. Deploy complete (SHA=$DEPLOY_SHA)."
    exit 0
  fi
  sleep 1
done

die "Local health probe failed after 30s. Check 'pm2 logs $PM2_PROCESS'."
