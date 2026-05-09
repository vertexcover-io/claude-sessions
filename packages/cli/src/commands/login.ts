// AI-generated. See PROMPT.md for the prompts and model used.

import { ensureAuthenticated, runPairFlow } from "./_pair.js";

export interface LoginOptions {
  serverUrl?: string;
  open?: import("./_open.js").Opener;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  fetchImpl?: typeof fetch;
}

const DEFAULT_SERVER_URL = "http://localhost:3000";

export const loginCommand = async (opts: LoginOptions = {}): Promise<number> => {
  const serverUrl = (opts.serverUrl ?? DEFAULT_SERVER_URL).replace(/\/+$/, "");

  const existing = await ensureAuthenticated({
    serverUrl,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  if (existing) {
    process.stdout.write(
      `already logged in as ${existing.email}. run \`claude-sessions logout\` first to switch.\n`,
    );
    return 0;
  }

  const result = await runPairFlow({
    serverUrl,
    ...(opts.open ? { open: opts.open } : {}),
    ...(opts.stdin ? { stdin: opts.stdin } : {}),
    ...(opts.stdout ? { stdout: opts.stdout } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  return result ? 0 : 1;
};
