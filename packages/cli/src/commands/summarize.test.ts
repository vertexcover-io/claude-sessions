// AI-generated. See PROMPT.md for the prompts and model used.

import { Readable, Writable } from "node:stream";
import type { SessionSummary } from "@claude-sessions/core";
import { describe, expect, it, vi } from "vitest";
import type { Summarizer } from "../summarizer/index.js";
import type { SessionDetail, UploadClient } from "../upload/client.js";
import {
  type DiscoveredSummarizable,
  type SummarizeCommandOpts,
  summarizeCommand,
} from "./summarize.js";

interface Captured {
  stdout: string;
  stderr: string;
}

const makeStdio = (): { stdio: Pick<SummarizeCommandOpts, "stdout" | "stderr">; cap: Captured } => {
  const cap: Captured = { stdout: "", stderr: "" };
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      cap.stdout += chunk.toString();
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      cap.stderr += chunk.toString();
      cb();
    },
  });
  return { stdio: { stdout, stderr }, cap };
};

const stdinFrom = (text: string): NodeJS.ReadableStream => Readable.from([text]);

const okSummary = (sessionId: string): SessionSummary => ({
  session_id: sessionId,
  title: "t",
  summary: "s",
  tags: [],
  files_touched: [],
  prs_referenced: [],
  tool_call_counts: {},
  generated_at: new Date().toISOString(),
  model: "sonnet",
  status: "ok",
});

const fakeClient = (): UploadClient => ({}) as unknown as UploadClient;

const makeSummarizer = (
  impl?: (id: string, path: string, opts?: { force?: boolean }) => Promise<SessionSummary>,
): {
  calls: Array<{ id: string; path: string; force: boolean }>;
  sum: Pick<Summarizer, "summarize">;
} => {
  const calls: Array<{ id: string; path: string; force: boolean }> = [];
  const sum = {
    summarize: vi.fn(async (id: string, path: string, o?: { force?: boolean }) => {
      calls.push({ id, path, force: o?.force === true });
      return impl ? await impl(id, path, o) : okSummary(id);
    }),
  } as unknown as Pick<Summarizer, "summarize">;
  return { calls, sum };
};

const discovered = (entries: DiscoveredSummarizable[]) => () => entries;

