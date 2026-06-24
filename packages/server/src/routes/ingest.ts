// AI-generated. See PROMPT.md for the prompts and model used.

import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, buildRequireAuth } from "../auth/middleware.js";
import type { DbClient } from "../db/client.js";
import { findUserRepoAccess, upsertRepo } from "../db/repos.js";
import { events, sessionCommits, sessions } from "../db/schema.js";
import type { Env } from "../env.js";
import { redactDeep } from "../redact.js";

const eventSchema = z.object({
  event_uuid: z.string(),
  parent_uuid: z.string().nullable(),
  ts: z.string().datetime(),
  type: z.enum(["user_msg", "assistant_msg", "tool_use", "summary", "system"]),
  payload: z.unknown(),
});

const commitSchema = z.object({
  sha: z.string().min(7),
  short_sha: z.string().min(4),
  author_name: z.string(),
  author_email: z.string(),
  // git's `%aI` emits strict ISO 8601 with a numeric offset
  // (e.g. `2026-05-10T11:30:45+05:30`), so we must accept offsets,
  // not just Z-suffix UTC.
  authored_at: z.string().datetime({ offset: true }),
  subject: z.string(),
  branch: z.string().nullable(),
  files_changed: z.number().int().nonnegative().nullable(),
  insertions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
});

const ingestSchema = z.object({
  session: z.object({
    id: z.string(),
    agent: z.literal("claude-code"),
    agent_version: z.string(),
    repo: z.object({ canonical_url: z.string(), branch: z.string().nullable() }),
    parent_session_id: z.string().nullable().optional(),
    source_cwd_hint: z.string(),
    started_at: z.string().datetime(),
    ended_at: z.string().datetime(),
    model: z.string().nullable(),
    permission_mode: z.string().nullable(),
    total_input_tokens: z.number().int().nonnegative(),
    total_output_tokens: z.number().int().nonnegative(),
    total_cost_usd: z.number().nonnegative(),
  }),
  events: z.array(eventSchema).max(500),
  commits: z.array(commitSchema).max(500).optional(),
});

export const buildIngestRouter = (db: DbClient, env: Env): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use("*", buildRequireAuth(env));

  router.post("/", async (c) => {
    const user = c.get("user");
    const parsed = ingestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;

    const repo = await upsertRepo(db, body.session.repo.canonical_url);
    const access = await findUserRepoAccess(db, user.id, repo.id);
    if (!access) return c.json({ error: "repo not enabled for user" }, 403);

    const redacted = body.events.map((e) => ({ ...e, payload: redactDeep(e.payload) }));

    const result = await db.transaction(async (tx) => {
      await tx
        .insert(sessions)
        .values({
          id: body.session.id,
          userId: user.id,
          repoId: repo.id,
          agent: body.session.agent,
          agentVersion: body.session.agent_version,
          branch: body.session.repo.branch,
          sourceCwdHint: body.session.source_cwd_hint,
          model: body.session.model,
          permissionMode: body.session.permission_mode,
          parentSessionId: body.session.parent_session_id ?? null,
          startedAt: new Date(body.session.started_at),
          endedAt: new Date(body.session.ended_at),
          totalInputTokens: body.session.total_input_tokens,
          totalOutputTokens: body.session.total_output_tokens,
          totalCostUsd: body.session.total_cost_usd.toString(),
        })
        .onConflictDoUpdate({
          target: sessions.id,
          set: {
            agentVersion: body.session.agent_version,
            branch: body.session.repo.branch,
            sourceCwdHint: body.session.source_cwd_hint,
            model: body.session.model,
            permissionMode: body.session.permission_mode,
            parentSessionId: body.session.parent_session_id ?? null,
            startedAt: new Date(body.session.started_at),
            endedAt: new Date(body.session.ended_at),
            totalInputTokens: body.session.total_input_tokens,
            totalOutputTokens: body.session.total_output_tokens,
            totalCostUsd: body.session.total_cost_usd.toString(),
            updatedAt: sql`now()`,
          },
        });

      let inserted: { eventUuid: string }[] = [];
      if (redacted.length > 0) {
        // Upsert on (session_id, event_uuid). On conflict we refresh the
        // payload + ts so adapter improvements (new canonical fields,
        // structured `data`, fixed timestamps) propagate on resync.
        // Server still de-dupes within a single batch via the unique key.
        inserted = await tx
          .insert(events)
          .values(
            redacted.map((e) => ({
              sessionId: body.session.id,
              eventUuid: e.event_uuid,
              parentUuid: e.parent_uuid,
              ts: new Date(e.ts),
              type: e.type,
              payload: e.payload as object,
            })),
          )
          .onConflictDoUpdate({
            target: [events.sessionId, events.eventUuid],
            set: {
              parentUuid: sql`excluded.parent_uuid`,
              ts: sql`excluded.ts`,
              type: sql`excluded.type`,
              payload: sql`excluded.payload`,
            },
          })
          .returning({ eventUuid: events.eventUuid });
      }
      // Replace any existing commits for this session with the freshly
      // mined set so the CLI re-mining stays authoritative. Cheap because
      // the count is bounded by the session window length.
      let commitsAccepted = 0;
      if (body.commits && body.commits.length > 0) {
        await tx.delete(sessionCommits).where(eq(sessionCommits.sessionId, body.session.id));
        await tx.insert(sessionCommits).values(
          body.commits.map((c) => ({
            sessionId: body.session.id,
            sha: c.sha,
            shortSha: c.short_sha,
            authorName: c.author_name,
            authorEmail: c.author_email,
            authoredAt: new Date(c.authored_at),
            subject: c.subject,
            branch: c.branch,
            filesChanged: c.files_changed,
            insertions: c.insertions,
            deletions: c.deletions,
          })),
        );
        commitsAccepted = body.commits.length;
      }

      return {
        accepted: inserted.length,
        skipped: redacted.length - inserted.length,
        commits_accepted: commitsAccepted,
      };
    });

    return c.json({
      ok: true,
      session_id: body.session.id,
      accepted_events: result.accepted,
      skipped_duplicates: result.skipped,
      commits_accepted: result.commits_accepted,
    });
  });

  return router;
};
