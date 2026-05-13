-- One row per `claude -p` invocation made by the CLI summarizer.
-- Tracks tokens, cost, durations, and retry attempts so we can answer
-- "how much did summarization cost this week" without re-deriving from
-- per-token pricing (claude returns the authoritative total_cost_usd).

CREATE TABLE IF NOT EXISTS summarization_runs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  attempt                  INTEGER NOT NULL,
  status                   TEXT NOT NULL,

  started_at               TIMESTAMPTZ NOT NULL,
  ended_at                 TIMESTAMPTZ NOT NULL,
  duration_ms              INTEGER NOT NULL,
  duration_api_ms          INTEGER,

  claude_model             TEXT NOT NULL,
  stop_reason              TEXT,
  num_turns                INTEGER,

  input_tokens             INTEGER NOT NULL DEFAULT 0,
  output_tokens            INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens    INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens        INTEGER NOT NULL DEFAULT 0,
  total_cost_usd           NUMERIC(12, 6) NOT NULL DEFAULT 0,

  prompt_chars             INTEGER NOT NULL,
  truncated                BOOLEAN NOT NULL DEFAULT FALSE,

  error                    TEXT,

  raw_usage                JSONB,

  CONSTRAINT summarization_runs_status_chk CHECK (status IN ('ok', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_summ_runs_session
  ON summarization_runs (session_id);

CREATE INDEX IF NOT EXISTS idx_summ_runs_started
  ON summarization_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_summ_runs_status
  ON summarization_runs (status);
