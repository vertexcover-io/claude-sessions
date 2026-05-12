# Design: Distinguish Backfill vs Live Sessions

## Problem Statement

When the watcher (`claude-sessions watch`) starts in a folder containing 80–90
historical session JSONLs, every one of them gets summarized via `claude -p`.
Each invocation is a full Anthropic API call — quota is exhausted before any
real work starts. The watcher already has a `Semaphore(2)` cap, but that
limits concurrency, not total volume.

Compounding this: re-running the watcher today **re-summarizes** sessions that
were already summarized in a prior run, because the trigger is "60 s of
silence after a `consumeFile`," which fires unconditionally.

## Context

- **Watcher entry:** `packages/cli/src/watcher/chokidar.ts` — `JsonlWatcher.start()`
  runs a catch-up pass over every existing JSONL, then installs a chokidar
  listener with `ignoreInitial: true`.
- **End detector:** `packages/cli/src/summarizer/end-detect.ts` — per-session
  60 s silence timer; fires `summarizer.summarize()` on expiry.
- **Summarizer:** `packages/cli/src/summarizer/index.ts` — `Semaphore(2)` +
  retry/backoff. No volume cap, no de-dup.
- **Summary table:** `packages/server/src/db/schema.ts` — `summaries` row has
  `{ status: "ok" | "failed", title, summary, ... }`. Server endpoint:
  `POST /api/sessions/:id/summary`.
- **Architectural invariant** (CLAUDE.md): *summarization runs in the CLI, not
  the server.* The server never calls `claude`. We will not violate this.
- **Other CLI commands** (`enable`, `sync`) call `consumeFile` directly without
  wiring the `Summarizer`. They already do not trigger LLM cost. Only
  `watch` does.

## Requirements

### Functional

- **R1.** On `watch` startup, JSONLs that exist *before* the chokidar listener
  is installed (the catch-up pass) MUST be ingested but MUST NOT trigger
  `claude -p`.
- **R2.** JSONLs that chokidar reports via `add` or `change` *after* startup
  MUST trigger end-detect → summarizer as today.
- **R3.** A session that already has a summary MUST NOT be re-summarized
  unless ≥ 5 new events have arrived since the watermark (`summarized_event_count`).
- **R4.** A session whose last summary attempt was `status: "failed"` is NOT
  considered "already summarized" — it remains eligible for re-attempt.
- **R5.** A new CLI command `claude-sessions summarize` lets the user opt
  historical sessions into LLM summarization explicitly:
  - `claude-sessions summarize <session-id>` — single session.
  - `claude-sessions summarize --all` — every session that has no `ok`
    summary yet, with a confirmation prompt showing count + estimated cost.
  - `claude-sessions summarize --all --force` — re-summarize even sessions
    that already have an `ok` summary (debug / manual re-run).
