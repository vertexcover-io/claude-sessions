// AI-generated. See PROMPT.md for the prompts and model used.

import { describe, expect, it } from "vitest";
import { parseAgentSummary } from "./pipeline.js";

const validLearning = (over: Record<string, unknown> = {}) => ({
  title: "Marked done without running tests",
  episode_event_uuids: ["u-3"],
  what_went_wrong: "Reported done before running the suite.",
  what_would_have_prevented: "Run the tests before claiming completion.",
  root_cause: "missing_verification",
  attributed_to: "agent",
  confidence: 0.9,
  severity: "high",
  ...over,
});

const base = (learnings?: unknown) => ({
  title: "t",
  summary: "s",
  tags: [],
  files_touched: [],
  prs_referenced: [],
  ...(learnings !== undefined ? { learnings } : {}),
});

describe("parseAgentSummary — learnings", () => {
  it("leaves learnings undefined when the field is absent", () => {
    expect(parseAgentSummary(base()).learnings).toBeUndefined();
  });

  it("accepts an empty array (clean session)", () => {
    expect(parseAgentSummary(base([])).learnings).toEqual([]);
  });

  it("parses a valid learning", () => {
    const out = parseAgentSummary(base([validLearning()]));
    expect(out.learnings).toHaveLength(1);
    expect(out.learnings?.[0]?.root_cause).toBe("missing_verification");
  });

  it("rejects a learning with no evidence uuids", () => {
    expect(() => parseAgentSummary(base([validLearning({ episode_event_uuids: [] })]))).toThrow(
      /episode_event_uuids/,
    );
  });

  it("rejects an invalid root_cause", () => {
    expect(() => parseAgentSummary(base([validLearning({ root_cause: "nope" })]))).toThrow(
      /root_cause/,
    );
  });

  it("rejects an invalid attributed_to", () => {
    expect(() => parseAgentSummary(base([validLearning({ attributed_to: "robot" })]))).toThrow(
      /attributed_to/,
    );
  });

  it("rejects an out-of-range confidence", () => {
    expect(() => parseAgentSummary(base([validLearning({ confidence: 2 })]))).toThrow(/confidence/);
  });

  it("drops an unknown severity rather than failing", () => {
    const out = parseAgentSummary(base([validLearning({ severity: "critical" })]));
    expect(out.learnings?.[0]?.severity).toBeUndefined();
  });
});
