# SPEC: Distinguish Backfill vs Live Sessions

**Source:** docs/spec/distinguish-backfill-live/design.md
**Generated:** 2026-05-12

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When `JsonlWatcher.start()` runs its catch-up pass over pre-existing JSONL files, the watcher shall ingest each file via `consumeFile` without invoking `SessionEndDetector.schedule()`. | After `start()` resolves, `SessionEndDetector.pendingSessions().length === 0` even when N pre-existing JSONLs were discovered. | Must |
| REQ-002 | Event-driven | When chokidar emits an `add` or `change` event for a `.jsonl` path after the listener is installed, the watcher shall ingest the file and call `SessionEndDetector.schedule(sessionId)`. | After firing one synthetic chokidar event, `pendingSessions().length === 1` for that session id. | Must |
| REQ-003 | Event-driven | When `Summarizer.summarize(sessionId, jsonlPath)` is invoked and the server already has a summary with `status === "ok"` and `(currentEventCount - summarized_event_count) < 5`, the summarizer shall NOT execute `claude -p` and shall return the existing summary unchanged. | The injected `runClaude`/`runPipeline` is never called; return value equals the previously stored summary; no new summarization-run row recorded. | Must |
| REQ-004 | Event-driven | When `Summarizer.summarize` proceeds with a successful pipeline run, the uploaded `SessionSummary` payload shall include `summarized_event_count` equal to `canonicalSession.events.length` at the time of summarization. | `UploadClient.uploadSummary` is called with a payload whose `summarized_event_count` matches the count from the parsed JSONL. | Must |
| REQ-005 | Unwanted | If the existing summary has `status === "failed"` (or any non-`"ok"` value), then `Summarizer.summarize` shall NOT skip and shall execute the pipeline. | With a stored failed summary, invoking `summarize` triggers `runClaude` exactly once. | Must |
| REQ-006 | Unwanted | If the existing summary has `status === "ok"` but `summarized_event_count` is null/undefined, then `Summarizer.summarize` shall NOT skip and shall execute the pipeline. | With a stored ok summary lacking watermark, `runClaude` is invoked. | Must |
| REQ-007 | Ubiquitous | The `summaries` table shall include a nullable `summarized_event_count` integer column, persisted by `POST /api/sessions/:id/summary` and returned by `GET /api/sessions/:id` inside the embedded summary object. | A round-trip POST→GET preserves `summarized_event_count`; the column is nullable in DDL; existing rows without the field continue to load. | Must |
| REQ-008 | Event-driven | When the user runs `claude-sessions summarize <session-id>`, the CLI shall locate the JSONL via existing discovery, instantiate the same `Summarizer` used by `watch`, and invoke `summarize(id, jsonlPath)` exactly once. | Exit code `0` on success; one summarize call recorded; failure exits non-zero with the error printed to stderr. | Must |
| REQ-009 | Event-driven | When the user runs `claude-sessions summarize --all`, the CLI shall enumerate every discoverable session that lacks an `ok` summary, print `"This will summarize <N> sessions. Estimated cost: ~$<X>. Proceed? (y/N)"`, and proceed only on `y`/`Y` confirmation (or when `--yes` is passed). | With N=0 the command exits with `"Nothing to do."` and code `0`; with N>0 stdin `"n\n"` aborts with code `0` and zero summarize calls; `--yes` skips the prompt entirely. | Must |
| REQ-010 | Event-driven | When the user runs `claude-sessions summarize --all --force`, the CLI shall include sessions that already have an `ok` summary and shall pass a flag through `summarize` that bypasses the watermark skip rule. | With one already-ok session and `--all --force --yes`, `runClaude` is invoked for that session. | Must |
| REQ-011 | Event-driven | When the user runs `claude-sessions summarize --all --since <ISO-8601>`, the CLI shall include only sessions whose `started_at` (or last event ts when started_at is unavailable) is on or after the given timestamp. | Sessions with `started_at < since` are excluded from the candidate count. | Should |
| REQ-012 | Event-driven | When `Summarizer.summarize` is called with `force: true`, the summarizer shall execute the pipeline regardless of any existing summary or watermark. | With an ok summary at delta=0 and `force: true`, `runClaude` is invoked. | Must |
| REQ-013 | Ubiquitous | The `Summarizer` constructor shall accept an optional `minResumarizeDelta: number` (default 5) that controls the watermark skip threshold. | Setting `minResumarizeDelta: 0` causes any new event to trigger re-summarization; setting `Infinity` causes only failed/missing summaries to trigger. | Should |
| REQ-014 | Ubiquitous | `SessionSummary` (in `@claude-sessions/core`) shall expose `summarized_event_count?: number` as a typed optional field. | `tsc --noEmit` passes across all packages with the field referenced; existing producers compile without changes (field is optional). | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Watcher starts in a folder with 90 pre-existing JSONLs, no live activity for 60+ seconds. | Zero `claude -p` invocations occur; all 90 sessions are ingested into the DB; `pendingSessions().length === 0`. | REQ-001 |
| EDGE-002 | Watcher running; user resumes a backfill session that has no summary row. The chokidar `change` event fires. | After 60 s silence, `Summarizer.summarize` runs; since no summary exists, the pipeline executes and uploads with `summarized_event_count = currentCount`. | REQ-002, REQ-006 |
| EDGE-003 | Session previously summarized at watermark=20; one new event arrives (count=21). | After 60 s silence, summarizer fetches existing summary, computes delta=1 (< 5), skips pipeline, returns prior summary. No new summarization-run row. | REQ-003 |
| EDGE-004 | Session previously summarized at watermark=20; five new events arrive (count=25). | After 60 s silence, delta=5 satisfies `>= 5`, pipeline executes and uploads new summary with `summarized_event_count = 25`. | REQ-003, REQ-004 |
| EDGE-005 | Session has prior summary with `status: "failed"` and `summarized_event_count: null`. New event arrives. | Pipeline executes regardless of delta because failed status disables the skip gate. | REQ-005 |
| EDGE-006 | `summarize --all` invoked on a folder with zero candidate sessions (everything already has ok summary). | Prints `"Nothing to do."` and exits with code `0`; no confirmation prompt; no summarize calls. | REQ-009 |
| EDGE-007 | `summarize <id>` invoked for a session id that does not exist in local discovery. | Exits with code `1` and prints `"Session not found: <id>"` to stderr; zero summarize calls. | REQ-008 |
| EDGE-008 | `summarize --all` user types `"n"` at the confirmation prompt. | Prints `"Aborted."` and exits with code `0`; zero summarize calls. | REQ-009 |
| EDGE-009 | `summarize --all` runs against 50 sessions; the 10th one fails with a non-retryable HTTP error. | Failed session is logged; remaining 40 continue to be processed; exit code is `1` if any session failed, `0` otherwise. The summary reports `<N> succeeded, <M> failed`. | REQ-008, REQ-009 |
| EDGE-010 | Existing rows in `summaries` table predate the migration and have `summarized_event_count = NULL`. | The new column accepts NULL; reads return undefined for the field; the skip rule treats undefined as "no watermark → re-summarize" (REQ-006). | REQ-007, REQ-006 |
| EDGE-011 | Two `change` events fire for the same session within 60 s. | End-detect timer resets on each (existing behavior); exactly one `summarize` call after silence. | REQ-002 |
| EDGE-012 | `claude-sessions summarize` with no positional arg AND no `--all`. | Prints usage to stderr and exits with code `2` (CLI usage error). Zero summarize calls. | REQ-008, REQ-009 |
| EDGE-013 | `summarize --all --force` against 90 sessions; user confirms. | All 90 are processed regardless of existing summary state. Each upload includes a fresh `summarized_event_count`. | REQ-010, REQ-012 |
| EDGE-014 | `start()` discovers 0 files; chokidar listener still installs on parent dirs (existing behavior preserved). | No regression — watcher waits for `add` events; subsequent `add` of a new JSONL triggers REQ-002 path. | REQ-002 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | `JsonlWatcher` test with stubbed chokidar + multiple pre-existing files. |
| REQ-002 | Yes | No | No | No | Same harness, fire synthetic `add`/`change`. |
| REQ-003 | Yes | No | No | No | Inject a `runPipeline` spy; pre-seed UploadClient with prior summary. |
| REQ-004 | Yes | No | No | No | Assert `uploadSummary` payload contains the field. |
| REQ-005 | Yes | No | No | No | Pre-seed UploadClient with `status: "failed"`. |
| REQ-006 | Yes | No | No | No | Pre-seed UploadClient with `status: "ok"` but no watermark. |
| REQ-007 | Yes | Yes | No | No | Unit: schema type. Integration: SQL migration applies cleanly; round-trip POST→GET. Server tests gated on Docker availability. |
| REQ-008 | Yes | No | No | No | New `commands/summarize.ts` test using mock UploadClient + injected discover. |
| REQ-009 | Yes | No | No | No | Stub stdin for confirmation; assert prompt text and abort path. |
| REQ-010 | Yes | No | No | No | `--force` exercise. |
| REQ-011 | Yes | No | No | No | `--since` filter. |
| REQ-012 | Yes | No | No | No | `Summarizer.summarize(..., { force: true })`. |
| REQ-013 | Yes | No | No | No | Constructor option propagation. |
| REQ-014 | Yes | No | No | No | Type-check + a trivial assignment test. |
| EDGE-001 | Yes | No | No | No | Same as REQ-001 with N=90. |
| EDGE-002 | Yes | No | No | No | Cover backfill→live promotion. |
| EDGE-003 | Yes | No | No | No | Delta=1 skip case. |
| EDGE-004 | Yes | No | No | No | Delta=5 trigger case. |
| EDGE-005 | Yes | No | No | No | Failed-summary recovery. |
| EDGE-006 | Yes | No | No | No | Empty `--all` candidates. |
| EDGE-007 | Yes | No | No | No | Bad id error path. |
| EDGE-008 | Yes | No | No | No | Confirmation `n` aborts. |
| EDGE-009 | Yes | No | No | No | Per-session failures don't halt the batch. |
| EDGE-010 | Yes | Yes | No | No | Migration applied to a row with NULL watermark loads OK. Server test gated on Docker. |
| EDGE-011 | Yes | No | No | No | Existing `end-detect` test pattern (fake timers). |
| EDGE-012 | Yes | No | No | No | Argv parser usage. |
| EDGE-013 | Yes | No | No | No | `--force` over many candidates. |
| EDGE-014 | Yes | No | No | No | Empty-folder regression. |

