-- Subagent (child) sessions: link a subagent transcript back to its parent.
-- No FK to sessions(id) on purpose — ingest order isn't guaranteed (a child may
-- be uploaded before its parent row exists), so a hard FK would fail ingest.
-- App-level integrity + ON DELETE handling at the query layer is enough here.
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
