// AI-generated. See PROMPT.md for the prompts and model used.

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const graphvizLoad = vi.fn();
vi.mock("@hpcc-js/wasm-graphviz", () => ({
  Graphviz: { load: () => graphvizLoad() },
}));

const mermaidParse = vi.fn();
const mermaidRender = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: (s: string) => mermaidParse(s),
    render: (id: string, s: string) => mermaidRender(id, s),
  },
}));

import { GraphvizBlock } from "../components/transcript/GraphvizBlock";
import { MermaidBlock } from "../components/transcript/MermaidBlock";
import { toFittedSvg } from "../components/transcript/graph-svg";

afterEach(() => {
  vi.clearAllMocks();
});

describe("toFittedSvg", () => {
  it("strips fixed width/height from the root svg so it scales to width", () => {
    const out = toFittedSvg('<svg width="800pt" height="600pt" viewBox="0 0 800 600"><g/></svg>');
    expect(out).not.toMatch(/<svg[^>]*\swidth=/);
    expect(out).not.toMatch(/<svg[^>]*\sheight=/);
    expect(out).toContain('viewBox="0 0 800 600"');
  });
});

describe("GraphvizBlock", () => {
  it("renders the SVG returned by the engine", async () => {
    graphvizLoad.mockResolvedValue({ dot: () => "<svg><g id='ok'/></svg>" });
    const { container } = render(<GraphvizBlock source="digraph { a -> b }" />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
  });

  it("falls back to raw source synchronously before the engine resolves", () => {
    graphvizLoad.mockReturnValue(new Promise(() => {})); // never resolves
    render(<GraphvizBlock source="digraph { a -> b }" />);
    expect(screen.getByText("digraph { a -> b }")).toBeInTheDocument();
  });

  it("falls back to raw source when the engine throws", async () => {
    graphvizLoad.mockRejectedValue(new Error("bad dot"));
    render(<GraphvizBlock source="not a graph" />);
    await waitFor(() => expect(screen.getByText("not a graph")).toBeInTheDocument());
  });
});

describe("MermaidBlock", () => {
  it("renders the SVG returned by the engine", async () => {
    mermaidParse.mockResolvedValue(true);
    mermaidRender.mockResolvedValue({ svg: "<svg><g id='m'/></svg>" });
    const { container } = render(<MermaidBlock source="graph LR; a-->b" />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
  });

  it("falls back to raw source when parse rejects", async () => {
    mermaidParse.mockRejectedValue(new Error("parse error"));
    render(<MermaidBlock source="graph LR; broken" />);
    await waitFor(() => expect(screen.getByText("graph LR; broken")).toBeInTheDocument());
    expect(mermaidRender).not.toHaveBeenCalled();
  });
});
