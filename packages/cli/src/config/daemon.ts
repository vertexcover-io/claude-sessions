// AI-generated. See PROMPT.md for the prompts and model used.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configHome } from "./paths.js";

export const watchPidPath = (): string => join(configHome(), "watch.pid");
export const watchLogPath = (): string => join(configHome(), "watch.log");

const ensureDir = (file: string): void => {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

const readPid = (): number | null => {
  const path = watchPidPath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const watcherPid = (): number | null => {
  const pid = readPid();
  if (pid === null) return null;
  if (!isProcessAlive(pid)) {
    try {
      unlinkSync(watchPidPath());
    } catch {
      // ignore
    }
    return null;
  }
  return pid;
};

export const isWatcherAlive = (): boolean => watcherPid() !== null;

export interface StartDaemonOptions {
  /** Path to the CLI's main.js (resolved by caller). */
  cliEntry: string;
  /** Override node binary (tests). */
  nodeBin?: string;
}

export const startWatcherDaemon = (opts: StartDaemonOptions): number => {
  const existing = watcherPid();
  if (existing !== null) return existing;
  const logPath = watchLogPath();
  const pidPath = watchPidPath();
  ensureDir(logPath);
  const out = openSync(logPath, "a");
  const err = openSync(logPath, "a");
  const child = spawn(opts.nodeBin ?? process.execPath, [opts.cliEntry, "watch"], {
    detached: true,
    stdio: ["ignore", out, err],
    env: { ...process.env, CLAUDE_SESSIONS_HOME: configHome() },
  });
  child.unref();
  if (!child.pid) throw new Error("failed to spawn watcher daemon");
  writeFileSync(pidPath, String(child.pid), { mode: 0o600 });
  return child.pid;
};

export const stopWatcherDaemon = (timeoutMs = 5000): boolean => {
  const pid = watcherPid();
  if (pid === null) return false;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already dead
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
  try {
    unlinkSync(watchPidPath());
  } catch {
    // ignore
  }
  return true;
};
