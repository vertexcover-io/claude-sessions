# Code Review — Pass 1: Distinguish Backfill vs Live Sessions

**Branch:** `feat/backfill-vs-live-sessions`
**Base:** `main`
**Reviewer:** Claude (code-review skill)
**Date:** 2026-05-12

## Verdict

**APPROVE WITH SUGGESTIONS** — all 5 phases land cleanly. No Critical or
Important defects. Tests cover the load-bearing requirements (watermark
skip, force bypass, force CLI-side gate, backfill-vs-live boundary,
round-trip of `summarized_event_count`). All 96 `@claude-sessions/cli`
tests pass.

The implementation matches the design doc's Approach 1 (hard switch +
watermark + opt-in CLI command) faithfully. Architectural invariants are
preserved: summarization stays in the CLI, shared types are added to
`@claude-sessions/core`, the migration is additive and nullable, the
Drizzle schema and SQL stay in sync.

## Critical defects

None.

## Important defects

None.

## Suggestions (nits)

These are non-blocking. Listed in rough priority order.

### S1. `--since` uses file `mtime` as a proxy for `started_at`

`packages/cli/src/commands/summarize.ts:43-48`

`defaultDiscover` always populates `started_at` from `statSync(f.path).mtime`
rather than from the session metadata. The spec phrase is "started_at (or
last event ts when started_at is unavailable)". `mtime` is closer to the
"last event ts" than the actual `started_at`. In practice this means
`--since 2026-05-01` will include long-running sessions that started in
April but had a recent append in May.

This is a semantic deviation but probably an acceptable approximation for
v0 — extracting a true `started_at` from the JSONL requires a header read
and the session metadata's `started_at` isn't currently surfaced by
`readSessionMeta`. Worth a TODO comment or a follow-up issue rather than
a fix in this PR.

### S2. `needsSummarize` swallows all errors as "include"

`packages/cli/src/commands/summarize.ts:82-96`

The `catch` returns `{ include: true }` for any failure of
`client.getSession`. Comment justifies this as "be tolerant — opt to
summarize rather than silently skip". The risk: if the server is down
during `summarize --all`, the user confirms a count of N (everything is
"included") and the CLI then attempts N pipeline runs, each of which
will then also fail at upload. Not catastrophic — `claude -p` still gets
called per session, burning quota on sessions that may already have
`status=ok`.

Two reasonable refinements (not required for this PR):
- Distinguish HTTP 404 (truly include) from network/5xx (warn and
  default to `false` to avoid quota burn).
- Print a `"warning: N sessions could not be checked"` line above the
  prompt so the user knows why the count looks high.

### S3. Pluralization in the confirmation prompt

`packages/cli/src/commands/summarize.ts:170`

`"This will summarize 1 sessions"` reads oddly when N=1. The spec text
uses `<N> sessions` literally so this matches the spec verbatim, but a
one-line `${n === 1 ? "session" : "sessions"}` improves UX. Not worth
holding the PR.

### S4. Returned skip-summary uses `model: "unknown"` and coerces null fields to `""`

`packages/cli/src/summarizer/index.ts:142-157`

When the watermark skip returns the prior summary, the CLI synthesizes a
`SessionSummary` from the `SessionDetailSummary` it pulled from the server.
The server response doesn't carry `model`, so the skip-return uses
`"unknown"`; nullable string fields become `""`. The watcher's
`onEnded` callback awaits and discards the returned summary, so nothing
in production currently inspects these fields. Worth a quick scan of
downstream consumers if the return value ever becomes user-visible.

### S5. `0004_summarized_event_count.sql` is not idempotent

`packages/server/src/db/migrations/0004_summarized_event_count.sql`

`ALTER TABLE summaries ADD COLUMN summarized_event_count integer NULL`
will error on re-run. This is consistent with the existing migration
convention in this repo (raw SQL, no `IF NOT EXISTS`), so flagging only
for awareness — no change required.

### S6. Test note: `summarizer.test.ts` "getSession rejects → pipeline still runs" tests an `HttpError(500)` path

`packages/cli/src/summarizer/summarizer.test.ts:386-401`

Good coverage. Worth adding a parallel test case for a thrown
non-`HttpError` (e.g. network error / `TypeError`) to lock in that the
generic `catch` in `checkWatermarkSkip` also falls through to the
pipeline. Cheap to add, increases confidence that no error path silently
skips summarization.

## Files changed during fix

None — verdict is APPROVE WITH SUGGESTIONS, no fixes applied.

## Final test/typecheck/lint status

- `bun run --filter @claude-sessions/cli test` — **PASS**: 20 files, 96
  tests, 0 failures (Duration: 2.16s).
- `bun run typecheck` and `bun run lint` not re-run since no fixes were
  applied; baseline is captured in `docs/spec/distinguish-backfill-live/baseline.json`.

## Spec coverage map

| Requirement | Implementation site | Test site | Status |
|---|---|---|---|
| REQ-001 (catch-up no end-detect) | `chokidar.ts:74` | `watcher-backfill-live.test.ts:86` | OK |
| REQ-002 (live add/change arms) | `chokidar.ts:84-89` | `watcher-backfill-live.test.ts:129` | OK |
| REQ-003 (skip when delta < N) | `summarizer/index.ts:130-164` | `summarizer.test.ts` (REQ-003) | OK |
| REQ-004 (upload includes count) | `pipeline.ts:108` | `summarizer.test.ts` (REQ-004) | OK |
| REQ-005 (failed → re-run) | `summarizer/index.ts:137` | `summarizer.test.ts` (REQ-005) | OK |
| REQ-006 (ok+null watermark → re-run) | `summarizer/index.ts:137` | `summarizer.test.ts` (REQ-006) | OK |
| REQ-007 (server column + round-trip) | `schema.ts:136`, `sessions.ts:347/362/540` | `sessions.test.ts` round-trip | OK |
| REQ-008 (single-id command) | `commands/summarize.ts:130-145` | `summarize.test.ts` REQ-008 | OK |
| REQ-009 (--all confirmation) | `commands/summarize.ts:160-176` | `summarize.test.ts` REQ-009 + EDGE-006/008 | OK |
| REQ-010 (--all --force) | `commands/summarize.ts:156-158, 182` | `summarize.test.ts` REQ-010 | OK |
| REQ-011 (--since filter) | `commands/summarize.ts:149-154` | `summarize.test.ts` REQ-011 | OK (see S1) |
| REQ-012 (force bypasses gate) | `summarizer/index.ts:173` | `summarizer.test.ts` REQ-012 | OK |
| REQ-013 (configurable delta) | `summarizer/index.ts:122` | `summarizer.test.ts` REQ-013 | OK |
| REQ-014 (typed optional field) | `core/types.ts:166` | typecheck | OK |
| EDGE-009 (per-session failures) | `commands/summarize.ts:178-190` | `summarize.test.ts` EDGE-009 | OK |
| EDGE-010 (legacy NULL row) | nullable column + REQ-006 path | `sessions.test.ts` null round-trip | OK |
| EDGE-011 (debounce two changes) | unchanged end-detect | `watcher-backfill-live.test.ts` EDGE-011 | OK |
| EDGE-012 (usage error) | `commands/summarize.ts:118-123` | `summarize.test.ts` EDGE-012 | OK |
| EDGE-014 (empty discover) | `chokidar.ts:77` | `watcher-backfill-live.test.ts` EDGE-014 | OK |
