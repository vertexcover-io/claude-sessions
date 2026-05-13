# Phase 2: `.github/workflows/deploy.yml` — build in CI, rsync, invoke `deploy.sh`

> **Status:** pending

## Overview

After this phase, pushing to `main` triggers a workflow that installs Bun, builds the four server-side packages, rsyncs only the build outputs + migrations + `.env`-relevant files to the VM, and then SSHes in to run `scripts/deploy.sh` from Phase 1. The workflow does **not** yet have secrets configured — that's Phase 3 — so the workflow file is committed but won't successfully run end-to-end until secrets land.

## Implementation

**Files:**
- Create: `.github/workflows/deploy.yml`

**What the workflow does, step by step:**

```yaml
name: Deploy to exe.dev

on:
  push:
    branches: [main]
  workflow_dispatch:  # allow manual re-run from the Actions UI without a code change

concurrency:
  group: deploy-production
  cancel-in-progress: false  # never cancel a deploy mid-flight; queue them

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Typecheck
        run: bun run typecheck

      - name: Lint
        run: bun run lint

      - name: Build (core, adapter-claude, web, server)
        run: |
          bun run --filter @claude-sessions/core build
          bun run --filter @claude-sessions/adapter-claude build
          bun run --filter @claude-sessions/web build
          bun run --filter @claude-sessions/server build

      # Stage exactly what the VM needs into a single tree so rsync is a single
      # invocation and we don't accidentally ship node_modules or source.
      - name: Stage deploy payload
        run: |
          mkdir -p _deploy/packages/core
          mkdir -p _deploy/packages/adapter-claude
          mkdir -p _deploy/packages/server
          mkdir -p _deploy/packages/web
          mkdir -p _deploy/scripts

          cp -r packages/core/dist                    _deploy/packages/core/dist
          cp    packages/core/package.json            _deploy/packages/core/package.json

          cp -r packages/adapter-claude/dist          _deploy/packages/adapter-claude/dist
          cp    packages/adapter-claude/package.json  _deploy/packages/adapter-claude/package.json

          cp -r packages/server/dist                  _deploy/packages/server/dist
          cp    packages/server/package.json          _deploy/packages/server/package.json
          # Migrations must be reachable from the running dist (see docker-compose.yml line 53).
          mkdir -p _deploy/packages/server/src/db
          cp -r packages/server/src/db/migrations     _deploy/packages/server/src/db/migrations

          cp -r packages/web/dist                     _deploy/packages/web/dist

          cp -r scripts/deploy.sh                     _deploy/scripts/deploy.sh
          cp    package.json bun.lock turbo.json      _deploy/

      - name: Configure SSH
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          SSH_KNOWN_HOSTS: ${{ secrets.SSH_KNOWN_HOSTS }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          echo "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
          chmod 644 ~/.ssh/known_hosts

      - name: Rsync to VM
        env:
          SSH_HOST: ${{ secrets.SSH_HOST }}
          SSH_USER: ${{ secrets.SSH_USER }}
        run: |
          rsync -az --delete \
            --exclude='.env' \
            -e "ssh -o StrictHostKeyChecking=yes" \
            _deploy/ "$SSH_USER@$SSH_HOST:~/claude-sessions/"

      - name: Invoke deploy.sh on VM
        env:
          SSH_HOST: ${{ secrets.SSH_HOST }}
          SSH_USER: ${{ secrets.SSH_USER }}
        run: |
          ssh -o StrictHostKeyChecking=yes "$SSH_USER@$SSH_HOST" \
            "DEPLOY_SHA=${GITHUB_SHA} bash -lc 'chmod +x ~/claude-sessions/scripts/deploy.sh && ~/claude-sessions/scripts/deploy.sh'"

      - name: Summary
        if: always()
        run: |
          echo "### Deploy ${GITHUB_SHA::7}" >> "$GITHUB_STEP_SUMMARY"
          echo "Status: ${{ job.status }}" >> "$GITHUB_STEP_SUMMARY"
```

**Key decisions baked into the YAML (do not silently change):**

- **`--exclude='.env'` on rsync** — the VM's `.env` is the source of truth for `JWT_SECRET`, DB password, etc. Never let CI overwrite it. The `.env` was hand-installed per `docs/deploy.md:212-224`.
- **`--delete` on rsync** — keeps the VM's `dist/` directories in sync with the build, removing files that no longer exist in the build output. Safe because the `_deploy/` staging tree contains *only* deployable artifacts; we never rsync the repo root with `--delete`.
- **`concurrency.cancel-in-progress: false`** — if two pushes land back-to-back, the second waits. Cancelling a deploy mid-rsync would leave the VM in a half-written state.
- **`bash -lc` on the remote command** — loads `~/.bashrc` so `bun` and `pm2` are on PATH (see Phase 1 notes). Without it, the SSH session is non-interactive and PATH is minimal.
- **Typecheck + lint as gates** — fast, cheap, and catch most "deploy broke the build" failures before any bytes hit the VM. Full test suite is intentionally **not** run here (out of scope, see plan.md Future Work).
- **`actions/checkout@v4` + `oven-sh/setup-bun@v2`** — both are the current stable majors as of 2026-05.

**What is NOT in this phase:**

- No secrets configured yet — that's Phase 3. The workflow will fail at "Configure SSH" until then.
- No `/health` smoke-check from the runner against the public URL yet — that's Phase 4. `deploy.sh` already health-checks locally on the VM, which is good enough for Phase 2's done criteria.

## Done When

- [ ] `.github/workflows/deploy.yml` is committed.
- [ ] `act` or a dry-run review of the YAML confirms there are no syntax errors and the staging step copies exactly the four `dist/` trees + migrations + `scripts/deploy.sh`.
- [ ] The workflow appears in the GitHub Actions tab on the next push (it will fail at the SSH step, which is expected and resolved in Phase 3).

**Commit:** `feat(ci): add deploy.yml workflow for exe.dev auto-deploy`
