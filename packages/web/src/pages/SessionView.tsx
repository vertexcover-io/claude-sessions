// AI-generated. See PROMPT.md for the prompts and model used.

import { Activity, ArrowLeft, FileText, GitFork, MessageSquare, Wrench } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ForkModal } from "../components/ForkModal";
import { ArtifactsPanel } from "../components/transcript/ArtifactsPanel";
import { CommitsPanel } from "../components/transcript/CommitsPanel";
import { StickyHeader } from "../components/transcript/StickyHeader";
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

type Tab = "timeline" | "conversation" | "tools" | "artifacts";

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
  const { id } = useParams<{ id: string }>();
  const session = useSession(id);
  const events = useSessionEvents(id);
  const toolCalls = useSessionToolCalls(id);
  const commits = useSessionCommits(id);
  const artifacts = useSessionArtifacts(id);
  const [forkOpen, setForkOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("timeline");

  if (session.isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading session…</div>;
  }
  if (session.isError || !session.data) {
    return <div className="p-8 text-center text-sm text-red-500">Failed to load session.</div>;
  }
  const data = session.data;
  const toolCount = toolCalls.data?.tool_calls.length ?? 0;
  const artifactCount = artifacts.data?.artifacts.length ?? 0;

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
      </div>

      {tab === "timeline" && (
        <div className="flex-1 overflow-auto">
          {events.isLoading && (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading timeline…</div>
          )}
          {events.data && <TimelineView events={events.data.events} />}
        </div>
      )}

      {tab === "conversation" && (
        <div className="flex-1 overflow-auto">
          {events.isLoading && (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading transcript…</div>
          )}
          {events.data && <TranscriptList events={events.data.events} conversationOnly />}
        </div>
      )}

      {tab === "tools" && (
        <div className="flex-1 overflow-auto">
          {toolCalls.isLoading && (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading tool calls…</div>
          )}
          {toolCalls.data && <ToolsView pairs={toolCalls.data.tool_calls} />}
        </div>
      )}

      {tab === "artifacts" && id && (
        <div className="flex-1 overflow-auto">
          <ArtifactsPanel sessionId={id} />
        </div>
      )}

      <ForkModal open={forkOpen} onClose={() => setForkOpen(false)} session={data} />
    </div>
  );
};
