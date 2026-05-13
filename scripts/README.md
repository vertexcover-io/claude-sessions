# scripts/

## `deploy.sh`

VM-side deploy script for the exe.dev host. Invoked by
`.github/workflows/deploy.yml` over SSH after fresh `dist/` artifacts have been
rsynced into `$HOME/claude-sessions/`.

**Contract**

The script assumes:

- `$HOME/claude-sessions/.env` exists and is mode `0600`.
- `$HOME/claude-sessions/packages/{core,adapter-claude,server,web}/dist/` are
  freshly populated.
- `$HOME/claude-sessions/packages/server/src/db/migrations/*.sql` is present
  (the workflow rsyncs migration SQL alongside the dist tree).
- `pm2` is installed and the `claude-sessions-api` process has been created
  via the manual first-time setup in `docs/deploy.md`.
- `node` is on PATH (via nvm; the workflow invokes the script with `bash -lc`
  so `~/.bashrc` is sourced).

**What it does**

1. Sanity-checks `.env` (exists, mode 0600).
2. Sanity-checks expected dist artifacts.
3. Loads `.env` into the environment (handles spaces in values).
4. Mirrors `packages/server/src/db/migrations/*.sql` into
   `packages/server/dist/src/db/migrations/` so `migrate.js` can find them.
5. Runs `node packages/server/dist/src/db/migrate.js` from the server package.
6. Restarts pm2 with `--update-env`.
7. Probes `http://localhost:3000/api/health` for up to 30s.

Exits non-zero on any failure. Does **not** auto-rollback.

**Running by hand**

```sh
cd ~/claude-sessions
DEPLOY_SHA=$(git rev-parse HEAD 2>/dev/null || echo manual) ./scripts/deploy.sh
```

Override defaults via env vars: `APP_DIR`, `PM2_PROCESS`, `HEALTH_URL`.
