// AI-generated. See PROMPT.md for the prompts and model used.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactContent, ArtifactMeta } from "../lib/types";

const mdArtifact: ArtifactMeta = {
  id: "art-md",
  path: "docs/PLAN.md",
  mime_type: "text/markdown",
  byte_size: 2048,
  uploaded_at: "2026-05-01T10:00:00.000Z",
};

const txtArtifact: ArtifactMeta = {
  id: "art-txt",
  path: "out/log.txt",
  mime_type: "text/plain",
  byte_size: 512,
  uploaded_at: "2026-05-01T10:01:00.000Z",
};

const contentById: Record<string, ArtifactContent> = {
  "art-md": {
    id: "art-md",
    path: "docs/PLAN.md",
    mime_type: "text/markdown",
    content: "# Heading\n\nMarkdown body.",
  },
  "art-txt": {
    id: "art-txt",
    path: "out/log.txt",
    mime_type: "text/plain",
    content: "plain text body",
  },
};

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    useSessionArtifacts: () => ({
      data: { artifacts: [mdArtifact, txtArtifact] },
      isLoading: false,
      isError: false,
    }),
    useSessionArtifact: (_id: string | undefined, artifactId: string | undefined) => ({
      data: artifactId ? contentById[artifactId] : undefined,
      isLoading: false,
      isError: false,
    }),
  };
});

import { ArtifactsPanel } from "../components/transcript/ArtifactsPanel";

const renderPanel = () => {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ArtifactsPanel sessionId="s-1" />
    </QueryClientProvider>,
  );
};

describe("ArtifactsPanel", () => {
  it("lists artifact rows from the mocked hook", () => {
    renderPanel();
    const rows = screen.getAllByTestId("artifact-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("docs/PLAN.md")).toBeTruthy();
    expect(screen.getByText("out/log.txt")).toBeTruthy();
  });

  it("renders a MarkdownView for text/markdown artifacts", () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByText("docs/PLAN.md"));
    expect(screen.getByTestId("artifact-drawer")).toBeTruthy();
    // MarkdownView renders an h1 from the leading "# Heading".
    expect(container.querySelector("h1")?.textContent).toBe("Heading");
    expect(container.querySelector('[data-testid="artifact-pre"]')).toBeNull();
  });

  it("renders a <pre> for text/plain artifacts", () => {
    renderPanel();
    fireEvent.click(screen.getByText("out/log.txt"));
    const pre = screen.getByTestId("artifact-pre");
    expect(pre.textContent).toBe("plain text body");
  });

  it("swaps drawer content in place when another artifact is clicked", () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByText("docs/PLAN.md"));
    expect(container.querySelector("h1")?.textContent).toBe("Heading");
    fireEvent.click(screen.getByText("out/log.txt"));
    // Single drawer, content swapped: markdown gone, <pre> now present.
    expect(container.querySelector("h1")).toBeNull();
    expect(screen.getByTestId("artifact-pre").textContent).toBe("plain text body");
    expect(screen.getAllByTestId("artifact-drawer")).toHaveLength(1);
  });

  it("closes the drawer on backdrop click", () => {
    renderPanel();
    fireEvent.click(screen.getByText("docs/PLAN.md"));
    fireEvent.click(screen.getByLabelText("close dialog"));
    expect(screen.queryByTestId("artifact-drawer")).toBeNull();
  });

  it("closes the drawer on Escape", () => {
    renderPanel();
    fireEvent.click(screen.getByText("docs/PLAN.md"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("artifact-drawer")).toBeNull();
  });
});
