# Phase 4: Post-deploy health gate + docs update

> **Status:** pending

## Overview

After this phase, the workflow's final step is a public-URL `/health` probe from the GitHub runner — not just the local probe inside `deploy.sh`. This catches "pm2 restarted but the exe.dev proxy isn't forwarding anymore" failure modes that a localhost check misses. The phase also updates `docs/deploy.md` so the auto-deploy is the documented default and the manual flow is clearly labeled as the fallback.

## Implementation

### Part A — add the public health gate to the workflow

**File:** `.github/workflows/deploy.yml` — append one step after "Invoke deploy.sh on VM":

```yaml
      - name: Public health check
        env:
          PUBLIC_URL: https://${{ secrets.SSH_HOST }}
        run: |
          set -euo pipefail
          # Poll up to 60s — pm2 restart + exe.dev proxy reconnect can lag a few seconds.
          for i in $(seq 1 30); do
            if curl -fsS --max-time 5 "$PUBLIC_URL/api/health" | tee /tmp/health.out | grep -q '"ok"'; then
              echo "Health OK after ${i} attempts"
              exit 0
            fi
            sleep 2
          done
          echo "Health check failed. Last response:"
          cat /tmp/health.out || true
          exit 1
```

**Why `/api/health` and not `/health`:** `docker-compose.yml:69` confirms `/api/health` is the canonical path. The `/health` reference in `docs/deploy.md:311` is likely stale; verify by hitting both during Phase 3's first live run and update the doc in Part B to match reality.

### Part B — update `docs/deploy.md`

Three edits:

1. **Add a new section at the top, just under the intro** (`docs/deploy.md` around line 5):

   ```markdown
   ## Automated deploys (default)

   Pushes to `main` are auto-deployed by `.github/workflows/deploy.yml` — see
   `docs/plans/github-actions-ssh-deploy/` for the implementation and
   `scripts/deploy.sh` for the VM-side script the workflow invokes.

   The manual steps below are kept for first-time VM provisioning, disaster
   recovery, and one-off operations. Day-to-day updates should land via `main`.
   ```

2. **Replace the "Updating the server" section** (`docs/deploy.md:544-565`) with:

   ```markdown
   ## Updating the server

   ### Automatic (preferred)

   Merge to `main`. The `Deploy to exe.dev` GitHub Action will:

   1. Build all packages on the runner.
   2. Rsync `dist/` artifacts to `~/claude-sessions/` on the VM.
   3. Run `scripts/deploy.sh` over SSH, which migrates the DB and restarts pm2.
   4. Probe `https://claude-sessions.exe.xyz/api/health` to confirm.

   ### Manual fallback

   Use only if Actions is unavailable or you're recovering from a broken deploy.

   <…existing manual block, unchanged…>
   ```

3. **Append a "CI secret rotation" subsection** under "Security hardening" (`docs/deploy.md` around line 406, before "Recommended"):

   ```markdown
   ### CI deploy key rotation

   The GitHub Actions workflow authenticates with a dedicated ed25519 keypair.
   To rotate:

   1. `ssh-keygen -t ed25519 -f ~/.ssh/claude-sessions-deploy-new -N ""`
   2. Append the new public key to `~/.ssh/authorized_keys` on the VM (do not
      remove the old one yet).
   3. Update the `SSH_PRIVATE_KEY` GitHub secret with the new private key.
   4. Trigger a `workflow_dispatch` run and confirm green.
   5. Remove the old public key from `~/.ssh/authorized_keys` on the VM.
   ```

### Part C — small workflow polish (optional within this phase)

If time allows, add to the workflow:

```yaml
      - name: Notify on failure
        if: failure()
        run: |
          echo "::error::Deploy failed for ${GITHUB_SHA::7}. Check the run logs and pm2 logs on the VM."
```

Nothing fancy — just makes the failure banner more useful. Slack/Discord notifications are out of scope.

## Done When

- [ ] Workflow has a `Public health check` step and a fresh run goes green end-to-end including that step.
- [ ] `docs/deploy.md` has the three edits in Part B and reads correctly top-to-bottom.
- [ ] One deliberate test: push a commit that breaks `/api/health` (e.g., make the route throw) → workflow fails at the public health check step (not silently green). Revert immediately afterwards.

**Commit:** `feat(ci): add public /api/health gate to deploy workflow` (Part A + C) and `docs(deploy): document automated deploy as default flow` (Part B). Two commits keep the code change separate from the docs change.

## What's now in place

End-to-end, after Phase 4:

- `git push origin main` → CI builds → rsync to VM → migrate → pm2 restart → local `/health` ok → public `/api/health` ok → green badge.
- One checked-in shell script (`scripts/deploy.sh`) that's auditable and runnable by hand on the VM.
- One checked-in workflow file (`.github/workflows/deploy.yml`).
- Four GitHub repo secrets, rotatable via a documented procedure.
- `docs/deploy.md` reflects reality.

## Things to revisit later (still out of scope)

- A staging VM + `deploy-staging.yml` on PRs.
- Notifications (Slack on failure).
- Full `ci.yml` running the integration test suite separately from deploy.
- Backup-before-migrate hook in `deploy.sh`.
- Atomic dist swap (rsync to a timestamped dir, symlink swap, restart) for true zero-downtime.
