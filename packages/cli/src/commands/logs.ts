// AI-generated. See PROMPT.md for the prompts and model used.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { watchLogPath } from "../config/daemon.js";

export interface LogsOptions {
  follow?: boolean;
  lines?: number;
}

export const logsCommand = async (opts: LogsOptions = {}): Promise<number> => {
  const path = watchLogPath();
  if (!existsSync(path)) {
    process.stdout.write("no watcher logs yet — run `claude-sessions init` first.\n");
    return 0;
  }
  const lines = opts.lines ?? 200;
  if (opts.follow) {
    return new Promise<number>((resolve) => {
      const child = spawn("tail", ["-n", String(lines), "-F", path], { stdio: "inherit" });
      child.on("close", (c) => resolve(c ?? 0));
      child.on("error", () => resolve(127));
    });
  }
  const contents = readFileSync(path, "utf8").split("\n");
  const tail = contents.slice(Math.max(0, contents.length - lines)).join("\n");
  process.stdout.write(tail);
  if (!tail.endsWith("\n")) process.stdout.write("\n");
  return 0;
};
