# claude-sessions — Project Instructions for Claude Code

A Turborepo monorepo (6 packages) inside the flat `vibe-tools` repo. Captures Claude Code session JSONLs, summarizes them, and serves a web UI + MCP server for search.

Read this first; it encodes invariants the codebase relies on.

## Packages

- `@claude-sessions/core` — canonical types, pricing, redaction, repo-detect. **All shared types live here.**
- `@claude-sessions/adapter-claude` — Claude Code JSONL → `CanonicalEvent` adapter, with byteOffset resume.
- `@claude-sessions/cli` — `claude-sessions` binary: login, enable, disable, status, watch, sync, find, open, mcp, fork, name. Owns redaction, summarization, upload, retry.
- `@claude-sessions/server` — Hono + Postgres (pgvector) + Drizzle. Auth, ingest, search, MCP, blob, audit. Hosts the SPA static assets at `/`.
- `@claude-sessions/web` — Vite + React 18 + Tailwind v4 SPA.
- `@claude-sessions/test-config` — shared vitest config.

## Architectural Invariants

These are load-bearing. Don't change them without understanding why.

### Canonical types live in `core`

`CanonicalEvent`, `CanonicalSession`, `SessionSummary`, `InterventionEvent`, `RepoIdentity` are all in `packages/core/src/types.ts` (and `repo-detect.ts`). **Never duplicate these in another package.** Import:

```ts
import type { CanonicalEvent, SessionSummary } from "@claude-sessions/core";
```

If you need a util in two packages, move it to `core` and re-export. That's how `canonicalizeRepo` ended up in `core/repo-detect.ts` after phase 3.

### Summarization runs in the CLI, not the server

The CLI invokes `claude -p` with the structured-output schema, mines PRs deterministically (regex over messages + `gh pr list` fallback), merges, and uploads via `POST /api/sessions/:id/summary`. The server never calls `claude` — it has no Anthropic credentials and shouldn't.

If you're tempted to add `claude -p` to the server, stop and put it in `cli/src/summarizer/`.

**The in-loop agent authors summaries; there is no timer.** The primary trigger is a `Stop` hook (`claude-sessions stop-hook`, installed alongside the `SessionStart` hook by `install-hooks`). When a substantive session has no fresh summary, the hook emits `decision: "block"` once (guarded by `stop_hook_active`) so the live agent runs `summarize --current --from-agent` and pushes its own summary. `claude -p` is a **manual last resort** — it only runs when someone explicitly invokes `summarize <id>` / `--all` without `--from-agent`. The watcher (`JsonlWatcher`) only tails and uploads events; it never summarizes. The old `SessionEndDetector` 60s-silence trigger has been removed.

**Settings gate the Stop-hook nag and learnings.** `~/.claude-sessions/settings.json` (`config/settings.ts`, read via `readSettings()`; toggled with `claude-sessions config set/get/list`) holds `summary_enabled` (default `true`) and `learnings_enabled` (default `false`). When `summary_enabled` is false the Stop hook returns without blocking (no nag) — provisional titles (`prompt-hook`) and manual `summarize` are **not** gated. When `learnings_enabled` is false (the default) the Stop hook omits the learnings clause + signal anchors, and `summarizeAndUpload` **omits** the `learnings` field from the upload (omit, not `[]`, so existing server-side learnings are preserved). The pipeline default is `readSettings().learnings_enabled`, overridable via `PipelineDeps.learningsEnabled` (tests).

**Provisional first-prompt title.** A `UserPromptSubmit` hook (`claude-sessions prompt-hook`, also installed by `install-hooks`) gives a brand-new session a readable title immediately instead of `Session <id>`. The hook probes the server and, when no `ok` summary exists, injects a one-time `hookSpecificOutput.additionalContext` instruction telling the in-loop agent to run `summarize --current --from-agent --provisional` as its first action. The hook never summarizes itself; it fails open on every uncertainty (the turn is blocking with a 30s timeout). The provisional summary is stamped `model: "heuristic"` so it is never treated as authoritative — the end-of-session Stop-hook agent summary (`model: "agent"`) supersedes it.

The watermark still gates re-summarization: `Summarizer.summarize` skips when an existing `ok` summary's `summarized_event_count` is within `minResumarizeDelta` (default 5) of the current count. `readWatermark` (`summarizer/watermark.ts`) is the shared predicate — the Summarizer uses it to decide whether to re-summarize, and the Stop hook uses it to decide whether to nag. **A `model: "heuristic"` summary is always treated as not-fresh** (in both `readWatermark` and the Summarizer's `backfillOnly` skip) so the provisional title is always upgradable. The `summaries.summarized_event_count` column (nullable; `0004_summarized_event_count.sql`) is the persisted watermark. `summarize --force` and `Summarizer({ force: true })` bypass the gate; agent-authored (`--from-agent`) summaries are always written.

