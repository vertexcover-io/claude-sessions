// AI-generated. See PROMPT.md for the prompts and model used.

import { readFile } from "node:fs/promises";
import { readSessionSync } from "@claude-sessions/adapter-claude";
import type {
  AttributedTo,
  CanonicalSession,
  RootCause,
  SessionLearning,
  SessionSummary,
} from "@claude-sessions/core";
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
  /**
   * Agent-authored narrative. When set, the in-loop coding agent supplied
   * the summary; we skip the `claude -p` invocation and enter the pipeline
   * at the merge step. Deterministic fields are still computed and merged.
   */
  providedSummary?: LlmSummary;
  /**
   * Provisional first-prompt title: stamp the summary `model: "heuristic"`
   * so the watermark treats it as never-fresh and a real agent summary
   * always supersedes it. Implies `providedSummary`.
   */
  provisional?: boolean;
}

export interface LlmSummary {
  title: string;
  summary: string;
  tags: string[];
  files_touched: string[];
  prs_referenced: string[];
  learnings?: SessionLearning[];
}

const dedupe = <T>(arr: readonly T[]): T[] => Array.from(new Set(arr));

const ensureArray = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
};

const ensureString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

const ROOT_CAUSES: readonly RootCause[] = [
  "underspecified_request",
  "instruction_not_followed",
  "missing_verification",
  "task_derailment",
  "context_loss",
  "environment_or_tooling",
];
const ATTRIBUTED: readonly AttributedTo[] = ["user", "agent", "shared", "environment"];
const SEVERITIES = ["low", "medium", "high"] as const;

/**
 * Parse + strictly validate the optional `learnings` array. Returns undefined
 * when the field is absent (server leaves existing rows untouched); `[]` is a
 * valid "clean session". Throws on any malformed entry so a bad agent payload
 * fails loudly rather than silently dropping diagnoses. Evidence-anchored:
 * every learning must cite ≥1 `episode_event_uuids`.
 */
const parseLearnings = (raw: unknown): SessionLearning[] | undefined => {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error("learnings: expected an array");
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`learnings[${i}]: expected an object`);
    }
    const o = entry as Record<string, unknown>;
    const uuids = ensureArray(o.episode_event_uuids);
    if (uuids.length === 0) {
      throw new Error(`learnings[${i}]: episode_event_uuids must cite at least one event`);
    }
    const title = ensureString(o.title).trim();
    const wentWrong = ensureString(o.what_went_wrong).trim();
    const prevented = ensureString(o.what_would_have_prevented).trim();
    if (!title) throw new Error(`learnings[${i}]: missing \`title\``);
    if (!wentWrong) throw new Error(`learnings[${i}]: missing \`what_went_wrong\``);
    if (!prevented) throw new Error(`learnings[${i}]: missing \`what_would_have_prevented\``);
    if (!ROOT_CAUSES.includes(o.root_cause as RootCause)) {
      throw new Error(`learnings[${i}]: invalid \`root_cause\` ${String(o.root_cause)}`);
    }
    if (!ATTRIBUTED.includes(o.attributed_to as AttributedTo)) {
      throw new Error(`learnings[${i}]: invalid \`attributed_to\` ${String(o.attributed_to)}`);
    }
    const confidence = typeof o.confidence === "number" ? o.confidence : Number.NaN;
    if (!(confidence >= 0 && confidence <= 1)) {
      throw new Error(`learnings[${i}]: \`confidence\` must be between 0 and 1`);
    }
    const learning: SessionLearning = {
      title,
      episode_event_uuids: uuids,
      what_went_wrong: wentWrong,
      what_would_have_prevented: prevented,
      root_cause: o.root_cause as RootCause,
      attributed_to: o.attributed_to as AttributedTo,
      confidence,
    };
    if (SEVERITIES.includes(o.severity as (typeof SEVERITIES)[number])) {
      learning.severity = o.severity as SessionLearning["severity"];
    }
    return learning;
  });
};

const parseLlmOutput = (raw: unknown): LlmSummary => {
  if (!raw || typeof raw !== "object") {
    throw new Error("claude returned a non-object summary");
  }
  const o = raw as Record<string, unknown>;
  const learnings = parseLearnings(o.learnings);
  return {
    title: ensureString(o.title),
    summary: ensureString(o.summary),
    tags: ensureArray(o.tags),
    files_touched: ensureArray(o.files_touched),
    prs_referenced: ensureArray(o.prs_referenced),
    ...(learnings !== undefined ? { learnings } : {}),
  };
};

/**
 * Strict validation for an agent-authored summary (matches SUMMARY_SCHEMA's
 * required fields). Throws on missing/empty title or summary so a malformed
 * agent payload fails loudly rather than uploading an empty summary.
 */
export const parseAgentSummary = (raw: unknown): LlmSummary => {
  const llm = parseLlmOutput(raw);
  if (llm.title.trim().length === 0) throw new Error("agent summary: missing `title`");
  if (llm.summary.trim().length === 0) throw new Error("agent summary: missing `summary`");
  return llm;
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
  const minePrsFn = deps.minePrsImpl ?? minePrs;
  const readBlobFn = deps.readBlob ?? (async (p: string) => new Uint8Array(await readFile(p)));
  const isAgent = deps.providedSummary !== undefined;
  const model = deps.model ?? (deps.provisional ? "heuristic" : isAgent ? "agent" : "sonnet");
  const attempt = deps.attempt ?? 1;
  const log = deps.recordLogger ?? ((m) => process.stderr.write(`${m}\n`));

  const session = readSession(deps.jsonlPath);
  const det = computeDeterministic(session);
  const minedPrs = await minePrsFn(session, det);

  let llm: LlmSummary;
  if (deps.providedSummary) {
    // Agent-authored: skip `claude -p`, record a zero-cost provenance run.
    llm = deps.providedSummary;
    const now = new Date();
    await safeRecord(
      deps.upload,
      sessionId,
      buildRunPayload({
        attempt,
        status: "ok",
        startedAt: now,
        endedAt: now,
        claudeModel: model,
        promptChars: 0,
        truncated: false,
        meta: null,
        error: null,
      }),
      log,
    );
  } else {
    const runClaudeFn = deps.runClaudeImpl ?? runClaude;
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
        error: claudeError
          ? claudeError instanceof Error
            ? claudeError.message
            : String(claudeError)
          : null,
      }),
      log,
    );

    if (claudeError || !claudeResult) {
      throw claudeError ?? new Error("claude returned no result");
    }

    llm = parseLlmOutput(claudeResult.output);
  }

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
    ...(llm.learnings !== undefined ? { learnings: llm.learnings } : {}),
  };

  await deps.upload.uploadSummary(sessionId, summary);
  const blob = await readBlobFn(deps.jsonlPath);
  await deps.upload.uploadBlob(sessionId, blob);

  return summary;
};
