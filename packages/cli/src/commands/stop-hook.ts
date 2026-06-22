// AI-generated. See PROMPT.md for the prompts and model used.

import { existsSync } from "node:fs";
import { readSessionSync } from "@claude-sessions/adapter-claude";
import type { CanonicalSession } from "@claude-sessions/core";
import { readWatermark } from "../summarizer/index.js";
import type { UploadClient } from "../upload/client.js";

/**
 * `claude-sessions stop-hook` — the Stop-hook entry point that makes the
 * in-loop agent author its own session summary before the turn ends.
 *
 * Claude Code invokes this with the Stop hook payload on stdin. When the
 * session is substantive and has no fresh summary yet, we emit a
 * `decision: "block"` so the agent is prompted to run
 * `summarize --current --from-agent`. `claude -p` stays a manual last resort.
 *
 * Contract (https://code.claude.com/docs/en/hooks): printing
 * `{"decision":"block","reason":...}` on stdout with exit 0 continues the
 * turn and feeds `reason` back to the agent. `stop_hook_active` is true once
 * we've already blocked this cycle — we must allow the stop then, or loop.
 * Any uncertainty (malformed input, unknown session, server error) allows
 * the stop: the hook must never wedge a session shut.
 */

export const DEFAULT_MIN_EVENTS = 10;

export interface StopHookOptions {
  client: UploadClient;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  /** Minimum transcript events before we bother nagging. */
  minEvents?: number;
  /** New-event threshold below which an existing summary counts as fresh. */
  minDelta?: number;
  /** Inject a session reader (tests). Defaults to `readSessionSync`. */
  readSession?: (path: string) => CanonicalSession;
  /** Inject the watermark probe (tests). */
  readWatermarkImpl?: typeof readWatermark;
}

interface StopHookInput {
  session_id?: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
}

const SUMMARY_REASON =
  "Before stopping, author a concise summary of this session as JSON and push it so the work " +
  "is captured: run `claude-sessions summarize --current --from-agent` with the summary on stdin " +
  "(the claude-session skill documents the schema). Authoring it yourself keeps the summary " +
  "agent-written instead of falling back to a separate `claude -p` pass.";

const readStdin = async (stdin: NodeJS.ReadableStream): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

export const stopHookCommand = async (opts: StopHookOptions): Promise<number> => {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const minEvents = opts.minEvents ?? DEFAULT_MIN_EVENTS;

  let input: StopHookInput;
  try {
    const raw = await readStdin(stdin);
    input = raw ? (JSON.parse(raw) as StopHookInput) : {};
  } catch {
    return 0;
  }

  // Loop guard: we already blocked once this stop cycle — let it stop now.
  if (input.stop_hook_active) return 0;

  const sessionId = input.session_id;
  const transcriptPath = input.transcript_path;
  if (!sessionId || !transcriptPath || !existsSync(transcriptPath)) return 0;

  // Activity threshold: trivial sessions aren't worth a summary.
  let eventCount: number;
  try {
    eventCount = (opts.readSession ?? readSessionSync)(transcriptPath).events.length;
  } catch {
    return 0;
  }
  if (eventCount < minEvents) return 0;

  // A fresh summary already exists (e.g. the agent just pushed one, or we
  // blocked a moment ago) — allow the stop.
  try {
    const wm = await (opts.readWatermarkImpl ?? readWatermark)(sessionId, transcriptPath, {
      upload: opts.client,
      ...(opts.readSession ? { readSession: opts.readSession } : {}),
      ...(opts.minDelta !== undefined ? { minDelta: opts.minDelta } : {}),
    });
    if (wm.fresh) return 0;
  } catch {
    // Unknown session (404) or server error — pushing would fail too, so
    // there's nothing to gain by blocking. Allow the stop.
    return 0;
  }

  stdout.write(`${JSON.stringify({ decision: "block", reason: SUMMARY_REASON })}\n`);
  return 0;
};
