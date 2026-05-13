---
title: "Baseline + quality gate friction observed during distinguish-backfill-live"
date: 2026-05-12
category: workflow
tags:
  - quality-gate
  - baseline
  - tdd
  - biome
  - testcontainers
  - code-review
component: harness-pipeline
severity: medium
status: observed
related:
  - docs/spec/distinguish-backfill-live/baseline.json
  - docs/spec/distinguish-backfill-live/gate-report-post-tdd-001.md
  - docs/spec/distinguish-backfill-live/verification/proof-report.md
---

# Baseline + quality gate friction observed during distinguish-backfill-live

## Problem

Four small but recurring frictions surfaced while running the orchestrate pipeline on the "distinguish backfill from live sessions" feature. None blocked the work, but each one nearly polluted gate output or wasted a review pass. Worth writing down so the next pipeline run avoids them.

## Insights

### 1. Stale tests are invisible until a quality gate forces them to run

`packages/web/src/__tests__/SessionView.test.tsx` was asserting `.tool-call.collapsed`, a class that had been removed in commit `a4a5496` (timeline tab default). The web suite hadn't been run end-to-end on `main` since that commit, so nothing flagged it. The pre-TDD baseline run was the first time anyone noticed — exactly the moment when "no, that's pre-existing" arguments start eating budget.

**Principle: every spec's baseline run is a low-cost audit of unrelated stale tests in adjacent packages — treat hits as pre-existing tech debt to fix in the same PR, never as something to silence.**

### 2. Baselines must explicitly carry env-blocked failures

The server suite is gated on Docker (testcontainers). On this machine podman is up but `DOCKER_HOST` isn't pointed at its socket, so 51 server tests skip. The baseline JSON encoded this as `status: env_blocked` with an explicit `blocking_error` and `remediation: "out of scope"`. That single field made the post-TDD gate trivially boolean: "did anything change vs baseline? no → PASS." Without it, the gate would have had to re-litigate Docker availability on every run.

**Principle: a baseline is not a pass/fail snapshot — it's the contract for what each subsequent gate is allowed to ignore. Encode the reason inline (`status` + `blocking_error` + `remediation`), not in prose elsewhere.**

### 3. Hand-written JSON gets caught by repo formatters — run them before declaring baseline done

The first hand-written `baseline.json` failed `bun run lint` because biome's JSON formatter disagreed with the indentation. Trivial to fix, but it momentarily muddied the gate output (a "lint regression" that was actually a baseline-creation artifact).

**Rule: any new JSON/MD/YAML the harness writes must run through `biome check` (or the project's equivalent) in the same step that creates it.** No exceptions for "but it's just metadata."

### 4. Two-pass code review found 0 blockers — consider when 2-pass is overkill

Both review passes returned clean for a ~500-line, single-package CLI feature. Two interpretations:

- **Optimistic:** the `brainstorm → spec-generation → planning → TDD` chain caught everything before review, so review just confirmed correctness. Evidence in favor: the spec's REQ matrix is unusually specific (REQ-013 nailed the constructor option that ended up needed for testability), and TDD generated the call-count assertions that would have been the most likely review nit.
- **Pessimistic:** two-pass review is calibrated for larger/architectural changes; on a feature that touches ~5 files in one package it's mostly redundant.

**Heuristic: when a feature is single-package, has a spec with quantitative REQs (call counts, deltas, exit codes), and produces test diffs that already encode the assertions a reviewer would write, one review pass is probably enough. Save the second pass for cross-package or architecture-touching work.**

## Prevention / Reuse

For the next pipeline run:

- [ ] Run **all** package test suites at baseline capture — not just the one the feature targets. Treat unrelated failures as PR-1 fixes, not deferrals.
- [ ] Every entry in `baseline.json` `results.*` must have a `status` field with one of `{pass, fail, env_blocked, not_collected}`. `env_blocked` and `not_collected` require an inline `blocking_error` or `reason` plus a `remediation` note.
- [ ] After writing `baseline.json` (or any new JSON artifact under `docs/spec/`), run `biome check <path>` before announcing baseline complete.
- [ ] Decide review-pass count from the planning stage's diff-size estimate: < 800 LOC across ≤ 2 packages → 1 pass; otherwise → 2 passes. Make this an explicit field in the plan, not a default assumption.

## Related

- `docs/spec/distinguish-backfill-live/baseline.json` — example of an env-blocked-encoded baseline
- `docs/spec/distinguish-backfill-live/gate-report-post-tdd-001.md` — post-TDD gate that consumed it cleanly
- `docs/spec/distinguish-backfill-live/verification/proof-report.md` — example of test-driven verification when live verification would defeat the property under test
