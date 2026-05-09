// AI-generated. See PROMPT.md for the prompts and model used.

import { fileURLToPath } from "node:url";
import { isWatcherAlive, startWatcherDaemon, watchLogPath } from "../config/daemon.js";
import { ensureAuthenticated, runPairFlow } from "./_pair.js";

export interface InitOptions {
  serverUrl?: string;
  /** Override the entry point for the spawned daemon (tests). */
  cliEntry?: string;
  open?: import("./_open.js").Opener;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  fetchImpl?: typeof fetch;
  /** Skip starting the daemon (tests). */
  skipDaemon?: boolean;
}

const DEFAULT_SERVER_URL = "http://localhost:3000";

const resolveCliEntry = (): string => {
  // The CLI bin is the same file currently executing; resolve via import.meta.url.
  return fileURLToPath(new URL("../main.js", import.meta.url));
};

export const initCommand = async (opts: InitOptions = {}): Promise<number> => {
  const serverUrl = (opts.serverUrl ?? DEFAULT_SERVER_URL).replace(/\/+$/, "");

  let auth = await ensureAuthenticated({
    serverUrl,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });

  if (!auth) {
    auth = await runPairFlow({
      serverUrl,
      ...(opts.open ? { open: opts.open } : {}),
      ...(opts.stdin ? { stdin: opts.stdin } : {}),
      ...(opts.stdout ? { stdout: opts.stdout } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    if (!auth) return 1;
  } else {
    process.stdout.write(`logged in as ${auth.email}\n`);
  }

  const watcherWasAlive = isWatcherAlive();
  if (watcherWasAlive) {
    process.stdout.write("watcher already running.\n");
  } else if (!opts.skipDaemon) {
    const pid = startWatcherDaemon({ cliEntry: opts.cliEntry ?? resolveCliEntry() });
    process.stdout.write(`started watcher (pid ${pid}). logs: ${watchLogPath()}\n`);
  }

  if (auth && watcherWasAlive) {
    process.stdout.write("nothing to do.\n");
  }
  return 0;
};
