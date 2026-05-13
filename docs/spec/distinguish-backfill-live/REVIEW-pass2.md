# Code Review — Pass 2: Distinguish Backfill vs Live Sessions

**Branch:** `feat/backfill-vs-live-sessions`
**Base:** `main`
**Reviewer:** Claude (independent re-review, code-review skill methodology)
**Date:** 2026-05-12

## Verdict

**APPROVE WITH SUGGESTIONS** — concurs with pass 1.

I reviewed `git diff main...HEAD` independently against the spec, the
project CLAUDE.md, and the focus areas the reviewer was asked to probe
(invariant violations, CLI UX surprises, accidental fan-out, mock
quality). I found no Critical or Important defects. Pass 1's
classification holds: the six S-items are non-blocking.

## Independent verification of pass-1 classification

| Pass-1 item | Re-checked | Should this block? |
|---|---|---|
| S1 `--since` uses mtime | `commands/summarize.ts:43-48` | **No.** REQ-011 is "Should" priority and its text already permits "last event ts when started_at is unavailable" — mtime is the closest cheap approximation. Worth a TODO, not a fix. |
| S2 `needsSummarize` errors → include | `commands/summarize.ts:82-96` | **No.** Worst case wastes LLM quota on a transient outage; the user still sees `<N> succeeded, <M> failed` and can re-run. Not a correctness defect. |
| S3 pluralization | `commands/summarize.ts:170` | **No.** Spec text is reproduced verbatim. |
| S4 `model: "unknown"` in skip-return | `summarizer/index.ts:142-157` | **No.** Both call sites that consume the return — `JsonlWatcher.onEnded` (`watcher/chokidar.ts:61-65`) and `summarizeCommand` (`commands/summarize.ts:139, 182`) — discard the returned `SessionSummary`. No user-visible field comes from it today. |
| S5 migration not idempotent | `0004_summarized_event_count.sql` | **No.** Matches existing convention (`0001_init.sql`, `0002_*.sql` likewise lack `IF NOT EXISTS`). |
| S6 add non-HttpError test case | `summarizer/summarizer.test.ts:386-401` | **No.** The generic `catch (err)` in `checkWatermarkSkip` covers all throws; the existing HttpError(500) test exercises that branch. Adding a second case is cheap but unnecessary for confidence. |

## Independent findings (focus areas)

### Architectural invariants — clean

- **Canonical types in `core`:** `SessionSummary.summarized_event_count?: number` correctly added to `packages/core/src/types.ts:166`. The new `SessionDetail` / `SessionDetailSummary` interfaces live in `packages/cli/src/upload/client.ts` — these are HTTP-wire-shape adapters local to the CLI uploader, not canonical domain types, so they belong there. No CLAUDE.md violation.
- **Summarization stays in CLI:** `claude -p` is still only invoked from `cli/src/summarizer/`. The server-side change (`routes/sessions.ts`) is purely DB column round-trip plumbing.
- **Drizzle ↔ SQL kept in sync:** `summarizedEventCount: integer("summarized_event_count")` (schema.ts:136) matches `0004_summarized_event_count.sql`. Nullable in both. CLAUDE.md "kept in sync by hand" satisfied.
- **Redaction:** untouched. The new column is integer; nothing to redact.
- **`event_uuid` dedupe:** untouched.

### CLI UX — no surprises

- Exit codes are unambiguous: `0` success / abort / nothing-to-do, `1` runtime failure (per-session or single-id miss), `2` usage error. Matches EDGE-012.
- "Nothing to do." (no candidates) and "Aborted." (user typed n/EOF) are distinguishable on stdout.
- `--all` requires explicit confirmation; `--yes` is the documented bypass. No silent destructive paths.

### Concurrency — no accidental fan-out

- `summarize --all` iterates `for (const c of candidates) { await summarizer.summarize(...) }` (`commands/summarize.ts:180-188`) — strictly serial. The Summarizer's per-instance semaphore (`inFlight() <= 2`) is therefore irrelevant in this command path; `inFlight` will never exceed 1. Correct as designed.
- `filterByStatus` (`commands/summarize.ts:98-111`) does fan out at `FETCH_CONCURRENCY=8` for `getSession` calls — but those are read-only, idempotent, and don't trigger `claude -p`. Safe.
- Watcher path: end-detect is debounced per-session and `onEnded` calls `summarize(sessionId, path)` with no `force`, so the semaphore + watermark gate naturally bound work.

### Tests — boundaries are appropriate

- `summarizer.test.ts` injects `runPipeline`, `readSessionImpl`, and `getSession` — these are all *collaborators* of the unit under test (`Summarizer.summarize`'s gating logic), not the function under test itself. No anti-pattern.
- `summarize.test.ts` injects `summarizerFactory`, `discover`, stdin/stdout streams. `summarizeCommand` orchestration logic (discovery filter, confirm, batch loop, exit codes) is what's being verified — the right boundary.
- `summarize-watch.test.ts` switches from real timers to a synthetic `add` event via a fake chokidar factory to prove backfill no longer arms end-detect. Solid coverage of REQ-001 vs REQ-002.

### Other spot-checks

- `checkWatermarkSkip` (`summarizer/index.ts:130-164`) reads the full JSONL synchronously while holding the semaphore slot. This is a duplicate read (the pipeline re-parses) but functionally correct and bounded by the semaphore. Acceptable for v0; flag for follow-up if profiling shows it.
- `getSession` 404 on a never-seen session is caught → `null` → pipeline runs. Correct EDGE-002 behavior.
- `currentEventCount = session.events.length` is symmetric with what the pipeline writes (`pipeline.ts:108`), so the watermark comparison is apples-to-apples.

## Critical defects

None.

## Important defects

None.

## Suggestions

The six pass-1 nits stand as written. No additional findings beyond:

### S7 (new, very minor). Synchronous JSONL re-parse inside the watermark gate

`packages/cli/src/summarizer/index.ts:130-164` calls `readSessionImpl(jsonlPath)` (default `readSessionSync`) just to count events for the delta check. The pipeline then re-parses the same file. For very large sessions this doubles parse cost on every gated call. A `countEvents(path)` line-counter (or surfacing event-count from the cached server detail) would avoid it. Not worth blocking — flag for a follow-up.

## Files changed during fix

None — verdict is APPROVE WITH SUGGESTIONS.

## Final test/typecheck/lint status

Pass 1 already ran `bun run --filter @claude-sessions/cli test` (96/96
pass) on the same SHA. No production code was modified in either pass,
so the baseline in `docs/spec/distinguish-backfill-live/baseline.json`
remains authoritative.
