import { GitCommit } from "lucide-react";
import type { SessionCommit } from "../../lib/types";

interface Props {
  commits: SessionCommit[];
}

const formatTime = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export const CommitsPanel = ({ commits }: Props) => {
  if (commits.length === 0) return null;
  return (
    <section className="px-4 pt-3" data-testid="commits-panel">
      <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
        <GitCommit size={12} />
        Commits during session ({commits.length})
      </div>
      <div className="space-y-1.5">
        {commits.map((c) => (
          <div
            key={c.sha}
            className="flex items-start gap-2 text-sm bg-card border border-border rounded px-3 py-2"
          >
            <span className="font-mono text-xs text-muted-foreground shrink-0 mt-0.5">
              {c.short_sha}
            </span>
            <span className="flex-1 truncate">{c.subject}</span>
            {c.branch && (
              <span className="font-mono text-xs text-muted-foreground shrink-0">{c.branch}</span>
            )}
            {(c.insertions !== null || c.deletions !== null) && (
              <span className="font-mono text-xs shrink-0 tabular-nums">
                {c.insertions !== null && <span className="text-emerald-600">+{c.insertions}</span>}
                {c.insertions !== null && c.deletions !== null && " "}
                {c.deletions !== null && <span className="text-red-500">-{c.deletions}</span>}
              </span>
            )}
            <span className="font-mono text-xs text-muted-foreground shrink-0 tabular-nums">
              {formatTime(c.authored_at)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};
