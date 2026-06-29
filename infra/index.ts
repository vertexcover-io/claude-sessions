// Pulumi program: Azure deployment for claude-sessions.
//
// Provisions: Resource Group -> Container Registry -> PostgreSQL Flexible Server
// (pgvector allowlisted) -> Container Apps Environment + Container App.
//
// The app image is the repo's universal Dockerfile, pushed to ACR by CI. The
// Container App pulls it and listens on 3000 behind Azure-managed HTTPS ingress.
//
// Secrets come from Pulumi config (see infra/README.md). DATABASE_URL is built
// from the Postgres outputs with `sslmode=require` (Flexible Server enforces TLS;
// postgres-js honors the query param, so no app-code change is needed).

import * as app from "@pulumi/azure-native/app";
import * as containerregistry from "@pulumi/azure-native/containerregistry";
import * as dbforpostgresql from "@pulumi/azure-native/dbforpostgresql";
import * as resources from "@pulumi/azure-native/resources";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const project = pulumi.getProject();
const stack = pulumi.getStack();
const prefix = `${project}-${stack}`;

// --- Config & secrets -------------------------------------------------------
// Embeddings use the deterministic `fake` provider — no OpenAI key needed. To
// switch to real embeddings later, set embedProvider=openai and add an
// `openaiApiKey` secret wired in as a Container App secret env var.
const embedProvider = config.get("embedProvider") ?? "fake";
const githubOrg = config.get("githubOrg") ?? "vertexcover-io";
const appBaseUrl = config.get("appBaseUrl"); // set after first apply (FQDN known)
const imageOverride = config.get("image"); // CI passes <acr>/claude-sessions:<sha>

const jwtSecret = config.requireSecret("jwtSecret");
const pgAdminPassword = config.requireSecret("pgAdminPassword");
const githubClientId = config.getSecret("githubClientId");
const githubClientSecret = config.getSecret("githubClientSecret");

const pgAdminLogin = config.get("pgAdminLogin") ?? "sessionsadmin";
const dbName = "claude_sessions";

// --- Resource Group ---------------------------------------------------------
const rg = new resources.ResourceGroup(`${prefix}-rg`);

// --- Container Registry -----------------------------------------------------
const registry = new containerregistry.Registry(`${prefix}acr`.replace(/[^a-z0-9]/g, ""), {
  resourceGroupName: rg.name,
  sku: { name: containerregistry.SkuName.Basic },
  adminUserEnabled: true, // simplest pull path; swap for managed identity later
});

const acrCreds = pulumi
  .all([rg.name, registry.name])
  .apply(([rgName, regName]) =>
    containerregistry.listRegistryCredentials({ resourceGroupName: rgName, registryName: regName }),
  );
const acrUsername = acrCreds.apply((c) => c.username ?? "");
const acrPassword = pulumi.secret(acrCreds.apply((c) => c.passwords?.[0]?.value ?? ""));

// --- PostgreSQL Flexible Server ---------------------------------------------
const pg = new dbforpostgresql.Server(`${prefix}-pg`, {
  resourceGroupName: rg.name,
  version: "16",
  administratorLogin: pgAdminLogin,
  administratorLoginPassword: pgAdminPassword,
  sku: { name: "Standard_B1ms", tier: dbforpostgresql.SkuTier.Burstable },
  storage: { storageSizeGB: 32 },
  backup: {
    backupRetentionDays: 7,
    geoRedundantBackup: dbforpostgresql.GeoRedundantBackupEnum.Disabled,
  },
  highAvailability: { mode: dbforpostgresql.HighAvailabilityMode.Disabled },
  authConfig: {
    activeDirectoryAuth: dbforpostgresql.ActiveDirectoryAuthEnum.Disabled,
    passwordAuth: dbforpostgresql.PasswordAuthEnum.Enabled,
  },
});

const database = new dbforpostgresql.Database(`${prefix}-db`, {
  resourceGroupName: rg.name,
  serverName: pg.name,
  databaseName: dbName,
});

