// AI-generated. See PROMPT.md for the prompts and model used.

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, buildRequireAuth } from "../auth/middleware.js";
import type { DbClient } from "../db/client.js";
import { repos, sessions, summaries } from "../db/schema.js";
import type { Env } from "../env.js";
import { searchInternal } from "../lib/search-internal.js";

const SearchQuery = z.object({
  // Empty `q` is allowed: filter-only browsing falls through to a
  // recency-ordered list of sessions matching the filters. The internal
  // search routine switches strategies based on whether `q` is non-empty.
  q: z.string().optional().default(""),
  repo: z.string().optional(),
  branch: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  tag: z.string().optional(),
  has_pr: z.coerce.boolean().optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const buildSearchRouter = (db: DbClient, env: Env): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use("*", buildRequireAuth(env));

  /**
   * GET /api/search/facets — distinct filter values across the user's
   * sessions. Powers the dropdowns / chips on the search page so users
   * pick from real values instead of typing free text.
   */
  router.get("/facets", async (c) => {
    const user = c.get("user");

    const repoRows = await db
      .select({
        canonical_url: repos.canonicalUrl,
        display_name: repos.displayName,
      })
      .from(repos)
      .innerJoin(sessions, eq(sessions.repoId, repos.id))
      .where(eq(sessions.userId, user.id))
      .groupBy(repos.canonicalUrl, repos.displayName)
      .orderBy(repos.canonicalUrl);

    const branchRows = await db
      .select({ branch: sessions.branch })
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), isNotNull(sessions.branch)))
      .groupBy(sessions.branch)
      .orderBy(sessions.branch);

    const modelRows = await db
      .select({ model: sessions.model })
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), isNotNull(sessions.model)))
      .groupBy(sessions.model)
      .orderBy(sessions.model);

    const agentRows = await db
      .select({ agent: sessions.agent })
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .groupBy(sessions.agent)
      .orderBy(sessions.agent);

    // Flatten the per-session `tags` arrays into a unique sorted list.
    const tagRows = await db
      .select({
        tag: sql<string>`tag_value`,
      })
      .from(
        sql`(
          SELECT DISTINCT unnest(${summaries.tags}) AS tag_value
          FROM ${summaries}
          INNER JOIN ${sessions} ON ${sessions.id} = ${summaries.sessionId}
          WHERE ${sessions.userId} = ${user.id}
        ) AS t`,
      )
      .orderBy(sql`tag_value`);

    return c.json({
      repos: repoRows.map((r) => ({
        canonical_url: r.canonical_url,
        display_name: r.display_name,
      })),
      branches: branchRows.map((r) => r.branch).filter((b): b is string => b !== null),
      models: modelRows.map((r) => r.model).filter((m): m is string => m !== null),
      agents: agentRows.map((r) => r.agent),
      tags: tagRows.map((r) => r.tag),
    });
  });

  router.get("/", async (c) => {
    const user = c.get("user");
    const raw = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsed = SearchQuery.safeParse(raw);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const params = parsed.data;

    const result = await searchInternal(db, user.id, params.q, {
      ...(params.repo !== undefined ? { repo: params.repo } : {}),
      ...(params.branch !== undefined ? { branch: params.branch } : {}),
      ...(params.agent !== undefined ? { agent: params.agent } : {}),
      ...(params.model !== undefined ? { model: params.model } : {}),
      ...(params.tag !== undefined ? { tag: params.tag } : {}),
      ...(params.has_pr !== undefined ? { hasPr: params.has_pr } : {}),
      ...(params.since !== undefined ? { since: params.since } : {}),
      limit: params.limit,
    });
    return c.json(result);
  });

  return router;
};
