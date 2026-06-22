// AI-generated. See PROMPT.md for the prompts and model used.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { readSessionSync } from "@claude-sessions/adapter-claude";
import { redact } from "@claude-sessions/core";
import { glob } from "tinyglobby";
import { claudeProjectsRoot, readSessionMeta } from "../discover.js";
import { extractFilesForTools } from "../summarizer/deterministic.js";
import type { UploadClient } from "../upload/client.js";

/**
 * Artifacts are files the agent CREATED or EDITED — not files it merely read.
 * This deliberately excludes Read (unlike the summarizer's files_touched) and
 * includes NotebookEdit.
 */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export interface ArtifactsOptions {
  sessionId: string;
  client: UploadClient;
  files?: string[];
  globs?: string[];
  dryRun?: boolean;
  /** Override `~/.claude/projects` for tests. */
  projectsRoot?: string;
}

interface ResolvedSession {
  jsonlPath: string;
  cwd: string;
}

/**
 * Scan every project dir under the projects root for a `<session-id>.jsonl`
 * whose first-line `sessionId` matches. The filename is the cheap hint;
 * the JSONL's own `sessionId` field is the source of truth.
 */
const resolveSession = (sessionId: string, projectsRoot: string): ResolvedSession | null => {
  if (!existsSync(projectsRoot)) return null;
  for (const sub of readdirSync(projectsRoot)) {
    const subDir = join(projectsRoot, sub);
    try {
      if (!statSync(subDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const candidate = join(subDir, `${sessionId}.jsonl`);
    if (!existsSync(candidate)) continue;
    const meta = readSessionMeta(candidate);
    if (meta.session_id !== null && meta.session_id !== sessionId) continue;
    if (!meta.cwd) continue;
    return { jsonlPath: candidate, cwd: meta.cwd };
  }
  return null;
};

/** For now, an "artifact" is a Markdown file the agent produced. */
const isMarkdown = (path: string): boolean => /\.(md|markdown)$/i.test(path);

const mimeForPath = (path: string): string => (isMarkdown(path) ? "text/markdown" : "text/plain");

/** Reject binaries (NUL byte) and non-utf8 content. */
const isTextBuffer = (buf: Buffer): boolean => {
  if (buf.includes(0)) return false;
  const decoded = buf.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(buf);
};

const dedupe = (paths: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
};

const resolveAgainst = (cwd: string, path: string): string =>
  isAbsolute(path) ? path : resolve(cwd, path);

/**
 * `claude-sessions artifacts <session-id>` — push the files an agent
 * created or edited during a session to the server.
 *
 * DEFAULT: derive the file set from the session's Write/Edit/MultiEdit/
 * NotebookEdit tool calls. OVERRIDE: if any --file/--glob is passed, the
 * set is built EXCLUSIVELY from those (replace semantics).
 *
 * Only Markdown files count as artifacts for now — non-`.md` paths are
 * dropped from the set (with a warning) regardless of how it was built.
 * Each body is redacted before upload (load-bearing CLI invariant).
 */
export const artifactsCommand = async (opts: ArtifactsOptions): Promise<number> => {
  const projectsRoot = opts.projectsRoot ?? claudeProjectsRoot();
  const session = resolveSession(opts.sessionId, projectsRoot);
  if (!session) {
    process.stderr.write(`session not found locally: ${opts.sessionId}\n`);
    return 1;
  }

  const explicitFiles = opts.files ?? [];
  const explicitGlobs = opts.globs ?? [];
  const useOverride = explicitFiles.length > 0 || explicitGlobs.length > 0;

  let resolved: string[];
  if (useOverride) {
    const fromFiles = explicitFiles.map((f) => resolveAgainst(session.cwd, f));
    const fromGlobs = await glob(explicitGlobs, {
      cwd: session.cwd,
      absolute: true,
      dot: true,
    });
    resolved = dedupe([...fromFiles, ...fromGlobs]);
  } else {
    const canonical = readSessionSync(session.jsonlPath);
    const paths: string[] = [];
    for (const ev of canonical.events) {
      if (ev.type !== "tool_use") continue;
      paths.push(...extractFilesForTools(ev, WRITE_TOOLS));
    }
    resolved = dedupe(paths.map((p) => resolveAgainst(session.cwd, p)));
  }

  // Artifacts are Markdown-only for now: drop anything else (with a warning
  // so a dropped --file/--glob isn't silent).
  for (const p of resolved.filter((p) => !isMarkdown(p))) {
    process.stderr.write(`skip (not markdown): ${p}\n`);
  }
  resolved = resolved.filter(isMarkdown);

  if (resolved.length === 0) {
    process.stdout.write("no artifacts to push\n");
    return 0;
  }

  if (opts.dryRun) {
    process.stdout.write(`would push ${resolved.length} artifact(s):\n`);
    for (const p of resolved) process.stdout.write(`  ${p}\n`);
    return 0;
  }

  let pushed = 0;
  let hadError = false;
  for (const path of resolved) {
    let buf: Buffer;
    try {
      if (!existsSync(path) || !statSync(path).isFile()) {
        process.stderr.write(`skip (missing): ${path}\n`);
        continue;
      }
      buf = readFileSync(path);
    } catch (err) {
      process.stderr.write(`skip (unreadable): ${path}: ${(err as Error).message}\n`);
      continue;
    }
    if (!isTextBuffer(buf)) {
      process.stderr.write(`skip (binary): ${path}\n`);
      continue;
    }
    const content = redact(buf.toString("utf8")).redacted;
    try {
      const res = await opts.client.uploadArtifact(opts.sessionId, {
        path,
        mime_type: mimeForPath(path),
        content,
      });
      pushed += 1;
      process.stdout.write(`pushed ${path} (${res.byte_size} bytes)\n`);
    } catch (err) {
      hadError = true;
      process.stderr.write(`failed to push ${path}: ${(err as Error).message}\n`);
    }
  }

  process.stdout.write(`pushed ${pushed} artifact(s)\n`);
  return hadError ? 1 : 0;
};
