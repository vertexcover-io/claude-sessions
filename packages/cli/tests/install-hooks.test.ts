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

const read = (): Record<string, never> => JSON.parse(readFileSync(settingsPath, "utf8"));
const commands = (s: {
  hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: string }> }> };
}) => (s.hooks?.SessionStart ?? []).flatMap((m) => (m.hooks ?? []).map((h) => h.command));

describe("install-hooks", () => {
  it("creates settings.json with the SessionStart hook", () => {
    const code = installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    expect(code).toBe(0);
    expect(commands(read())).toContain("claude-sessions ensure");
  });

  it("is idempotent — no duplicate entries on re-run", () => {
    installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    expect(commands(read()).filter((c) => c === "claude-sessions ensure")).toHaveLength(1);
  });

  it("preserves unrelated keys and existing hooks", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        model: "opus",
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
      }),
    );
    installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    const s = read() as Record<string, unknown>;
    expect(s.model).toBe("opus");
    expect((s.hooks as { Stop: unknown[] }).Stop).toHaveLength(1);
    expect(commands(s as never)).toContain("claude-sessions ensure");
  });

  it("uninstall removes only our entry, keeping others", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: "other" }] }] },
      }),
    );
    installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    uninstallHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    const cmds = commands(read());
    expect(cmds).toContain("other");
    expect(cmds).not.toContain("claude-sessions ensure");
  });

  it("uninstall drops the hooks key entirely when nothing else remains", () => {
    installHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    uninstallHooksCommand({ settingsPath, stdout: sink, stderr: sink });
    expect((read() as Record<string, unknown>).hooks).toBeUndefined();
  });
});
