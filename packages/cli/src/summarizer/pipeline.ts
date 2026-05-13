// AI-generated. See PROMPT.md for the prompts and model used.

import { readFile } from "node:fs/promises";
import { readSessionSync } from "@claude-sessions/adapter-claude";
import type { CanonicalSession, SessionSummary } from "@claude-sessions/core";
import type { SummarizationRunPayload, UploadClient } from "../upload/client.js";
import type { ClaudeRunMeta } from "./claude-runner.js";
import { runClaude } from "./claude-runner.js";
import { computeDeterministic } from "./deterministic.js";
import { minePrs } from "./pr-mining.js";
import { SUMMARY_SCHEMA, SYSTEM_PROMPT, buildPromptUserMessage } from "./prompt.js";

export interface PipelineDeps {
  upload: UploadClient;
  jsonlPath: string;
  readSession?: (path: string) => CanonicalSession;
  runClaudeImpl?: typeof runClaude;
  minePrsImpl?: typeof minePrs;
  readBlob?: (path: string) => Promise<Uint8Array>;
  model?: string;
  attempt?: number;
  recordLogger?: (msg: string) => void;
}

interface LlmSummary {
  title: string;
  summary: string;
  tags: string[];
  files_touched: string[];
  prs_referenced: string[];
}

const dedupe = <T>(arr: readonly T[]): T[] => Array.from(new Set(arr));

const ensureArray = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
};

const ensureString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

const parseLlmOutput = (raw: unknown): LlmSummary => {
  if (!raw || typeof raw !== "object") {
    throw new Error("claude returned a non-object summary");
  }
  const o = raw as Record<string, unknown>;
  return {
    title: ensureString(o.title),
    summary: ensureString(o.summary),
    tags: ensureArray(o.tags),
    files_touched: ensureArray(o.files_touched),
    prs_referenced: ensureArray(o.prs_referenced),
  };
};

const buildRunPayload = (args: {
  attempt: number;
  status: "ok" | "failed";
  startedAt: Date;
  endedAt: Date;
  claudeModel: string;
  promptChars: number;
  truncated: boolean;
  meta: ClaudeRunMeta | null;
  error: string | null;
}): SummarizationRunPayload => {
  const { attempt, status, startedAt, endedAt, claudeModel, promptChars, truncated, meta, error } =
    args;
  return {
    attempt,
    status,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: endedAt.getTime() - startedAt.getTime(),
    duration_api_ms: meta?.duration_api_ms ?? null,
    claude_model: claudeModel,
    stop_reason: meta?.stop_reason ?? null,
    num_turns: meta?.num_turns ?? null,
    input_tokens: meta?.usage.input_tokens ?? 0,
    output_tokens: meta?.usage.output_tokens ?? 0,
    cache_creation_tokens: meta?.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: meta?.usage.cache_read_input_tokens ?? 0,
    total_cost_usd: meta?.total_cost_usd ?? 0,
    prompt_chars: promptChars,
    truncated,
    error,
    raw_usage: meta?.raw_usage ?? null,
  };
};

const safeRecord = async (
  upload: UploadClient,
  sessionId: string,
  payload: SummarizationRunPayload,
  log: (msg: string) => void,
): Promise<void> => {
  try {
    await upload.recordSummarizationRun(sessionId, payload);
  } catch (err) {
    log(
      `summarization-run record failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

export const summarizeAndUpload = async (
  sessionId: string,
  deps: PipelineDeps,
): Promise<SessionSummary> => {
  const readSession = deps.readSession ?? readSessionSync;
  const runClaudeFn = deps.runClaudeImpl ?? runClaude;
  const minePrsFn = deps.minePrsImpl ?? minePrs;
  const readBlobFn = deps.readBlob ?? (async (p: string) => new Uint8Array(await readFile(p)));
  const model = deps.model ?? "sonnet";
  const attempt = deps.attempt ?? 1;
  const log = deps.recordLogger ?? ((m) => process.stderr.write(`${m}\n`));

  const session = readSession(deps.jsonlPath);
  const det = computeDeterministic(session);
  const minedPrs = await minePrsFn(session, det);

  const prompt = buildPromptUserMessage(session, det);
  const startedAt = new Date();
  let claudeResult: Awaited<ReturnType<typeof runClaudeFn>> | null = null;
  let claudeError: unknown = null;
  try {
    claudeResult = await runClaudeFn({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: prompt.text,
      schema: SUMMARY_SCHEMA,
      model,
    });
  } catch (err) {
    claudeError = err;
  }
  const endedAt = new Date();

  await safeRecord(
    deps.upload,
    sessionId,
    buildRunPayload({
      attempt,
      status: claudeError ? "failed" : "ok",
      startedAt,
      endedAt,
      claudeModel: model,
      promptChars: prompt.text.length,
      truncated: prompt.truncated,
      meta: claudeResult?.meta ?? null,
      error: claudeError ? (claudeError instanceof Error ? claudeError.message : String(claudeError)) : null,
    }),
    log,
  );

  if (claudeError || !claudeResult) {
    throw claudeError ?? new Error("claude returned no result");
  }

  const llm = parseLlmOutput(claudeResult.output);

  const summary: SessionSummary = {
    session_id: sessionId,
    title: llm.title,
    summary: llm.summary,
    tags: llm.tags,
    files_touched: dedupe([...llm.files_touched, ...det.files_touched_raw]),
    prs_referenced: dedupe([...llm.prs_referenced, ...minedPrs]),
    tool_call_counts: det.tool_call_counts,
    generated_at: new Date().toISOString(),
    model,
    status: "ok",
    summarized_event_count: session.events.length,
  };

  await deps.upload.uploadSummary(sessionId, summary);
  const blob = await readBlobFn(deps.jsonlPath);
  await deps.upload.uploadBlob(sessionId, blob);

  return summary;
};
