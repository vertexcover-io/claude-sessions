// AI-generated. See PROMPT.md for the prompts and model used.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSettings } from "../config/settings.js";
import { configCommand } from "./config.js";

let dir: string;
let prevHome: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cs-config-cmd-"));
  prevHome = process.env.CLAUDE_SESSIONS_HOME;
  process.env.CLAUDE_SESSIONS_HOME = dir;
});

afterEach(() => {
  process.env.CLAUDE_SESSIONS_HOME = prevHome;
  rmSync(dir, { recursive: true, force: true });
});

const capture = (): { stream: NodeJS.WritableStream; get: () => string } => {
  let data = "";
  const stream = {
    write: (s: string) => {
      data += s;
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { stream, get: () => data };
};

const run = async (args: string[]): Promise<{ code: number; out: string; err: string }> => {
  const out = capture();
  const err = capture();
  const code = await configCommand(args, { stdout: out.stream, stderr: err.stream });
  return { code, out: out.get(), err: err.get() };
};

describe("configCommand", () => {
  it("lists defaults", async () => {
    const { code, out } = await run(["list"]);
    expect(code).toBe(0);
    expect(out).toContain("summary.enabled=false");
    expect(out).toContain("learnings.enabled=false");
  });

  it("sets a value and persists it", async () => {
    const set = await run(["set", "summary.enabled", "false"]);
    expect(set.code).toBe(0);
    expect(readSettings().summary_enabled).toBe(false);
    const get = await run(["get", "summary.enabled"]);
    expect(get.out.trim()).toBe("false");
  });

  it("sets learnings.enabled", async () => {
    await run(["set", "learnings.enabled", "true"]);
    expect(readSettings().learnings_enabled).toBe(true);
  });

  it("rejects an unknown key with exit 2", async () => {
    const { code, err } = await run(["set", "bogus.key", "true"]);
    expect(code).toBe(2);
    expect(err).toContain("unknown key");
  });

  it("rejects an invalid value with exit 2", async () => {
    const { code, err } = await run(["set", "summary.enabled", "maybe"]);
    expect(code).toBe(2);
    expect(err).toContain("invalid value");
  });

  it("rejects an unknown subcommand with exit 2", async () => {
    const { code, err } = await run(["frobnicate"]);
    expect(code).toBe(2);
    expect(err).toContain("usage");
  });
});
