# infra — Pulumi (Azure)

Provisions the Azure deployment for claude-sessions:

```
Resource Group
 ├── Container Registry (ACR)          stores the app image
 ├── PostgreSQL Flexible Server        managed, pgvector allowlisted
 │     └── database "claude_sessions"
 └── Container Apps Environment
       └── Container App               runs the image, HTTPS ingress on :3000
```

This is a **standalone** project — it is **not** a Turborepo workspace member, so it
never enters `bun run build` / `typecheck` / `lint` at the repo root. It has its own
`package.json` and lockfile.

The exe.dev deploy path (`.github/workflows/deploy.yml`, `scripts/deploy.sh`) is
untouched and keeps working. Azure is a parallel, manually-triggered path.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az login`)
- Bun (or npm) for installing this project's deps

## One-time bootstrap

```sh
cd infra
bun install
az login
pulumi login                      # Pulumi Cloud (free) or `pulumi login azblob://...`
pulumi stack init prod
```

### Set config + secrets

```sh
pulumi config set azure-native:location centralindia      # or your region
pulumi config set claude-sessions:githubOrg vertexcover-io
# embedProvider defaults to `fake` (no OpenAI key needed); no need to set it.

pulumi config set --secret claude-sessions:jwtSecret        "$(openssl rand -hex 32)"
pulumi config set --secret claude-sessions:pgAdminPassword  '<strong-password>'
# GitHub OAuth (org-gated login):
pulumi config set --secret claude-sessions:githubClientId      '<id>'
pulumi config set --secret claude-sessions:githubClientSecret  '<secret>'
```

### First apply (creates base infra)

```sh
pulumi up
```

This creates the registry, Postgres, and a Container App running whatever image
tag is configured (`claude-sessions:image`, default `:latest`). On the very first
apply there is no image in ACR yet — the app will fail to pull until CI pushes one.
That's expected; the goal of the first apply is to materialize the registry + DB
and reveal the app FQDN.

```sh
pulumi stack output acrLoginServer       # e.g. claudesessionsprodacr.azurecr.io
pulumi stack output containerAppUrl       # e.g. https://claude-sessions-prod-app.<region>.azurecontainerapps.io
```

### Wire the FQDN back in (OAuth + APP_BASE_URL)

```sh
pulumi config set claude-sessions:appBaseUrl "$(pulumi stack output containerAppUrl)"
```

Then update the **GitHub OAuth app** (Settings → Developer settings → OAuth Apps):

- Authorization callback URL → `<containerAppUrl>/api/auth/github/callback`

Re-apply so the app picks up `APP_BASE_URL`:

```sh
pulumi up
```

## Day-to-day deploys

You normally don't run Pulumi by hand. The **Deploy to Azure** GitHub Action
(`.github/workflows/deploy-azure.yml`, manual `workflow_dispatch`) builds the
image, pushes it to ACR, and runs `pulumi up` with the image pinned to the commit
SHA.

## CI secrets

The workflow authenticates to Azure via OIDC and to Pulumi via an access token.
Add these GitHub repo secrets:

| Secret | Purpose |
|---|---|
| `AZURE_CLIENT_ID` | OIDC federated app registration |
| `AZURE_TENANT_ID` | Azure tenant |
| `AZURE_SUBSCRIPTION_ID` | Target subscription |
| `PULUMI_ACCESS_TOKEN` | Pulumi Cloud state access |

(Configure the federated credential on the app registration to trust this repo's
`workflow_dispatch` runs. Alternatively switch `azure/login` to an
`AZURE_CREDENTIALS` service-principal secret.)

## Migrations

Migrations run **on container startup** — `packages/server/src/main.ts` applies
`migrations/*.sql` idempotently unless `NODE_ENV=test`. A healthy new revision
therefore implies migrations applied.

For a risky migration you'd rather gate before rollout, run it explicitly against
the DB from a trusted host:

```sh
export DATABASE_URL="$(cd infra && pulumi stack output databaseUrlSecret --show-secrets)"
# build the server, then:
node packages/server/dist/src/db/migrate.js
```

(This needs network egress to the DB — temporarily add a firewall rule for your IP
via the Azure portal, then remove it.)

## pgvector

`azure.extensions=VECTOR` is set as a server `Configuration` so `0001_init.sql`'s
`CREATE EXTENSION vector` succeeds. If a migration errors with
`extension "vector" is not allow-listed`, confirm that configuration applied:

```sh
az postgres flexible-server parameter show \
  --resource-group "$(pulumi stack output resourceGroupName)" \
  --server-name <server> --name azure.extensions
```

## Rollback

Re-run **Deploy to Azure** from a previous commit (the Actions tab lets you pick a
ref), or pin locally:

```sh
pulumi up --config claude-sessions:image=<acrLoginServer>/claude-sessions:<old-sha>
```

Container Apps swaps back to the prior image with no downtime.

## Teardown

```sh
pulumi destroy
pulumi stack rm prod
```
