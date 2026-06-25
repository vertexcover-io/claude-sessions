-- GitHub OAuth identity on users. Login moves from email+password to GitHub
-- OAuth (org-gated), so password_hash and email both become nullable: an
-- OAuth-created user has no password, and GitHub may not expose a public email.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users ADD COLUMN github_id BIGINT;
ALTER TABLE users ADD COLUMN github_login TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- Partial unique indexes so legacy rows (null github_id/login) don't collide.
-- github_id is the upsert conflict target; github_login is keyed by the
-- ?user=<login> filter and the users facet (case-insensitive).
CREATE UNIQUE INDEX users_github_id_uniq ON users(github_id) WHERE github_id IS NOT NULL;
CREATE UNIQUE INDEX users_github_login_uniq ON users(lower(github_login)) WHERE github_login IS NOT NULL;
