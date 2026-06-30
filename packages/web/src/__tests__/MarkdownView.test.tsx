// AI-generated. See PROMPT.md for the prompts and model used.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Stub the two graph engines so routing is observable without running WASM /
// mermaid under jsdom (neither produces an SVG synchronously here).
vi.mock("../components/transcript/GraphvizBlock", () => ({
  GraphvizBlock: ({ source }: { source: string }) => <div data-testid="graphviz">{source}</div>,
}));
vi.mock("../components/transcript/MermaidBlock", () => ({
  MermaidBlock: ({ source }: { source: string }) => <div data-testid="mermaid">{source}</div>,
}));

import { MarkdownView } from "../components/transcript/MarkdownView";

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

describe("MarkdownView graph rendering", () => {
  it("routes a dot fence to GraphvizBlock when renderGraphs is set", () => {
    render(<MarkdownView renderGraphs>{fence("dot", "digraph { a -> b }")}</MarkdownView>);
    expect(screen.getByTestId("graphviz")).toHaveTextContent("digraph { a -> b }");
  });

  it("routes a graphviz fence to GraphvizBlock", () => {
    render(<MarkdownView renderGraphs>{fence("graphviz", "digraph { x -> y }")}</MarkdownView>);
    expect(screen.getByTestId("graphviz")).toHaveTextContent("digraph { x -> y }");
  });

  it("routes a mermaid fence to MermaidBlock", () => {
    render(<MarkdownView renderGraphs>{fence("mermaid", "graph LR; a-->b")}</MarkdownView>);
    expect(screen.getByTestId("mermaid")).toHaveTextContent("graph LR; a-->b");
  });

  it("leaves non-graph code blocks as plain code", () => {
    render(<MarkdownView renderGraphs>{fence("ts", "const x = 1;")}</MarkdownView>);
    expect(screen.queryByTestId("graphviz")).toBeNull();
    expect(screen.queryByTestId("mermaid")).toBeNull();
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  });

  it("does not render graphs when renderGraphs is absent (transcript path)", () => {
    render(<MarkdownView>{fence("dot", "digraph { a -> b }")}</MarkdownView>);
    expect(screen.queryByTestId("graphviz")).toBeNull();
    expect(screen.getByText("digraph { a -> b }")).toBeInTheDocument();
  });
});
