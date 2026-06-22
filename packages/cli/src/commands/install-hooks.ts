// AI-generated. See PROMPT.md for the prompts and model used.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The hooks we manage. `SessionStart` keeps auth + the watcher up;
 * `UserPromptSubmit` gives a new session a provisional title on its first
 * prompt; `Stop` makes the in-loop agent author its own session summary
 * before the turn ends (the primary summarization trigger — there is no timer).
 */
const MANAGED_HOOKS: { event: string; command: string }[] = [
  { event: "SessionStart", command: "claude-sessions ensure" },
  { event: "UserPromptSubmit", command: "claude-sessions prompt-hook" },
  { event: "Stop", command: "claude-sessions stop-hook" },
];

const MANAGED_COMMANDS = new Set(MANAGED_HOOKS.map((h) => h.command));
const MANAGED_EVENTS = new Set(MANAGED_HOOKS.map((h) => h.event));

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

const hasCommand = (matchers: HookMatcher[], command: string): boolean =>
  matchers.some((m) => (m.hooks ?? []).some((h) => h.command === command));

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

  const installed: string[] = [];
  for (const mh of MANAGED_HOOKS) {
    const matchers = asMatchers(hooks[mh.event]);
    if (hasCommand(matchers, mh.command)) continue;
    matchers.push({ hooks: [{ type: "command", command: mh.command }] });
    hooks[mh.event] = matchers;
    installed.push(mh.event);
  }

  if (installed.length === 0) {
    stdout.write(`hooks already installed in ${path}\n`);
    return 0;
  }

  settings.hooks = hooks;
  writeSettings(path, settings);
  stdout.write(`installed ${installed.join(" + ")} hook(s) in ${path}\n`);
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

  // Rebuild without empty keys (rather than `delete`) so an emptied hooks
  // object drops out entirely instead of serializing as `{}`.
  let removed = false;
  const nextHooks: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(hooks)) {
    if (!MANAGED_EVENTS.has(k) || !Array.isArray(v)) {
      nextHooks[k] = v;
      continue;
    }
    const filtered = asMatchers(v)
      .map((m) => {
        const kept = (m.hooks ?? []).filter((h) => !MANAGED_COMMANDS.has(h.command ?? ""));
        if (kept.length !== (m.hooks ?? []).length) removed = true;
        return { ...m, hooks: kept };
      })
      .filter((m) => (m.hooks ?? []).length > 0);
    if (filtered.length > 0) nextHooks[k] = filtered;
  }

  if (!removed) {
    stdout.write("nothing to uninstall\n");
    return 0;
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
  stdout.write(`removed claude-sessions hooks from ${path}\n`);
  return 0;
};
