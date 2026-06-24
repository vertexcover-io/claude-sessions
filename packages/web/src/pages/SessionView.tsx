// AI-generated. See PROMPT.md for the prompts and model used.

import {
  Activity,
  ArrowLeft,
  FileText,
  GitFork,
  Lightbulb,
  MessageSquare,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ForkModal } from "../components/ForkModal";
import { ArtifactsPanel } from "../components/transcript/ArtifactsPanel";
import { CommitsPanel } from "../components/transcript/CommitsPanel";
import { LearningsPanel } from "../components/transcript/LearningsPanel";
import { StickyHeader } from "../components/transcript/StickyHeader";
import { SubagentBackBar } from "../components/transcript/SubagentBackBar";
import { SummaryPanel } from "../components/transcript/SummaryPanel";
import { TimelineView } from "../components/transcript/TimelineView";
import { ToolsView } from "../components/transcript/ToolsView";
import { TranscriptList } from "../components/transcript/TranscriptList";
import {
  useSession,
  useSessionArtifacts,
  useSessionCommits,
  useSessionEvents,
  useSessionToolCalls,
} from "../lib/api";
import { cn } from "../lib/cn";

type Tab = "timeline" | "conversation" | "tools" | "artifacts" | "learnings";

interface SubagentFrame {
  sessionId: string;
  anchorEventUuid: string;
}

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "px-3 py-1.5 text-sm rounded inline-flex items-center gap-1.5 border",
      active
        ? "border-border bg-muted text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent",
    )}
    aria-pressed={active}
  >
    {children}
  </button>
);

