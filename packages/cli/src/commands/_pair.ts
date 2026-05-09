// AI-generated. See PROMPT.md for the prompts and model used.

import { createInterface } from "node:readline/promises";
import { readCredentials, writeCredentials } from "../config/credentials.js";
import { type Opener, defaultOpener } from "./_open.js";

export interface PairOptions {
  serverUrl: string;
  open?: Opener;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  fetchImpl?: typeof fetch;
}

const isTokenValid = async (
  serverUrl: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<boolean> => {
  try {
    const res = await fetchImpl(`${serverUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
};

export const ensureAuthenticated = async (
  opts: PairOptions,
): Promise<{ token: string; email: string } | null> => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const existing = readCredentials();
  if (existing && existing.server_url === opts.serverUrl.replace(/\/+$/, "")) {
    if (await isTokenValid(opts.serverUrl, existing.token, fetchImpl)) {
      return { token: existing.token, email: existing.user_email };
    }
  }
  return null;
};

const exchangePairCode = async (
  serverUrl: string,
  code: string,
  fetchImpl: typeof fetch,
): Promise<{ token: string; email: string } | null> => {
  const res = await fetchImpl(`${serverUrl}/api/auth/cli-exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { token: string; user: { email: string } };
  return { token: json.token, email: json.user.email };
};

export const runPairFlow = async (
  opts: PairOptions,
): Promise<{ token: string; email: string } | null> => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const open = opts.open ?? defaultOpener;
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const serverUrl = opts.serverUrl.replace(/\/+$/, "");

  process.stdout.write(`opening ${serverUrl} — log in there, then copy the pairing code.\n`);
  await open(serverUrl);

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const code = (await rl.question("Paste the pairing code: ")).trim();
      if (!code) {
        process.stderr.write("empty code; aborting.\n");
        return null;
      }
      const result = await exchangePairCode(serverUrl, code, fetchImpl);
      if (!result) {
        process.stderr.write("invalid or expired code — try again.\n");
        continue;
      }
      await writeCredentials({
        server_url: serverUrl,
        token: result.token,
        user_email: result.email,
      });
      process.stdout.write(`paired as ${result.email}\n`);
      return result;
    }
  } finally {
    rl.close();
  }
};
