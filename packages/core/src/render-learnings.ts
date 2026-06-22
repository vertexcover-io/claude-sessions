import type { AttributedTo, RootCause, SessionLearning } from "./types.js";

const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  underspecified_request: "underspecified request",
  instruction_not_followed: "instruction not followed",
  missing_verification: "missing verification",
  task_derailment: "task derailment",
  context_loss: "context loss",
  environment_or_tooling: "environment or tooling",
};

const ATTRIBUTED_LABEL: Record<AttributedTo, string> = {
  user: "user",
  agent: "agent",
  shared: "shared",
  environment: "environment",
};

const severityTally = (learnings: SessionLearning[]): string => {
  const counts: Record<string, number> = {};
  for (const l of learnings) {
    const s = l.severity ?? "unspecified";
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const order = ["high", "medium", "low", "unspecified"];
  const parts = order.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
};

const chipsLine = (l: SessionLearning): string => {
  const chips = [
    `\`${ROOT_CAUSE_LABEL[l.root_cause]}\``,
    `\`${ATTRIBUTED_LABEL[l.attributed_to]}\``,
  ];
  if (l.severity) chips.push(`\`${l.severity}\``);
  chips.push(`confidence ${l.confidence.toFixed(2)}`);
  return chips.join(" · ");
};

const evidenceLine = (uuids: string[]): string => {
  if (uuids.length === 0) return "";
  const refs = uuids.map((u, i) => `[event ${i + 1} →](#evt-${u})`).join(" · ");
  return `\n\n**Evidence:** ${refs}`;
};

/**
 * Deterministic markdown render of structured learning records — the single
 * source of truth for the CLI `learnings` command. No second LLM pass, no
 * stored prose that can drift.
 */
export const renderLearningsMarkdown = (learnings: SessionLearning[]): string => {
  if (learnings.length === 0) {
    return "## Learnings\n\nNo issues detected this session.\n";
  }

  const count = learnings.length;
  const noun = count === 1 ? "issue" : "issues";
  const header = `## Learnings — ${count} ${noun}${severityTally(learnings)}`;

  const sections = learnings.map((l, i) => {
    return [
      `### ${i + 1}. ${l.title}`,
      chipsLine(l),
      "",
      "**What went wrong**",
      l.what_went_wrong.trim(),
      "",
      "**What would have prevented it**",
      l.what_would_have_prevented.trim() + evidenceLine(l.episode_event_uuids),
    ].join("\n");
  });

  return `${header}\n\n${sections.join("\n\n")}\n`;
};
