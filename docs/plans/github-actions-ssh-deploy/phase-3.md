# Phase 3: Secrets + first live run

> **Status:** pending

## Overview

After this phase, the workflow from Phase 2 runs successfully end-to-end against the real `claude-sessions.exe.xyz` VM, triggered by a real push to `main`. This is the "make it actually work" phase — generating a deploy-only SSH keypair, registering it on the VM, populating the four GitHub repo secrets, and watching one push succeed.

## Implementation

**No code changes.** This phase is operational. It produces:

- A new ed25519 SSH keypair dedicated to CI (so the deploy key can be rotated/revoked without touching your personal SSH key on exe.dev).
- Four GitHub repo secrets.
- One green workflow run.

### Steps (perform in this order)

**1. Generate a deploy keypair on your laptop.**

```sh
ssh-keygen -t ed25519 -f ~/.ssh/claude-sessions-deploy -C "github-actions deploy@$(date +%Y-%m-%d)" -N ""
```

Result: `~/.ssh/claude-sessions-deploy` (private) and `~/.ssh/claude-sessions-deploy.pub` (public). The `-N ""` makes it passphrase-less, which CI requires.

**2. Authorize the public key on the VM.**

```sh
cat ~/.ssh/claude-sessions-deploy.pub | ssh claude-sessions.exe.xyz \
  'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

Verify by SSHing in with just the new key:

```sh
ssh -i ~/.ssh/claude-sessions-deploy -o IdentitiesOnly=yes claude-sessions.exe.xyz 'whoami && which bun && which pm2'
```

Expected: prints the username, `bun` path, `pm2` path. If `bun` or `pm2` is missing, the workflow will fail at the deploy step — go back and confirm Phase 1's `bash -lc` PATH assumption holds.

**3. Capture the VM's host key for `known_hosts` pinning.**

```sh
ssh-keyscan -t ed25519 claude-sessions.exe.xyz 2>/dev/null
```

Copy the entire output line. This goes into the `SSH_KNOWN_HOSTS` secret and is what makes `StrictHostKeyChecking=yes` work in CI without prompting.

> **Trust on first use caveat:** `ssh-keyscan` is only as trustworthy as your network at the moment of capture. If you want to be paranoid, run `ssh-keyscan` from the VM itself (`ssh claude-sessions.exe.xyz 'ssh-keyscan -t ed25519 localhost'`) and verify the fingerprint matches.

**4. Populate the four GitHub repo secrets.**

Settings → Secrets and variables → Actions → New repository secret. Add:

| Secret name | Value |
|---|---|
| `SSH_PRIVATE_KEY` | Contents of `~/.ssh/claude-sessions-deploy` (the private key — include the `-----BEGIN/END-----` lines, with a trailing newline) |
| `SSH_KNOWN_HOSTS` | Output from step 3 |
| `SSH_HOST` | `claude-sessions.exe.xyz` |
| `SSH_USER` | The VM's SSH user (likely `exedev` based on `docs/deploy.md:507`'s `/home/exedev/`; confirm with `whoami` from step 2) |

**5. Trigger the first run.**

Two options:

- **Recommended**: trigger manually first via the Actions tab → `Deploy to exe.dev` → `Run workflow` → branch: `main`. This uses the `workflow_dispatch` we wired in Phase 2 and lets you test without making a commit.
- Or merge a trivial change (e.g., a README typo fix) to `main`.

**6. Watch and verify.**

While the workflow runs, in a second terminal:

```sh
ssh -i ~/.ssh/claude-sessions-deploy claude-sessions.exe.xyz 'pm2 logs claude-sessions-api --lines 0'
```

You should see:

- Rsync output in the Actions UI completing in <30s (only `dist/` deltas).
- "Invoke deploy.sh" step printing the migration output, then `pm2 restart claude-sessions-api`.
- pm2 logs showing the server starting up with the new code.
- The job ending green.

After the run, hit the public URL from your laptop:

```sh
curl https://claude-sessions.exe.xyz/api/health
# → {"status":"ok"}
```

## Done When

- [ ] All four secrets are set in the repo.
- [ ] One push to `main` (or one `workflow_dispatch` run) lands a green job.
- [ ] `pm2 logs` on the VM shows the server restarted with the new commit's code.
- [ ] `/api/health` returns 200 OK against the public URL.
- [ ] The deploy keypair file is **deleted from your laptop** after the private key is pasted into the GitHub secret (`shred -u ~/.ssh/claude-sessions-deploy` on Linux; on macOS, `rm -P` or just `rm` is fine since GitHub now holds the only copy you need — the public key on the VM still authorizes it).

**Commit:** No code commit for this phase. Document the rotation process in Phase 4's docs update.

## Rollback / "I broke production"

If the first run lands and something is broken:

1. **Revert the offending commit on `main`**: `git revert <sha> && git push`. The workflow re-runs and deploys the revert.
2. **Or SSH in and `git checkout <prev-sha>`** the `~/claude-sessions` source… but wait — there is no `git` tree on the VM anymore (we rsync `dist/` only, not source). So revert-on-main is the only path. This is a deliberate constraint of the rsync-dist approach and the reason "auto-rollback" was deferred.

## Secret rotation

- Generate a new keypair (step 1).
- Add the new public key to `~/.ssh/authorized_keys` on the VM **before** rotating the secret (so there's no window where CI can't log in).
- Update `SSH_PRIVATE_KEY` in GitHub secrets.
- Remove the old public key from `~/.ssh/authorized_keys`.
- Document this in `docs/deploy.md` (Phase 4).
