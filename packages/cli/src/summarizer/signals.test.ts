// AI-generated. See PROMPT.md for the prompts and model used.

import type { CanonicalEvent, CanonicalSession } from "@claude-sessions/core";
import { describe, expect, it } from "vitest";
import { detectSignals, renderSignalAnchors } from "./signals.js";

let seq = 0;
const base = (over: Partial<CanonicalEvent> & { type: CanonicalEvent["type"] }) => {
  seq += 1;
  return {
    ts: "2026-05-01T10:00:00.000Z",
    event_uuid: `e${seq}`,
    parent_uuid: null,
    raw: {},
    ...over,
  } as CanonicalEvent;
};

const user = (content_md: string, uuid?: string): CanonicalEvent =>
  base({ type: "user_msg", content_md, ...(uuid ? { event_uuid: uuid } : {}) } as never);
const assistant = (content_md: string): CanonicalEvent =>
  base({ type: "assistant_msg", content_md } as never);
const tool = (over: Record<string, unknown>): CanonicalEvent =>
  base({ type: "tool_use", tool: "Bash", input_summary: "", tool_use_id: "t", ...over } as never);

const session = (events: CanonicalEvent[]): CanonicalSession =>
  ({ id: "s", events }) as CanonicalSession;

describe("detectSignals", () => {
  it("returns [] for a clean session", () => {
    const s = session([user("please add a flag"), assistant("done, added it")]);
    expect(detectSignals(s)).toEqual([]);
  });

  it("flags a user correction", () => {
    const s = session([
      assistant("I added the flag."),
      user("no, that's wrong, you didn't run the tests", "u-fix"),
    ]);
    const out = detectSignals(s);
    expect(out.some((a) => a.signal === "user_correction" && a.event_uuid === "u-fix")).toBe(true);
  });

  it("flags premature_done when a correction follows a done claim", () => {
    const s = session([assistant("All done!"), user("no, you forgot the json output", "u-pd")]);
    const out = detectSignals(s);
    expect(out.some((a) => a.signal === "premature_done" && a.event_uuid === "u-pd")).toBe(true);
  });

  it("flags a tool failure", () => {
    const s = session([tool({ event_uuid: "t-err", is_error: true, output_summary: "2 failed" })]);
    const out = detectSignals(s);
    expect(out.some((a) => a.signal === "tool_failure" && a.event_uuid === "t-err")).toBe(true);
  });

  it("flags a git revert in a Bash call", () => {
    const s = session([tool({ event_uuid: "t-rev", input_summary: "git revert HEAD" })]);
    const out = detectSignals(s);
    expect(out.some((a) => a.signal === "revert" && a.event_uuid === "t-rev")).toBe(true);
  });

  it("never throws on missing events", () => {
    expect(detectSignals({ id: "s" } as CanonicalSession)).toEqual([]);
  });
});

describe("renderSignalAnchors", () => {
  it("returns empty string when there are no anchors", () => {
    expect(renderSignalAnchors([])).toBe("");
  });

  it("caps the rendered list and notes the remainder", () => {
    const anchors = Array.from({ length: 15 }, (_, i) => ({
      event_uuid: `e${i}`,
      signal: "tool_failure" as const,
      snippet: "x",
    }));
    const out = renderSignalAnchors(anchors, 12);
    expect(out).toContain("and 3 more");
  });
});
