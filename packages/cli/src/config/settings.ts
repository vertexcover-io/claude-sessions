// AI-generated. See PROMPT.md for the prompts and model used.

import { atomicWriteJson, readJsonOr, withFileLock } from "./atomic.js";
import { settingsPath } from "./paths.js";

/**
 * User-tunable CLI behavior, persisted at `~/.claude-sessions/settings.json`.
 *
 * - `summary_enabled` gates the automatic end-of-session summary nag (the Stop
 *   hook). Provisional first-prompt titles and manual `summarize` are
 *   unaffected. Default on.
 * - `learnings_enabled` gates per-turn learnings: signal detection in the Stop
 *   hook and the `learnings` field on the summary upload. Default OFF — no
 *   learnings are computed or sent until the user opts in.
 */
export interface SettingsFile {
  version: 1;
  summary_enabled: boolean;
  learnings_enabled: boolean;
}

export type SettingKey = "summary_enabled" | "learnings_enabled";

const defaults = (): SettingsFile => ({
  version: 1,
  summary_enabled: true,
  learnings_enabled: false,
});

/**
 * Read settings, falling back to defaults on a missing, wrong-version, or
 * malformed file (fail-open, matching the rest of the config layer).
 */
export const readSettings = (): SettingsFile => {
  const raw = readJsonOr<Partial<SettingsFile> | null>(settingsPath(), null);
  if (!raw || raw.version !== 1) return defaults();
  const base = defaults();
  return {
    version: 1,
    summary_enabled:
      typeof raw.summary_enabled === "boolean" ? raw.summary_enabled : base.summary_enabled,
    learnings_enabled:
      typeof raw.learnings_enabled === "boolean" ? raw.learnings_enabled : base.learnings_enabled,
  };
};

/** Atomically set one setting, preserving the other. */
export const setSetting = async (key: SettingKey, value: boolean): Promise<void> => {
  await withFileLock(settingsPath(), () => {
    const current = readSettings();
    atomicWriteJson(settingsPath(), { ...current, [key]: value });
  });
};