## Verification Scenarios

(For functional-verify; runs the actual CLI binary against a fixture folder and the local server.)

- **VS-1: Backfill ingestion has zero LLM cost.**
  Given a folder with 5 pre-seeded JSONLs and a fresh DB, when `claude-sessions watch` is started and runs for 90 seconds with no live writes, then the server reports 5 sessions ingested and 0 summarization-run rows.
- **VS-2: Live event triggers summarization.**
  Given a running watcher with no existing sessions, when a JSONL is created and grows by ≥ 5 events, then exactly 1 summarization-run row exists with `status="ok"` and `summarized_event_count` equal to the line count.
- **VS-3: Re-summarization respects watermark.**
  Given a session summarized at count=10, when 3 events are appended, then no new `claude -p` call is made; when 5 more are appended (count=18), then exactly one new summarize call occurs with `summarized_event_count=18`.
- **VS-4: `summarize --all` confirmation.**
  Given 3 sessions with no summary, when `claude-sessions summarize --all` is run with stdin `"n\n"`, then exit code is 0, the prompt text appears, and `summarization_runs` table count is unchanged.
- **VS-5: `summarize --all --yes`.**
  Same setup as VS-4, with `--yes`, exit code 0, all 3 sessions get summarized.

## Out of Scope

- **Web UI button to trigger summarization.** Deferred to a follow-up PR. Web continues to render whatever summary state exists.
- **Server-side summarization queue or scheduling.** Architectural invariant: `claude -p` only ever runs in the CLI.
- **Daily/monthly cost cap.** Useful future safety net; not part of this PR.
- **Per-session cost prediction beyond a static estimate.** `summarize --all` shows `~$0.05 × N` as a placeholder; refinement deferred.
- **Migration of existing rows to populate `summarized_event_count` retroactively.** Not needed; nullable column + REQ-006 handles legacy rows correctly.
- **Re-summarization in the `sync` command.** `sync` does not wire the summarizer today and won't start.
- **Multiple concurrent watcher processes.** Server upsert handles last-write-wins; we don't add a CLI-side lock.
