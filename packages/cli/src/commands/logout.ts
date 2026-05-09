// AI-generated. See PROMPT.md for the prompts and model used.

import { clearCredentials, readCredentials } from "../config/credentials.js";
import { isWatcherAlive, stopWatcherDaemon } from "../config/daemon.js";

export const logoutCommand = async (): Promise<number> => {
  const creds = readCredentials();
  if (isWatcherAlive()) {
    stopWatcherDaemon();
    process.stdout.write("stopped watcher.\n");
  }
  if (!creds) {
    process.stdout.write("not logged in.\n");
    return 0;
  }
  clearCredentials();
  process.stdout.write(`logged out ${creds.user_email}.\n`);
  return 0;
};
