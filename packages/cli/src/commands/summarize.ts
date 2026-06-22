// AI-generated. See PROMPT.md for the prompts and model used.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { listRepos } from "../config/repos.js";
import { claudeProjectsRoot, findSessionsForRepo, readSessionMeta } from "../discover.js";
import { type LlmSummary, Summarizer, parseAgentSummary } from "../summarizer/index.js";
import type { SessionDetail, UploadClient } from "../upload/client.js";

// TODO: refine from summarization_runs averages
const EST_USD_PER_SUMMARY = 0.05;

const FETCH_CONCURRENCY = 8;

export interface DiscoveredSummarizable {
  session_id: string;
  path: string;
  started_at?: string;
}

export interface SummarizeCommandOpts {
  client: UploadClient;
  sessionId?: string;
  all?: boolean;
  force?: boolean;
  since?: string;
  yes?: boolean;
  /** Read an agent-authored summary (JSON) from stdin instead of running `claude -p`. */
  fromAgent?: boolean;
  /** Mark the agent summary as a provisional first-prompt title (model=heuristic). */
  provisional?: boolean;
  /** Target the active session for the current working directory. */
  current?: boolean;
  summarizerFactory?: (client: UploadClient) => Pick<Summarizer, "summarize">;
  discover?: () => DiscoveredSummarizable[];
  /** Resolve the current-cwd session (tests). Defaults to a projects-dir scan. */
  resolveCurrent?: (cwd: string) => DiscoveredSummarizable | null;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

const defaultDiscover = (): DiscoveredSummarizable[] => {
  const out: DiscoveredSummarizable[] = [];
  for (const r of listRepos()) {
    if (!r.entry.enabled) continue;
    const files = findSessionsForRepo(r.canonical_url, [r.entry.local_path]);
    for (const f of files) {
      const sid = f.session_id ?? readSessionMeta(f.path).session_id;
      if (!sid) continue;
      let started_at: string | undefined;
      try {
        started_at = statSync(f.path).mtime.toISOString();
      } catch {
        started_at = undefined;
      }
      out.push({ session_id: sid, path: f.path, ...(started_at ? { started_at } : {}) });
    }
  }
  return out;
};

const writeUsage = (stderr: NodeJS.WritableStream): void => {
  stderr.write(
    "usage: claude-sessions summarize (<session-id> | --current | --all) [--from-agent] [--force] [--since <iso>] [--yes]\n",
  );
};

/**
 * Resolve the active session for `cwd`: the newest JSONL under the projects
 * root whose first-line `cwd` matches. Used by `--current` so the in-loop
 * agent can summarize its own session without knowing the id.
 */
const resolveCurrentSession = (cwd: string): DiscoveredSummarizable | null => {
  const root = claudeProjectsRoot();
  if (!existsSync(root)) return null;
  let best: { session_id: string; path: string; mtime: number } | null = null;
  for (const sub of readdirSync(root)) {
    const subDir = join(root, sub);
    try {
      if (!statSync(subDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const name of readdirSync(subDir)) {
      if (!name.endsWith(".jsonl")) continue;
      const full = join(subDir, name);
      let mtime: number;
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
        mtime = st.mtimeMs;
      } catch {
        continue;
      }
      const meta = readSessionMeta(full);
      if (meta.cwd !== cwd || !meta.session_id) continue;
      if (!best || mtime > best.mtime) {
        best = { session_id: meta.session_id, path: full, mtime };
      }
    }
  }
  return best ? { session_id: best.session_id, path: best.path } : null;
};

const readStdin = async (stdin: NodeJS.ReadableStream): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const promptYesNo = async (
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  prompt: string,
): Promise<boolean> => {
  stdout.write(prompt);
  const rl = createInterface({ input: stdin, terminal: false });
  return await new Promise<boolean>((resolve) => {
    rl.once("line", (line) => {
      rl.close();
      const trimmed = line.trim();
      resolve(trimmed === "y" || trimmed === "Y");
    });
    rl.once("close", () => resolve(false));
  });
};

interface NeedsSummarizeResult {
  include: boolean;
}

const needsSummarize = async (
  client: UploadClient,
  sessionId: string,
): Promise<NeedsSummarizeResult> => {
  try {
    const detail: SessionDetail = await client.getSession(sessionId);
    const s = detail.summary;
    if (!s) return { include: true };
    if (s.status !== "ok") return { include: true };
    return { include: false };
  } catch {
    // be tolerant — opt to summarize rather than silently skip
    return { include: true };
  }
};

const filterByStatus = async (
  client: UploadClient,
  candidates: DiscoveredSummarizable[],
): Promise<DiscoveredSummarizable[]> => {
  const out: DiscoveredSummarizable[] = [];
  for (let i = 0; i < candidates.length; i += FETCH_CONCURRENCY) {
    const slice = candidates.slice(i, i + FETCH_CONCURRENCY);
    const decisions = await Promise.all(
      slice.map(async (c) => ({ c, r: await needsSummarize(client, c.session_id) })),
    );
    for (const d of decisions) if (d.r.include) out.push(d.c);
  }
  return out;
};

export const summarizeCommand = async (opts: SummarizeCommandOpts): Promise<number> => {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  const hasId = typeof opts.sessionId === "string" && opts.sessionId.length > 0;
  const wantCurrent = opts.current === true;
  const wantAll = opts.all === true;
  const fromAgent = opts.fromAgent === true;
  const provisional = opts.provisional === true;

  // Exactly one of <session-id> / --current / --all.
  if ([hasId, wantCurrent, wantAll].filter(Boolean).length !== 1) {
    writeUsage(stderr);
    return 2;
  }
  if (fromAgent && wantAll) {
    stderr.write("--from-agent requires a single session (use <session-id> or --current)\n");
    return 2;
  }
  if (provisional && !fromAgent) {
    stderr.write("--provisional requires --from-agent\n");
    return 2;
  }

  const summarizer = opts.summarizerFactory
    ? opts.summarizerFactory(opts.client)
    : new Summarizer({ upload: opts.client });
  const discover = opts.discover ?? defaultDiscover;
  const resolveCurrent = opts.resolveCurrent ?? resolveCurrentSession;

  if (hasId || wantCurrent) {
    let single: DiscoveredSummarizable | null;
    if (wantCurrent) {
      single = resolveCurrent(process.cwd());
      if (!single) {
        stderr.write("no active session found for the current directory\n");
        return 1;
      }
    } else {
      const sessionId = opts.sessionId as string;
      single = discover().find((s) => s.session_id === sessionId) ?? null;
      if (!single) {
        stderr.write(`Session not found: ${sessionId}\n`);
        return 1;
      }
    }

    let providedSummary: LlmSummary | undefined;
    if (fromAgent) {
      const raw = await readStdin(stdin);
      try {
        providedSummary = parseAgentSummary(JSON.parse(raw));
      } catch (err) {
        stderr.write(
          `invalid agent summary: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return 1;
      }
    }

    try {
      await summarizer.summarize(single.session_id, single.path, {
        force: opts.force === true,
        ...(providedSummary ? { providedSummary } : {}),
        ...(provisional ? { provisional: true } : {}),
      });
      return 0;
    } catch (err) {
      stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }

  // --all
  let candidates = discover();
  if (typeof opts.since === "string" && opts.since.length > 0) {
    const since = opts.since;
    candidates = candidates.filter(
      (c) => typeof c.started_at === "string" && c.started_at >= since,
    );
  }

  if (opts.force !== true) {
    candidates = await filterByStatus(opts.client, candidates);
  }

  if (candidates.length === 0) {
    stdout.write("Nothing to do.\n");
    return 0;
  }

  if (opts.yes !== true) {
    const cost = (candidates.length * EST_USD_PER_SUMMARY).toFixed(2);
    const ok = await promptYesNo(
      stdin,
      stdout,
      `This will summarize ${candidates.length} sessions. Estimated cost: ~$${cost}. Proceed? (y/N)\n`,
    );
    if (!ok) {
      stdout.write("Aborted.\n");
      return 0;
    }
  }

  let succeeded = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await summarizer.summarize(c.session_id, c.path, { force: opts.force === true });
      succeeded += 1;
    } catch (err) {
      failed += 1;
      stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  stdout.write(`${succeeded} succeeded, ${failed} failed\n`);
  return failed > 0 ? 1 : 0;
};
