// AI-generated. See PROMPT.md for the prompts and model used.

import { X } from "lucide-react";
import { Resizable } from "re-resizable";
import { useEffect, useState } from "react";
import { useSessionArtifact } from "../lib/api";
import type { ArtifactMeta } from "../lib/types";
import { MarkdownView } from "./transcript/MarkdownView";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  artifact: ArtifactMeta;
}

const DEFAULT_WIDTH = 560;

export const ArtifactDrawer = ({ open, onClose, sessionId, artifact }: Props) => {
  const content = useSessionArtifact(open ? sessionId : undefined, open ? artifact.id : undefined);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const body = content.data?.content ?? "";
  const isMarkdown = artifact.mime_type === "text/markdown";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="artifact-drawer">
      <button
        type="button"
        aria-label="close dialog"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <Resizable
        defaultSize={{ width: DEFAULT_WIDTH, height: "100%" }}
        minWidth={360}
        maxWidth="90vw"
        enable={{ left: true }}
        handleComponent={{
          left: (
            <div className="flex h-full w-2 items-center justify-center">
              <div className="h-12 w-1 rounded-full bg-border transition-colors hover:bg-primary" />
            </div>
          ),
        }}
        handleStyles={{ left: { width: 8, left: -4 } }}
        className="relative h-full"
        style={{
          transform: shown ? "translateX(0)" : "translateX(100%)",
          transition: "transform 200ms ease-out",
        }}
      >
        <div
          aria-modal="true"
          className="flex h-full flex-col border-l border-border bg-card text-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border p-4">
            <h3 className="truncate font-mono text-sm font-semibold" title={artifact.path}>
              {artifact.path}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="close"
              className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {content.isLoading && (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading artifact…</div>
            )}
            {content.isError && (
              <div className="p-8 text-center text-sm text-red-500">Failed to load artifact.</div>
            )}
            {content.data &&
              (isMarkdown ? (
                <MarkdownView>{body}</MarkdownView>
              ) : (
                <pre
                  className="whitespace-pre-wrap rounded border border-border bg-background p-3 font-mono text-xs"
                  data-testid="artifact-pre"
                >
                  {body}
                </pre>
              ))}
          </div>
        </div>
      </Resizable>
    </div>
  );
};
