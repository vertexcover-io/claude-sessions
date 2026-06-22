# Per-Session Learning Extraction — Design

Date: 2026-06-22
Status: Design (not yet implemented)
Scope: **Per-session** failure/learning extraction only. Cross-session pattern
mining ("Insights" page, learning embeddings, clustering) is explicitly out of
scope here and tracked separately.

## Goal

For each captured session, detect where things went wrong and *why*, attribute a
root cause, ground every claim in transcript evidence, and surface it in the
dashboard (a "Learnings" tab on `session/:id`) plus a CLI read command. The
mechanism rides the existing Stop-hook + agent-summary push — **no new trigger,
no new push command, no session-end detection.**

## Research basis

- **MAST** ("Why Do Multi-Agent LLM Systems Fail?", NeurIPS 2025) — the 3-category /
  14-mode failure taxonomy and the LLM-as-judge discipline (tag against concrete
  trace evidence). We adopt its enum.
- **Reflexion** — the agent that did the work verbally reflects on a *concrete
  outcome signal*, not free recall.
- **ExpeL** — collect → abstract. We do the "collect" (per-session) here; "abstract"
  (cross-session) is out of scope.
- **Hermes** — let the in-loop agent decide what's worth persisting, at a turn
  boundary, with an activity threshold.

## Core principle

**Evidence-anchored, not free-recall.** A learning record MUST cite ≥1 event UUID
of observed evidence (a user correction, a tool failure, a reopened task). No
evidence → no record. This is what prevents the model from inventing failures in
clean sessions.

---

## Data shapes

### Fixed enums (aggregatable)

Single root-cause classifier. We deliberately do **not** carry MAST's 14-mode
`failureMode` enum: MAST was designed for multi-agent systems (roles, inter-agent
comms) — most modes don't apply to a single Claude Code agent + user, and the ones
that do collapse onto `RootCause` 1:1, so a second enum only adds classification
ambiguity and an extra aggregation axis. `RootCause` + the orthogonal
`attributedTo` + `severity` are non-overlapping and sufficient for the per-session
tab. (Finer granularity can be added later if the cross-session Insights page
needs it.)

```ts
type RootCause =
  | "underspecified_request"
  | "instruction_not_followed"
  | "missing_verification"
  | "task_derailment"        // "model drift"
  | "context_loss"
  | "environment_or_tooling";

type AttributedTo = "user" | "agent" | "shared" | "environment";
```

### `SessionLearning` (canonical record — lives in `core/types.ts`)

`title` is the short scannable headline (card/list/anchor). `whatWentWrong` and
`whatWouldHavePrevented` are **descriptive markdown** — narrative paragraphs that
explain context, what the agent did, the expectation gap, and the corrective
*principle* with reasoning — NOT one-line fixes.

```ts
interface SessionLearning {
  title: string;                   // short headline (≤80 chars) — card/list/anchor
  episodeEventUuids: string[];     // evidence anchors (≥1 required)
  whatWentWrong: string;           // descriptive md: situation, action, expectation gap, why
  whatWouldHavePrevented: string;  // descriptive md: corrective principle + reasoning
  rootCause: RootCause;
  attributedTo: AttributedTo;
  confidence: number;              // 0..1
  severity?: "low" | "medium" | "high";
}
```

---

## The pipeline, in order of occurrence

### Stage 0 — Capture (existing, unchanged)
The `JsonlWatcher` tails the session JSONL and uploads `CanonicalEvent`s to the
server (dedupe by `event_uuid`). No summarization here. This is the raw material.

### Stage 1 — Signal detection (deterministic, cheap, at capture)
Compute *candidate failure episodes* over the **full JSONL** (not the agent's
context window) with zero LLM cost. Sources:
- `InterventionEvent`s (already emitted).
- Lexical correction cues in the *next user turn*: "no", "actually", "revert",
  "that's wrong", "you didn't", "I meant".
- Premature-done: agent said "done", same task reopened next user turn.
- Tool/test/build failure; `git revert`/`reset` over the agent's own edits.

**Output format** — an array of anchors, attached to the session (lightweight,
not yet diagnosed):

```jsonc
[
  { "event_uuid": "uuid-4", "signal": "user_correction", "snippet": "...AND the json. And you didn't run the tests." },
  { "event_uuid": "uuid-6", "signal": "tool_failure", "snippet": "2 tests failed (snapshot)" }
]
```

These mark *where* to look. They are handed to the agent in Stage 3 so long
sessions (early events scrolled out of context) are still diagnosable.

### Stage 2 — Trigger (existing Stop hook, unchanged logic)
At the end of **every agent turn**, `claude-sessions stop-hook` runs. There is
**no session-end event**; CTRL+C fires no hook. The hook gates:
- `eventCount < 10` → skip (trivial).
- watermark `fresh` (existing `ok` summary within `minDelta=12` of the JSONL) → skip.
- else → emit `decision:"block"` once (guarded by `stop_hook_active`).

