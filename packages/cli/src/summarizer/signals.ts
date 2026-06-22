// AI-generated. See PROMPT.md for the prompts and model used.

import type { CanonicalEvent, CanonicalSession } from "@claude-sessions/core";

export type SignalKind = "user_correction" | "premature_done" | "tool_failure" | "revert";

export interface SignalAnchor {
  event_uuid: string;
  signal: SignalKind;
  snippet: string;
}

const SNIPPET_MAX = 140;

const snip = (s: string): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat;
};

// Lexical correction cues that, when they open a user turn, usually mean the
// agent's prior output diverged from what the user wanted.
const CORRECTION_CUES = [
  /\bno\b/i,
  /\bactually\b/i,
  /\brevert\b/i,
  /\bthat'?s wrong\b/i,
  /\byou (didn'?t|did not|forgot|missed)\b/i,
  /\bi meant\b/i,
  /\bnot what i\b/i,
  /\bundo\b/i,
];

const DONE_CUES = [
  /\b(all )?done\b/i,
  /\bcompleted?\b/i,
  /\bfinished\b/i,
  /\bthat'?s (it|everything)\b/i,
  /\bshould (now )?work\b/i,
];

const REVERT_CUES = [/\bgit\s+(revert|reset|checkout\s+--)\b/i];

const isUser = (e: CanonicalEvent): e is Extract<CanonicalEvent, { type: "user_msg" }> =>
  e.type === "user_msg";
const isAssistant = (e: CanonicalEvent): e is Extract<CanonicalEvent, { type: "assistant_msg" }> =>
  e.type === "assistant_msg";
const isTool = (e: CanonicalEvent): e is Extract<CanonicalEvent, { type: "tool_use" }> =>
  e.type === "tool_use";

/**
 * Deterministic, zero-LLM detection of candidate failure episodes over the
 * FULL event list (not the agent's context window). Cheap enough to run on
 * every Stop-hook fire. The anchors mark *where to look* — the in-loop agent
 * diagnoses them in Stage 3. Never throws on malformed input; returns [].
 */
export const detectSignals = (session: CanonicalSession): SignalAnchor[] => {
  const events = session.events ?? [];
  const anchors: SignalAnchor[] = [];
  const seen = new Set<string>();

  const push = (a: SignalAnchor): void => {
    const key = `${a.signal}:${a.event_uuid}`;
    if (seen.has(key)) return;
    seen.add(key);
    anchors.push(a);
  };

  // Track whether the immediately-preceding assistant turn claimed completion,
  // so a follow-up user turn flags premature-done in addition to a correction.
  let prevAssistantClaimedDone = false;

  for (const ev of events) {
    if (isAssistant(ev)) {
      const text = ev.content_md ?? "";
      prevAssistantClaimedDone = DONE_CUES.some((re) => re.test(text));
      continue;
    }

    if (isTool(ev)) {
      if (ev.is_error) {
        push({
          event_uuid: ev.event_uuid,
          signal: "tool_failure",
          snippet: snip(`${ev.tool}: ${ev.output_summary ?? ev.input_summary ?? ""}`),
        });
      }
      if (ev.tool === "Bash" && REVERT_CUES.some((re) => re.test(ev.input_summary ?? ""))) {
        push({
          event_uuid: ev.event_uuid,
          signal: "revert",
          snippet: snip(ev.input_summary ?? ""),
        });
      }
      continue;
    }

    if (isUser(ev)) {
      const text = ev.content_md ?? "";
      const isCorrection = CORRECTION_CUES.some((re) => re.test(text));
      if (isCorrection) {
        push({ event_uuid: ev.event_uuid, signal: "user_correction", snippet: snip(text) });
      }
      if (prevAssistantClaimedDone && isCorrection) {
        push({ event_uuid: ev.event_uuid, signal: "premature_done", snippet: snip(text) });
      }
      prevAssistantClaimedDone = false;
    }
  }

  return anchors;
};

/**
 * Render a compact, bounded anchor list for inlining into the Stop-hook block
 * reason so the in-loop agent knows where to look. Caps the count to keep the
 * reason small.
 */
export const renderSignalAnchors = (anchors: SignalAnchor[], cap = 12): string => {
  if (anchors.length === 0) return "";
  const shown = anchors.slice(0, cap);
  const lines = shown.map((a) => `- [${a.signal}] ${a.event_uuid}: ${a.snippet}`);
  const more = anchors.length > cap ? `\n- …and ${anchors.length - cap} more` : "";
  return `\n\nCandidate failure episodes detected (evidence anchors — diagnose each as a learning, citing its event_uuid):\n${lines.join("\n")}${more}`;
};