export const SessionView = () => {
  const { id: rootId } = useParams<{ id: string }>();
  // Drill-in stack: each frame is a subagent transcript plus the parent row to
  // restore when popping back. The active session id is the deepest frame, or
  // the root when the stack is empty.
  const [stack, setStack] = useState<SubagentFrame[]>([]);
  const activeSessionId = stack.at(-1)?.sessionId ?? rootId;
  const inSubagent = stack.length > 0;

  // Session metadata (header, summary, commits, artifacts, learnings) always
  // reflects the ROOT session — subagents are transcript-only. Only the
  // transcript/timeline/tools data follows the active (possibly nested) id.
  const session = useSession(rootId);
  const events = useSessionEvents(activeSessionId);
  const toolCalls = useSessionToolCalls(activeSessionId);
  const commits = useSessionCommits(rootId);
  const artifacts = useSessionArtifacts(rootId);
  const [forkOpen, setForkOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("timeline");
  const jumpTarget = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Deep-link into the transcript: a learning's evidence, or the originating
  // Agent row restored on Back. The Timeline view renders every event type
  // (incl. tool failures) and is not virtualized, so the anchor element exists
  // once it mounts. In subagent mode the timeline renders regardless of `tab`,
  // so we only require that a timeline is on screen. Scroll + flash.
  useEffect(() => {
    if (!jumpTarget.current) return;
    // `activeSessionId` is read so the effect re-fires after any transcript
    // swap — including popping a middle crumb, which keeps the view in
    // subagent mode but changes which transcript is mounted.
    if (!activeSessionId) return;
    if (!inSubagent && tab !== "timeline") return;
    const uuid = jumpTarget.current;
    jumpTarget.current = null;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`evt-${uuid}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("evt-flash");
      setTimeout(() => el.classList.remove("evt-flash"), 1600);
    });
    return () => cancelAnimationFrame(raf);
  }, [tab, inSubagent, activeSessionId]);

  const handleJumpToEvent = useCallback((eventUuid: string) => {
    jumpTarget.current = eventUuid;
    setTab("timeline");
  }, []);

  const handleEnterSubagent = useCallback((agentId: string, parentEventUuid: string) => {
    setStack((s) => [...s, { sessionId: agentId, anchorEventUuid: parentEventUuid }]);
    requestAnimationFrame(() => transcriptRef.current?.scrollTo({ top: 0 }));
  }, []);

  // Pop to `depth` frames (0 = back to root). After the parent transcript
  // re-renders, land on the row we came from by reusing the jump+flash effect.
  const popTo = useCallback((depth: number) => {
    setStack((s) => {
      if (depth >= s.length) return s;
      const restore = s[depth];
      if (restore) jumpTarget.current = restore.anchorEventUuid;
      return s.slice(0, depth);
    });
  }, []);

  if (session.isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading session…</div>;
  }
  if (session.isError || !session.data) {
    return <div className="p-8 text-center text-sm text-red-500">Failed to load session.</div>;
  }
  const data = session.data;
  const toolCount = toolCalls.data?.tool_calls.length ?? 0;
  const artifactCount = artifacts.data?.artifacts.length ?? 0;
  const learnings = data.learnings ?? [];
  const learningCount = learnings.length;

  return (
    <div className="flex flex-col h-full" data-testid="session-view">
      <StickyHeader session={data} />

      <div className="px-4 pt-3">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} /> Home
          </Link>
          <button
            type="button"
            onClick={() => setForkOpen(true)}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted"
            data-testid="fork-button"
          >
            <GitFork size={14} /> Fork
          </button>
        </div>
      </div>

      {inSubagent ? (
        <>
          <SubagentBackBar
            stack={stack}
            onBackToMain={() => popTo(0)}
            onPopTo={(depth) => popTo(depth)}
          />
          <div ref={transcriptRef} className="flex-1 overflow-auto">
            {events.isLoading && (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading subagent…</div>
            )}
            {events.data && (
              <TimelineView events={events.data.events} onEnterSubagent={handleEnterSubagent} />
            )}
          </div>
          <ForkModal open={forkOpen} onClose={() => setForkOpen(false)} session={data} />
        </>
      ) : (
        <>
          {data.summary && <SummaryPanel session={data} summary={data.summary} />}

          {commits.data?.commits && commits.data.commits.length > 0 && (
            <CommitsPanel commits={commits.data.commits} />
          )}

          <div className="px-4 pt-3 flex items-center gap-2 border-b border-border pb-3">
            <TabButton active={tab === "timeline"} onClick={() => setTab("timeline")}>
              <Activity size={14} /> Timeline
            </TabButton>
            <TabButton active={tab === "conversation"} onClick={() => setTab("conversation")}>
              <MessageSquare size={14} /> Conversation
            </TabButton>
            <TabButton active={tab === "tools"} onClick={() => setTab("tools")}>
              <Wrench size={14} /> Tools
              {toolCount > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">{toolCount}</span>
              )}
            </TabButton>
            <TabButton active={tab === "artifacts"} onClick={() => setTab("artifacts")}>
              <FileText size={14} /> Artifacts
              {artifactCount > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">{artifactCount}</span>
              )}
            </TabButton>
            <TabButton active={tab === "learnings"} onClick={() => setTab("learnings")}>
              <Lightbulb size={14} /> Learnings
              {learningCount > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">{learningCount}</span>
              )}
            </TabButton>
          </div>

          {tab === "timeline" && (
            <div ref={transcriptRef} className="flex-1 overflow-auto">
              {events.isLoading && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading timeline…
                </div>
              )}
              {events.data && (
                <TimelineView events={events.data.events} onEnterSubagent={handleEnterSubagent} />
              )}
            </div>
          )}

          {tab === "conversation" && (
            <div className="flex-1 overflow-auto">
              {events.isLoading && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading transcript…
                </div>
              )}
              {events.data && (
                <TranscriptList
                  events={events.data.events}
                  conversationOnly
                  onEnterSubagent={handleEnterSubagent}
                />
              )}
            </div>
          )}

          {tab === "tools" && (
            <div className="flex-1 overflow-auto">
              {toolCalls.isLoading && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading tool calls…
                </div>
              )}
              {toolCalls.data && <ToolsView pairs={toolCalls.data.tool_calls} />}
            </div>
          )}

          {tab === "artifacts" && rootId && (
            <div className="flex-1 overflow-auto">
              <ArtifactsPanel sessionId={rootId} />
            </div>
          )}

          {tab === "learnings" && (
            <div className="flex-1 overflow-auto">
              <LearningsPanel learnings={learnings} onJumpToEvent={handleJumpToEvent} />
            </div>
          )}

          <ForkModal open={forkOpen} onClose={() => setForkOpen(false)} session={data} />
        </>
      )}
    </div>
  );
};
