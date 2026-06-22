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

## Fallback

If you never push a summary, the watcher daemon detects end-of-session and
generates one with `claude -p` (backfill-only: it skips any session that already
has a summary, so your agent-authored summary is never overwritten). Set
`CLAUDE_SESSIONS_SUMMARIZE=0` to disable the fallback entirely.
