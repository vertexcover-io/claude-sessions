-- Learnings: per-session failure episodes diagnosed by the in-loop agent and
-- pushed inside the existing summary body (POST /api/sessions/:id/summary).
-- Multi-row — one per diagnosed episode. The summary handler delete-and-
-- replaces the whole set per session when status='ok', so the latest agent
-- reflection (which sees the full trajectory) always wins. Provenance
-- (model/generated_at/summarized_event_count) is stamped from the summary
-- envelope. No embedding column in this scope — per-session display is local.

CREATE TABLE IF NOT EXISTS learnings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title                     TEXT NOT NULL,
  episode_event_uuids       TEXT[] NOT NULL DEFAULT '{}'::text[],
  what_went_wrong           TEXT NOT NULL,
  what_would_have_prevented TEXT NOT NULL,
  root_cause                TEXT NOT NULL,
  attributed_to             TEXT NOT NULL,
  confidence                REAL NOT NULL,
  severity                  TEXT,
  model                     TEXT,
  generated_at              TIMESTAMPTZ,
  summarized_event_count    INTEGER,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learnings_session
  ON learnings (session_id, created_at);
