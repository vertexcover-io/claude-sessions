# claude-sessions command reference

Every command is `claude-sessions <command> [args] [flags]`. Most exit non-zero
on failure. Source of truth: `packages/cli/src/main.ts`.

## Setup & auth

### `init [--server <url>]`
Ensure the CLI is authenticated and the watcher daemon is running. Default
server `http://localhost:3000`. A good first-run convenience that wraps
login + watcher startup.

### `login [--server <url>]`
Authenticate via the dashboard and pair the CLI. Stores a token under
`~/.claude-sessions/`. See `auth-setup.md`.

### `logout`
Stop the watcher and clear stored credentials.

### `ensure [--server <url>]`
Non-interactive: verify the CLI is authenticated and the watcher daemon is
running; warn (never block) if not authenticated; emit a hook note when the
current repo isn't enabled. This is the `SessionStart` hook entry point — you
normally don't run it by hand.

### `install-hooks` / `uninstall-hooks`
Add/remove the global `SessionStart` hook (`claude-sessions ensure`) in
`~/.claude/settings.json`. Idempotent; preserves your other settings.

## Repos

### `enable [path]`
Watch the repo at `path` (defaults to cwd). Required before a repo's sessions
are synced/summarized.

### `disable [path] [--purge]`
Stop watching a repo (defaults to cwd). `--purge` also deletes all of that
repo's events from the cloud.

### `status`
Show watched repos and their last-sync timestamps.

## Capture

### `watch`
Long-running watcher. Tails JSONL files and uploads new events as they appear.

### `sync [--full-scan]`
One-shot catch-up: ingest any pending events for watched repos. `--full-scan`
re-reads every JSONL from byte 0 (the server dedupes by `event_uuid`, so this is
safe but slower).

### `logs [-f|--follow] [-n|--lines <n>]`
Show recent watcher logs. `--follow` streams; `--lines` sets how many to show
(default 200).

## Enrich

### `summarize [session-id] [--current] [--from-agent] [--all] [--force] [--since <iso>] [--yes]`
Write or backfill a session summary. Pick exactly one target: `<session-id>`,
`--current` (the active session for the cwd), or `--all`.
- `--from-agent` reads an agent-authored summary (JSON) from **stdin** and skips
  `claude -p` entirely. Requires a single session (`<id>` or `--current`). See
  `summaries.md` for the JSON contract.
- Without `--from-agent`, runs `claude -p` locally (the metered backfill path).
- `--force` bypasses the watermark/status skip gate.
- `--since <iso>` limits `--all` to sessions started at/after an ISO-8601 time.
- `--yes` skips the confirmation prompt.

### `artifacts <session-id> [--file <path>] [--glob <pattern>] [--dry-run]`
Push the files the agent created/edited during a session. See `artifacts.md`
for the discovery model and override semantics.

## Browse & reuse

### `find <query...>`
Open the dashboard search page for the query.

### `open`
Open the dashboard URL in the default browser.

### `name <session-id> [name]`
Set or clear a session's display name. Pass no name to clear it.

### `fork <session-id> --until <event-uuid> [--cwd <path>]`
Fork a session at an event uuid into a local resumable JSONL. `--cwd` sets the
new transcript's working directory.

### `runs [--limit <n>] [--since <iso>] [--since-days <n>] [--status ok|failed] [--session <id>] [--stats]`
Show summarization runs (`claude -p` invocations) with cost and token totals.
`--stats` prints only the aggregate.

### `mcp`
Print the `claude mcp add` command to register the MCP search server.
