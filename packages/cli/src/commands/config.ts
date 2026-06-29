// AI-generated. See PROMPT.md for the prompts and model used.

import { type SettingKey, readSettings, setSetting } from "../config/settings.js";

/**
 * `claude-sessions config <set|get|list>` — read and toggle the persistent CLI
 * settings in `~/.claude-sessions/settings.json`.
 *
 *   config set summary.enabled false
 *   config get learnings.enabled
 *   config list
 *
 * Dotted keys map to the snake_case fields on `SettingsFile`.
 */

export interface ConfigOptions {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

const KEY_MAP: Record<string, SettingKey> = {
  "summary.enabled": "summary_enabled",
  "learnings.enabled": "learnings_enabled",
};

const DOTTED_KEYS = Object.keys(KEY_MAP);

const USAGE = `usage: claude-sessions config <set <key> <value> | get <key> | list>\n  keys:   ${DOTTED_KEYS.join(", ")}\n  values: true | false\n`;

const parseBool = (raw: string): boolean | null => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
};

export const configCommand = async (args: string[], opts: ConfigOptions = {}): Promise<number> => {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const [sub, key, value] = args;

  if (sub === "list") {
    const s = readSettings();
    stdout.write(`summary.enabled=${s.summary_enabled}\n`);
    stdout.write(`learnings.enabled=${s.learnings_enabled}\n`);
    return 0;
  }

  if (sub === "get") {
    const field = key ? KEY_MAP[key] : undefined;
    if (!field) {
      stderr.write(`unknown key: ${key ?? "(none)"}\n${USAGE}`);
      return 2;
    }
    stdout.write(`${readSettings()[field]}\n`);
    return 0;
  }

  if (sub === "set") {
    const field = key ? KEY_MAP[key] : undefined;
    if (!field) {
      stderr.write(`unknown key: ${key ?? "(none)"}\n${USAGE}`);
      return 2;
    }
    const bool = value !== undefined ? parseBool(value) : null;
    if (bool === null) {
      stderr.write(`invalid value: ${value ?? "(none)"} (expected true|false)\n${USAGE}`);
      return 2;
    }
    await setSetting(field, bool);
    stdout.write(`${key}=${bool}\n`);
    return 0;
  }

  stderr.write(USAGE);
  return 2;
};
