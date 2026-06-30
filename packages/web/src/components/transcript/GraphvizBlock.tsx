// AI-generated. See PROMPT.md for the prompts and model used.

import DOMPurify from "dompurify";
import { useEffect, useState } from "react";

interface Props {
  source: string;
}

/** Render a Graphviz DOT block as an SVG. The WASM engine is loaded
 *  lazily (dynamic import) so its payload only downloads when an
 *  artifact actually contains a `dot`/`graphviz` fence. On any parse or
 *  load error we fall back to the raw source so the drawer never breaks. */
export const GraphvizBlock = ({ source }: Props) => {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    (async () => {
      try {
        const { Graphviz } = await import("@hpcc-js/wasm-graphviz");
        const graphviz = await Graphviz.load();
        const rendered = graphviz.dot(source);
        if (cancelled) return;
        setSvg(DOMPurify.sanitize(rendered, { USE_PROFILES: { svg: true, svgFilters: true } }));
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
        className="graph-svg overflow-auto"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG is sanitized via DOMPurify above.
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