The last substantive turn before the user exits is the de-facto "final"
reflection. Learnings inherit this trigger for free.

### Stage 3 — Agent reflection (Reflexion-style, in-loop agent)
The blocked agent authors its summary AND, in the same pass, diagnoses each
flagged episode from Stage 1. It fills the existing stdin JSON contract with one
new field.

**Output format** — stdin JSON piped to `summarize --current --from-agent`:

```jsonc
{
  "title": "...", "summary": "...", "tags": ["..."],
  "files_touched": ["..."], "prs_referenced": ["..."],
  "learnings": [                          // NEW; [] or omitted when nothing detected
    {
      "title": "Declared done while the human-readable table still rendered",
      "episode_event_uuids": ["uuid-3", "uuid-4"],
      "what_went_wrong": "The user asked for a `--json` flag that prints machine-readable output. After editing `status.ts` I declared the task done, but the change only *added* a JSON branch without guarding the existing table render, so the command printed both the human table and the JSON. The user expected `--json` to replace the table entirely; the divergence came from treating the flag as additive rather than as a mode switch, and from not re-reading the output path before claiming completion.",
      "what_would_have_prevented": "Before declaring a task done, re-read the actual code path the change touches and trace what it now produces end to end — especially when adding a flag that is meant to *change* behavior rather than extend it. A flag named `--json` implies an output *mode*; the safe default is to confirm the prior output is suppressed, not assume it.",
      "root_cause": "instruction_not_followed",
      "attributed_to": "agent",
      "confidence": 0.9,
      "severity": "medium"
    },
    {
      "title": "Marked the task complete without running the test suite",
      "episode_event_uuids": ["uuid-3", "uuid-6"],
      "what_went_wrong": "I reported the work as finished at the same point I had not run any tests. When the suite was eventually run (only after the user pointed it out), two snapshot tests failed because they still expected the old output format. The failure was latent the entire time I claimed success — the user's trust in 'done' was misplaced because completion was asserted on the basis of having written code, not on the basis of verified behavior.",
      "what_would_have_prevented": "Treat 'done' as a claim that requires evidence: in a repo with a test gate, run `bun run test` (or the relevant subset) and read the result before reporting completion. Verification is part of the task, not an optional follow-up — and snapshot-bearing repos in particular will surface format changes that are invisible to a code read.",
      "root_cause": "missing_verification",
      "attributed_to": "agent",
      "confidence": 0.95,
      "severity": "high"
    }
  ]
}
```

### Stage 4 — CLI push (piggyback, no new command)
`summarize --current --from-agent` parses the stdin JSON and calls the existing
`UploadClient.uploadSummary()` → `POST /api/sessions/:id/summary`. The
`learnings` array travels inside the same body. No new endpoint, no new auth /
retry / 4xx-non-retry surface.

### Stage 5 — Server persist (same transaction, delete-and-replace)
In the existing `POST /:id/summary` handler (`packages/server/src/routes/sessions.ts`):
1. Validate `learnings` via the extended zod `summarySchema`.
2. `redactDeep` every text field (defense in depth, like `title`/`summary`).
3. Inside the existing `db.transaction`:
   - upsert the `summaries` row (unchanged),
   - `DELETE FROM learnings WHERE session_id = $1`,
   - insert the new set,
   - stamp provenance: `model`, `generated_at`, `summarized_event_count` from
     this run (links to `summarization_runs`).

Delete-and-replace is **safe**: evidence stays in the transcript, so the latest
reflection (which sees the whole trajectory) is the most complete. Last turn wins.

**Stored row format** — new `learnings` table (1-to-many on `session_id`):

```
learnings(
  id              uuid pk,
  session_id      text  fk -> sessions(id),
  title           text,
  episode_event_uuids text[],
  what_went_wrong text,           -- descriptive markdown
  what_would_have_prevented text, -- descriptive markdown
  root_cause      text,           -- enum-as-text
  attributed_to   text,
  confidence      real,
  severity        text null,
  model           text,           -- provenance: "agent" | "heuristic" | "claude -p"
  generated_at    timestamptz,
  created_at      timestamptz default now()
)
```

No `embedding` column in this scope — per-session display needs no vector. (Add
it when the cross-session Insights page is built.)

### Stage 6 — Read path (extend existing endpoint)
`GET /api/sessions/:id` (already returns metadata + summary) gains a `learnings`
array via a plain `db.select().from(learnings).where(...)` (no Drizzle relations).
One round-trip powers the tab.

**Response format** (additive):

```jsonc
{
  "session": { ... },
  "summary": { ... },
  "learnings": [ { /* SessionLearning + provenance */ } ]
}
```

### Stage 7 — Render (deterministic markdown, single source of truth)
The markdown document is a **deterministic render of the structured records** —
no second LLM pass, no stored prose that can drift. Rendered in the web (or
server-side as `.md`).

