# Deployment Guide — exe.dev

How to deploy the claude-sessions stack (Postgres + Hono server + web SPA) on
[exe.dev](https://exe.dev) and point the CLI at it.

## Automated deploys (default)

Pushes to `main` are auto-deployed by `.github/workflows/deploy.yml`. The
workflow builds all packages in CI, rsyncs only the `dist/` artifacts to the
VM, and runs `scripts/deploy.sh` over SSH to migrate the DB and restart pm2.
See `docs/plans/github-actions-ssh-deploy/` for the design and `scripts/deploy.sh`
for the VM-side script.

The manual steps below are kept for **first-time VM provisioning**, disaster
recovery, and one-off operations. Day-to-day updates land via `main`.

## How exe.dev works

exe.dev gives you persistent Linux VMs accessible over SSH. Key properties:

- `ssh exe.dev` to manage VMs (create, list, share, clone)
- Every VM gets `https://<vmname>.exe.xyz` with automatic TLS certs
- exe.dev's reverse proxy handles TLS termination and forwards to your VM
- VMs have persistent disks — reboot survives, data stays
- First-boot setup scripts let you automate provisioning
- Docker runs inside VMs (no Docker Compose orchestration layer from exe.dev)
- VMs are private by default; share via email links or mark public
- 2 CPU, 8 GB RAM, 25 GB disk, shared across up to 50 VMs for $20/month

**The exe.dev proxy** is the critical piece for deployment:

- Proxies `https://<vmname>.exe.xyz` → your VM's HTTP port
- Auto-detects port from Dockerfile `EXPOSE` directive (prefers 80, then ≥1024)
- Override with `ssh exe.dev share port <vm> <port>`
- Ports 3000–9999 are transparently forwarded: `https://<vm>.exe.xyz:3456/`
- Sets `X-Forwarded-Proto: https`, `X-Forwarded-Host`, `X-Forwarded-For`
- Custom domains via CNAME: `app.example.com CNAME <vmname>.exe.xyz`

## Architecture

```
 Laptop (CLI)                      exe.dev VM (your vm)        exe.dev Proxy
┌─────────────────┐       ┌─────────────────────────────┐     ┌──────────────┐
│ ~/.claude/      │       │  Node (port 3000)           │     │              │
│ projects/*.jsonl│──────→│  ├── Hono server            │────→│  HTTPS auto  │
│                 │ HTTPS │  │   - REST API (/api/*)     │     │  TLS cert    │
│ claude-sessions │       │  │   - MCP (/mcp/:token)    │     │              │
│   login --server│       │  │   - Static SPA (/)       │     │  <vm>.exe.xyz│
│   watch         │       │  │   - /health              │     │              │
│   sync          │       │  ├── Postgres (:5432)       │     └──────────────┘
│   fork          │       │  │   - pgvector, FTS        │
└─────────────────┘       │  └── persist to disk        │
                            └─────────────────────────────┘
```

All CLI traffic flows **outbound** from your laptop to `https://<vm>.exe.xyz`.
The VM has no public IP — exe.dev's proxy is the only ingress.

## Prerequisites

- An [exe.dev](https://exe.dev) account (register with `ssh exe.dev`)
- Your SSH key registered with exe.dev
- Node 22 / npm knowledge (for building the project)
- `JWT_SECRET` — 32+ random bytes (see [Generating secrets](#generating-secrets))
- `OPENAI_API_KEY` — for embeddings (optional; use `EMBED_PROVIDER=fake`)

## Quickstart (TL;DR)

```sh
# 1. Create a VM on exe.dev
ssh exe.dev new --name claude-sessions

# 2. SSH in and install dependencies
ssh claude-sessions.exe.xyz
sudo apt update && sudo apt install -y postgresql-16 postgresql-16-pgvector curl
sudo apt install -y nodejs npm     # or install via nvm

# 3. Set up Postgres
sudo -u postgres psql -c "CREATE DATABASE claude_sessions;"
sudo -u postgres psql -d claude_sessions -c "CREATE EXTENSION vector;"

# 4. Build & deploy the app
git clone https://github.com/amankumarsingh77/vibe-tools.git
cd vibe-tools/claude-sessions
# ... install bun, build, configure .env, run migrations, start server

# 5. Point exe.dev proxy to port 3000
ssh exe.dev share port claude-sessions 3000

# 6. Login from your laptop
claude-sessions login --server https://claude-sessions.exe.xyz
```

## Step-by-step

### 1. Register with exe.dev

```sh
ssh exe.dev
```

If this is your first time, follow the registration flow. It registers your SSH
key. After that you can create VMs.

### 2. Create a VM

```sh
ssh exe.dev new --name claude-sessions
```

Name must be unique across all exe.dev users. Try something specific like
`claude-sessions-<yourname>` if `claude-sessions` is taken.

The VM is ready immediately. Connect to it:

```sh
ssh claude-sessions.exe.xyz
```

> You'll get a host key warning on first SSH — verify the key fingerprint
> against exe.dev's published host key.

### 3. Install Postgres + pgvector

Postgres runs directly on the VM (not in Docker) for persistence simplicity.
exe.dev VMs have persistent disks, so your data survives reboots.

```sh
ssh claude-sessions.exe.xyz

# Install Postgres 16 with pgvector
sudo apt update
sudo apt install -y postgresql-16 postgresql-16-pgvector

# Start Postgres and enable on boot
sudo systemctl enable --now postgresql
```

Create the database:

```sh
sudo -u postgres psql -c "CREATE DATABASE claude_sessions;"
sudo -u postgres psql -d claude_sessions -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Set a password for the `postgres` user (not strictly required since Postgres
only listens on localhost by default, but needed if your connection string
uses password auth):

```sh
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'strong-password-here';"
```

> **Note**: Postgres on exe.dev VMs defaults to `trust` auth for local socket
> connections and `md5` for TCP. Since the server connects via localhost, the
> `DATABASE_URL` will be:
> ```
> postgres://postgres:strong-password-here@localhost:5432/claude_sessions
> ```

### 4. Configure Postgres for pgvector

Edit `/etc/postgresql/16/main/postgresql.conf`:

```sh
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = 'localhost'/" \
  /etc/postgresql/16/main/postgresql.conf

# Increase maintenance_work_mem for HNSW index creation
sudo sed -i "s/#maintenance_work_mem = 64MB/maintenance_work_mem = 256MB/" \
  /etc/postgresql/16/main/postgresql.conf

sudo systemctl restart postgresql
```

### 5. Install Node.js

exeuntu (the default VM image) is Ubuntu. Install Node 22:

```sh
# Option A: via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22

# Option B: via apt
sudo apt install -y nodejs npm
# May not give you Node 22 — use nvm for the right version.
```

### 6. Install Bun

The project uses Bun for install and build:

```sh
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### 7. Clone and build the project

```sh
git clone https://github.com/amankumarsingh77/vibe-tools.git
cd vibe-tools/claude-sessions
bun install
```

Build all packages:

```sh
bun run --filter @claude-sessions/core build
bun run --filter @claude-sessions/adapter-claude build
bun run --filter @claude-sessions/web build
bun run --filter @claude-sessions/server build
```

### 8. Configure environment

Create `/home/exedev/claude-sessions/.env` (the project root, since
`docker-compose.yml` isn't used on the VM):

```sh
cat > .env << 'EOF'
DATABASE_URL=postgres://postgres:strong-password-here@localhost:5432/claude_sessions
JWT_SECRET=a7f3c9e1b2d4...   # 32+ random bytes
EMBED_PROVIDER=fake
OPENAI_API_KEY=
PORT=3000
NODE_ENV=production
COOKIE_SECURE=true
EOF

chmod 600 .env
```

**JWT_SECRET**: Generate it on your laptop and copy it over:

```sh
# On your laptop
openssl rand -hex 32
# → a7f3c9e1b2d4...
```

### 9. Run migrations

`DATABASE_URL` is read from the environment, so export it or use a wrapper:

```sh
cd ~/claude-sessions
export $(cat .env | xargs)
bun run --filter @claude-sessions/server db:migrate
```

Expected output:

```
migrations applied: 0001_init.sql, 0002_session_commits.sql, ...
```

If you see `Error: extension "vector" not available`, make sure
`postgresql-16-pgvector` was installed and the extension was created in the
database.

### 10. Configure GitHub OAuth

There is no password login or registration endpoint — users sign in with GitHub
and a row is auto-created on first login for members of the allowed org. Create a
GitHub OAuth app (Settings → Developer settings → OAuth Apps):

- **Authorization callback URL**: `https://<your-host>/api/auth/github/callback`
- Scopes requested at runtime: `read:org user:email`

Then set in `.env`:

```sh
GITHUB_CLIENT_ID=<oauth app client id>
GITHUB_CLIENT_SECRET=<oauth app client secret>
GITHUB_ORG=vertexcover-io          # only active members of this org can sign in
APP_BASE_URL=https://<your-host>   # builds the OAuth redirect_uri
```

### 11. Start the server

For production, use a process manager so the server restarts on crash and
survives SSH disconnection:

```sh
# Install pm2
npm install -g pm2

# Start the server
cd ~/claude-sessions
export $(cat .env | xargs)
pm2 start packages/server/dist/src/main.js --name claude-sessions-api
pm2 save
pm2 startup
```

The `pm2 startup` command will print a `sudo` command to run so pm2 restarts
on VM reboot.

### 12. Configure the exe.dev proxy

By default, exe.dev attempts to auto-detect the port. Since we're not using
a Dockerfile with EXPOSE, the auto-detection may not pick port 3000.
Explicitly set it:

```sh
# From your laptop (not inside the VM)
ssh exe.dev share port claude-sessions 3000
```

### 13. Verify the server

```sh
# From your laptop
curl https://claude-sessions.exe.xyz/health
# → {"status":"ok"}

# OAuth start should 302-redirect to github.com
curl -sI "https://claude-sessions.exe.xyz/api/auth/github/start" | grep -i location
# → location: https://github.com/login/oauth/authorize?...
```

### 14. Open the web UI

Open `https://claude-sessions.exe.xyz` in your browser and click
**Sign in with GitHub** (you must be a member of `GITHUB_ORG`).

If you get a blank page or 404, the SPA static files may not be served.
Check that `WEB_DIST` is set or the files exist at the expected path:

```sh
ls ~/claude-sessions/packages/web/dist/index.html
```

The server's `buildStaticSpa` handler (in `packages/server/src/routes/static.ts`)
looks for `packages/web/dist` relative to `cwd`, or the `WEB_DIST` env var.

## CLI setup (from your laptop)

### Build the CLI

```sh
cd claude-sessions
bun run --filter @claude-sessions/cli build
```

### Login via pairing flow

```sh
node packages/cli/dist/main.js login --server https://claude-sessions.exe.xyz
```

This opens the web UI. Log in there, then copy the pairing code from the UI
and paste it into the terminal. The CLI persists the token to
`~/.claude-sessions/credentials.json` (mode `0600`).

### Enable a repo and start watching

```sh
cd /path/to/your/project
node packages/cli/dist/main.js enable .
node packages/cli/dist/main.js watch
```

### Verify

```sh
node packages/cli/dist/main.js status
```

You should see your repo with a non-empty "LAST SYNC" timestamp.

## Custom domain (optional)

Instead of `https://claude-sessions.exe.xyz`, point your own domain at the VM:

### Subdomain (e.g., `sessions.example.com`)

Add a CNAME record at your DNS provider:

```
sessions.example.com  CNAME  claude-sessions.exe.xyz
```

exe.dev handles TLS certs automatically. Visit `https://sessions.example.com`.

### Apex domain (e.g., `sessions.example`)

```
www.sessions.example  CNAME  claude-sessions.exe.xyz
sessions.example      ALIAS  claude-sessions.exe.xyz   # or A record
```

> **Cloudflare users**: Disable proxy mode (orange cloud → grey cloud) or
> exe.dev's TLS cert issuance will fail.

## Security hardening

### Essential

| Area | What to do | Why |
|---|---|---|
| `JWT_SECRET` | 32+ random bytes, `chmod 600 .env` | Signs all auth tokens |
| Postgres password | Strong password in `DATABASE_URL` | Don't use defaults |
| `COOKIE_SECURE` | `true` in `.env` | Session cookie needs `Secure` flag behind HTTPS proxy |
| `.env` file | `chmod 600`, never commit | Contains all secrets |
| VM privacy | Default is private — don't `share set-public` | Only you can access the web UI |
| Firewall | Not needed — exe.dev proxy is the only ingress | No public IP on the VM |

### Recommended

#### Rate limiting

The server should rate-limit these endpoints. Not yet implemented — add Hono
middleware with an in-memory token bucket:

| Endpoint | Strategy | Suggested limit |
|---|---|---|
| `GET /api/auth/github/callback` | IP-based | 10 req/min |
| `POST /api/auth/cli-exchange` | IP-based | 5 req/min |
| `POST /api/ingest` | User-based | 100 req/min |

#### Body size limits

The 500-events-per-batch cap in the Zod schema is already in place. Add
Hono's `bodyLimit` middleware as a defense-in-depth measure:

```ts
import { bodyLimit } from "hono/body-limit";

app.use("/api/ingest", bodyLimit({
  maxSize: 5 * 1024 * 1024,  // 5 MB
  onError: (c) => c.json({ error: "payload too large" }, 413),
}));
```

#### CORS

The web SPA is served from the same origin (`/` via the static handler), so
CORS isn't strictly needed for browser traffic. If you access the API from
another origin, add it:

```ts
import { cors } from "hono/cors";

app.use("/api/*", cors({
  origin: ["https://sessions.example.com"],
  credentials: true,
}));
```

#### X-Forwarded-* trust

exe.dev's proxy already sets `X-Forwarded-Proto: https`. The server should
trust this header so cookie `Secure` flag and redirect URLs use the correct
scheme. This is already partially handled — `env.COOKIE_SECURE` controls
the cookie flag, and you set it to `true` in `.env`.

For IP-based rate limiting, read `X-Forwarded-For` from the request headers:

```ts
const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  ?? c.req.header("x-real-ip")
  ?? "unknown";
```

#### HTTPS enforcement in the CLI

The CLI currently accepts `http://` for any server URL. For production, add
a check that rejects non-HTTPS URLs when the host is not localhost:

```ts
// In packages/cli/src/commands/login.ts and upload/client.ts:
const url = new URL(serverUrl);
if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && url.protocol !== "https:") {
  throw new Error("server must use HTTPS for non-localhost connections");
}
```

## Token lifecycle

| Token | Audience | Issued by | Expiry | Used |
|---|---|---|---|---|
| CLI bearer | `cli` | Login or `/cli-exchange` | 7 days | `Authorization: Bearer` header |
| Session cookie | `web` | Login | 7 days | Browser SPA (httpOnly) |
| MCP token | `mcp` | `/api/auth/mcp-token` | 7 days | URL path at `/mcp/<token>` |

On 401, the CLI should print:

```
Authentication expired. Run `claude-sessions login --server <url>` to re-authenticate.
```

Rotating `JWT_SECRET` invalidates all tokens — acceptable for v0.

## Backups

### Nightly pg_dump

Create `/home/exedev/backup-claude-sessions.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

DATE=$(date +%Y-%m-%d)
BACKUP_DIR=/home/exedev/backups
mkdir -p "$BACKUP_DIR"

pg_dump -U postgres -d claude_sessions --no-owner --no-acl \
  | gzip \
  > "$BACKUP_DIR/claude-sessions-${DATE}.sql.gz"

# Keep last 30 days
find "$BACKUP_DIR" -name "claude-sessions-*.sql.gz" -mtime +30 -delete
```

Make it executable and add a cron job:

```sh
chmod +x ~/backup-claude-sessions.sh
crontab -e
# Add:
0 3 * * * /home/exedev/backup-claude-sessions.sh
```

### Copy backups off the VM

```sh
# From your laptop
scp claude-sessions.exe.xyz:~/backups/claude-sessions-2026-05-12.sql.gz .
```

Or use `rsync`, `rclone` to S3/R2, etc.

## Updating the server

### Automatic (preferred)

Merge to `main`. The `Deploy to exe.dev` GitHub Action will:

1. Build all packages on the runner (`bun run build`).
2. Rsync `dist/` + migrations + `scripts/deploy.sh` to `~/claude-sessions/` on the VM.
3. Invoke `scripts/deploy.sh` over SSH, which runs `migrate.js`, restarts pm2,
   and probes `http://localhost:3000/api/health`.
4. Probe `https://claude-sessions.exe.xyz/api/health` from the runner to confirm.

The workflow is in `.github/workflows/deploy.yml`. Required repo secrets:
`SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `SSH_HOST`, `SSH_USER` (see
[CI deploy key rotation](#ci-deploy-key-rotation) below for the keypair setup).

To re-deploy without a new commit: Actions → `Deploy to exe.dev` → Run workflow.

### Manual fallback

Use only when Actions is unavailable or you're recovering from a broken state.

```sh
ssh claude-sessions.exe.xyz
cd ~/claude-sessions

# Pull latest code
git pull

# Rebuild
bun install
bun run --filter @claude-sessions/core build
bun run --filter @claude-sessions/adapter-claude build
bun run --filter @claude-sessions/web build
bun run --filter @claude-sessions/server build

# Run new migrations (if any)
export $(cat .env | xargs)
bun run --filter @claude-sessions/server db:migrate

# Restart
pm2 restart claude-sessions-api
```

### CI deploy key rotation

The GitHub Actions workflow authenticates with a dedicated ed25519 keypair
generated specifically for CI. To rotate:

```sh
# 1. Generate a new keypair on your laptop
ssh-keygen -t ed25519 -f ~/.ssh/claude-sessions-deploy-new -N "" \
  -C "github-actions deploy@$(date +%Y-%m-%d)"

# 2. Authorize the NEW key on the VM (do not remove the old one yet)
cat ~/.ssh/claude-sessions-deploy-new.pub | \
  ssh claude-sessions.exe.xyz 'cat >> ~/.ssh/authorized_keys'

# 3. Update the SSH_PRIVATE_KEY GitHub secret with the new private key contents

# 4. Trigger a workflow_dispatch run and confirm green

# 5. Remove the OLD public key from ~/.ssh/authorized_keys on the VM
```

First-time setup of the deploy key:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/claude-sessions-deploy -N "" \
  -C "github-actions deploy"

# Authorize on VM
cat ~/.ssh/claude-sessions-deploy.pub | \
  ssh claude-sessions.exe.xyz 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'

# Capture host key for known_hosts pinning
ssh-keyscan -t ed25519 claude-sessions.exe.xyz

# Then populate the four GitHub repo secrets:
#   SSH_PRIVATE_KEY  = contents of ~/.ssh/claude-sessions-deploy
#   SSH_KNOWN_HOSTS  = output of the ssh-keyscan above
#   SSH_HOST         = claude-sessions.exe.xyz
#   SSH_USER         = the VM's SSH user (run `whoami` on the VM)
```

## Monitoring

```sh
# Health check (from anywhere)
curl https://claude-sessions.exe.xyz/health

# Server logs
ssh claude-sessions.exe.xyz
pm2 logs claude-sessions-api --lines 50

# Postgres logs
sudo journalctl -u postgresql --since "10 minutes ago"

# Disk usage
df -h

# Postgres size
sudo -u postgres psql -d claude_sessions -c "SELECT pg_database_size('claude_sessions')/1024/1024 AS size_mb;"
```

## Troubleshooting

### Server won't start

```sh
ssh claude-sessions.exe.xyz
cd ~/claude-sessions
export $(cat .env | xargs)
node packages/server/dist/src/main.js
# Watch for error messages
```

Common causes:

- `DATABASE_URL` unreachable — check Postgres is running: `sudo systemctl status postgresql`
- `JWT_SECRET` too short — must be ≥ 8 characters
- Port 3000 already in use — `sudo lsof -i :3000`
- `EMBED_PROVIDER=openai` but no `OPENAI_API_KEY` set — switch to `fake`
- Migration failed — `vector` extension missing from the database

### CLI can't connect

```sh
curl https://claude-sessions.exe.xyz/health
# → {"status":"ok"}

# Is the proxy pointing at the right port?
ssh exe.dev share port claude-sessions   # should show 3000

# Token valid?
curl https://claude-sessions.exe.xyz/api/auth/me \
  -H "Authorization: Bearer <token>"

# Re-login if 401
node packages/cli/dist/main.js login --server https://claude-sessions.exe.xyz
```

### Web UI shows blank page

```sh
ssh claude-sessions.exe.xyz
# Check the SPA dist exists
ls ~/claude-sessions/packages/web/dist/index.html

# If missing, rebuild:
cd ~/claude-sessions && bun run --filter @claude-sessions/web build

# Check server logs for static file path errors
pm2 logs claude-sessions-api
```

### Web UI loads but API calls fail (CORS or cookie issues)

- Make sure `COOKIE_SECURE=true` in `.env`
- The browser must access the site over HTTPS (exe.dev handles this)
- Cookie `SameSite=Lax` is set — this works for top-level navigation but
  may block cross-origin requests if you're accessing from a different domain
- If accessing the API from a different origin, configure CORS

### Proxy not forwarding

```sh
# From your laptop
ssh exe.dev share port claude-sessions   # check port
ssh exe.dev share show claude-sessions   # check visibility (should be private)
```

### VM ran out of disk

exe.dev VMs have 25 GB shared across all VMs. Check usage:

```sh
ssh claude-sessions.exe.xyz
df -h
sudo du -sh /var/lib/postgresql  # Postgres data
sudo du -sh /home                 # your home directory
```

If Postgres logs are large:

```sh
sudo journalctl --vacuum-size=100M
```

### Need to resize / recover

exe.dev doesn't currently offer disk resizing. If you need more space:

1. Create a new VM
2. Dump and restore Postgres
3. Clone your code
4. Update DNS / proxy config
5. Delete the old VM

## VM lifecycle

```sh
# List VMs
ssh exe.dev ls

# Clone a VM (fast — shares underlying resources)
ssh exe.dev cp claude-sessions claude-sessions-staging

# Delete a VM
ssh exe.dev rm claude-sessions-staging

# Share with a teammate
ssh exe.dev share add claude-sessions teammate@example.com

# Remove a user
ssh exe.dev share remove claude-sessions teammate@example.com

# Stop (but don't delete) — doesn't exist on exe.dev
# VMs are always running when you're using them
# They may be suspended during inactivity
```

## Security checklist

Before going live:

- [ ] `JWT_SECRET` is 32+ random bytes in `.env` (`chmod 600`)
- [ ] Postgres has a non-default password
- [ ] `COOKIE_SECURE=true` in `.env`
- [ ] VM is private (default — `ssh exe.dev share show <vm>` confirms)
- [ ] Server is managed by pm2 (auto-restart on crash/reboot)
- [ ] `EMBED_PROVIDER` is configured correctly (not leaking OpenAI keys to logs)
- [ ] Nightly backups are running
- [ ] CLI enforces HTTPS for non-localhost servers
- [ ] You can log in from the web UI and from the CLI
- [ ] Watcher successfully uploads events (test with `claude-sessions sync`)

## Reference

### exe.dev commands for this deployment

| Command | Purpose |
|---|---|
| `ssh exe.dev new --name <vm>` | Create VM |
| `ssh exe.dev ls` | List VMs |
| `ssh exe.dev share port <vm> <port>` | Set proxy target port |
| `ssh exe.dev share show <vm>` | Check visibility & port |
| `ssh exe.dev share set-public <vm>` | Make proxy public (not needed) |
| `ssh exe.dev share add <vm> <email>` | Share with a specific user |
| `ssh exe.dev share add-link <vm>` | Create a share link |
| `ssh exe.dev rm <vm>` | Delete VM |
| `ssh exe.dev cp <src> <dst>` | Clone VM |
| `ssh exe.dev ssh-key list` | List registered SSH keys |

### exe.dev proxy port behavior

- **Port auto-detection**: checks Dockerfile `EXPOSE` directives, prefers port
  80, then smallest exposed TCP port ≥ 1024
- **No Dockerfile**: falls back to the default, which may not be 3000
- **Explicit is better**: always run `ssh exe.dev share port <vm> 3000`
- **Additional ports**: Ports 3000–9999 are transparently forwarded at
  `https://<vm>.exe.xyz:<port>/` — these are always private (only the default
  port can be made public)

### Ports used

| Port | Service | Notes |
|---|---|---|
| 3000 | Hono server | Main proxy target |
| 5432 | Postgres | Localhost only, not exposed |
| 22 | SSH | exe.dev's SSH endpoint |
