// AI-generated. See PROMPT.md for the prompts and model used.

import { readSessionSync } from "@claude-sessions/adapter-claude";
import type { CanonicalSession } from "@claude-sessions/core";
import type { SessionDetailSummary, UploadClient } from "../upload/client.js";

export const DEFAULT_MIN_RESUMMARIZE_DELTA = 5;

export interface WatermarkDeps {
  upload: UploadClient;
  /** Inject a custom session reader (tests). Defaults to `readSessionSync`. */
  readSession?: (path: string) => CanonicalSession;
  /** New-event threshold below which an existing summary counts as fresh. */
  minDelta?: number;
}

export interface WatermarkState {
  /** The server's current summary for the session, if any. */
  summary: SessionDetailSummary | null;
  /** True when an `ok` summary exists and is within `minDelta` of the JSONL. */
  fresh: boolean;
  /** New events since the last summary, or null when unknown / no summary. */
  delta: number | null;
}

/**
 * Inspect the server's summary watermark for a session by comparing its
 * `summarized_event_count` against the current JSONL event count.
 *
 * Shared by the Summarizer (decide whether to re-summarize) and the Stop
 * hook (decide whether to force the agent to author one). Throws propagate
 * to the caller — both treat a thrown error as "no usable watermark".
 */
export const readWatermark = async (
  sessionId: string,
  jsonlPath: string,
  deps: WatermarkDeps,
): Promise<WatermarkState> => {
  const minDelta = deps.minDelta ?? DEFAULT_MIN_RESUMMARIZE_DELTA;
  const existing = await deps.upload.getSession(sessionId);
  const s = existing.summary;
  if (!s || s.status !== "ok") return { summary: s ?? null, fresh: false, delta: null };
  // A provisional first-prompt title is never fresh — a real agent summary
  // must always be allowed to supersede it.
  if (s.model === "heuristic") return { summary: s, fresh: false, delta: null };
  if (s.summarized_event_count == null) return { summary: s, fresh: false, delta: null };
  const session = (deps.readSession ?? readSessionSync)(jsonlPath);
  const delta = session.events.length - s.summarized_event_count;
  return { summary: s, fresh: delta < minDelta, delta };
};