**Per-session learnings ride the summary push.** Failure episodes the agent diagnoses travel inside the same `summarize --from-agent` body as an optional `learnings` array (snake_case `SessionLearning` in `core/types.ts`; never a separate command/endpoint). The Stop hook computes deterministic evidence anchors over the full JSONL (`summarizer/signals.ts → detectSignals`) and inlines them into the block reason so long sessions stay diagnosable. The server (`POST /:id/summary`) **delete-and-replaces** the whole `learnings` set per session, but only when `status === "ok"` **and** the field is present — an omitted `learnings` leaves existing rows untouched (a failed/partial re-run must not wipe good learnings), while `[]` is an explicit "clean session" that clears them. Every learning must cite ≥1 `event_uuid` (evidence-anchored; enforced in `parseLearnings` and the server zod schema). Provenance (`model`/`generated_at`/`summarized_event_count`) is stamped server-side from the summary envelope. Learnings are returned bundled in `GET /:id` and surfaced in the web **Learnings** tab (`learnings` table, migration `0006_learnings.sql`; no embedding column — per-session display is local). CTRL+C mid-turn loses only the final turn's learnings; backfill with a manual `summarize <id>` over the complete JSONL. Read via `claude-sessions learnings <id>` (deterministic markdown from `core/render-learnings.ts`, the single source of truth shared with the UI).

### Redaction is canonical at the CLI; server is defense in depth

`packages/core/src/redact.ts` is THE redaction implementation (regex patterns + Shannon-entropy heuristic, idempotent). The CLI runs it on every event before upload. The server runs `redactDeep` (which wraps `core.redact`) on ingest payloads as a safety net for misbehaving or legacy clients.

`redact(redact(x)) === redact(x)` — keep this property. The replacement token `[REDACTED:kind]` is non-matching against any pattern.

**Env-line redact wins over more specific patterns** (e.g. an OpenAI-key regex). When `OPENAI_KEY=sk-...` appears, the env-line regex captures the whole line including the value. This is intentional defense-in-depth — don't "fix" it.

### Embedding provider is pluggable

`EMBED_PROVIDER` env var selects the strategy (in `packages/server/src/embed/index.ts`):

- `openai` (default): `text-embedding-3-small` via raw fetch (no SDK)
- `bge`: stub, throws "not implemented in v0"
- `fake`: deterministic SHA256-derived L2-normalized 1536-vector — used by tests so CI doesn't need an OpenAI key
- `none`: skip embedding entirely

When adding a new provider, keep the 1536-dim contract — the `summaries.embedding` column is `vector(1536)`.

### pgvector embedding is generated inline on summary upload (no worker)

`POST /api/sessions/:id/summary` runs the embedding call and inserts into `summaries.embedding` in the same transaction. Search is immediately consistent. **Don't introduce a queue or worker without a real reason** — v0 traffic is single-user and the CLI is already async.

### `event_uuid` is the dedupe key

Server upserts ingest events on `event_uuid`. Idempotent re-uploads depend on this. EDGE-002 (inode replacement) and the retry/backoff loop both rely on it. Any new ingest path must preserve uniqueness per (session, line).

### JWT `aud` claim distinguishes token types

- `aud=api` — normal session token (login)
- `aud=mcp` — MCP server token (issued by `POST /api/auth/mcp-token`)

Middleware checks `aud` per route. Don't collapse the two.

### Auth is GitHub OAuth (org-gated); reads are global, writes are owner-only

Login is the GitHub OAuth web flow (`GET /api/auth/github/start` → `…/callback`), gated to one org via `GITHUB_ORG` (only `active` members; checked with the user token against `GET /user/memberships/orgs/{org}`). There is **no password login** — `auth/github.ts` is the injectable client seam (stub it in tests via `buildApp(db, env, { githubClient })`), and `db/users.ts` `upsertGithubUser` resolves by `github_id` then **adopts an existing row by email** then inserts. The CLI is unchanged: it still uses the pairing-code flow on top of the web session.

**Reads are global, writes are owner-scoped.** Every GET read path (sessions list, `:id` detail + sub-routes, repos, search, facets, MCP, `lib/sessions-internal.ts`) dropped the `eq(sessions.userId, …)` filter — any authenticated member sees all **non-private** sessions, each carrying an `author { github_login, avatar_url }` (LEFT JOIN `users`). Private sessions are hidden from everyone's lists; their detail stays masked `(private)`. **Mutations keep `eq(sessions.userId, user.id)`** (PATCH, summary POST, blob/artifact write, privacy flip) — don't globalize those. Ingest auto-grants `user_repos` on first push instead of gating. The `role` column is vestigial (no admin concept); don't build authorization on it. `?user=<github_login>` filters lists/search; the users facet powers the dropdowns.

### TIMESTAMPTZ everywhere

All timestamp columns are `timestamp with time zone`. ISO strings on the wire end in `Z`. Drizzle returns `Date`; raw `postgres-js` template literals return strings (use the query builder for `Z`-suffix assertions).

## Test Patterns

