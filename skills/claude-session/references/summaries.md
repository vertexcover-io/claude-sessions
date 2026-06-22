# Authoring a session summary

You (the coding agent) write the summary yourself and push it through the CLI —
no separate `claude -p` call is needed. The CLI merges deterministic facts
(files touched, tool-call counts, PR links) on top of your narrative, redacts,
and uploads.

## How to push it

Pipe a JSON object matching the contract below to stdin:

```
echo '{"title":"...","summary":"...","tags":["..."],"files_touched":["..."],"prs_referenced":[]}' \
  | claude-sessions summarize --current --from-agent
```

- `--current` resolves the active session for the current directory — you do not
  need to know the session id.
- To summarize a specific session instead: `summarize <session-id> --from-agent`.

## JSON contract

All five fields are required (use empty arrays where you have nothing):

| Field | Type | Guidance |
|-------|------|----------|
| `title` | string | ≤ 80 chars, commit-message style. What this session accomplished. |
| `summary` | string | 4–6 sentences. What changed and why; key decisions; outcome. |
| `tags` | string[] | 3–8 kebab-case topic tags (e.g. `auth`, `bug-fix`, `pgvector`). |
| `files_touched` | string[] | Notable files you created/edited (paths). The CLI also adds the ones it mines deterministically — don't worry about being exhaustive. |
| `prs_referenced` | string[] | GitHub PR URLs you opened/referenced, if any. |

`tool_call_counts` is computed by the CLI — do not include it.

A malformed payload (not JSON, or missing/empty `title`/`summary`) fails with a
non-zero exit and uploads nothing.

## When to do it

Fire it when you've completed a meaningful unit of work or are wrapping up. It's
safe to run more than once — re-running updates the summary in place.

## How you get prompted

A `Stop` hook (installed by `claude-sessions install-hooks`) nudges you to
author a summary before a substantive session ends: it returns a `block`
decision asking you to run `summarize --current --from-agent`. Once you've
pushed a fresh summary, the hook lets the session stop. There is no
timer-based / daemon summarization.

## Provisional first-prompt title

A `UserPromptSubmit` hook nudges you, on the **first prompt** of a new session,
to give it a readable title right away (instead of `Session <id>` in the
dashboard). When prompted, run — as your first action, before the task —
`summarize --current --from-agent --provisional` with a short title + one-line
summary derived only from the user's request:

```
echo '{"title":"Add login form","summary":"User asked to add a login form.","tags":["auth"],"files_touched":[],"prs_referenced":[]}' \
  | claude-sessions summarize --current --from-agent --provisional
```

`--provisional` stamps the summary `model=heuristic` so it's never treated as
final — the full `Stop`-hook summary you author later supersedes it. It's quick
and only needs doing once per session.

## Fallback

`claude -p` is a manual last resort, not automatic. If a session ends with no
agent-authored summary, generate one on demand with `summarize <id>` or
`summarize --all` (these invoke `claude -p`). The watcher never summarizes on
its own.
