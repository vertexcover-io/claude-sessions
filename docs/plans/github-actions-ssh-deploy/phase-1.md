# Phase 1: `scripts/deploy.sh` — VM-side deploy script

> **Status:** pending

## Overview

After this phase, a single command on the VM — `./scripts/deploy.sh` — performs the full restart cycle (load `.env`, run migrations, restart pm2, probe `/health`) and exits non-zero on any failure. This is the contract Phase 2's GitHub Actions workflow will invoke over SSH. Building it first lets us validate the VM-side mechanics by hand before adding CI complexity on top.

The script assumes Phase 2 has already rsync'd fresh `dist/` artifacts into `~/claude-sessions/packages/*/dist/` and migration SQL into `~/claude-sessions/packages/server/src/db/migrations/`. It does **not** build anything itself.

## Implementation

**Files:**
- Create: `scripts/deploy.sh`
- Create: `scripts/README.md` — one-paragraph note on what `deploy.sh` expects.
- Verify (read-only): `packages/server/package.json` has a `db:migrate` script. If it doesn't, add it in this phase as part of the contract — calling whatever `bun run --filter @claude-sessions/server db:migrate` resolves to today on the dev box.

**Pattern to follow:** Mirror the manual steps from `docs/deploy.md:544-565` (`Updating the server`) verbatim, minus the build steps (which moved to CI).

**What `deploy.sh` must do, in order:**

1. `set -euo pipefail` — fail on any error, unset var, or broken pipe.
2. `cd "$HOME/claude-sessions"` — pin working directory; the script must be runnable from anywhere.
3. Sanity-check that `.env` exists and is mode `0600`. If not, fail with a clear message.
4. Sanity-check that the four expected `dist/` directories exist and contain `index.js` (server) / `index.html` (web). Fail early if any are missing — means rsync didn't land.
5. Export the env file: `set -a; . ./.env; set +a` (safer than `export $(cat .env | xargs)` from the doc — that breaks on values with spaces).
6. Run migrations: `bun run --filter @claude-sessions/server db:migrate`. On non-zero, exit immediately — **do not** restart pm2 with a half-migrated schema.
7. Restart pm2: `pm2 restart claude-sessions-api --update-env`. The `--update-env` flag is important — without it pm2 keeps the env it was originally started with, which silently ignores any new `.env` values.
8. Probe local health: loop up to ~30s polling `curl -fsS http://localhost:3000/api/health` (or `/health` — confirm which in Phase 4). Exit non-zero if it never becomes healthy.
9. On success, print the deployed git SHA (from `$DEPLOY_SHA` env var passed in by the workflow, or `unknown`) and exit 0.

**Why bun stays on the VM:** the migration runner is invoked via `bun run --filter`. We could swap to `node` + a direct migration script, but that's a larger refactor and outside this plan's scope. Bun is already installed per `docs/deploy.md:186`.

**What to test (manually, since this is a shell script):**

- Run `./scripts/deploy.sh` on the VM in its current good state → exits 0, pm2 restarts, `/health` returns ok.
- Temporarily rename `.env` → script fails with "missing .env" message, **does not** restart pm2.
- Temporarily corrupt a migration SQL file → script fails at the migrate step, pm2 is not restarted.
- Stop pm2 entirely → script's pm2 restart fails clearly (pm2 returns non-zero for "process not found"). This documents that the first-time install is still manual (per `docs/deploy.md:282-291`).

## Done When

- [ ] `scripts/deploy.sh` is checked in, executable (`chmod +x`), and passes `shellcheck` (run locally; not yet in CI).
- [ ] Running `./scripts/deploy.sh` by hand on the exe.dev VM successfully migrates + restarts + health-checks against the currently-deployed code.
- [ ] All four manual failure cases above behave as described.
- [ ] `packages/server/package.json` has a working `db:migrate` script (added in this phase if it didn't already).

**Commit:** `feat(deploy): add scripts/deploy.sh for VM-side deploy automation`

## Notes for Phase 2

The workflow will invoke this as:

```sh
ssh -o StrictHostKeyChecking=yes "$SSH_USER@$SSH_HOST" \
  "DEPLOY_SHA=$GITHUB_SHA bash -lc '~/claude-sessions/scripts/deploy.sh'"
```

`bash -lc` ensures `.bashrc` (which sources nvm / bun PATH) is loaded; otherwise `bun` and `pm2` won't be found over a non-interactive SSH session. This is a common footgun — call it out in the workflow YAML too.
