// AI-generated. See PROMPT.md for the prompts and model used.

import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { loadEnv } from "./env.js";

const env = loadEnv();

if (env.NODE_ENV !== "test") {
  const applied = await runMigrations(env.DATABASE_URL);
  if (applied.length > 0) {
    console.log(`migrations applied: ${applied.join(", ")}`);
  }
}

const webDist = process.env.WEB_DIST;
const { db } = createDb(env.DATABASE_URL);
const app = buildApp(db, env, webDist ? { webDist } : {});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});
