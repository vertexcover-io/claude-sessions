# Pushing session artifacts

## What is an artifact?

An **artifact** is a **Markdown (`.md` / `.markdown`) file the agent created or
edited during the session** — e.g. a design doc, build notes, a report, a
write-up. (For now the feature is Markdown-only; non-`.md` files are not treated
as artifacts even if the agent wrote them.)

Pushed artifacts appear in the web UI's **Artifacts** tab on the session page,
where the Markdown renders in a modal viewer.

## How to push them

```
claude-sessions artifacts <session-id> [--file <path>] [--glob <pattern>] [--dry-run]
```

`<session-id>` is the `<id>.jsonl` filename under `~/.claude/projects/` (also
the id in the web UI URL).

**Default (no flags): auto-derive.** The command reads the session transcript,
finds every file written via a `Write` / `Edit` / `MultiEdit` / `NotebookEdit`
tool call (files only *read* are excluded), keeps the Markdown ones, reads their
current on-disk contents, and uploads them. So the usual flow is simply:

```
claude-sessions artifacts <session-id>
```

**Override: `--file` / `--glob`** replace the auto-derived set (replace, not
union; both repeatable). Use when the doc wasn't written via a tool call, or to
publish a specific subset:

```
claude-sessions artifacts <id> --file docs/report.md
claude-sessions artifacts <id> --glob "docs/**/*.md"
```

The Markdown-only rule still applies to overrides — a non-`.md` `--file` is
dropped with a `skip (not markdown)` warning.

## What gets uploaded

- **Markdown only.** Non-`.md` paths are dropped (with a warning), whether
  auto-derived or passed explicitly.
- **Text only.** A `.md` that's actually binary / non-UTF-8, or is missing, is
  skipped with a warning.
- **Redacted.** Each file's content goes through the canonical redaction pass
  before upload (same secret-scrubbing as events) — defense in depth.
- **Idempotent.** Re-pushing the same path updates that artifact in place (keyed
  on session + path) — no duplicates.
- **Size cap.** Files above the server's per-artifact limit (5 MB) are rejected.

## Preview first

```
claude-sessions artifacts <id> --dry-run
```

`--dry-run` prints the resolved Markdown set and exits **without uploading** —
use it to confirm what will be pushed.
