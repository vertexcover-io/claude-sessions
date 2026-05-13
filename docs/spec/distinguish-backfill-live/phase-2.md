# Phase 2: Core type + upload client typing

> **Status:** pending
> **Traces to:** REQ-014

## Overview

Add the optional `summarized_event_count?: number` field to `SessionSummary` in `@claude-sessions/core`. Type the CLI's `UploadClient.getSession` return so the watermark is reachable without `as any`.

Pure-types phase. No behavior change. Ensures Phases 3 and 4 can compile their watermark logic.

## Implementation

**Files:**
- Modify: `packages/core/src/types.ts` — extend the `SessionSummary` interface:
  ```ts
  export interface SessionSummary {
    // ...existing fields
    summarized_event_count?: number;
  }
  ```
- Modify: `packages/cli/src/upload/client.ts`:
  - Add a small typed shape for the embedded summary on `getSession`'s return:
    ```ts
    export interface SessionDetailSummary {
      title: string | null;
      summary: string | null;
      tags: string[];
      files_touched: string[];
      prs_referenced: string[];
      tool_call_counts: Record<string, number>;
      status: "pending" | "ok" | "failed";
      summarized_event_count?: number | null;
    }
    export interface SessionDetail {
      id: string;
      summary: SessionDetailSummary | null;
      // (other fields are not needed by the summarizer; type as Record<string, unknown> rest)
      [k: string]: unknown;
    }
    ```
  - Change `getSession` signature from `Promise<Record<string, unknown>>` to `Promise<SessionDetail>`. Implementation stays the same (just a type narrowing on JSON parse).

**What to test:**
- A new tiny test in `packages/cli/src/upload/client.test.ts` (create if missing): `getSession` parses a server payload that includes `summarized_event_count` and exposes it via the typed shape.
- Type-only: confirm a downstream import like `summary?.summarized_event_count` typechecks.

**Commit:** `feat(core, cli): summarized_event_count on SessionSummary + UploadClient typing`

## Done When

- [ ] `SessionSummary` exposes the new optional field.
- [ ] `UploadClient.getSession` returns the typed `SessionDetail` shape.
- [ ] `bun run typecheck` passes across all packages.
- [ ] New unit test passes.
