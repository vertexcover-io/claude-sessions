// AI-generated. See PROMPT.md for the prompts and model used.

import type { UploadClient } from "../upload/client.js";
import { JsonlWatcher } from "../watcher/chokidar.js";

/**
 * The watcher only tails JSONL files and uploads new events. It never
 * generates summaries: the in-loop coding agent authors them directly
 * (`summarize --from-agent`, forced by the Stop hook), and `claude -p` is a
 * manual last resort (`summarize <id>` / `--all`). There is no timer-based
 * end-of-session trigger.
 */
export interface WatchOptions {
  client: UploadClient;
}

/**
 * `claude-sessions watch` — long-lived foreground tail. Stays alive
 * until SIGINT / SIGTERM, then closes the watcher cleanly.
 */
export const watchCommand = async (opts: WatchOptions): Promise<number> => {
  const watcher = new JsonlWatcher({ client: opts.client });
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
