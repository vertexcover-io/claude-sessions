// AI-generated. See PROMPT.md for the prompts and model used.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installHooksCommand, uninstallHooksCommand } from "../src/commands/install-hooks.js";

let dir: string;
let settingsPath: string;
const sink = { write: () => true } as unknown as NodeJS.WritableStream;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cs-hooks-"));
  settingsPath = join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Settings = {
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
} & Record<string, unknown>;

const read = (): Settings => JSON.parse(readFileSync(settingsPath, "utf8"));
const commands = (s: Settings, event: string): (string | undefined)[] =>
  (s.hooks?.[event] ?? []).flatMap((m) => (m.hooks ?? []).map((h) => h.command));

describe("install-hooks", () => {
  it("creates settings.json with the SessionStart, UserPromptSubmit and Stop hooks", () => {
    const code = installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    expect(code).toBe(0);
    expect(commands(read(), "SessionStart")).toContain("claude-sessions ensure");
    expect(commands(read(), "UserPromptSubmit")).toContain("claude-sessions prompt-hook");
    expect(commands(read(), "Stop")).toContain("claude-sessions stop-hook");
  });

  it("is idempotent — no duplicate entries on re-run", () => {
    installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    const s = read();
    expect(commands(s, "SessionStart").filter((c) => c === "claude-sessions ensure")).toHaveLength(
      1,
    );
    expect(
      commands(s, "UserPromptSubmit").filter((c) => c === "claude-sessions prompt-hook"),
    ).toHaveLength(1);
    expect(commands(s, "Stop").filter((c) => c === "claude-sessions stop-hook")).toHaveLength(1);
  });

  it("preserves unrelated keys and a pre-existing Stop hook", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        model: "opus",
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
      }),
    );
    installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    const s = read();
    expect(s.model).toBe("opus");
    // Our Stop hook is appended alongside the user's existing one.
    expect(commands(s, "Stop")).toContain("echo hi");
    expect(commands(s, "Stop")).toContain("claude-sessions stop-hook");
    expect(commands(s, "SessionStart")).toContain("claude-sessions ensure");
  });

  it("uninstall removes only our entries, keeping others", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "other" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }],
        },
      }),
    );
    installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    uninstallHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    const s = read();
    expect(commands(s, "SessionStart")).toContain("other");
    expect(commands(s, "SessionStart")).not.toContain("claude-sessions ensure");
    expect(commands(s, "Stop")).toContain("echo hi");
    expect(commands(s, "Stop")).not.toContain("claude-sessions stop-hook");
    expect(commands(s, "UserPromptSubmit")).not.toContain("claude-sessions prompt-hook");
  });

  it("uninstall drops the hooks key entirely when nothing else remains", () => {
    installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    uninstallHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    expect(read().hooks).toBeUndefined();
  });
});
