# CLI Settings (disable summary / disable learnings) + Watcher Autostart — Design

Date: 2026-06-29
Status: Approved (design)

## Goals

Three user-requested features for the `@claude-sessions/cli`:

1. **Disable summary** — a persistent global setting that stops the automatic
   end-of-session summary nag. Survives across sessions and repos.
2. **Disable learnings (default OFF for now)** — no `learnings` are computed or
   sent on every turn. Re-enableable later; no working code is deleted.
3. **Autostart the watcher on Claude Code start** — the SessionStart hook checks
   whether the watcher is running and starts it if not. No OS-level
   (launchd/systemd) machinery.

## Key finding: feature 3 is already implemented

`packages/cli/src/commands/ensure.ts` (the SessionStart hook, installed by
`install.sh` via `install-hooks`) already does:

```ts
if (!opts.skipDaemon && !isWatcherAlive()) {
  startWatcherDaemon({ cliEntry: ... });
}
```

This is exactly the chosen approach. Feature 3 therefore reduces to
**verification + documentation**, not new construction (see Section D).

## Current architecture (relevant facts)

- Per-user CLI state lives in `~/.claude-sessions/` (override via
  `CLAUDE_SESSIONS_HOME`): `credentials.json`, `state.json`, `repos.json`,
  `watch.pid`, `watch.log`. **There is no general settings file yet.**
- Config files are versioned JSON written atomically through
  `config/atomic.ts` (`withFileLock` + `atomicWriteJson`); `config/state.ts` is
  the reference pattern.
- Summarization is triggered **only** by the Stop hook
  (`commands/stop-hook.ts`), which emits `{"decision":"block","reason":...}` to
  nudge the in-loop agent to run `summarize --current --from-agent`.
- The provisional first-prompt **title** comes from a separate hook,
  `commands/prompt-hook.ts` (UserPromptSubmit). This is independent of the Stop
  hook.
- Learnings flow two ways: (a) the Stop hook appends deterministic evidence
  anchors from `summarizer/signals.ts → detectSignals` to the block reason and
  asks the agent for a `learnings` array; (b) `summarize --from-agent` includes
  that array in the summary upload body.
- Server semantics (from CLAUDE.md): `POST /:id/summary` delete-and-replaces the
  learnings set **only when the `learnings` field is present** and
  `status === "ok"`. An **omitted** `learnings` field leaves existing rows
  untouched; `[]` explicitly clears them.
- `main.ts` parses commands/flags with **commander**.

## Decisions (from clarification)

- Disable summary = **global persistent setting** (not per-repo).
- Disable learnings = **setting, default OFF now** (code retained, just gated).
- Autostart = **SessionStart hook only** (already implemented).
- Provisional first-prompt **title stays even when summary is off**. Only the
  end-of-session Stop-hook nag is suppressed. → `summary_enabled` gates the
  **Stop hook only**, never the prompt-hook.
- CLI surface = **`config set` / `config get` / `config list`** (dotted keys),
  one extensible command.
- Manual `summarize <id>` / `--all` is **unaffected** by `summary_enabled` — an
  explicit invocation always summarizes.

---

## Section A — New `settings.json` config file

New module `packages/cli/src/config/settings.ts`.

```ts
export interface SettingsFile {
  version: 1;
  summary_enabled: boolean;   // default true
  learnings_enabled: boolean; // default false
}
```

- `settingsPath()` added to `config/paths.ts`:
  `join(configHome(), "settings.json")`.
- `readSettings(): SettingsFile` — returns defaults
  (`{ version: 1, summary_enabled: true, learnings_enabled: false }`) when the
  file is missing, the wrong version, or malformed (fail-open, matching the rest
  of the config layer). Unknown future keys are preserved on read where
  practical but at minimum ignored.
- `setSetting(key: "summary_enabled" | "learnings_enabled", value: boolean)` —
  reads-merges-writes atomically via `withFileLock` + `atomicWriteJson` (the
  `config/state.ts` pattern). Creates the file with defaults for the other key.

