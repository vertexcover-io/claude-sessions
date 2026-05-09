// AI-generated. See PROMPT.md for the prompts and model used.

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { TranscriptEvent } from "../../lib/types";
import { AssistantMessage } from "./AssistantMessage";
import { ToolCallCollapsed } from "./ToolCallCollapsed";
import { UserMessage } from "./UserMessage";

interface Props {
  events: TranscriptEvent[];
  /** When true, drop tool_use + system events so the timeline reads as a
   *  pure user/assistant conversation, AND collapse every contiguous run
   *  of assistant turns between two user turns into a single block. */
  conversationOnly?: boolean;
}

interface AssistantTurn {
  ts: string;
  content_md: string;
}

/** In conversation mode each user message is followed by Claude's reply,
 *  which in our raw stream is often N assistant_msg events (one per
 *  message Claude streamed back, broken up by tool_use rounds). We
 *  group them into one synthesized event whose `payload.turns` carries
 *  every individual turn so the UI can render each with its own
 *  timestamp inside one bubble (matches the screenshot). */
const collapseAssistantRuns = (events: TranscriptEvent[]): TranscriptEvent[] => {
  const out: TranscriptEvent[] = [];
  let runStart: TranscriptEvent | null = null;
  let runTurns: AssistantTurn[] = [];
  let runModel: string | undefined;

  const flush = () => {
    if (runStart === null) return;
    out.push({
      ...runStart,
      payload: {
        ...runStart.payload,
        // Keep `content_md` as the joined fallback so anything that
        // ignores `turns` still renders something reasonable.
        content_md: runTurns
          .map((t) => t.content_md)
          .filter((t) => t.length > 0)
          .join("\n\n"),
        turns: runTurns,
        ...(runModel !== undefined ? { model: runModel } : {}),
      },
    });
    runStart = null;
    runTurns = [];
    runModel = undefined;
  };

  for (const ev of events) {
    if (ev.type === "assistant_msg") {
      const text = (ev.payload.content_md ?? "") as string;
      if (text.trim().length === 0) continue;
      if (runStart === null) runStart = ev;
      runTurns.push({ ts: ev.ts, content_md: text });
      const m = ev.payload.model;
      if (typeof m === "string" && m.length > 0) runModel = m;
      continue;
    }
    flush();
    out.push(ev);
  }
  flush();
  return out;
};

// Below this size we render every event up-front. Virtualization adds latency
// for short transcripts and pessimizes test environments (jsdom reports zero
// scroll height). The threshold matches Lighthouse's "interactive" budget.
const VIRTUALIZE_THRESHOLD = 50;

const renderEvent = (event: TranscriptEvent) => {
  switch (event.type) {
    case "user_msg":
      return <UserMessage content={event.payload.content_md ?? ""} ts={event.ts} />;
    case "assistant_msg": {
      const turns = Array.isArray(event.payload.turns)
        ? (event.payload.turns as AssistantTurn[])
        : undefined;
      return (
        <AssistantMessage
          content={event.payload.content_md ?? ""}
          model={typeof event.payload.model === "string" ? event.payload.model : undefined}
          ts={event.ts}
          turns={turns}
        />
      );
    }
    case "tool_use":
      return <ToolCallCollapsed event={event} />;
    case "summary":
      return (
        <div className="msg-assistant border-dashed">
          <div className="text-xs text-muted-foreground mb-2">Summary</div>
          <div className="text-sm whitespace-pre-wrap">{event.payload.content ?? ""}</div>
        </div>
      );
    case "system":
      return (
        <div className="text-xs text-muted-foreground italic px-2">
          system: {event.payload.kind ?? "unknown"} — {event.payload.content ?? ""}
        </div>
      );
    default:
      return null;
  }
};

const SimpleTranscript = ({ events }: Props) => (
  <div
    data-testid="transcript-list"
    className="transcript-list flex-1 overflow-auto px-4 py-4 space-y-3"
    style={{ maxHeight: "calc(100vh - 56px)" }}
  >
    {events.map((event) => (
      <div key={event.event_uuid}>{renderEvent(event)}</div>
    ))}
  </div>
);

const VirtualizedTranscript = ({ events }: Props) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 160,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      data-testid="transcript-list"
      className="transcript-list flex-1 overflow-auto px-4 py-4"
      style={{ maxHeight: "calc(100vh - 56px)" }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virt) => {
          const event = events[virt.index];
          if (!event) return null;
          return (
            <div
              key={event.event_uuid}
              data-index={virt.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virt.start}px)`,
                paddingBottom: 12,
              }}
            >
              {renderEvent(event)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const TranscriptList = ({ events, conversationOnly }: Props) => {
  const filtered = conversationOnly
    ? collapseAssistantRuns(
        events.filter((e) => e.type === "user_msg" || e.type === "assistant_msg"),
      )
    : events;
  if (filtered.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground" data-testid="transcript-empty">
        {conversationOnly ? "No conversation messages." : "No transcript events."}
      </div>
    );
  }
  if (filtered.length < VIRTUALIZE_THRESHOLD) return <SimpleTranscript events={filtered} />;
  return <VirtualizedTranscript events={filtered} />;
};
