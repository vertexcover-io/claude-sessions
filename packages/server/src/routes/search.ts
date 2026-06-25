// AI-generated. See PROMPT.md for the prompts and model used.

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, buildRequireAuth } from "../auth/middleware.js";
import type { DbClient } from "../db/client.js";
import { repos, sessions, summaries, users } from "../db/schema.js";
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
  user: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const buildSearchRouter = (db: DbClient, env: Env): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use("*", buildRequireAuth(env));

  /**
   * GET /api/search/facets — distinct filter values across ALL sessions
   * (org-wide, private excluded). Powers the dropdowns / chips on the search
   * and home pages so users pick from real values instead of typing free text.
   */
  router.get("/facets", async (c) => {
    const notPrivate = eq(sessions.isPrivate, false);

    const repoRows = await db
      .select({
        canonical_url: repos.canonicalUrl,
        display_name: repos.displayName,
      })
      .from(repos)
      .innerJoin(sessions, eq(sessions.repoId, repos.id))
      .where(notPrivate)
      .groupBy(repos.canonicalUrl, repos.displayName)
      .orderBy(repos.canonicalUrl);

    const branchRows = await db
      .select({ branch: sessions.branch })
      .from(sessions)
      .where(and(notPrivate, isNotNull(sessions.branch)))
      .groupBy(sessions.branch)
      .orderBy(sessions.branch);

    const modelRows = await db
      .select({ model: sessions.model })
      .from(sessions)
      .where(and(notPrivate, isNotNull(sessions.model)))
      .groupBy(sessions.model)
      .orderBy(sessions.model);

    const agentRows = await db
      .select({ agent: sessions.agent })
      .from(sessions)
      .where(notPrivate)
      .groupBy(sessions.agent)
      .orderBy(sessions.agent);

    const userRows = await db
      .select({
        github_login: users.githubLogin,
        avatar_url: users.avatarUrl,
        count: sql<number>`count(${sessions.id})::int`,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(notPrivate, isNotNull(users.githubLogin)))
      .groupBy(users.githubLogin, users.avatarUrl)
      .orderBy(desc(sql`count(${sessions.id})`));

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
          WHERE ${sessions.isPrivate} = false
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
      users: userRows
        .filter(
          (r): r is { github_login: string; avatar_url: string | null; count: number } =>
            r.github_login !== null,
        )
        .map((r) => ({
          github_login: r.github_login,
          avatar_url: r.avatar_url,
          count: r.count,
        })),
      tags: tagRows.map((r) => r.tag),
    });
  });

  router.get("/", async (c) => {
    const raw = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsed = SearchQuery.safeParse(raw);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const params = parsed.data;

    const result = await searchInternal(db, params.q, {
      ...(params.repo !== undefined ? { repo: params.repo } : {}),
      ...(params.branch !== undefined ? { branch: params.branch } : {}),
      ...(params.agent !== undefined ? { agent: params.agent } : {}),
      ...(params.model !== undefined ? { model: params.model } : {}),
      ...(params.tag !== undefined ? { tag: params.tag } : {}),
      ...(params.has_pr !== undefined ? { hasPr: params.has_pr } : {}),
      ...(params.since !== undefined ? { since: params.since } : {}),
      ...(params.user !== undefined ? { user: params.user } : {}),
      limit: params.limit,
    });
    return c.json(result);
  });

  return router;
};
