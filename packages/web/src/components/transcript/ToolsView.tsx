import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import type { ToolCallPair } from "../../lib/types";

const formatDuration = (ms: number | null): string => {
  if (ms === null || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s % 60)}s`;
};

const formatTime = (iso: string | null): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString();
};

const ToolCallRow = ({ pair }: { pair: ToolCallPair }) => {
  const [open, setOpen] = useState(false);
  const tool = pair.tool ?? "(unknown)";
  const orphan = !pair.called_at || !pair.completed_at;

  return (
    <div
      className={cn(
        "border border-border rounded my-2",
        pair.is_error && "border-red-500/40",
        orphan && "border-amber-500/40",
      )}
      data-testid="tool-pair"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left p-2 font-mono text-sm flex items-center gap-2 hover:bg-accent"
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          className={cn("transition-transform shrink-0", open && "rotate-90")}
        />
        <span className="font-semibold shrink-0">{tool}</span>
        <span className="text-muted-foreground truncate flex-1">
          {pair.input_summary ?? "(no input)"}
        </span>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
          {formatDuration(pair.duration_ms)}
        </span>
        {pair.is_error && <span className="text-xs text-red-500 font-medium">error</span>}
        {orphan && !pair.is_error && (
          <span className="text-xs text-amber-500 font-medium">incomplete</span>
        )}
      </button>
      {open && (
        <div className="border-t border-border p-3 space-y-3 text-xs bg-muted">
          <div className="flex gap-6 text-muted-foreground">
            <div>
              <span className="font-semibold">called: </span>
              <span className="font-mono">{formatTime(pair.called_at)}</span>
            </div>
            <div>
              <span className="font-semibold">completed: </span>
              <span className="font-mono">{formatTime(pair.completed_at)}</span>
            </div>
            <div>
              <span className="font-semibold">duration: </span>
              <span className="font-mono">{formatDuration(pair.duration_ms)}</span>
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-1">input</div>
            <pre className="font-mono whitespace-pre-wrap bg-background border border-border rounded p-2">
              {pair.input_summary ?? "(empty)"}
            </pre>
          </div>
          <div>
            <div className="text-muted-foreground mb-1">output</div>
            <pre
              className={cn(
                "font-mono whitespace-pre-wrap border rounded p-2",
                pair.is_error ? "bg-red-500/5 border-red-500/40" : "bg-background border-border",
              )}
            >
              {pair.output_summary ?? (orphan ? "(no result — interrupted?)" : "(empty)")}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export const ToolsView = ({ pairs }: { pairs: ToolCallPair[] }) => {
  if (pairs.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">No tool calls.</div>;
  }
  return (
    <div className="px-4 py-4" data-testid="tools-view">
      <div className="text-xs text-muted-foreground mb-3">
        {pairs.length} tool {pairs.length === 1 ? "call" : "calls"}
      </div>
      {pairs.map((p) => (
        <ToolCallRow key={p.tool_use_id} pair={p} />
      ))}
    </div>
  );
};
