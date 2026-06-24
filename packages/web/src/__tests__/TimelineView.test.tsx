// AI-generated. See PROMPT.md for the prompts and model used.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelineView } from "../components/transcript/TimelineView";
import type { TranscriptEvent } from "../lib/types";

const agentCall: TranscriptEvent = {
  event_uuid: "call-1",
  parent_uuid: null,
  ts: "2026-05-01T10:00:00.000Z",
  type: "tool_use",
  payload: { tool: "Agent", tool_use_id: "tu-agent", input_summary: "spawn explorer" },
};

// The capture pipeline stamps agent_id on the tool_result, not the call.
// TimelineView pairs them by tool_use_id and must surface the affordance.
const agentResult: TranscriptEvent = {
  event_uuid: "result-1",
  parent_uuid: "call-1",
  ts: "2026-05-01T10:00:05.000Z",
  type: "tool_use",
  payload: { tool: "", tool_use_id: "tu-agent", output_summary: "done", agent_id: "child-1" },
};

describe("TimelineView subagent drill-in", () => {
  it("shows the enter affordance when agent_id rides on the paired result event", () => {
    const onEnter = vi.fn();
    render(<TimelineView events={[agentCall, agentResult]} onEnterSubagent={onEnter} />);
    const enter = screen.getByTestId("enter-subagent");
    fireEvent.click(enter);
    // Anchors back-navigation on the call (Agent) row, not the result.
    expect(onEnter).toHaveBeenCalledWith("child-1", "call-1");
  });

  it("renders no enter affordance for a non-Agent tool pair", () => {
    const call: TranscriptEvent = {
      event_uuid: "b-1",
      parent_uuid: null,
      ts: "2026-05-01T10:00:00.000Z",
      type: "tool_use",
      payload: { tool: "Bash", tool_use_id: "tu-b", input_summary: "ls" },
    };
    render(<TimelineView events={[call]} onEnterSubagent={vi.fn()} />);
    expect(screen.queryByTestId("enter-subagent")).toBeNull();
  });
});
