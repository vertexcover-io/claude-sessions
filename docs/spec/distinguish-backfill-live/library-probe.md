# Library Probe — distinguish-backfill-live

NOT_APPLICABLE

The design doc declares no external dependencies (`## External Dependencies & Fallback Chain` → "None — pure-internal feature"). All work is contained to:

- `packages/cli/src/watcher/chokidar.ts` (existing chokidar dep, no change)
- `packages/cli/src/summarizer/index.ts` (existing logic, internal change)
- `packages/cli/src/commands/summarize.ts` (new command, uses existing CLI plumbing)
- `packages/server/src/db/schema.ts` + new migration SQL (one nullable column)
- `packages/server/src/routes/sessions.ts` (echo new field on read; accept on write)
- `packages/core/src/types.ts` (extend `SessionSummary`)

No third-party APIs. No new npm packages.

<!-- LP:VERDICT:PASS -->