- **Server integration tests use `testcontainers`** with `pgvector/pgvector:pg16`. Don't migrate to pg-mem / sqlite — pgvector, FTS, and IMMUTABLE-indexed expressions don't survive the substitution.
- **`execFile`-based subprocesses (claude, gh) are mocked via `vi.mock("node:child_process")`**. Don't add a heavyweight mock library — `vi.mock` + a typed `execFile` factory is enough. See `packages/cli/src/summarizer/claude-runner.test.ts`.
- **CLI integration tests use an in-process HTTP mock server** — see `packages/cli/tests/helpers/mock-server.ts`. Avoids spinning up the real Hono server for CLI-side flows.
- **Web tests use jsdom**. `tanstack-virtual` returns 0-height scroll containers under jsdom — flat-render below 50 events, virtualize above (already wired in `TranscriptList`).
- **Use real Postgres for any FTS/vector/IMMUTABLE-index assertion**. Mocks lie about Postgres semantics.

## Tooling

- **Bun** for install + script running. Workspace root: `claude-sessions/`. Run `bun install` from there.
- **Turbo** for task orchestration (`bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`).
- **Biome** for lint + format. `biome check .` from the workspace root.
- **TypeScript strict** + `verbatimModuleSyntax: true`. Always use `import type` for types.
- **Drizzle** ORM + raw SQL migrations in `packages/server/src/db/migrations/`. Both kept in sync by hand.
- **Docker compose** at `claude-sessions/docker-compose.yml` runs Postgres on `:5433` for local dev.

## Common Gotchas

- **Postgres FTS index needs an IMMUTABLE wrapper function** (`summaries_fts_text(...)`). Naive `to_tsvector('english', coalesce(...))` fails because `coalesce` over `regconfig` is STABLE.
- **MCP SDK SSE transport is deprecated** (1.29.0+). Use `WebStandardStreamableHTTPServerTransport` (stateless, `enableJsonResponse: true`) — Hono-compatible.
- **chokidar v4 has named exports only**: `import { watch as chokidarWatch, type FSWatcher } from "chokidar"`.
- **Biome `useLiteralKeys` vs TS `noUncheckedIndexedAccess`** — use dot access on `process.env.X`. Still narrows to `string | undefined`.
- **`bytea` returns as Node `Buffer`** — copy into a fresh `Uint8Array` for `new Response(...)` byte-equality.
- **4xx is non-retryable** in the CLI uploader — auth/RBAC failures don't burn the backoff schedule. See `cli/src/upload/retry.ts` and its `shouldRetry` predicate.
- **Inode replacement (EDGE-002)**: when the persisted offset > new file size, reset offset to 0; server dedupe by `event_uuid` keeps it idempotent.
- **`db.query.<table>.findFirst` requires `relations(...)` declarations**. We chose plain `db.select().from().where().limit(1)` to keep the schema relation-free. Don't add relations unless you really need them.
- **Turbo doesn't pass env vars to tasks by default**. Add to `turbo.json`'s `env: [...]` passthrough list (e.g. `DATABASE_URL`, `JWT_SECRET`, `EMBED_PROVIDER`).
- **rehype-shiki fails to compile under Node 25** (oniguruma native build). Currently no inline syntax highlighting in markdown. To re-add: `@shikijs/rehype` with a working Node pin.

## Where to Find Things

- Canonical types: `packages/core/src/types.ts`
- Redaction: `packages/core/src/redact.ts`
- Pricing: `packages/core/src/pricing.ts`
- Repo identity / git detection: `packages/core/src/repo-detect.ts`
- Adapter (Claude JSONL): `packages/adapter-claude/src/{index,stream}.ts`
- Server entry: `packages/server/src/main.ts` → `app.ts` (router composition)
- Server schema (SQL): `packages/server/src/db/migrations/0001_init.sql`
- Server schema (Drizzle): `packages/server/src/db/schema.ts`
- Embedding providers: `packages/server/src/embed/{index,openai,bge,fake}.ts`
- Search (RRF + FTS + vector): `packages/server/src/lib/search-internal.ts`
- MCP server (6 tools): `packages/server/src/routes/mcp.ts`
- CLI entry: `packages/cli/src/main.ts`
- CLI commands: `packages/cli/src/commands/` (incl. `summarize.ts` for one-shot + `--all` runs)
- CLI watcher + uploader: `packages/cli/src/watcher/` and `packages/cli/src/upload/`
- CLI summarizer: `packages/cli/src/summarizer/` (watermark + skip-rule live in `index.ts`)
- Web SPA pages: `packages/web/src/pages/`
- Web transcript components: `packages/web/src/components/transcript/`

## Style

- TypeScript strict; type all functions.
- Prefer small, focused functions; early returns over nested conditionals.
- No needless comments / docstrings.
- No emojis in code or commit messages unless the user asks.
- Commit conventions: per-tool addition uses `add <tool-name>: <one-line>`, but inside this monorepo prefer conventional `feat:` / `fix:` / `refactor:` prefixes.
