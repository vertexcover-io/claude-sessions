---
name: claude-session
description: >-
  Use the claude-sessions CLI to capture, sync, summarize, search, and push
  artifacts from Claude Code coding sessions to the claude-sessions server.
  Use this when a user wants to set up session capture, push a session's
  generated files (artifacts), back-fill or summarize past sessions, find a
  prior session, or fork one — i.e. any task driving the `claude-sessions`
  binary end to end.
---

# Capturing Claude Code sessions

The `claude-sessions` CLI ships every Claude Code session (the JSONL transcript
under `~/.claude/projects/`) to a server that summarizes and indexes it, then
serves a web UI + MCP search. This skill is the operator's guide to driving it.

## Prerequisites

- The `claude-sessions` binary is installed and on `PATH`.
- A reachable server URL (default `http://localhost:3000`).

If you are unsure whether the CLI is set up, run `claude-sessions status`.

**One-time setup:** `claude-sessions install-hooks` adds a global `SessionStart`
hook (`claude-sessions ensure`) so every new session automatically verifies
auth and starts the watcher. After that, capture is hands-off.

## End-to-end workflow

Do these in order the first time; afterwards only the step you need.

1. **Authenticate** — `claude-sessions login --server <url>`. Pairs the CLI and
   stores a token. See `references/auth-setup.md`.
2. **Enable a repo** — from inside the repo: `claude-sessions enable`. This is
   what makes the repo's sessions eligible for sync/summary.
3. **Check state** — `claude-sessions status` lists watched repos and last-sync
   times.
4. **Capture sessions** — either run the long-lived `claude-sessions watch`
   (tails + uploads live) or do a one-shot `claude-sessions sync` to catch up.
5. **Summarize (you author it)** — when you've done significant work or are
   wrapping up, write the summary yourself and push it:
   ```
   echo '<json>' | claude-sessions summarize --current --from-agent
   ```
   The JSON contract and field guidance are in `references/summaries.md`. The
   CLI merges deterministic facts (files touched, tool counts) on top of your
   narrative. You do NOT need to know the session id — `--current` resolves it.
   If you don't summarize, the watcher daemon backfills it with `claude -p`.
6. **Push artifacts** — `claude-sessions artifacts <session-id>` uploads the
   **Markdown files** the agent created/edited so they show in the web Artifacts
   tab. See `references/artifacts.md` for what counts as an artifact and how.

## When the SessionStart hook asks for a summary

When capture is active, the `ensure` hook injects a standing reminder: after
completing any **significant task** (a feature, fix, or refactor — not every
small edit), author a summary and push it with `summarize --current
--from-agent` (step 5 above). This is the expected default, not an exception.

## When the SessionStart hook says a repo isn't enabled

The `ensure` hook injects a note when the current repo isn't enabled for
capture. When you see it: **ask the user** whether to enable session capture
for this repo. If they say yes, run `claude-sessions enable` (it also refreshes
the watcher). If no, do nothing — this session simply won't be saved.

Full per-command flag reference: `references/commands.md`.

## Which command do I want?

- "Get my sessions into the server" → `watch` (continuous) or `sync` (one-shot).
- "Write the title/summary/search index for this session" → `summarize --current --from-agent` (you author it).
- "Backfill summaries for old sessions" → `summarize <id>` / `--all` (uses `claude -p`).
- "Publish the Markdown docs this session produced" → `artifacts`.
- "Find an old session" → `find <query>` (opens the dashboard search).
- "Resume an old session locally" → `fork <session-id> --until <event-uuid>`.

`sync` uploads raw events; summarizing is a separate step. When **you** author
the summary (`--from-agent`) it costs nothing extra; the `claude -p` backfill
path is metered. Artifacts are independent of both — you can push artifacts for
any synced session.

## Common gotchas

- **Enable before sync.** `sync`/`summarize` only touch sessions in repos you
  have `enable`d. A "nothing to do" result usually means the repo isn't enabled.
- **Agent summaries always win.** Your `--from-agent` summary is authoritative;
  the daemon's `claude -p` backfill skips any session that already has a summary.
- **`claude -p` backfill is metered.** Prefer a specific `<session-id>` over
  `--all`; `--all` respects a watermark and skips already-summarized sessions
  (override with `--force`).
- **Artifacts are Markdown-only (for now).** Auto-derive keeps only `.md`/
  `.markdown` files the agent wrote; non-md paths are dropped with a warning,
  even when passed via `--file`/`--glob`. `--file`/`--glob` **replace** the
  auto set (not union). Use `--dry-run` to preview. See `references/artifacts.md`.
- **Session id = JSONL filename.** A session's id is the `<id>.jsonl` filename
  under `~/.claude/projects/<encoded-cwd>/`; it's also shown in the web UI URL.
