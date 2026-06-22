-- Artifacts: files an agent created or edited during a session, pushed by
-- the CLI `artifacts` command. Unlike session_blobs (one NDJSON blob per
-- session) this is multi-row — one row per file path. Re-pushing the same
-- path upserts on (session_id, path) so the command is idempotent.

CREATE TABLE IF NOT EXISTS artifacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  bytes        BYTEA NOT NULL,
  byte_size    INTEGER NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT artifacts_session_path_uniq UNIQUE (session_id, path)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_session_uploaded
  ON artifacts (session_id, uploaded_at DESC);
