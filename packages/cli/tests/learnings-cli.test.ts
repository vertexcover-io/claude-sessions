// AI-generated. See PROMPT.md for the prompts and model used.

import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { learningsCommand } from "../src/commands/learnings.js";
import type { LearningRecord, SessionDetail, UploadClient } from "../src/upload/client.js";

const collect = () => {
  let buf = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, get: () => buf };
};

const record = (over: Partial<LearningRecord> = {}): LearningRecord => ({
  id: "l1",
  title: "Marked done without running tests",
  episode_event_uuids: ["u-3"],
  what_went_wrong: "Reported done before running the suite.",
  what_would_have_prevented: "Run the tests first.",
  root_cause: "missing_verification",
  attributed_to: "agent",
  confidence: 0.9,
  severity: "high",
  model: "agent",
  generated_at: "2026-05-01T10:00:00.000Z",
  summarized_event_count: 47,
  ...over,
});

const stubClient = (detail: Partial<SessionDetail>): UploadClient =>
  ({
    getSession: async () => ({ id: "s-1", summary: null, ...detail }) as SessionDetail,
  }) as unknown as UploadClient;

describe("learnings command", () => {
  it("renders markdown for a session's learnings", async () => {
    const out = collect();
    const code = await learningsCommand({
      client: stubClient({ learnings: [record()] }),
      sessionId: "s-1",
      stdout: out.stream,
    });
    expect(code).toBe(0);
    expect(out.get()).toContain("### 1. Marked done without running tests");
    expect(out.get()).toContain("`missing verification`");
  });

  it("prints raw JSON with --json", async () => {
    const out = collect();
    await learningsCommand({
      client: stubClient({ learnings: [record()] }),
      sessionId: "s-1",
      json: true,
      stdout: out.stream,
    });
    const parsed = JSON.parse(out.get());
    expect(parsed).toHaveLength(1);
    expect(parsed[0].root_cause).toBe("missing_verification");
  });

  it("renders the empty state when there are no learnings", async () => {
    const out = collect();
    await learningsCommand({
      client: stubClient({ learnings: [] }),
      sessionId: "s-1",
      stdout: out.stream,
    });
    expect(out.get()).toContain("No issues detected this session.");
  });
});
