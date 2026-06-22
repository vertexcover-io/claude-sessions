// AI-generated. See PROMPT.md for the prompts and model used.

import { X } from "lucide-react";
import { useSessionArtifact } from "../lib/api";
import type { ArtifactMeta } from "../lib/types";
import { MarkdownView } from "./transcript/MarkdownView";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  artifact: ArtifactMeta;
}

export const ArtifactModal = ({ open, onClose, sessionId, artifact }: Props) => {
  const content = useSessionArtifact(open ? sessionId : undefined, open ? artifact.id : undefined);

  if (!open) return null;

  const body = content.data?.content ?? "";
  const isMarkdown = artifact.mime_type === "text/markdown";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="artifact-modal"
    >
      <button
        type="button"
        aria-label="close dialog"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <dialog
        open
        aria-modal="true"
        className="relative bg-card border border-border rounded-lg p-5 w-full max-w-3xl mx-4 text-foreground max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold font-mono text-sm truncate" title={artifact.path}>
            {artifact.path}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="text-muted-foreground hover:text-foreground shrink-0 ml-2"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
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
                className="font-mono whitespace-pre-wrap bg-background border border-border rounded p-3 text-xs"
                data-testid="artifact-pre"
              >
                {body}
              </pre>
            ))}
        </div>
      </dialog>
    </div>
  );
};
