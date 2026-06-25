// AI-generated. See PROMPT.md for the prompts and model used.

export interface User {
  id: string;
  email: string | null;
  role: "user" | "admin";
  github_login: string | null;
  avatar_url: string | null;
}

export interface Author {
  github_login: string;
  avatar_url: string | null;
}

export interface RepoSummary {
  id: string;
  canonical_url: string;
  display_name: string | null;
  access: string;
  session_count: number;
  last_activity: string | null;
}

export interface SessionListItem {
  id: string;
  agent: string;
  branch: string | null;
  model: string | null;
  started_at: string;
  ended_at: string;
  total_cost_usd: string;
  is_private: boolean;
  name: string | null;
  repo?: string | null;
  title: string | null;
  summary: string | null;
  tags: string[];
  prs_referenced: string[];
  author?: Author | null;
  display_name: string;
}

export interface SessionSummaryPayload {
  title: string | null;
  summary: string | null;
  tags: string[];
  files_touched: string[];
  prs_referenced: string[];
  tool_call_counts: Record<string, number>;
  status: "pending" | "ok" | "failed";
}

export interface SessionLearning {
  id: string;
  title: string;
  episode_event_uuids: string[];
  what_went_wrong: string;
  what_would_have_prevented: string;
  root_cause: string;
  attributed_to: string;
  confidence: number;
  severity: "low" | "medium" | "high" | null;
  model: string | null;
  generated_at: string | null;
  summarized_event_count: number | null;
}

export interface SessionDetail {
  id: string;
  agent?: string;
  agent_version?: string;
  repo_id?: string | null;
  repo?: { canonical_url: string; branch: string | null } | null;
  branch?: string | null;
  source_cwd_hint?: string;
  model?: string | null;
  started_at?: string;
  ended_at?: string;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cost_usd?: string;
  permission_mode?: string | null;
  is_private: boolean;
  name?: string | null;
  has_blob?: boolean;
  display_name: string;
  author?: Author | null;
  summary: SessionSummaryPayload | null;
  learnings?: SessionLearning[];
}

export type CanonicalEventType = "user_msg" | "assistant_msg" | "tool_use" | "summary" | "system";

export interface TranscriptEvent {
  event_uuid: string;
  parent_uuid: string | null;
  ts: string;
  type: CanonicalEventType;
  payload: Record<string, unknown> & {
    content_md?: string;
    content?: string;
    tool?: string;
    tool_use_id?: string;
    input_summary?: string;
    output_summary?: string;
    is_error?: boolean;
    kind?: string;
    data?: Record<string, unknown>;
    /** Synthetic field set by the conversation-mode collapse — every
     *  assistant turn that was merged into this bubble, in order. The
     *  UI renders each as its own block with its own timestamp. */
    turns?: Array<{ ts: string; content_md: string }>;
    model?: string;
    /** Present on an `Agent` tool_use event: the child session id whose
     *  transcript captures the subagent's work. */
    agent_id?: string;
  };
}

export interface SessionCommit {
  sha: string;
  short_sha: string;
  author_name: string;
  author_email: string;
  authored_at: string;
  subject: string;
  branch: string | null;
  files_changed: number | null;
  insertions: number | null;
  deletions: number | null;
}

export interface RepoFacets {
  branches: string[];
  users: Array<{ github_login: string; avatar_url: string | null; count: number }>;
}

export interface SearchFacets {
  repos: Array<{ canonical_url: string; display_name: string | null }>;
  branches: string[];
  models: string[];
  agents: string[];
  users: Array<{ github_login: string; avatar_url: string | null; count: number }>;
  tags: string[];
}

export interface ToolCallPair {
  tool_use_id: string;
  tool: string | null;
  input_summary: string | null;
  output_summary: string | null;
  is_error: boolean;
  called_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface ArtifactMeta {
  id: string;
  path: string;
  mime_type: string;
  byte_size: number;
  uploaded_at: string;
}

export interface ArtifactContent {
  id: string;
  path: string;
  mime_type: string;
  content: string;
}

export interface SearchResult {
  session_id: string;
  title: string | null;
  summary: string | null;
  tags: string[];
  repo: string | null;
  branch: string | null;
  agent: string;
  started_at: string;
  ended_at: string;
  total_cost_usd: string;
  author?: Author | null;
}
