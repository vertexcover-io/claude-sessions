// AI-generated. See PROMPT.md for the prompts and model used.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { and, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { verifyToken } from "../auth/jwt.js";
import type { DbClient } from "../db/client.js";
import { sessions, summarizationRuns } from "../db/schema.js";
import type { Env } from "../env.js";
import { searchInternal } from "../lib/search-internal.js";
import {
  findSessionsForPr,
  getSessionForUser,
  listRecent,
  setSessionPrivate,
} from "../lib/sessions-internal.js";

const buildMcpServer = (db: DbClient, userId: string): McpServer => {
  const server = new McpServer({ name: "claude-sessions", version: "0.1.0" });

  server.tool(
    "search_sessions",
    "Hybrid FTS + vector search across all (non-private) sessions in the org.",
    {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({ query, limit }) => {
      const result = await searchInternal(db, query, {
        limit: limit ?? 10,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    "get_session",
    "Fetch a single session by id.",
    { session_id: z.string() },
    async ({ session_id }) => {
      const detail = await getSessionForUser(db, userId, session_id);
      if (!detail) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "session not found" }) }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(detail) }] };
    },
  );

  server.tool(
    "find_sessions_for_pr",
    "Find sessions whose summary references the given PR URL.",
    { pr_url: z.string() },
    async ({ pr_url }) => {
      const sessions = await findSessionsForPr(db, userId, pr_url);
      return { content: [{ type: "text", text: JSON.stringify(sessions) }] };
    },
  );

  server.tool(
    "get_my_recent_sessions",
    "List the most recent (non-private) sessions across the org, optionally filtered.",
    {
      limit: z.number().int().min(1).max(50).optional(),
      agent: z.string().optional(),
      repo: z.string().optional(),
    },
    async (args) => {
      const opts: { limit?: number; agent?: string; repo?: string } = {};
      if (args.limit !== undefined) opts.limit = args.limit;
      if (args.agent !== undefined) opts.agent = args.agent;
      if (args.repo !== undefined) opts.repo = args.repo;
      const result = await listRecent(db, userId, opts);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    "get_summarization_stats",
    "Aggregate stats over `claude -p` summarization runs (calls, cost, retries, failures). Optional since_days filter (default: all time).",
    {
      since_days: z.number().int().min(1).max(365).optional(),
    },
    async ({ since_days }) => {
      const filters = [eq(sessions.isPrivate, false)];
      if (since_days !== undefined) {
        const since = new Date();
        since.setDate(since.getDate() - since_days);
        filters.push(gte(summarizationRuns.startedAt, since));
      }
      const rows = await db
        .select({
          calls: sql<number>`count(*)::int`,
          successes: sql<number>`count(*) FILTER (WHERE ${summarizationRuns.status} = 'ok')::int`,
          failures: sql<number>`count(*) FILTER (WHERE ${summarizationRuns.status} = 'failed')::int`,
          retries: sql<number>`count(*) FILTER (WHERE ${summarizationRuns.attempt} > 1)::int`,
          input_tokens: sql<string>`coalesce(sum(${summarizationRuns.inputTokens}), 0)::text`,
          output_tokens: sql<string>`coalesce(sum(${summarizationRuns.outputTokens}), 0)::text`,
          cache_creation_tokens: sql<string>`coalesce(sum(${summarizationRuns.cacheCreationTokens}), 0)::text`,
          cache_read_tokens: sql<string>`coalesce(sum(${summarizationRuns.cacheReadTokens}), 0)::text`,
          total_cost_usd: sql<string>`coalesce(sum(${summarizationRuns.totalCostUsd}), 0)::text`,
          avg_duration_ms: sql<number | null>`avg(${summarizationRuns.durationMs})::int`,
          p95_duration_ms: sql<
            number | null
          >`percentile_cont(0.95) within group (order by ${summarizationRuns.durationMs})::int`,
        })
        .from(summarizationRuns)
        .innerJoin(sessions, eq(sessions.id, summarizationRuns.sessionId))
        .where(and(...filters));
      return { content: [{ type: "text", text: JSON.stringify(rows[0] ?? {}) }] };
    },
  );

  server.tool(
    "mark_current_session_private",
    "Withdraw a session from the cloud (privacy).",
    { session_id: z.string() },
    async ({ session_id }) => {
      await setSessionPrivate(db, userId, session_id, true);
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  server.tool(
    "mark_current_session_public",
    "Re-publish a previously-private session.",
    { session_id: z.string() },
    async ({ session_id }) => {
      await setSessionPrivate(db, userId, session_id, false);
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  return server;
};

export const buildMcpRouter = (db: DbClient, env: Env): Hono => {
  const router = new Hono();

  const handle = async (req: Request, token: string): Promise<Response> => {
    let userId: string;
    try {
      const payload = await verifyToken(token, env.JWT_SECRET);
      if (payload.aud !== "mcp") return new Response("unauthorized", { status: 401 });
      userId = payload.sub;
    } catch {
      return new Response("unauthorized", { status: 401 });
    }

    const server = buildMcpServer(db, userId);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    // Schedule cleanup after the response body is consumed.
    res.headers.append("x-mcp-server", "claude-sessions");
    return res;
  };

  router.all("/:token", async (c) => {
    return handle(c.req.raw, c.req.param("token"));
  });

  return router;
};