- **R6.** When the user resumes a long-finished session that was previously
  summarized, the next live `change` event MUST cause re-summarization
  (subject to R3's delta ≥ 5 rule). Stale summaries are not acceptable.

### Non-Functional

- **NF1.** No new external dependencies.
- **NF2.** Server change is additive only (one nullable column on `summaries`).
  Existing rows continue to work; an absent watermark is treated as "unknown,
  eligible for re-summarize on next opportunity."
- **NF3.** No CPU-bound work (no full-file hash, no full prompt rebuild) on
  the skip-decision path. Watermark check is a single field comparison.
- **NF4.** The `Summarizer` public API stays backwards-compatible — the
  watermark / skip logic is internal. The new opt-in command instantiates the
  same `Summarizer`.

### Edge Cases

- **EC1.** Watcher restart mid-session: session summarized at `event_count=20`,
  watcher restarts at `count=25`. Catch-up classifies as backfill (no
  schedule). User sends one more message → live `change` → end-detect →
  summarizer sees delta = 6 ≥ 5 → re-summarizes. ✓
- **EC2.** Backfill session never resumed: stays without summary. UI shows
  derived display name. User can opt in via `summarize <id>`.
- **EC3.** Backfill session opted in via `summarize --all`: bypasses live
  classification. Watermark = 0; delta = full count ≥ 5; runs.
- **EC4.** Two `change` events within 60 s: existing end-detect debounce
  resets the timer; one summarize call after silence. Unchanged.
- **EC5.** Failed prior summary: treated as no watermark; eligible. Don't
  starve recovery.
- **EC6.** `summarize --all` on a folder with 90 backfill sessions: command
  prints `"This will summarize N sessions. Estimated cost: ~$X. Proceed? (y/N)"`
  and waits. Confirmation gate prevents accidental quota burn.
- **EC7.** Concurrent `watch` + `summarize <id>`: both go through the same
  `Summarizer` instance is not possible across processes, so both could race
  to write a summary. Server's `POST /api/sessions/:id/summary` is an upsert;
  last write wins. Acceptable — watermark prevents wasted work in the common
  case (one process holds the watermark, the other sees it via API).

## Key Insights

1. **Pre-existing files at watcher start = backfill** is a clean,
   deterministic boundary that doesn't need a knob, doesn't need clock-skew
   handling, and doesn't need to read file contents. The catch-up pass
   already enumerates them — we just need to *not* arm the end-detect
   timer for those.

2. **Resumed sessions naturally promote to live.** When a backfill session
   gets a new chokidar `change` event, the live path fires end-detect.
   The watermark check then decides whether re-summarization is warranted.
   No special "promotion" logic needed.

3. **The watermark is the deduplication primitive.** Without it, "live"
   sessions still cost on every restart. With it, both backfill *and* live
   skip correctly.

4. **The fix is local.** Two files in CLI (`chokidar.ts`, `index.ts`), one
   field in server schema, one new CLI command. No transport changes, no
   web changes.

## Architectural Challenges

### Boundary: catch-up vs live

The catch-up loop and the chokidar `add`/`change` handlers currently funnel
through the same `consumeSafe(path)` method, which always calls
`scheduleEndDetect`. The fix is to give `consumeSafe` an `arm: boolean` flag
(or equivalent) that the catch-up loop sets to `false`.

### Watermark consistency

The watermark lives on the summary row server-side. The CLI must read it
before deciding to skip. Options:

- **A.** Add `summarized_event_count` to the existing `GET /api/sessions/:id`
  response (it already returns the summary) — cheapest.
- **B.** New endpoint `GET /api/sessions/:id/summary-watermark` returning
  just the watermark — single integer, smaller payload but new route.

Choosing **A**: the CLI already reads sessions when it needs them; one extra
field is free, and the absence of a separate route reduces surface area.

### Counting events

`computeDeterministic(session)` returns a `det` object — extend it (or read
directly) to expose the event count. The `CanonicalSession.events.length` is
the canonical source. Both the watermark write (after a successful summary)
and the watermark check (before invoking claude) read from the same source.

## Approaches Considered

### Approach 1 — Hard switch (chosen)

- Catch-up pass: ingest only, never schedule end-detect.
- Live chokidar events: schedule end-detect as today.
- Summarizer skips if `current_count - watermark < 5` and prior status was `ok`.
- New `summarize` CLI command for opt-in.

**Pros:** smallest diff; preserves existing semantics for the live case;
clear mental model ("watcher = live; CLI command = manual").
**Cons:** users with stale summaries from prior runs still need to either
resume the session or run `summarize <id>` to refresh.

### Approach 2 — Mtime-threshold heuristic

Treat any session whose JSONL `mtime` is within the last 30 minutes as live;
older as backfill, regardless of when discovered.

**Pros:** auto-summarizes "recently active but watcher just started" cases.
**Cons:** introduces a knob (threshold), wrong on paused sessions, vulnerable
to clock skew. Doesn't materially help the cost problem because such files
are usually a small minority.

### Approach 3 — Daily budget cap (orthogonal)

Track cumulative cost from `claude -p` envelopes; refuse new summaries when
budget hit.

**Pros:** absolute cost ceiling.
**Cons:** doesn't fix the root cause (we still spend the budget on backfill
before hitting the cap). Worth shipping later as a safety net, not now.

**Decision:** Approach 1. Approach 3 is a future safety net, not a substitute.

## Chosen Approach (High-Level Design)

### Component diagram

```
                 ┌───────────────────────────────┐
   user runs ─►  │  claude-sessions watch        │
                 │                               │
                 │  JsonlWatcher.start()         │
                 │   ├─ catch-up pass            │  consumeFile only
                 │   │   for f in existing:      │  (no end-detect)
                 │   │     consumeSafe(f, false) │
                 │   └─ live: chokidar.on(...)   │  consumeFile +
                 │       consumeSafe(p, true)    │  scheduleEndDetect
                 └───────────────┬───────────────┘
                                 │ silence 60s
                                 ▼
                 ┌───────────────────────────────┐
                 │  Summarizer.summarize()       │
                 │   ├─ fetch summary watermark  │ via GET /api/sessions/:id
                 │   ├─ if status=ok &&          │
                 │   │   current_count - wm < 5  │ skip; return prior summary
                 │   ├─ else run pipeline.ts     │ claude -p + upload
                 │   └─ upload includes          │
                 │       summarized_event_count  │
                 └───────────────────────────────┘

                 ┌───────────────────────────────┐
   user runs ─►  │  claude-sessions summarize    │  bypasses watcher
                 │   <id> | --all [--force]      │  same Summarizer instance
                 │                               │  same watermark logic
                 │   --all → confirm prompt      │  unless --force
                 └───────────────────────────────┘
```

