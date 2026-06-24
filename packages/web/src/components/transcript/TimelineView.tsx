import { ChevronRight, CornerDownRight, Sparkles, User, Wrench } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import type { TranscriptEvent } from "../../lib/types";
import { MarkdownView } from "./MarkdownView";

interface Props {
  events: TranscriptEvent[];
  onEnterSubagent?: (agentId: string, parentEventUuid: string) => void;
}

const formatTime = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDuration = (ms: number): string => {
  if (ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s % 60)}s`;
};

interface PairedTool {
  call: TranscriptEvent | null;
  result: TranscriptEvent | null;
  tool_use_id: string;
}

const PairedToolCard = ({
  pair,
  onEnterSubagent,
}: {
  pair: PairedTool;
  onEnterSubagent?: (agentId: string, parentEventUuid: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const call = pair.call;
  const result = pair.result;
  const tool = (call?.payload.tool ?? "tool") as string;
  const input = (call?.payload.input_summary ?? "") as string;
  const output = (result?.payload.output_summary ?? call?.payload.output_summary ?? "") as string;
  const isError = call?.payload.is_error === true || result?.payload.is_error === true;
  const agentId = call?.payload.agent_id;
  const callUuid = call?.event_uuid;
  const calledAt = call?.ts ?? null;
  const completedAt = result?.ts ?? null;
  const duration =
    calledAt && completedAt && Date.parse(calledAt) > 0 && Date.parse(completedAt) > 0
      ? Date.parse(completedAt) - Date.parse(calledAt)
      : null;

  return (
    <div className={cn("tool-card relative", isError && "tool-error")} data-testid="tool-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="tool-card-header"
        aria-expanded={open}
      >
        <ChevronRight
          size={13}
          className={cn("transition-transform shrink-0", open && "rotate-90")}
        />
        <Wrench size={12} className="shrink-0" />
        <span className="tool-card-tool shrink-0">{tool}</span>
        <span className="tool-card-input">{input}</span>
        {duration !== null && <span className="tool-card-meta">{formatDuration(duration)}</span>}
        {calledAt && Date.parse(calledAt) > 0 && (
          <span className="tool-card-meta">{formatTime(calledAt)}</span>
        )}
        {isError && <span className="role-badge role-badge-tool-error">error</span>}
      </button>
      {agentId && callUuid && onEnterSubagent && (
        <button
          type="button"
          onClick={() => onEnterSubagent(agentId, callUuid)}
          className="absolute top-1.5 right-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-border bg-background hover:bg-accent"
          data-testid="enter-subagent"
        >
          <CornerDownRight size={12} /> enter
        </button>
      )}
      {open && (
        <div className="tool-card-body space-y-2">
          {(calledAt || completedAt) && (
            <div className="flex gap-4 text-xs text-muted-foreground">
              {calledAt && (
                <span>
                  called <span className="font-mono">{formatTime(calledAt)}</span>
                </span>
              )}
              {completedAt && (
                <span>
                  completed <span className="font-mono">{formatTime(completedAt)}</span>
                </span>
              )}
              {duration !== null && (
                <span>
                  took <span className="font-mono">{formatDuration(duration)}</span>
                </span>
              )}
            </div>
          )}
          <div>
            <div className="text-muted-foreground mb-1 text-xs">input</div>
            <pre className="font-mono whitespace-pre-wrap m-0">{input || "(empty)"}</pre>
          </div>
          {output && (
            <div>
              <div className="text-muted-foreground mb-1 text-xs">output</div>
              <pre className="font-mono whitespace-pre-wrap m-0">{output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface TimelineRowProps {
  dotClass: string;
  children: React.ReactNode;
  id?: string;
}
const TimelineRow = ({ dotClass, children, id }: TimelineRowProps) => (
  <div className="timeline-row" id={id}>
    <span className={cn("timeline-dot", dotClass)} aria-hidden />
    {children}
  </div>
);

/** Pair tool_use call (assistant-emitted: has `tool` + `input_summary`)
 *  with its corresponding tool_result (user-shaped: blank tool, has
 *  output_summary) by `tool_use_id`. We render the pair at the call's
 *  timeline position and skip the result row. Orphans (one side missing)
 *  still render at their own position so nothing is dropped. */
const buildTimeline = (events: TranscriptEvent[]) => {
  const callIdxByToolUseId = new Map<string, number>();
  const consumedResultIdx = new Set<number>();
  const pairing = new Map<number, PairedTool>(); // call event index → pair

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.type !== "tool_use") continue;
    const id = ev.payload.tool_use_id;
    if (typeof id !== "string" || id.length === 0) continue;
    const isCall =
      typeof ev.payload.tool === "string" &&
      ev.payload.tool.length > 0 &&
      typeof ev.payload.input_summary === "string" &&
      ev.payload.input_summary.length > 0;
    if (isCall) {
      callIdxByToolUseId.set(id, i);
      pairing.set(i, { call: ev, result: null, tool_use_id: id });
    } else {
      const callIdx = callIdxByToolUseId.get(id);
      if (callIdx !== undefined) {
        const pair = pairing.get(callIdx);
        if (pair) pair.result = ev;
        consumedResultIdx.add(i);
      }
    }
  }

  return { pairing, consumedResultIdx };
};

export const TimelineView = ({ events, onEnterSubagent }: Props) => {
  if (events.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">No timeline events.</div>;
  }

  const { pairing, consumedResultIdx } = buildTimeline(events);

  return (
    <div className="px-4 py-4 timeline" data-testid="timeline-view">
      {events.map((ev, i) => {
        if (consumedResultIdx.has(i)) return null;

        if (ev.type === "user_msg") {
          const text = (ev.payload.content_md ?? "") as string;
          if (!text.trim()) return null;
          return (
            <TimelineRow
              key={ev.event_uuid}
              id={`evt-${ev.event_uuid}`}
              dotClass="timeline-dot-user"
            >
              <div className="msg-user">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="role-badge role-badge-user">
                    <User size={11} /> You
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                    {formatTime(ev.ts)}
                  </span>
                </div>
                <MarkdownView>{text}</MarkdownView>
              </div>
            </TimelineRow>
          );
        }

        if (ev.type === "assistant_msg") {
          const text = (ev.payload.content_md ?? "") as string;
          if (!text.trim()) return null;
          const model = (ev.payload.model ?? null) as string | null;
          return (
            <TimelineRow
              key={ev.event_uuid}
              id={`evt-${ev.event_uuid}`}
              dotClass="timeline-dot-assistant"
            >
              <div className="msg-assistant">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="role-badge role-badge-assistant">
                    <Sparkles size={11} /> Claude
                  </span>
                  {model && (
                    <span className="font-mono text-xs text-muted-foreground">{model}</span>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                    {formatTime(ev.ts)}
                  </span>
                </div>
                <MarkdownView>{text}</MarkdownView>
              </div>
            </TimelineRow>
          );
        }

        if (ev.type === "tool_use") {
          const pair = pairing.get(i) ?? {
            call: ev,
            result: null,
            tool_use_id: (ev.payload.tool_use_id ?? "") as string,
          };
          const isError =
            pair.call?.payload.is_error === true || pair.result?.payload.is_error === true;
          return (
            <TimelineRow
              key={ev.event_uuid}
              id={`evt-${ev.event_uuid}`}
              dotClass={isError ? "timeline-dot-tool-error" : "timeline-dot-tool"}
            >
              <PairedToolCard pair={pair} onEnterSubagent={onEnterSubagent} />
            </TimelineRow>
          );
        }

        // system / summary / unknown — keep noise out of the timeline.
        return null;
      })}
    </div>
  );
};
