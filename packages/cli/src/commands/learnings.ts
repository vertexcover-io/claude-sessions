// AI-generated. See PROMPT.md for the prompts and model used.

import { type SessionLearning, renderLearningsMarkdown } from "@claude-sessions/core";
import type { LearningRecord, UploadClient } from "../upload/client.js";

export interface LearningsOptions {
  client: UploadClient;
  sessionId: string;
  json?: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

const toSessionLearning = (r: LearningRecord): SessionLearning => ({
  title: r.title,
  episode_event_uuids: r.episode_event_uuids,
  what_went_wrong: r.what_went_wrong,
  what_would_have_prevented: r.what_would_have_prevented,
  root_cause: r.root_cause as SessionLearning["root_cause"],
  attributed_to: r.attributed_to as SessionLearning["attributed_to"],
  confidence: r.confidence,
  ...(r.severity ? { severity: r.severity } : {}),
});

/**
 * `claude-sessions learnings <id>` — read-only. Renders the deterministic
 * markdown for a session's learnings (or raw JSON records with `--json`).
 */
export const learningsCommand = async (opts: LearningsOptions): Promise<number> => {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  let detail: Awaited<ReturnType<UploadClient["getSession"]>>;
  try {
    detail = await opts.client.getSession(opts.sessionId);
  } catch (err) {
    stderr.write(`failed to fetch session: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const records = detail.learnings ?? [];

  if (opts.json) {
    stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return 0;
  }

  stdout.write(`${renderLearningsMarkdown(records.map(toSessionLearning))}`);
  return 0;
};