// Allowlist the pgvector extension so `CREATE EXTENSION vector` in 0001_init.sql
// succeeds. Flexible Server gates extensions behind the `azure.extensions` GUC.
const vectorExtension = new dbforpostgresql.Configuration(`${prefix}-pg-extensions`, {
  resourceGroupName: rg.name,
  serverName: pg.name,
  configurationName: "azure.extensions",
  value: "VECTOR",
  source: "user-override",
});

// Allow other Azure services (the Container App) to reach the DB. The 0.0.0.0
// start/end pair is Azure's special "allow all Azure-internal services" rule.
const allowAzure = new dbforpostgresql.FirewallRule(`${prefix}-pg-allow-azure`, {
  resourceGroupName: rg.name,
  serverName: pg.name,
  firewallRuleName: "AllowAllAzureServices",
  startIpAddress: "0.0.0.0",
  endIpAddress: "0.0.0.0",
});

const databaseUrl = pulumi
  .all([pgAdminPassword, pg.fullyQualifiedDomainName])
  .apply(
    ([pw, fqdn]) =>
      `postgres://${pgAdminLogin}:${encodeURIComponent(pw)}@${fqdn}:5432/${dbName}?sslmode=require`,
  );

// --- Container Apps Environment ---------------------------------------------
const env = new app.ManagedEnvironment(`${prefix}-env`, {
  resourceGroupName: rg.name,
});

const image = pulumi
  .all([registry.loginServer, pulumi.output(imageOverride)])
  .apply(([loginServer, override]) =>
    override && override.length > 0 ? override : `${loginServer}/claude-sessions:latest`,
  );

// --- Container App ----------------------------------------------------------
const containerApp = new app.ContainerApp(
  `${prefix}-app`,
  {
    resourceGroupName: rg.name,
    managedEnvironmentId: env.id,
    configuration: {
      ingress: {
        external: true,
        targetPort: 3000,
        transport: app.IngressTransportMethod.Auto,
        allowInsecure: false,
      },
      registries: [
        {
          server: registry.loginServer,
          username: acrUsername,
          passwordSecretRef: "acr-password",
        },
      ],
      secrets: [
        { name: "acr-password", value: acrPassword },
        { name: "database-url", value: databaseUrl },
        { name: "jwt-secret", value: jwtSecret },
        ...(githubClientId ? [{ name: "github-client-id", value: githubClientId }] : []),
        ...(githubClientSecret
          ? [{ name: "github-client-secret", value: githubClientSecret }]
          : []),
      ],
    },
    template: {
      containers: [
        {
          name: "api",
          image,
          resources: { cpu: 0.5, memory: "1Gi" },
          env: [
            { name: "NODE_ENV", value: "production" },
            { name: "PORT", value: "3000" },
            { name: "COOKIE_SECURE", value: "true" },
            { name: "EMBED_PROVIDER", value: embedProvider },
            { name: "GITHUB_ORG", value: githubOrg },
            ...(appBaseUrl ? [{ name: "APP_BASE_URL", value: appBaseUrl }] : []),
            { name: "DATABASE_URL", secretRef: "database-url" },
            { name: "JWT_SECRET", secretRef: "jwt-secret" },
            ...(githubClientId
              ? [{ name: "GITHUB_CLIENT_ID", secretRef: "github-client-id" }]
              : []),
            ...(githubClientSecret
              ? [{ name: "GITHUB_CLIENT_SECRET", secretRef: "github-client-secret" }]
              : []),
          ],
        },
      ],
      scale: { minReplicas: 1, maxReplicas: 3 },
    },
  },
  { dependsOn: [database, vectorExtension, allowAzure] },
);

// --- Exports ----------------------------------------------------------------
export const resourceGroupName = rg.name;
export const acrName = registry.name;
export const acrLoginServer = registry.loginServer;
export const containerAppFqdn = containerApp.configuration.apply((c) => c?.ingress?.fqdn ?? "");
export const containerAppUrl = containerApp.configuration.apply((c) =>
  c?.ingress?.fqdn ? `https://${c.ingress.fqdn}` : "",
);
export const databaseUrlSecret = pulumi.secret(databaseUrl);
