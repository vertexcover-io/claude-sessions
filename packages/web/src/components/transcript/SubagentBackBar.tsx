// AI-generated. See PROMPT.md for the prompts and model used.

import { ArrowLeft, ChevronRight, GitFork } from "lucide-react";

interface Crumb {
  sessionId: string;
  anchorEventUuid: string;
}

interface Props {
  stack: Crumb[];
  onBackToMain: () => void;
  onPopTo: (depth: number) => void;
}

const shortId = (id: string): string => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

export const SubagentBackBar = ({ stack, onBackToMain, onPopTo }: Props) => {
  if (stack.length === 0) return null;

  return (
    <div
      className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border px-4 py-2 flex items-center gap-2 text-sm flex-wrap"
      data-testid="subagent-back-bar"
    >
      <button
        type="button"
        onClick={onBackToMain}
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted"
        data-testid="back-to-main"
      >
        <ArrowLeft size={14} /> Back to main
      </button>
      <span className="text-muted-foreground">/</span>
      {stack.map((crumb, i) => (
        <span key={crumb.sessionId} className="inline-flex items-center gap-2">
          {i > 0 && <ChevronRight size={14} className="text-muted-foreground" />}
          <button
            type="button"
            onClick={() => onPopTo(i + 1)}
            className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded hover:bg-accent"
            data-testid="back-bar-crumb"
          >
            <GitFork size={12} /> Agent · {shortId(crumb.sessionId)}
          </button>
        </span>
      ))}
    </div>
  );
};