Rationale: keeps every existing config convention — versioned JSON, atomic
writes, `CLAUDE_SESSIONS_HOME` override.

## Section B — Feature 1: disable summary

### CLI command

New `config` command in `main.ts`:

- `claude-sessions config set <key> <value>` where `<key>` ∈
  `{ summary.enabled, learnings.enabled }` and `<value>` ∈ `{ true, false }`.
  Dotted keys map to `summary_enabled` / `learnings_enabled`. Invalid key or
  value → exit 2 with a usage message listing valid keys.
- `claude-sessions config get <key>` — prints the boolean.
- `claude-sessions config list` — prints all settings, one `key=value` per line.

Implementation in `packages/cli/src/commands/config.ts`. Pure over
`readSettings`/`setSetting`; injectable IO for tests (stdout/stderr).

### Enforcement point

In `commands/stop-hook.ts`, after stdin parse + the `stop_hook_active` loop
guard, call `readSettings()`. If `summary_enabled === false`, return `0`
immediately (no `block` emitted) — the agent is never nagged. The watcher still
tails/uploads events; only the automatic summary authoring nudge is suppressed.

`prompt-hook.ts` is **not** touched — provisional titles continue regardless.
Manual `summarize` is **not** gated.

## Section C — Feature 2: disable learnings (default OFF)

Reads `learnings_enabled` (default `false`) in two places:

1. **Stop-hook block reason** (`stop-hook.ts`): split the current
   `SUMMARY_REASON` into a base clause + an optional learnings clause. When
   learnings are off: emit only the base clause and **skip**
   `renderSignalAnchors(detectSignals(session))` entirely (no per-turn signal
   computation, no `learnings` array requested).

2. **`summarize --from-agent`** (`commands/summarize.ts` →
   `summarizer/pipeline.ts`): when learnings are off, **strip the `learnings`
   field from the upload body** even if the agent supplied one. Because the
   server only touches learnings when the field is *present*, omitting it means
   nothing is sent and existing learnings rows are preserved — the safe
   semantic for a temporary disable.

No code is removed. `detectSignals`, `renderSignalAnchors`, `parseLearnings`,
and the pipeline learnings path all remain; they are gated. Flip
`config set learnings.enabled true` to restore full behavior.

## Section D — Feature 3: autostart watcher (verify + document)

Already implemented in `ensure.ts` (SessionStart hook starts the watcher when
`!isWatcherAlive()`). Work for this feature:

- Add/extend an `ensure` test asserting: when the watcher is dead and
  `skipDaemon` is not set, `startWatcherDaemon` is invoked. (Use the existing
  daemon injection seam.)
- Add one line to `install.sh`'s closing message noting the watcher
  auto-starts / revives whenever Claude Code launches (SessionStart hook), so
  users understand no separate boot step is needed.
- No launchd/systemd; no shell-profile edits.

---

## Testing

- `config/settings.test.ts`: defaults when missing; round-trip set→read;
  malformed file → defaults; setting one key preserves the other.
- `commands/config.test.ts`: `set`/`get`/`list` happy paths; invalid key/value
  → exit 2.
- `commands/stop-hook.test.ts` (extend): `summary_enabled:false` → returns 0,
  no `block` on stdout; `learnings_enabled:false` → block reason omits the
  learnings clause and contains no signal anchors;
  `learnings_enabled:true` → anchors present (existing behavior).
- `commands/summarize.test.ts` (extend): agent payload includes `learnings`
  but `learnings_enabled:false` → uploaded body has **no** `learnings` key;
  with it `true` → `learnings` preserved.
- `commands/ensure.test.ts` (extend): dead watcher → `startWatcherDaemon`
  called.

## Out of scope (YAGNI)

- Per-repo summary/learnings overrides.
- launchd / systemd / shell-profile autostart.
- A web-UI toggle for these settings.
- Gating manual `summarize` or the provisional prompt-hook.
