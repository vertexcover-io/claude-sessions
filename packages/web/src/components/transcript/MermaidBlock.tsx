// AI-generated. See PROMPT.md for the prompts and model used.

import { useEffect, useState } from "react";
import { toFittedSvg } from "./graph-svg";

interface Props {
  source: string;
}

let idCounter = 0;
const nextId = (): string => {
  idCounter += 1;
  return `mermaid-${idCounter}`;
};

const prefersDark = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Render a Mermaid block (flowchart, sequence diagram, etc. — auto-detected
 *  from the first keyword) as an SVG. The mermaid engine is loaded lazily so
 *  its payload only downloads when an artifact contains a `mermaid` fence. On
 *  any parse or load error we fall back to the raw source. */
export const MermaidBlock = ({ source }: Props) => {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: prefersDark() ? "dark" : "default",
        });
        // parse() validates without injecting an error node into the DOM.
        await mermaid.parse(source);
        const { svg: rendered } = await mermaid.render(nextId(), source);
        if (cancelled) return;
        setSvg(toFittedSvg(rendered));
      } catch {
        // Leave svg null → raw-source fallback below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (svg) {
    return (
      <div
        className="graph-svg"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG is sanitized via DOMPurify in toFittedSvg.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  return (
    <pre className="whitespace-pre-wrap rounded border border-border bg-background p-3 font-mono text-xs">
      {source}
    </pre>
  );
};
