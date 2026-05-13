# Phase 4: Watcher catch-up vs live split

> **Status:** pending
> **Traces to:** REQ-001, REQ-002, EDGE-001, EDGE-002, EDGE-011, EDGE-014

## Overview

Stop the watcher's catch-up pass from arming the end-detect timer. Live `add`/`change` events from chokidar continue to arm it. After this phase, starting `claude-sessions watch` against a folder of pre-existing JSONLs produces zero `claude -p` invocations during the silent window.

## Implementation

**Files:**
- Modify: `packages/cli/src/watcher/chokidar.ts` (`JsonlWatcher`):
  - Change `consumeSafe(path: string)` to `consumeSafe(path: string, opts?: { armEndDetect?: boolean })`. Default `armEndDetect = true` for backwards-compat with any caller that doesn't pass it (none today, but keeps API safe).
  - In `consumeSafe`, gate the `this.scheduleEndDetect(path)` call on `opts.armEndDetect !== false`.
  - In `start()`:
    - Catch-up loop: `await this.consumeSafe(f, { armEndDetect: false })`.
    - chokidar `onChange` handler: `void this.consumeSafe(p, { armEndDetect: true })` (or just leave default).

**What to test (`packages/cli/src/watcher/watcher.test.ts` — likely a new file or extend `summarize-watch.test.ts`):**
- **REQ-001 / EDGE-001:** Build a tmp folder with 5 fake JSONLs (use existing fixtures). Stub `chokidarFactory` to return a fake watcher that NEVER fires events. Stub `discover` to return the 5 files. Inject a `Summarizer` whose `summarize` is a spy. After `start()` resolves and a brief `await Promise.resolve()` flush, assert the summarize spy was called 0 times. Also assert the end-detect's `pendingSessions().length === 0` (expose via the existing detector — or assert indirectly by checking the spy after advancing fake timers past 60s).
- **REQ-002 / EDGE-002:** Same setup, but after `start()`, fire a synthetic `add` event for a 6th file. Advance fake timers by 60s. Assert summarize spy called exactly once with that session id.
- **EDGE-011:** Two synthetic `change` events for the same path within 60s; advance timer; assert summarize called exactly once.
- **EDGE-014:** Empty folder (`discover` returns `[]`). `start()` resolves; no errors; chokidar listener still installed.

**Pattern to follow:** existing `packages/cli/tests/summarize-watch.test.ts` and the SessionEndDetector's fake-timer pattern.

**Commit:** `feat(cli): catch-up pass no longer arms summarizer (backfill vs live split)`

## Done When

- [ ] Catch-up does not schedule end-detect.
- [ ] Live add/change events still schedule end-detect.
- [ ] All listed tests pass.
- [ ] Existing watcher/end-detect tests still pass.
- [ ] `bun run --filter @claude-sessions/cli test` green.
