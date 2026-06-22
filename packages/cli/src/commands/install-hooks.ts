// AI-generated. See PROMPT.md for the prompts and model used.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HOOK_COMMAND = "claude-sessions ensure";

export interface InstallHooksOptions {
  /** Override the settings.json path (tests). */
  settingsPath?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

interface HookCommand {
  type?: string;
  command?: string;
}
interface HookMatcher {
  matcher?: string;
  hooks?: HookCommand[];
}

const defaultSettingsPath = (): string => join(homedir(), ".claude", "settings.json");

const readSettings = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`failed to parse ${path} — fix or remove it, then re-run`);
  }
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
};

const writeSettings = (path: string, settings: Record<string, unknown>): void => {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
};

const asMatchers = (v: unknown): HookMatcher[] => (Array.isArray(v) ? (v as HookMatcher[]) : []);

const hasOurHook = (matchers: HookMatcher[]): boolean =>
  matchers.some((m) => (m.hooks ?? []).some((h) => h.command === HOOK_COMMAND));

export const installHooksCommand = (opts: InstallHooksOptions = {}): number => {
  const path = opts.settingsPath ?? defaultSettingsPath();
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  let settings: Record<string, unknown>;
  try {
    settings = readSettings(path);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const hooks =
    settings.hooks && typeof settings.hooks === "object"
      ? (settings.hooks as Record<string, unknown>)
      : {};
  const sessionStart = asMatchers(hooks.SessionStart);

  if (hasOurHook(sessionStart)) {
    stdout.write(`SessionStart hook already installed in ${path}\n`);
    return 0;
  }

  sessionStart.push({ hooks: [{ type: "command", command: HOOK_COMMAND }] });
  hooks.SessionStart = sessionStart;
  settings.hooks = hooks;
  writeSettings(path, settings);
  stdout.write(`installed SessionStart hook (\`${HOOK_COMMAND}\`) in ${path}\n`);
  return 0;
};

export const uninstallHooksCommand = (opts: InstallHooksOptions = {}): number => {
  const path = opts.settingsPath ?? defaultSettingsPath();
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  if (!existsSync(path)) {
    stdout.write("nothing to uninstall\n");
    return 0;
  }

  let settings: Record<string, unknown>;
  try {
    settings = readSettings(path);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const hooks =
    settings.hooks && typeof settings.hooks === "object"
      ? (settings.hooks as Record<string, unknown>)
      : {};
  if (!Array.isArray(hooks.SessionStart)) {
    stdout.write("nothing to uninstall\n");
    return 0;
  }

  const filtered = asMatchers(hooks.SessionStart)
    .map((m) => ({ ...m, hooks: (m.hooks ?? []).filter((h) => h.command !== HOOK_COMMAND) }))
    .filter((m) => (m.hooks ?? []).length > 0);

  // Rebuild without empty keys (rather than `delete`) so an emptied hooks
  // object drops out entirely instead of serializing as `{}`.
  const nextHooks: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(hooks)) {
    if (k === "SessionStart") {
      if (filtered.length > 0) nextHooks[k] = filtered;
    } else {
      nextHooks[k] = v;
    }
  }
  const nextSettings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (k === "hooks") {
      if (Object.keys(nextHooks).length > 0) nextSettings[k] = nextHooks;
    } else {
      nextSettings[k] = v;
    }
  }

  writeSettings(path, nextSettings);
  stdout.write(`removed SessionStart hook from ${path}\n`);
  return 0;
};
