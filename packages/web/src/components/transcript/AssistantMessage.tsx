import { Sparkles } from "lucide-react";
import { MarkdownView } from "./MarkdownView";

interface AssistantTurn {
  ts: string;
  content_md: string;
}

interface Props {
  content: string;
  model?: string;
  ts?: string;
  /** Multiple assistant turns merged into one bubble — each rendered with
   *  its own timestamp, matching the screenshot layout. */
  turns?: AssistantTurn[];
}

const formatTime = (iso?: string): string | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

export const AssistantMessage = ({ content, model, ts, turns }: Props) => {
  const renderTurns: AssistantTurn[] =
    turns && turns.length > 0 ? turns : [{ ts: ts ?? "", content_md: content }];

  return (
    <div className="msg-assistant" data-testid="msg-assistant">
      <div className="flex items-center gap-2 mb-2">
        <span className="role-badge role-badge-assistant">
          <Sparkles size={11} /> Claude
        </span>
        {model && <span className="font-mono text-xs text-muted-foreground">{model}</span>}
      </div>
      <div className="space-y-3">
        {renderTurns.map((t, i) => {
          const time = formatTime(t.ts);
          return (
            <div key={`${t.ts}-${i}`} className="assistant-turn">
              {time && (
                <div className="text-xs text-muted-foreground tabular-nums mb-1 font-mono">
                  {time}
                </div>
              )}
              <MarkdownView>{t.content_md}</MarkdownView>
            </div>
          );
        })}
      </div>
    </div>
  );
};
