# Phase 1: Server schema + migration + route round-trip

> **Status:** pending
> **Traces to:** REQ-007, REQ-014 (server side), EDGE-010

## Overview

Add a nullable `summarized_event_count` column to the `summaries` table. Extend the POST /sessions/:id/summary handler to persist it, and extend GET /sessions/:id to return it inside the embedded `summary` object.

Server-only. No CLI changes. After this phase, the data plane supports the watermark; nothing reads it yet.

## Implementation

**Files:**
- Modify: `packages/server/src/db/schema.ts` — add `summarizedEventCount: integer("summarized_event_count")` to the `summaries` table (nullable, no default).
- Create: `packages/server/src/db/migrations/0004_summarized_event_count.sql` — `ALTER TABLE summaries ADD COLUMN summarized_event_count integer NULL;`. Idempotent guard with `IF NOT EXISTS` is fine but not required (migrations are run once).
- Modify: `packages/server/src/routes/sessions.ts`:
  - Extend `summarySchema` (line 22): add `summarized_event_count: z.number().int().nonnegative().optional()`.
  - Extend the `POST /:id/summary` insert + `onConflictDoUpdate` set blocks to write `summarizedEventCount: body.summarized_event_count ?? null`.
  - Extend the `GET /:id` response (line 528) — add `summarized_event_count: summary.summarizedEventCount ?? null` to the returned `summary` object.
- Test: `packages/server/src/routes/sessions.test.ts` — extend the existing summary round-trip test (or add one if missing). Verify POST→GET preserves the value, and that omitting it yields `null` on read.

**Pattern to follow:** the existing `name` PATCH and the prior `0002_session_commits.sql` migration.

**What to test:**
- Round-trip: POST `summary` with `summarized_event_count: 42` → GET returns `summary.summarized_event_count === 42`.
- Backwards-compat: POST without the field → GET returns `summary.summarized_event_count === null` (or omitted; either is acceptable as long as it's strictly checked in tests).
- Schema migration: column exists, is nullable. (Server integration tests under testcontainers may be env-blocked — add the test anyway; it'll skip gracefully.)

**Commit:** `feat(server): summarized_event_count watermark on summaries`

## Done When

- [ ] Migration file exists and matches `schema.ts`.
- [ ] `summarySchema` accepts the optional field.
- [ ] POST persists, GET returns.
- [ ] Server unit tests pass; new round-trip test added (may skip under testcontainers env-block — that's OK).
- [ ] `bun run typecheck` passes for `@claude-sessions/server`.
