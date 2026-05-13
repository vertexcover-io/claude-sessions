# Phase 3: Summarizer watermark skip + force flag

> **Status:** pending
> **Traces to:** REQ-003, REQ-004, REQ-005, REQ-006, REQ-012, REQ-013, EDGE-003, EDGE-004, EDGE-005

## Overview

Wire the watermark gate into `Summarizer.summarize()`. Add `force: boolean` and `minResumarizeDelta: number` (default 5). After this phase, calling `summarize()` for a session with a fresh `ok` summary at delta < threshold returns the existing summary without invoking `claude -p`.

## Implementation

**Files:**
- Modify: `packages/cli/src/summarizer/index.ts` — class `Summarizer`:
  - Add constructor option `minResumarizeDelta?: number` (default 5). Store on instance.
  - Change `summarize` signature: `summarize(sessionId, jsonlPath, opts?: { force?: boolean }): Promise<SessionSummary>`.
  - **Skip-decision algorithm** (runs after `acquire()`, before invoking `runPipeline`):
    1. If `opts?.force === true` → skip the gate entirely.
    2. Otherwise, call `this.upload.getSession(sessionId)`. If 404, fall through to pipeline (no prior summary).
    3. If `existing.summary?.status === "ok"` AND `existing.summary.summarized_event_count != null`:
       - Read the canonical session: `readSessionSync(jsonlPath)` → `events.length`.
       - `delta = currentCount - existing.summary.summarized_event_count`.
       - If `delta < this.minResumarizeDelta` → return the existing summary as-is (cast to `SessionSummary`; convert nullable strings to empty as needed). No new summarization-run row, no upload.
    4. Otherwise → fall through to pipeline as today.
  - On any error in the skip check (network, parse), log and fall through to pipeline. **Never let the watermark check block summarization.**
- Modify: `packages/cli/src/summarizer/pipeline.ts` — `summarizeAndUpload` already builds the summary; add `summarized_event_count: session.events.length` to the returned `SessionSummary` so it's persisted on every successful run.
- Modify: `packages/cli/src/upload/client.ts` — ensure `uploadSummary` JSON.stringifies the new field (it should already, since the helper takes `unknown` — verify).

**What to test (`packages/cli/src/summarizer/summarizer.test.ts` — extend existing):**
- **REQ-003 / EDGE-003:** Mock UploadClient with `getSession` returning `summary: { status: "ok", summarized_event_count: 20 }`. Stub `readSession` to return a session with 21 events. Call `summarize`. Assert `runPipeline` (injected) is NOT called and the returned summary equals the existing one.
- **REQ-003 / EDGE-004:** Same setup, session with 25 events, delta=5. Assert `runPipeline` IS called.
- **REQ-005 / EDGE-005:** `getSession` returns `summary: { status: "failed" }`. Pipeline is called.
- **REQ-006:** `getSession` returns `summary: { status: "ok", summarized_event_count: null }`. Pipeline is called.
- **REQ-012:** Force=true with status=ok and delta=0 → pipeline IS called.
- **REQ-013:** `new Summarizer({ minResumarizeDelta: 0 })` → delta=1 triggers pipeline; `new Summarizer({ minResumarizeDelta: Infinity })` → delta=1000 still skips (with status=ok and watermark present).
- **REQ-004:** After a successful pipeline run, the uploaded `SessionSummary` payload (captured via spy) includes `summarized_event_count` matching the session's event count.
- **Robustness:** `getSession` rejects with HTTP 500 → pipeline is still called (don't block on error).

**Commit:** `feat(cli): watermark skip in Summarizer to prevent re-summarizing unchanged sessions`

## Done When

- [ ] `Summarizer` constructor accepts `minResumarizeDelta`.
- [ ] `summarize(..., { force: true })` bypasses the gate.
- [ ] All listed test cases pass.
- [ ] Existing summarizer tests still pass.
- [ ] `bun run --filter @claude-sessions/cli test` green.
- [ ] `bun run typecheck` green.
