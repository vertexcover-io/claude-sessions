// AI-generated. See PROMPT.md for the prompts and model used.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRepo } from "@claude-sessions/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureCommand } from "../src/commands/ensure.js";
import { writeCredentials } from "../src/config/credentials.js";
import { upsertRepo } from "../src/config/repos.js";
import { makeTempGitRepo } from "./helpers/git-repo.js";

const SERVER = "http://localhost:3000";

let home: string;
let out: string;
const stdout = {
  write: (c: string) => {
    out += c;
    return true;
  },
} as unknown as NodeJS.WritableStream;
const stderr = { write: () => true } as unknown as NodeJS.WritableStream;
// ensureAuthenticated validates the token via GET /api/auth/me; 200 = valid.
const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cs-ensure-"));
  process.env.CLAUDE_SESSIONS_HOME = home;
  out = "";
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  process.env.CLAUDE_SESSIONS_HOME = undefined;
});

const parseHookOutput = (): {
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
} => JSON.parse(out.trim());

describe("ensure command", () => {
  it("not authenticated → warns to login via additionalContext, exit 0", async () => {
    const code = await ensureCommand({
      serverUrl: SERVER,
      skipDaemon: true,
      stdout,
      stderr,
      fetchImpl: okFetch,
    });
    expect(code).toBe(0);
    const json = parseHookOutput();
    expect(json.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(json.hookSpecificOutput.additionalContext).toContain("login");
  });

  it("authenticated + repo not enabled → additionalContext asks to enable", async () => {
    await writeCredentials({ server_url: SERVER, token: "tok", user_email: "u@e.test" });
    const repo = makeTempGitRepo("git@github.com:fixture/ensure-a.git");
    try {
      const code = await ensureCommand({
        serverUrl: SERVER,
        cwd: repo.path,
        skipDaemon: true,
        stdout,
        stderr,
        fetchImpl: okFetch,
      });
      expect(code).toBe(0);
      expect(parseHookOutput().hookSpecificOutput.additionalContext).toContain(
        "claude-sessions enable",
      );
    } finally {
      repo.cleanup();
    }
  });

  it("authenticated + repo enabled → additionalContext nudges to push a summary", async () => {
    await writeCredentials({ server_url: SERVER, token: "tok", user_email: "u@e.test" });
    const repo = makeTempGitRepo("git@github.com:fixture/ensure-b.git");
    try {
      const id = detectRepo(repo.path);
      if (!id) throw new Error("expected a git repo");
      await upsertRepo(id.canonical_url, {
        local_path: id.toplevel,
        enabled: true,
        manual_override_url: null,
      });
      const code = await ensureCommand({
        serverUrl: SERVER,
        cwd: repo.path,
        skipDaemon: true,
        stdout,
        stderr,
        fetchImpl: okFetch,
      });
      expect(code).toBe(0);
      const ctx = parseHookOutput().hookSpecificOutput.additionalContext;
      expect(ctx).toContain("summarize --current --from-agent");
      expect(ctx).toContain("claude-session");
    } finally {
      repo.cleanup();
    }
  });
});
