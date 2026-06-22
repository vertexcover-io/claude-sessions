// AI-generated. See PROMPT.md for the prompts and model used.

import { Summarizer } from "../summarizer/index.js";
import type { UploadClient } from "../upload/client.js";
import { JsonlWatcher } from "../watcher/chokidar.js";

/**
 * The daemon's end-of-session summarization is a FALLBACK only: the in-loop
 * coding agent authors summaries directly (`summarize --from-agent`), and the
 * watcher's `claude -p` pass only fills gaps for sessions that have no summary
 * (backfill-only mode skips any session with an existing `ok` summary).
 * Set `CLAUDE_SESSIONS_SUMMARIZE=0` to disable the fallback entirely.
 */
const summarizationEnabled = (): boolean => process.env.CLAUDE_SESSIONS_SUMMARIZE !== "0";

export interface WatchOptions {
  client: UploadClient;
  /** Disable summarization (tests). */
  disableSummarizer?: boolean;
}

/**
 * `claude-sessions watch` — long-lived foreground tail. Stays alive
 * until SIGINT / SIGTERM, then closes the watcher cleanly.
 */
export const watchCommand = async (opts: WatchOptions): Promise<number> => {
  const summarizationOff = !summarizationEnabled() || opts.disableSummarizer;
  const summarizer = summarizationOff
    ? undefined
    : new Summarizer({ upload: opts.client, backfillOnly: true });
  const watcher = new JsonlWatcher({
    client: opts.client,
    ...(summarizer ? { summarizer } : {}),
  });
  await watcher.start();
  process.stdout.write("watching for new events (ctrl-c to exit)...\n");

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await watcher.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  await new Promise<void>(() => undefined);
  return 0;
};
