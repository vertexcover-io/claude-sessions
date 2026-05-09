import { User } from "lucide-react";
import { MarkdownView } from "./MarkdownView";

interface Props {
  content: string;
  ts?: string;
}

const formatTime = (iso?: string): string | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export const UserMessage = ({ content, ts }: Props) => {
  const time = formatTime(ts);
  return (
    <div className="msg-user" data-testid="msg-user">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="role-badge role-badge-user">
          <User size={11} /> You
        </span>
        {time && <span className="text-xs text-muted-foreground tabular-nums">{time}</span>}
      </div>
      <MarkdownView>{content}</MarkdownView>
    </div>
  );
};
