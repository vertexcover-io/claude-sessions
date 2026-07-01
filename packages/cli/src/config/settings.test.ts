// AI-generated. See PROMPT.md for the prompts and model used.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { settingsPath } from "./paths.js";
import { readSettings, setSetting } from "./settings.js";

let dir: string;
let prevHome: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cs-settings-"));
  prevHome = process.env.CLAUDE_SESSIONS_HOME;
  process.env.CLAUDE_SESSIONS_HOME = dir;
});

afterEach(() => {
  process.env.CLAUDE_SESSIONS_HOME = prevHome;
  rmSync(dir, { recursive: true, force: true });
});

describe("settings", () => {
  it("returns defaults when the file is missing", () => {
    expect(readSettings()).toEqual({
      version: 1,
      summary_enabled: false,
      learnings_enabled: false,
    });
  });

  it("round-trips a set value", async () => {
    await setSetting("summary_enabled", false);
    expect(readSettings().summary_enabled).toBe(false);
    await setSetting("learnings_enabled", true);
    expect(readSettings().learnings_enabled).toBe(true);
  });

  it("preserves the other key when setting one", async () => {
    await setSetting("learnings_enabled", true);
    await setSetting("summary_enabled", false);
    const s = readSettings();
    expect(s.summary_enabled).toBe(false);
    expect(s.learnings_enabled).toBe(true);
  });

  it("falls back to defaults on a malformed file", () => {
    writeFileSync(settingsPath(), "not json {{{");
    expect(readSettings()).toEqual({
      version: 1,
      summary_enabled: false,
      learnings_enabled: false,
    });
  });

  it("falls back to defaults on a wrong-version file", () => {
    writeFileSync(settingsPath(), JSON.stringify({ version: 2, summary_enabled: true }));
    expect(readSettings().summary_enabled).toBe(false);
  });

  it("fills missing keys from defaults", () => {
    writeFileSync(settingsPath(), JSON.stringify({ version: 1, summary_enabled: false }));
    const s = readSettings();
    expect(s.summary_enabled).toBe(false);
    expect(s.learnings_enabled).toBe(false);
  });
});
