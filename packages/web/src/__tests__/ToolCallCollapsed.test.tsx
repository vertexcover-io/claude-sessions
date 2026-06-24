// AI-generated. See PROMPT.md for the prompts and model used.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCallCollapsed } from "../components/transcript/ToolCallCollapsed";
import type { TranscriptEvent } from "../lib/types";

const event: TranscriptEvent = {
  event_uuid: "t-1",
  parent_uuid: null,
  ts: "2026-05-01T10:00:00.000Z",
  type: "tool_use",
  payload: {
    tool: "Bash",
    tool_use_id: "tu-1",
    input_summary: "ls /tmp",
    output_summary: "drwx 1 root",
  },
};

describe("ToolCallCollapsed (REQ-024)", () => {
  it("renders collapsed by default with .tool-call.collapsed class", () => {
    const { container } = render(<ToolCallCollapsed event={event} />);
    expect(container.querySelector(".tool-call.collapsed")).toBeTruthy();
    expect(screen.queryByTestId("tool-body")).toBeNull();
  });

  it("expands and collapses on toggle click", () => {
    render(<ToolCallCollapsed event={event} />);
    const toggle = screen.getByTestId("tool-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("tool-body")).toBeInTheDocument();
    expect(screen.getByTestId("tool-body")).toHaveTextContent("ls /tmp");
    fireEvent.click(toggle);
    expect(screen.queryByTestId("tool-body")).toBeNull();
  });

  it("renders an enter affordance for Agent rows and invokes onEnterSubagent with agent_id + event_uuid", () => {
    const agentEvent: TranscriptEvent = {
      event_uuid: "agent-row-1",
      parent_uuid: null,
      ts: "2026-05-01T10:00:00.000Z",
      type: "tool_use",
      payload: {
        tool: "Agent",
        tool_use_id: "tu-9",
        input_summary: "spawn explorer",
        agent_id: "child-session-1",
      },
    };
    const onEnter = vi.fn();
    render(<ToolCallCollapsed event={agentEvent} onEnterSubagent={onEnter} />);
    const enter = screen.getByTestId("enter-subagent");
    fireEvent.click(enter);
    expect(onEnter).toHaveBeenCalledWith("child-session-1", "agent-row-1");
  });

  it("renders no enter affordance when agent_id is absent", () => {
    render(<ToolCallCollapsed event={event} onEnterSubagent={vi.fn()} />);
    expect(screen.queryByTestId("enter-subagent")).toBeNull();
  });
});
