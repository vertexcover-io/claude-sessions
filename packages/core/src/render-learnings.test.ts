import { describe, expect, it } from "vitest";
import { renderLearningsMarkdown } from "./render-learnings.js";
import type { SessionLearning } from "./types.js";

const learning = (over: Partial<SessionLearning> = {}): SessionLearning => ({
  title: "Marked the task complete without running the test suite",
  episode_event_uuids: ["uuid-3", "uuid-6"],
  what_went_wrong: "I reported the work finished before running any tests.",
  what_would_have_prevented: "Run the tests and read the result before reporting done.",
  root_cause: "missing_verification",
  attributed_to: "agent",
  confidence: 0.95,
  severity: "high",
  ...over,
});

describe("renderLearningsMarkdown", () => {
  it("renders the empty state when there are no learnings", () => {
    const md = renderLearningsMarkdown([]);
    expect(md).toContain("No issues detected this session.");
  });

  it("renders heading with count and severity tally", () => {
    const md = renderLearningsMarkdown([
      learning({ severity: "high" }),
      learning({ severity: "medium", title: "Other" }),
    ]);
    expect(md).toContain("## Learnings — 2 issues (1 high, 1 medium)");
  });

  it("renders title, humanized chips, prose sections, and evidence refs", () => {
    const md = renderLearningsMarkdown([learning()]);
    expect(md).toContain("### 1. Marked the task complete without running the test suite");
    expect(md).toContain("`missing verification`");
    expect(md).toContain("`agent`");
    expect(md).toContain("`high`");
    expect(md).toContain("confidence 0.95");
    expect(md).toContain("**What went wrong**");
    expect(md).toContain("**What would have prevented it**");
    expect(md).toContain("[event 1 →](#evt-uuid-3)");
    expect(md).toContain("[event 2 →](#evt-uuid-6)");
  });

  it("omits the severity chip when severity is absent", () => {
    const { severity, ...rest } = learning();
    void severity;
    const md = renderLearningsMarkdown([rest as SessionLearning]);
    expect(md).toContain("`missing verification`");
    expect(md).not.toMatch(/`high`|`medium`|`low`/);
  });
});
