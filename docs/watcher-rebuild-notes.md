# Watcher Rebuild Notes

Operational notes from rebuilding the `claude-sessions` watcher daemon against a
fresh build.

## Procedure

1. **Stop the watcher.** The daemon's PID lives in `~/.claude-sessions/watch.pid`
   (managed by `packages/cli/src/config/daemon.ts`). Send `SIGTERM`, escalate to
   `SIGKILL` if it's still alive after a grace period, then remove the pidfile.
2. **Build.** Run `bun run build` from the workspace root — Turbo rebuilds only
   the packages whose inputs changed (the CLI was a cache miss here; the rest
   replayed from cache).
3. **Restart.** `claude-sessions ensure` re-spawns the detached watcher singleton
   if `watch.pid` is absent or stale, writing the new PID and appending to
   `~/.claude-sessions/watch.log`.

## Notes

- `ensure` is idempotent: if a live watcher already owns `watch.pid`, it returns
  the existing PID instead of spawning a duplicate. Clearing the stale pidfile is
  what lets a restart actually take.
- The restarted watcher runs off the freshly built `packages/cli/dist/main.js`,
  so a rebuild only takes effect after the bounce.
- `logout` also stops the watcher but additionally clears credentials — prefer
  the manual SIGTERM + `ensure` cycle when you only want to pick up a new build.
