# Authentication & local state

## Logging in

```
claude-sessions login --server <url>
```

This pairs the CLI with the server (via the dashboard) and writes a bearer
token to local state. `init --server <url>` does the same and also starts the
watcher.

The default server is `http://localhost:3000`. Point `--server` at your
deployment otherwise.

## Where state lives

All CLI state is under `~/.claude-sessions/`:

- `credentials.json` — `{ server_url, token, user_email }`. Created by `login`;
  read by every command that talks to the server. `logout` clears it.
- `repos.json` — which local repos are enabled (keyed by canonical repo URL).
  Managed by `enable` / `disable`.
- `state.json` — per-JSONL upload progress (byte offset, last event uuid). Lets
  `sync`/`watch` resume without re-uploading.

Session transcripts themselves are read from Claude Code's own location:
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.

## Verifying

- `claude-sessions status` — shows watched repos + last-sync times. If it errors
  about credentials, re-run `login`.
- A `4xx` from the server is treated as non-retryable by the uploader (auth/RBAC
  failures won't burn the backoff schedule) — if uploads consistently 401/403,
  re-authenticate.

## Auth model (background)

Tokens are JWTs. Normal CLI/session calls use an `aud=api` token; the MCP server
uses a separate `aud=mcp` token issued on demand. You don't manage these by
hand — `login` and `mcp` handle them.
