import { execFileSync } from "node:child_process";

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

const runGit = (cwd: string, args: string[]): string | null => {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    }).trimEnd();
  } catch {
    return null;
  }
};

const parseShortStat = (
  out: string,
): { filesChanged: number | null; insertions: number | null; deletions: number | null } => {
  const m = out.match(
    /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/,
  );
  if (!m) return { filesChanged: null, insertions: null, deletions: null };
  return {
    filesChanged: m[1] ? Number(m[1]) : null,
    insertions: m[2] ? Number(m[2]) : 0,
    deletions: m[3] ? Number(m[3]) : 0,
  };
};

const SEP = "\x1eRECORD\x1e";
const FMT = ["%H", "%h", "%an", "%ae", "%aI", "%s"].join("\x1f");

/**
 * List commits authored under `cwd` between two ISO timestamps.
 * Walks the local repo's reflog/all-branches so worktree-only commits
 * still surface. Returns at most `limit` commits, newest last.
 */
export const listCommitsInWindow = (
  cwd: string,
  startedAt: string,
  endedAt: string,
  limit = 200,
): SessionCommit[] => {
  // Pad the window slightly so commits made within the same minute as the
  // session start/end aren't missed because of clock-skew or rounding.
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const since = new Date(startMs - 60_000).toISOString();
  const until = new Date(endMs + 60_000).toISOString();

  const branchOut = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchOut && branchOut !== "HEAD" ? branchOut : null;

  const out = runGit(cwd, [
    "log",
    "--all",
    "--no-merges",
    `--since=${since}`,
    `--until=${until}`,
    `--max-count=${limit}`,
    `--pretty=format:${FMT}${SEP}`,
  ]);
  if (!out) return [];

  const records = out
    .split(SEP)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const commits: SessionCommit[] = [];
  for (const rec of records) {
    const parts = rec.split("\x1f");
    if (parts.length < 6) continue;
    const sha = parts[0] ?? "";
    const shortSha = parts[1] ?? "";
    const authorName = parts[2] ?? "";
    const authorEmail = parts[3] ?? "";
    const authoredAt = parts[4] ?? "";
    const subject = parts[5] ?? "";
    if (!sha || !authoredAt) continue;

    // Per-commit shortstat for line counts. One extra git invocation per
    // commit, but the window is bounded by the session length so this is
    // typically <10 commits.
    const stat = runGit(cwd, ["show", "--shortstat", "--format=", sha]);
    const counts = stat
      ? parseShortStat(stat)
      : { filesChanged: null, insertions: null, deletions: null };

    commits.push({
      sha,
      short_sha: shortSha,
      author_name: authorName,
      author_email: authorEmail,
      authored_at: authoredAt,
      subject,
      branch,
      files_changed: counts.filesChanged,
      insertions: counts.insertions,
      deletions: counts.deletions,
    });
  }

  // newest-last for stable display ordering
  commits.sort((a, b) => (a.authored_at < b.authored_at ? -1 : 1));
  return commits;
};
