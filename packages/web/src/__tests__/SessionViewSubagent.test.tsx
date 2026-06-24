// AI-generated. See PROMPT.md for the prompts and model used.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "../lib/types";
import { fixtureSession } from "./fixtures";

const agentRow = (uuid: string, agentId: string, input: string): TranscriptEvent => ({
  event_uuid: uuid,
  parent_uuid: null,
  ts: "2026-05-01T10:00:00.000Z",
  type: "tool_use",
  payload: { tool: "Agent", tool_use_id: uuid, input_summary: input, agent_id: agentId },
});

const userRow = (uuid: string, text: string): TranscriptEvent => ({
  event_uuid: uuid,
  parent_uuid: null,
  ts: "2026-05-01T10:00:00.000Z",
  type: "user_msg",
  payload: { content_md: text },
});

// Each session id maps to its own transcript. Root has an Agent row pointing at
// `child-1`; `child-1` has one pointing at `grandchild-1`.
const eventsBySession: Record<string, TranscriptEvent[]> = {
  root: [userRow("root-u", "root prompt"), agentRow("root-agent", "child-1", "spawn child")],
  "child-1": [
    userRow("child-u", "child prompt"),
    agentRow("child-agent", "grandchild-1", "spawn grandchild"),
  ],
  "grandchild-1": [userRow("gc-u", "grandchild prompt")],
};

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    useSession: () => ({
      data: fixtureSession({ summary: null }),
      isLoading: false,
      isError: false,
    }),
    useSessionEvents: (id: string | undefined) => ({
      data: { events: id ? (eventsBySession[id] ?? []) : [] },
      isLoading: false,
      isError: false,
    }),
    useSessionToolCalls: () => ({ data: { tool_calls: [] }, isLoading: false, isError: false }),
    useSessionCommits: () => ({ data: { commits: [] }, isLoading: false, isError: false }),
    useSessionArtifacts: () => ({ data: { artifacts: [] }, isLoading: false, isError: false }),
  };
});

import { SessionView } from "../pages/SessionView";

const renderRoot = () => {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/sessions/root"]}>
        <Routes>
          <Route path="/sessions/:id" element={<SessionView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("SessionView subagent drill-in", () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView / scrollTo.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn() as unknown as Element["scrollTo"];
  });

  it("entering a subagent swaps to its transcript and shows the back bar", () => {
    renderRoot();
    expect(screen.queryByTestId("subagent-back-bar")).toBeNull();
    expect(screen.getByText("root prompt")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("enter-subagent"));

    expect(screen.getByTestId("subagent-back-bar")).toBeInTheDocument();
    expect(screen.getByText("child prompt")).toBeInTheDocument();
    expect(screen.queryByText("root prompt")).toBeNull();
  });

  it("Back to main pops the stack and removes the back bar", () => {
    renderRoot();
    fireEvent.click(screen.getByTestId("enter-subagent"));
    expect(screen.getByTestId("subagent-back-bar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("back-to-main"));

    expect(screen.queryByTestId("subagent-back-bar")).toBeNull();
    expect(screen.getByText("root prompt")).toBeInTheDocument();
  });

  it("nested entering shows a multi-crumb breadcrumb and popping a crumb truncates", () => {
    renderRoot();
    // root → child-1
    fireEvent.click(screen.getByTestId("enter-subagent"));
    // child-1 → grandchild-1
    fireEvent.click(screen.getByTestId("enter-subagent"));

    expect(screen.getByText("grandchild prompt")).toBeInTheDocument();
    const crumbs = screen.getAllByTestId("back-bar-crumb");
    expect(crumbs).toHaveLength(2);

    // Click the first crumb (child-1) → truncate back to depth 1.
    fireEvent.click(crumbs[0] as HTMLElement);

    expect(screen.getByText("child prompt")).toBeInTheDocument();
    expect(screen.queryByText("grandchild prompt")).toBeNull();
    const bar = screen.getByTestId("subagent-back-bar");
    expect(within(bar).getAllByTestId("back-bar-crumb")).toHaveLength(1);
  });
});
