// AI-generated. See PROMPT.md for the prompts and model used.

import { readSessionSync } from "@claude-sessions/adapter-claude";
import type { CanonicalSession, SessionSummary } from "@claude-sessions/core";
import { HttpError, type UploadClient } from "../upload/client.js";
import type { runClaude } from "./claude-runner.js";
import { type LlmSummary, type PipelineDeps, summarizeAndUpload } from "./pipeline.js";
import type { minePrs } from "./pr-mining.js";
import { readWatermark } from "./watermark.js";

export { computeDeterministic } from "./deterministic.js";
export { readWatermark, DEFAULT_MIN_RESUMMARIZE_DELTA } from "./watermark.js";
export type { WatermarkState, WatermarkDeps } from "./watermark.js";
export { runClaude } from "./claude-runner.js";
export { minePrs } from "./pr-mining.js";
export {
  SUMMARY_SCHEMA,
  SYSTEM_PROMPT,
  buildPromptUserMessage,
  TRUNCATION_MARKER,
} from "./prompt.js";
export { summarizeAndUpload, parseAgentSummary } from "./pipeline.js";
export type { LlmSummary } from "./pipeline.js";

/**
 * Concurrency cap: at most 2 `claude -p` invocations in flight at any
 * time across the whole watcher (REQ-019). The simplest implementation
 * is a queue + counter; we resolve the next pending whenever a current
 * one finishes.
 */
class Semaphore {
  private slots: number;
  private queue: Array<() => void> = [];

