-- Commits authored on the local repo while the session was active. Mined
-- by the CLI via `git log --since=<started_at> --until=<ended_at>` against
-- the session's local_path; uploaded with the rest of the session payload.
-- Cross-worktree-safe because git log walks the same object database.

CREATE TABLE IF NOT EXISTS session_commits (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  short_sha TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  authored_at TIMESTAMPTZ NOT NULL,
  subject TEXT NOT NULL,
  branch TEXT,
  files_changed INTEGER,
  insertions INTEGER,
  deletions INTEGER,
  PRIMARY KEY (session_id, sha)
);

CREATE INDEX IF NOT EXISTS session_commits_authored_at_idx
  ON session_commits (session_id, authored_at);