**Output format**:

The `title` is the heading; `rootCause` / `attributedTo` / `severity` are chips;
the two prose fields render as their own descriptive sub-sections.

```markdown
## Learnings — 2 issues (1 high, 1 medium)

### 1. Declared done while the human-readable table still rendered
`instruction not followed` · `agent` · `medium` · confidence 0.90

**What went wrong**
The user asked for a `--json` flag that prints machine-readable output. After
editing `status.ts` I declared the task done, but the change only *added* a JSON
branch without guarding the existing table render, so the command printed both
the human table and the JSON. The user expected `--json` to replace the table
entirely; the divergence came from treating the flag as additive rather than as a
mode switch, and from not re-reading the output path before claiming completion.

**What would have prevented it**
Before declaring a task done, re-read the actual code path the change touches and
trace what it now produces end to end — especially when adding a flag meant to
*change* behavior rather than extend it. A flag named `--json` implies an output
*mode*; the safe default is to confirm the prior output is suppressed.

**Evidence:** [event 3 →](#evt-3) · [event 4 →](#evt-4)

### 2. Marked the task complete without running the test suite
`missing verification` · `agent` · `high` · confidence 0.95

**What went wrong**
I reported the work as finished at a point where I had not run any tests. When the
suite was eventually run — only after the user pointed it out — two snapshot tests
failed because they still expected the old output format. The failure was latent
the entire time I claimed success.

**What would have prevented it**
Treat 'done' as a claim that requires evidence: in a repo with a test gate, run
`bun run test` and read the result before reporting completion. Verification is
part of the task, not an optional follow-up.

**Evidence:** [event 3 →](#evt-3) · [event 6 →](#evt-6)
```

(Optional future: one agent-authored `learnings_overview` markdown field for a
session-level narrative, rendered above this list. Deterministic-only ships first.)

### Stage 8 — UI surface
- **Learnings tab** on `session/:id`, alongside Artifacts.
  - Renders the Stage-7 markdown; root-cause / attributed-to / severity as colored chips.
  - Evidence UUIDs deep-link into the (already-virtualized) transcript;
    clicking jumps to the highlighted event.
  - **"View raw"** toggle swaps the rendered markdown for the raw JSON records
    (the exact Stop-hook output).
  - Empty state: "No issues detected this session" (absence is signal — not a
    blank tab).
  - Provenance line: "generated by agent at event 47" (or "manual `claude -p`").
- **CLI read command** (the only new command, read-only):
  `claude-sessions learnings <id>` → rendered markdown; `--json` → raw records.

### Stage 9 — Edge cases / backfill
- **CTRL+C mid-turn** (before the turn's Stop hook): last *completed* turn's
  learnings persist; final-turn learnings may be missed. Identical to current
  summary behavior. Recoverable: raw events are already uploaded, so a manual
  `claude-sessions summarize <id>` backfills over the complete JSONL.
- **Long sessions** (early events out of context): Stage-1 anchors are computed
  over the full JSONL and handed to the agent, so episodes remain diagnosable.
- **Re-summarization**: delete-and-replace keeps the set consistent with the
  latest run; provenance records which run produced it.

---

## When a learning IS captured

- An `InterventionEvent` / user-correction cue.
- Agent declared done, then the same task reopened next user turn.
- A tool/test/build failure, or a `git revert`/`reset` over the agent's edits.
- An explicit earlier instruction provably contradicted later.

## When it is NOT captured

- **Clean sessions** — no correction signal → no record.
- **User changed their mind** — next turn adds *new* scope (not a correction).
- **Stylistic nitpicks** below a severity floor — capture as `low`, exclude from
  any future trend mining.
- **Silent underspecification** — output didn't match an underspecified request
  but the user accepted it → no signal, nothing to capture.
- **Trivial sessions** — `< 10` events / pure Q&A with no edits.
- **Provisional/heuristic-only sessions** — no agent reflection ran.

---

## Architectural fit (invariants respected)

- Reflection/authoring runs in the **CLI / in-loop agent**, never the server.
- Server only stores + redacts; learnings ride the existing summary transaction.
- No queue/worker; no new auth path; `event_uuid` anchors stay stable.
- Enums (not free text) so cross-session aggregation is possible later.

## Out of scope (separate effort)

- Learning embeddings + clustering.
- Cross-session "Insights / Patterns" page and trend tiles.
- MCP `get_failure_trends` / `get_learnings` tools.
- Feedback loop into `CLAUDE.md` / skill files.

## Sources

- MAST — https://arxiv.org/abs/2503.13657
- Reflexion — https://arxiv.org/abs/2303.11366
- ExpeL — https://arxiv.org/abs/2308.10144
- Hermes (self-improving agent) — https://saulius.io/blog/hermes-agent-self-improving-ai-architecture