describe("summarizeCommand", () => {
  it("REQ-008: known id calls summarize once and returns 0", async () => {
    const { stdio } = makeStdio();
    const { calls, sum } = makeSummarizer();
    const code = await summarizeCommand({
      client: fakeClient(),
      sessionId: "sid-1",
      summarizerFactory: () => sum,
      discover: discovered([{ session_id: "sid-1", path: "/tmp/sid-1.jsonl" }]),
      ...stdio,
    });
    expect(code).toBe(0);
    expect(calls).toEqual([{ id: "sid-1", path: "/tmp/sid-1.jsonl", force: false }]);
  });

  it("EDGE-007: unknown id writes 'Session not found' to stderr, returns 1, no calls", async () => {
    const { stdio, cap } = makeStdio();
    const { calls, sum } = makeSummarizer();
    const code = await summarizeCommand({
      client: fakeClient(),
      sessionId: "nope",
      summarizerFactory: () => sum,
      discover: discovered([]),
      ...stdio,
    });
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Session not found: nope");
    expect(calls).toHaveLength(0);
  });

  it("REQ-009 + EDGE-006: --all with empty candidates writes 'Nothing to do.', returns 0", async () => {
    const { stdio, cap } = makeStdio();
    const { calls, sum } = makeSummarizer();
    const code = await summarizeCommand({
      client: fakeClient(),
      all: true,
      summarizerFactory: () => sum,
      discover: discovered([]),
      ...stdio,
    });
    expect(code).toBe(0);
    expect(cap.stdout).toBe("Nothing to do.\n");
    expect(calls).toHaveLength(0);
  });

  it("REQ-009 + EDGE-008: --all with stdin 'n' aborts, returns 0, no calls", async () => {
    const { stdio, cap } = makeStdio();
    const { calls, sum } = makeSummarizer();
    // Force-bypass server status check by passing --force=false but client.getSession returns null summary.
    const client = {
      getSession: async (id: string): Promise<SessionDetail> => ({ id, summary: null }),
    } as unknown as UploadClient;
    const code = await summarizeCommand({
      client,
      all: true,
      summarizerFactory: () => sum,
      discover: discovered([
        { session_id: "a", path: "/a.jsonl" },
        { session_id: "b", path: "/b.jsonl" },
      ]),
      stdin: stdinFrom("n\n"),
      ...stdio,
    });
    expect(code).toBe(0);
    expect(cap.stdout).toContain("This will summarize 2 sessions");
    expect(cap.stdout).toContain("Estimated cost: ~$0.10");
    expect(cap.stdout).toContain("Aborted.\n");
    expect(calls).toHaveLength(0);
  });

  it("REQ-009 with --yes: 3 candidates, no prompt, 3 calls, returns 0", async () => {
    const { stdio, cap } = makeStdio();
    const { calls, sum } = makeSummarizer();
    const client = {
      getSession: async (id: string): Promise<SessionDetail> => ({ id, summary: null }),
    } as unknown as UploadClient;
    const code = await summarizeCommand({
      client,
      all: true,
      yes: true,
      summarizerFactory: () => sum,
      discover: discovered([
        { session_id: "a", path: "/a.jsonl" },
        { session_id: "b", path: "/b.jsonl" },
        { session_id: "c", path: "/c.jsonl" },
      ]),
      ...stdio,
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(3);
    expect(cap.stdout).not.toContain("Proceed?");
    expect(cap.stdout).toContain("3 succeeded, 0 failed\n");
  });

  it("REQ-010 + EDGE-013: --all --force --yes includes sessions with status:ok", async () => {
    const { stdio } = makeStdio();
    const { calls, sum } = makeSummarizer();
    let getCalls = 0;
    const client = {
      getSession: async (id: string): Promise<SessionDetail> => {
        getCalls += 1;
        return {
          id,
          summary: {
            title: null,
            summary: null,
            tags: [],
            files_touched: [],
            prs_referenced: [],
            tool_call_counts: {},
            status: "ok",
            summarized_event_count: 100,
          },
        };
      },
    } as unknown as UploadClient;
    const code = await summarizeCommand({
      client,
      all: true,
      force: true,
      yes: true,
      summarizerFactory: () => sum,
      discover: discovered([
        { session_id: "x", path: "/x.jsonl" },
        { session_id: "y", path: "/y.jsonl" },
      ]),
      ...stdio,
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.force === true)).toBe(true);
    // --force should NOT consult the server for status filtering.
    expect(getCalls).toBe(0);
  });

  it("REQ-011: --all --since filters out earlier started_at", async () => {
    const { stdio } = makeStdio();
    const { calls, sum } = makeSummarizer();
    const client = {
      getSession: async (id: string): Promise<SessionDetail> => ({ id, summary: null }),
    } as unknown as UploadClient;
    const code = await summarizeCommand({
      client,
      all: true,
      yes: true,
      since: "2026-01-01T00:00:00.000Z",
      summarizerFactory: () => sum,
      discover: discovered([
        { session_id: "old", path: "/old.jsonl", started_at: "2025-12-31T00:00:00.000Z" },
        { session_id: "new", path: "/new.jsonl", started_at: "2026-02-01T00:00:00.000Z" },
        { session_id: "no-time", path: "/n.jsonl" },
      ]),
      ...stdio,
    });
    expect(code).toBe(0);
    expect(calls.map((c) => c.id)).toEqual(["new"]);
  });

  it("EDGE-009: 1 of 3 throws → '2 succeeded, 1 failed', returns 1", async () => {
    const { stdio, cap } = makeStdio();
    const { calls, sum } = makeSummarizer(async (id: string) => {
      if (id === "b") throw new Error("boom");
      return okSummary(id);
    });
    const client = {
      getSession: async (id: string): Promise<SessionDetail> => ({ id, summary: null }),
    } as unknown as UploadClient;
    const code = await summarizeCommand({
      client,
      all: true,
      yes: true,
      summarizerFactory: () => sum,
      discover: discovered([
        { session_id: "a", path: "/a.jsonl" },
        { session_id: "b", path: "/b.jsonl" },
        { session_id: "c", path: "/c.jsonl" },
      ]),
      ...stdio,
    });
    expect(code).toBe(1);
    expect(calls).toHaveLength(3);
    expect(cap.stdout).toContain("2 succeeded, 1 failed\n");
    expect(cap.stderr).toContain("boom");
  });

  it("EDGE-012: no positional and no --all writes usage, returns 2", async () => {
    const { stdio, cap } = makeStdio();
    const { calls, sum } = makeSummarizer();
    const code = await summarizeCommand({
      client: fakeClient(),
      summarizerFactory: () => sum,
      discover: discovered([]),
      ...stdio,
    });
    expect(code).toBe(2);
    expect(cap.stderr).toContain("usage:");
    expect(calls).toHaveLength(0);
  });

  it("EDGE-012: both positional and --all writes usage, returns 2", async () => {
    const { stdio, cap } = makeStdio();
    const { calls, sum } = makeSummarizer();
    const code = await summarizeCommand({
      client: fakeClient(),
      sessionId: "x",
      all: true,
      summarizerFactory: () => sum,
      discover: discovered([]),
      ...stdio,
    });
    expect(code).toBe(2);
    expect(cap.stderr).toContain("usage:");
    expect(calls).toHaveLength(0);
  });

  it("--all without --force filters out sessions whose summary.status === 'ok'", async () => {
    const { stdio, cap } = makeStdio();
    const { calls, sum } = makeSummarizer();
    const client = {
      getSession: async (id: string): Promise<SessionDetail> => {
        if (id === "done") {
          return {
            id,
            summary: {
              title: null,
              summary: null,
              tags: [],
              files_touched: [],
              prs_referenced: [],
              tool_call_counts: {},
              status: "ok",
              summarized_event_count: 50,
            },
          };
        }
        return { id, summary: null };
      },
    } as unknown as UploadClient;
    const code = await summarizeCommand({
      client,
      all: true,
      yes: true,
      summarizerFactory: () => sum,
      discover: discovered([
        { session_id: "done", path: "/done.jsonl" },
        { session_id: "todo", path: "/todo.jsonl" },
      ]),
      ...stdio,
    });
    expect(code).toBe(0);
    expect(calls.map((c) => c.id)).toEqual(["todo"]);
    expect(cap.stdout).toContain("1 succeeded, 0 failed\n");
  });
});