### Data shape changes

**`packages/server/src/db/schema.ts` (and matching migration):**

```ts
summaries: {
  ...existing fields,
  summarized_event_count: integer('summarized_event_count'),  // nullable
}
```

**`packages/core/src/types.ts` (`SessionSummary`):**

```ts
interface SessionSummary {
  ...existing,
  summarized_event_count?: number;
}
```

**`POST /api/sessions/:id/summary`** payload accepts the new field; persisted
verbatim. `GET /api/sessions/:id` returns it inside the embedded summary.

### Skip decision (in `Summarizer.summarize`)

```
fetch existing summary for sessionId
if summary exists AND summary.status == "ok":
    current_count = canonicalSession.events.length
    if current_count - summary.summarized_event_count < 5:
        return summary   // skip, no claude call
run pipeline.ts as today
on success: include summarized_event_count = current_count in upload
```

The fetch is one HTTP GET; cheap relative to a `claude -p` round-trip.

### Catch-up vs live (in `JsonlWatcher`)

```
async start():
    files = discover()
    for f in files:
        await consumeSafe(f, { armEndDetect: false })   // backfill
    install chokidar listener
    on add|change(p):
        consumeSafe(p, { armEndDetect: true })          // live
```

`scheduleEndDetect` is invoked only when `armEndDetect: true`.

### New CLI command

`packages/cli/src/commands/summarize.ts`:

- Args: `<id?>` positional, `--all`, `--since <ISO>`, `--force`, `--yes`.
- Discovers candidate sessions via existing `discover.ts`.
- For `--all`: lists count + estimated cost (`count * avg_cost_per_summary`,
  using a static estimate constant; we already record cost in
  `SummarizationRunPayload` so we could refine over time).
- Prompts `Proceed? (y/N)` unless `--yes`.
- Calls `summarizer.summarize(id, jsonlPath)` for each — same instance, same
  semaphore, same retry, same watermark gate. `--force` bypasses the gate.

## Out of Scope

- **UI button / web trigger.** Deferred to a follow-up; this PR is CLI only.
  Web continues to render whatever summary state exists; sessions without a
  summary already render fine (display_name fallback).
- **Daily budget cap** (Approach 3). Useful future work; not blocking.
- **Cost prediction beyond a static estimate.** A future iteration could
  compute per-session estimates from `prompt.text.length` × token rate.
- **Server-side queue / scheduling.** Architectural invariant says no.

## Open Questions

- **OQ1.** Should the static cost estimate for `summarize --all` be hardcoded
  (e.g. `$0.05/session`) or computed from prior `summarization_runs` rows?
  → Lean hardcoded for now; refine if users complain. Add a TODO.
- **OQ2.** Should `summarize --all` be paginated (process in batches with a
  pause) to make it interruptible? The semaphore + retry already serializes;
  Ctrl-C exits cleanly. Probably not worth it.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration breaks existing summaries | Low | High | Column is nullable; no backfill required. |
| Watermark = 0 for existing rows means everyone gets re-summarized | Medium | Medium | Skip rule requires `status == ok`; rows with no watermark are nullable, so the comparison `null - n` would be NaN — explicitly guard with `if watermark != null`. |
| User runs `summarize --all` accidentally | Medium | High | Confirmation prompt with count + estimate; require `--yes` to skip. |
| Race between watcher and `summarize <id>` for same session | Low | Low | Server upsert; last write wins. Watermark check skips no-op cases. |
| `summarize <id>` for a session that doesn't exist locally | Low | Low | Resolve via `discover.ts`; clean error if not found. |

## Assumptions

- The server's `summaries` table can take an additive column without any
  online-migration concerns (single-user dev DB).
- `POST /api/sessions/:id/summary` will simply ignore unknown fields if a
  client is older — acceptable rolling upgrade behavior.
- `CanonicalSession.events.length` is a stable, deterministic count after
  `readSessionSync`. (It is; the adapter is pure.)

## External Dependencies & Fallback Chain

None — pure-internal feature. No new libraries, no new external APIs.
