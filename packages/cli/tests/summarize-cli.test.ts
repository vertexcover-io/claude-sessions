// AI-generated. See PROMPT.md for the prompts and model used.

import { Readable } from "node:stream";
import type { SessionSummary } from "@claude-sessions/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { summarizeCommand } from "../src/commands/summarize.js";
import { Summarizer } from "../src/summarizer/index.js";
import { UploadClient } from "../src/upload/client.js";
import { makeTempGitRepo } from "./helpers/git-repo.js";
import { type MockServerHandle, startMockServer } from "./helpers/mock-server.js";
import {
  type FixtureEnv,
  buildEvent,
  createSessionFile,
  makeFixtureEnv,
} from "./helpers/tmp-jsonl.js";

let fixture: FixtureEnv;
let server: MockServerHandle;

beforeEach(async () => {
  fixture = makeFixtureEnv();
  server = await startMockServer();
});

afterEach(async () => {
  fixture.cleanup();
  await server.stop();
});

const SID = "session-cli-int";

const buildClient = (): UploadClient =>
  new UploadClient({ serverUrl: server.url, token: "tok", retryDelaysMs: [] });

const seedSession = (eventCount: number): { path: string } => {
  const repo = makeTempGitRepo("git@github.com:fixture/summarize-cli.git");
  const events = Array.from({ length: eventCount }, (_, i) =>
    buildEvent({ uuid: `e${i}`, sessionId: SID, cwd: repo.path }),
  );
  const file = createSessionFile(fixture.projectsRoot, repo.path, SID, events);
  return { path: file.path };
};

const seedServerWithOk = (summarizedEventCount: number): void => {
  server.setMethodHandler("GET", `/api/sessions/${SID}`, () => ({
    status: 200,
    body: {
      id: SID,
      summary: {
        title: "existing",
        summary: "already summarized",
        tags: [],
        files_touched: [],
        prs_referenced: [],
        tool_call_counts: {},
        status: "ok",
        summarized_event_count: summarizedEventCount,
      },
    },
  }));
};

const countSummaryPosts = (): number =>
  server.requests.filter((r) => r.method === "POST" && r.path === `/api/sessions/${SID}/summary`)
    .length;

describe("summarize CLI integration (Phase 5 cost gate)", () => {
  it("without --force: existing ok-summary with delta=0 → 0 POSTs to /summary", async () => {
    const { path } = seedSession(3);
    seedServerWithOk(3);

    const client = buildClient();

    const code = await summarizeCommand({
      client,
      sessionId: SID,
      // Use real Summarizer with the watermark check; do NOT inject a stub.
      summarizerFactory: (c) => new Summarizer({ upload: c, retryDelaysMs: [] }),
      discover: () => [{ session_id: SID, path }],
      stdout: process.stdout,
      stderr: process.stderr,
    });

    expect(code).toBe(0);
    expect(countSummaryPosts()).toBe(0);
  });

  it("with --force --all --yes: bypasses watermark, posts exactly one summary", async () => {
    const { path } = seedSession(3);
    seedServerWithOk(3);

    // Stub the pipeline so we don't need claude/gh; we still want the real
    // Summarizer wiring to honour `force` and call upload.uploadSummary.
    const fakeSummary = (id: string): SessionSummary => ({
      session_id: id,
      title: "regenerated",
      summary: "regenerated body",
      tags: [],
      files_touched: [],
      prs_referenced: [],
      tool_call_counts: {},
      generated_at: new Date().toISOString(),
      model: "sonnet",
      status: "ok",
      summarized_event_count: 3,
    });

    const client = buildClient();

    const code = await summarizeCommand({
      client,
      all: true,
      force: true,
      yes: true,
      summarizerFactory: (c) =>
        new Summarizer({
          upload: c,
          retryDelaysMs: [],
          runPipeline: async (sessionId) => {
            await c.uploadSummary(sessionId, fakeSummary(sessionId));
            return fakeSummary(sessionId);
          },
        }),
      discover: () => [{ session_id: SID, path }],
      stdout: process.stdout,
      stderr: process.stderr,
    });

    expect(code).toBe(0);
    expect(countSummaryPosts()).toBe(1);
  });
});

describe("summarize --from-agent / --current", () => {
  const agentJson = JSON.stringify({
    title: "Agent-authored title",
    summary: "The in-loop agent wrote this summary itself.",
    tags: ["agent"],
    files_touched: ["notes.md"],
    prs_referenced: [],
  });

  it("--from-agent --current: reads stdin JSON, posts one agent summary", async () => {
    const { path } = seedSession(3);
    const code = await summarizeCommand({
      client: buildClient(),
      current: true,
      fromAgent: true,
      resolveCurrent: () => ({ session_id: SID, path }),
      summarizerFactory: (c) => new Summarizer({ upload: c, retryDelaysMs: [] }),
      stdin: Readable.from([Buffer.from(agentJson)]),
      stdout: process.stdout,
      stderr: process.stderr,
    });

    expect(code).toBe(0);
    expect(countSummaryPosts()).toBe(1);
    const post = server.requests.find(
      (r) => r.method === "POST" && r.path === `/api/sessions/${SID}/summary`,
    );
    const body = post?.body as { title: string; model: string };
    expect(body.title).toBe("Agent-authored title");
    expect(body.model).toBe("agent");
  });

  it("--from-agent with invalid JSON → exit 1, no summary posted", async () => {
    const { path } = seedSession(3);
    const code = await summarizeCommand({
      client: buildClient(),
      current: true,
      fromAgent: true,
      resolveCurrent: () => ({ session_id: SID, path }),
      stdin: Readable.from([Buffer.from("not-json")]),
      stdout: process.stdout,
      stderr: process.stderr,
    });
    expect(code).toBe(1);
    expect(countSummaryPosts()).toBe(0);
  });

  it("--from-agent with missing title → exit 1", async () => {
    const { path } = seedSession(3);
    const code = await summarizeCommand({
      client: buildClient(),
      current: true,
      fromAgent: true,
      resolveCurrent: () => ({ session_id: SID, path }),
      stdin: Readable.from([Buffer.from(JSON.stringify({ summary: "no title here" }))]),
      stdout: process.stdout,
      stderr: process.stderr,
    });
    expect(code).toBe(1);
    expect(countSummaryPosts()).toBe(0);
  });

  it("--current with no active session → exit 1", async () => {
    const code = await summarizeCommand({
      client: buildClient(),
      current: true,
      resolveCurrent: () => null,
      stdout: process.stdout,
      stderr: process.stderr,
    });
    expect(code).toBe(1);
  });

  it("--current + --all together → usage error (exit 2)", async () => {
    const code = await summarizeCommand({
      client: buildClient(),
      current: true,
      all: true,
      stdout: process.stdout,
      stderr: process.stderr,
    });
    expect(code).toBe(2);
  });
});
