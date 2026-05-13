// AI-generated. See PROMPT.md for the prompts and model used.

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, buildRequireAuth } from "../auth/middleware.js";
import type { DbClient } from "../db/client.js";
import { sessions, summarizationRuns } from "../db/schema.js";
import type { Env } from "../env.js";

const listQuery = z.object({
  since: z.string().datetime().optional(),
  status: z.enum(["ok", "failed"]).optional(),
  session_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const statsQuery = z.object({
  since: z.string().datetime().optional(),
  since_days: z.coerce.number().int().min(1).max(365).optional(),
});

const resolveSince = (since: string | undefined, sinceDays: number | undefined): Date | null => {
  if (since) return new Date(since);
  if (sinceDays !== undefined) {
    const d = new Date();
    d.setDate(d.getDate() - sinceDays);
    return d;
  }
  return null;
};

export const buildSummarizationRunsRouter = (
  db: DbClient,
  env: Env,
): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use("*", buildRequireAuth(env));

  router.get("/", async (c) => {
    const user = c.get("user");
    const parsed = listQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const q = parsed.data;

    const filters = [eq(sessions.userId, user.id)];
    if (q.since) filters.push(gte(summarizationRuns.startedAt, new Date(q.since)));
    if (q.status) filters.push(eq(summarizationRuns.status, q.status));
    if (q.session_id) filters.push(eq(summarizationRuns.sessionId, q.session_id));

    const rows = await db
      .select({
        id: summarizationRuns.id,
        session_id: summarizationRuns.sessionId,
        attempt: summarizationRuns.attempt,
        status: summarizationRuns.status,
        started_at: summarizationRuns.startedAt,
        ended_at: summarizationRuns.endedAt,
        duration_ms: summarizationRuns.durationMs,
        duration_api_ms: summarizationRuns.durationApiMs,
        claude_model: summarizationRuns.claudeModel,
        stop_reason: summarizationRuns.stopReason,
        num_turns: summarizationRuns.numTurns,
        input_tokens: summarizationRuns.inputTokens,
        output_tokens: summarizationRuns.outputTokens,
        cache_creation_tokens: summarizationRuns.cacheCreationTokens,
        cache_read_tokens: summarizationRuns.cacheReadTokens,
        total_cost_usd: summarizationRuns.totalCostUsd,
        prompt_chars: summarizationRuns.promptChars,
        truncated: summarizationRuns.truncated,
        error: summarizationRuns.error,
      })
      .from(summarizationRuns)
      .innerJoin(sessions, eq(sessions.id, summarizationRuns.sessionId))
      .where(and(...filters))
      .orderBy(desc(summarizationRuns.startedAt))
      .limit(q.limit);

    return c.json({ runs: rows });
  });

  router.get("/stats", async (c) => {
    const user = c.get("user");
    const parsed = statsQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const sinceDate = resolveSince(parsed.data.since, parsed.data.since_days);

    const filters = [eq(sessions.userId, user.id)];
    if (sinceDate) filters.push(gte(summarizationRuns.startedAt, sinceDate));

    const aggRows = await db
      .select({
        calls: sql<number>`count(*)::int`,
        successes: sql<number>`count(*) FILTER (WHERE ${summarizationRuns.status} = 'ok')::int`,
        failures: sql<number>`count(*) FILTER (WHERE ${summarizationRuns.status} = 'failed')::int`,
        retries: sql<number>`count(*) FILTER (WHERE ${summarizationRuns.attempt} > 1)::int`,
        input_tokens: sql<number>`coalesce(sum(${summarizationRuns.inputTokens}), 0)::bigint`,
        output_tokens: sql<number>`coalesce(sum(${summarizationRuns.outputTokens}), 0)::bigint`,
        cache_creation_tokens: sql<number>`coalesce(sum(${summarizationRuns.cacheCreationTokens}), 0)::bigint`,
        cache_read_tokens: sql<number>`coalesce(sum(${summarizationRuns.cacheReadTokens}), 0)::bigint`,
        total_cost_usd: sql<string>`coalesce(sum(${summarizationRuns.totalCostUsd}), 0)::text`,
        avg_duration_ms: sql<number | null>`avg(${summarizationRuns.durationMs})::int`,
        p95_duration_ms: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${summarizationRuns.durationMs})::int`,
      })
      .from(summarizationRuns)
      .innerJoin(sessions, eq(sessions.id, summarizationRuns.sessionId))
      .where(and(...filters));

    const agg = aggRows[0];
    return c.json({
      since: sinceDate?.toISOString() ?? null,
      ...agg,
    });
  });

  return router;
};
