// AI-generated. See PROMPT.md for the prompts and model used.

import { FileText } from "lucide-react";
import { useState } from "react";
import { useSessionArtifacts } from "../../lib/api";
import type { ArtifactMeta } from "../../lib/types";
import { ArtifactModal } from "../ArtifactModal";

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

export const ArtifactsPanel = ({ sessionId }: { sessionId: string }) => {
  const artifacts = useSessionArtifacts(sessionId);
  const [selected, setSelected] = useState<ArtifactMeta | null>(null);

  if (artifacts.isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading artifacts…</div>;
  }
  if (artifacts.isError) {
    return <div className="p-8 text-center text-sm text-red-500">Failed to load artifacts.</div>;
  }

  const rows = artifacts.data?.artifacts ?? [];
  if (rows.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">No artifacts.</div>;
  }

  return (
    <div className="px-4 py-4" data-testid="artifacts-panel">
      <div className="text-xs text-muted-foreground mb-3">
        {rows.length} {rows.length === 1 ? "artifact" : "artifacts"}
      </div>
      <div className="space-y-1">
        {rows.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelected(a)}
            className="w-full text-left p-2 rounded border border-border flex items-center gap-2 hover:bg-accent"
            data-testid="artifact-row"
          >
            <FileText size={14} className="shrink-0 text-muted-foreground" />
            <span className="font-mono text-sm truncate flex-1">{a.path}</span>
            <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
              {formatBytes(a.byte_size)}
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <ArtifactModal
          open={!!selected}
          onClose={() => setSelected(null)}
          sessionId={sessionId}
          artifact={selected}
        />
      )}
    </div>
  );
};