  constructor(public readonly capacity: number) {
    this.slots = capacity;
  }

  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.slots -= 1;
  }

  release(): void {
    this.slots += 1;
    const next = this.queue.shift();
    if (next) next();
  }

  inFlight(): number {
    return this.capacity - this.slots;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;

const makeFailedSummary = (sessionId: string, error: string): SessionSummary => ({
  session_id: sessionId,
  title: "",
  summary: "",
  tags: [],
  files_touched: [],
  prs_referenced: [],
  tool_call_counts: {},
  generated_at: new Date().toISOString(),
  model: "sonnet",
  status: "failed",
  error,
});

export interface SummarizerOptions {
  upload: UploadClient;
  /** Override the global concurrency cap (default 2). */
  maxConcurrent?: number;
  /** Override per-attempt backoff (tests pass `[]` to fail fast). */
  retryDelaysMs?: readonly number[];
  /** Hook a logger for non-fatal warnings. */
  logger?: (msg: string) => void;
  /** Inject a custom pipeline runner (tests). */
  runPipeline?: (sessionId: string, deps: PipelineDeps) => Promise<SessionSummary>;
  /** Inject a custom claude runner — wired through to the pipeline. */
  runClaudeImpl?: typeof runClaude;
  /** Inject a custom PR-miner. */
  minePrsImpl?: typeof minePrs;
  /**
   * Minimum number of new events since the last successful summary required
   * to re-summarize. Defaults to 5 (REQ-013).
   */
  minResumarizeDelta?: number;
  /** Inject a custom session reader (tests). Defaults to `readSessionSync`. */
  readSessionImpl?: (path: string) => CanonicalSession;
  /**
   * Backfill-only mode (the watcher daemon's fallback `claude -p` path).
   * Skip if ANY `ok` summary already exists, regardless of event delta — so
   * an agent-authored summary is never overwritten by the fallback.
   */
  backfillOnly?: boolean;
}

/**
 * Wraps `summarizeAndUpload` with a global semaphore and retry policy.
 *
 * On retry exhaustion, posts a `status: "failed"` summary so the UI can
 * surface "summarization failed — retry" without joining a job table.
 */
export class Summarizer {
  private upload: UploadClient;
  private sem: Semaphore;
  private retryDelaysMs: readonly number[];
  private logger: (msg: string) => void;
  private runPipeline: (sessionId: string, deps: PipelineDeps) => Promise<SessionSummary>;
  private runClaudeImpl: typeof runClaude | undefined;
  private minePrsImpl: typeof minePrs | undefined;
  private minResumarizeDelta: number;
  private readSessionImpl: (path: string) => CanonicalSession;
  private backfillOnly: boolean;

  constructor(opts: SummarizerOptions) {
    this.upload = opts.upload;
    this.sem = new Semaphore(opts.maxConcurrent ?? 2);
    this.retryDelaysMs = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
    this.logger = opts.logger ?? ((m) => process.stderr.write(`${m}\n`));
    this.runPipeline = opts.runPipeline ?? summarizeAndUpload;
    this.runClaudeImpl = opts.runClaudeImpl;
    this.minePrsImpl = opts.minePrsImpl;
    this.minResumarizeDelta = opts.minResumarizeDelta ?? 5;
    this.readSessionImpl = opts.readSessionImpl ?? readSessionSync;
    this.backfillOnly = opts.backfillOnly ?? false;
  }

  inFlight(): number {
    return this.sem.inFlight();
  }

  private buildSkipSummary(
    sessionId: string,
    s: NonNullable<Awaited<ReturnType<UploadClient["getSession"]>>["summary"]>,
  ): SessionSummary {
    return {
      session_id: sessionId,
      title: s.title ?? "",
      summary: s.summary ?? "",
      tags: s.tags,
      files_touched: s.files_touched,
      prs_referenced: s.prs_referenced,
      tool_call_counts: s.tool_call_counts,
      generated_at: new Date().toISOString(),
      model: "unknown",
      status: "ok",
      ...(s.summarized_event_count != null
        ? { summarized_event_count: s.summarized_event_count }
        : {}),
    };
  }

  private async checkWatermarkSkip(
    sessionId: string,
    jsonlPath: string,
  ): Promise<SessionSummary | null> {
    try {
      const wm = await readWatermark(sessionId, jsonlPath, {
        upload: this.upload,
        readSession: this.readSessionImpl,
        minDelta: this.minResumarizeDelta,
      });
      const s = wm.summary;
      if (!s || s.status !== "ok") return null;
      // A provisional first-prompt title (model=heuristic) is not authoritative;
      // never skip on it, so even the backfill `claude -p` path upgrades it.
      if (s.model === "heuristic") return null;
      // Backfill-only: any existing `ok` summary wins (agent-authored or prior).
      if (this.backfillOnly) {
        this.logger(`summarize skipped for ${sessionId}: backfill-only, ok summary exists`);
        return this.buildSkipSummary(sessionId, s);
      }
      if (!wm.fresh) return null;
      this.logger(
        `summarize skipped for ${sessionId}: delta=${wm.delta} < ${this.minResumarizeDelta}`,
      );
      return this.buildSkipSummary(sessionId, s);
    } catch (err) {
      this.logger(
        `watermark check failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async summarize(
    sessionId: string,
    jsonlPath: string,
    opts?: { force?: boolean; providedSummary?: LlmSummary; provisional?: boolean },
  ): Promise<SessionSummary> {
    await this.sem.acquire();
    try {
      // Agent-authored summaries are authoritative: always write, never gate.
      const isAgent = opts?.providedSummary !== undefined;
      if (!isAgent && opts?.force !== true) {
        const skip = await this.checkWatermarkSkip(sessionId, jsonlPath);
        if (skip) return skip;
      }
      const baseDeps: PipelineDeps = {
        upload: this.upload,
        jsonlPath,
        recordLogger: this.logger,
        ...(this.runClaudeImpl ? { runClaudeImpl: this.runClaudeImpl } : {}),
        ...(this.minePrsImpl ? { minePrsImpl: this.minePrsImpl } : {}),
        ...(opts?.providedSummary ? { providedSummary: opts.providedSummary } : {}),
        ...(opts?.provisional ? { provisional: true } : {}),
      };
      let lastErr: unknown = null;
      for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
        try {
          return await this.runPipeline(sessionId, { ...baseDeps, attempt: attempt + 1 });
        } catch (err) {
          lastErr = err;
          // 404 from the server means it has no record of this session for
          // the current user (DB reset, account switch, never-ingested).
          // Retrying and uploading a failure marker will both 404 too —
          // log once and bail.
          if (err instanceof HttpError && err.status === 404) {
            this.logger(`summarize skipped for ${sessionId}: server has no such session`);
            return makeFailedSummary(sessionId, err.message);
          }
          this.logger(
            `summarize attempt ${attempt + 1} failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          if (attempt < this.retryDelaysMs.length) {
            const delay = this.retryDelaysMs[attempt] ?? 0;
            if (delay > 0) await sleep(delay);
          }
        }
      }
      // Exhausted retries — best-effort upload of a `failed` row so the
      // UI can offer a retry button.
      const marker = makeFailedSummary(
        sessionId,
        lastErr instanceof Error ? lastErr.message : String(lastErr),
      );
      try {
        await this.upload.uploadSummary(sessionId, marker);
      } catch (uploadErr) {
        this.logger(
          `failed to upload failure marker for ${sessionId}: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`,
        );
      }
      return marker;
    } finally {
      this.sem.release();
    }
  }
}
