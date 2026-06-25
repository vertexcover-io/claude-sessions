// AI-generated. See PROMPT.md for the prompts and model used.

import { Hono } from "hono";
import type { GithubClient } from "./auth/github.js";
import type { DbClient } from "./db/client.js";
import type { Env } from "./env.js";
import { buildAuthRouter } from "./routes/auth.js";
import { buildHealthRouter } from "./routes/health.js";
import { buildIngestRouter } from "./routes/ingest.js";
import { buildMcpRouter } from "./routes/mcp.js";
import { buildReposRouter } from "./routes/repos.js";
import { buildSearchRouter } from "./routes/search.js";
import { buildSessionsRouter } from "./routes/sessions.js";
import { buildStaticSpa } from "./routes/static.js";
import { buildSummarizationRunsRouter } from "./routes/summarization-runs.js";

export interface BuildAppOptions {
  webDist?: string;
  githubClient?: GithubClient;
}

export const buildApp = (db: DbClient, env: Env, opts: BuildAppOptions = {}): Hono => {
  const app = new Hono();
  app.route("/health", buildHealthRouter());
  app.route("/api/health", buildHealthRouter());
  app.route("/api/auth", buildAuthRouter(db, env, opts.githubClient));
  app.route("/api/repos", buildReposRouter(db, env));
  app.route("/api/ingest", buildIngestRouter(db, env));
  app.route("/api/sessions", buildSessionsRouter(db, env));
  app.route("/api/search", buildSearchRouter(db, env));
  app.route("/api/summarization-runs", buildSummarizationRunsRouter(db, env));
  app.route("/mcp", buildMcpRouter(db, env));
  app.use("*", buildStaticSpa(opts.webDist));
  app.onError((err, c) => {
    console.error("server error", err);
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
};
