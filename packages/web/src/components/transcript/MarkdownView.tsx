// AI-generated. See PROMPT.md for the prompts and model used.

import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { GraphvizBlock } from "./GraphvizBlock";
import { MermaidBlock } from "./MermaidBlock";

interface Props {
  children: string;
  /** When set, fenced `dot`/`graphviz`/`mermaid` blocks render as SVG diagrams
   *  instead of plain code. Only the artifact viewer opts in; the transcript
   *  keeps rendering code blocks as plain text. */
  renderGraphs?: boolean;
}

const codeRenderer = ({ className, children, ...rest }: ComponentPropsWithoutRef<"code">) => {
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
  const src = String(children ?? "").replace(/\n$/, "");
  if (lang === "dot" || lang === "graphviz") return <GraphvizBlock source={src} />;
  if (lang === "mermaid") return <MermaidBlock source={src} />;
  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
};

const graphComponents: Components = { code: codeRenderer };

/** Strip CSI / ANSI escape sequences (e.g. `\x1b[1m`, `\x1b[22m`,
 *  256-colour, OSC) that leak in from `<local-command-stdout>` blocks
 *  the slash-command machinery wraps shell output with. Without this
 *  the codes render as literal `\x1b[...m` in the message bubble. */
const ANSI_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Matching ANSI escapes is the explicit purpose here.
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;

const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

export const MarkdownView = ({ children, renderGraphs = false }: Props) => {
  return (
    <div className="prose-tight text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={renderGraphs ? graphComponents : undefined}
      >
        {stripAnsi(children)}
      </ReactMarkdown>
    </div>
  );
};
