// AI-generated. See PROMPT.md for the prompts and model used.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MockServerHandle, startMockServer } from "../../tests/helpers/mock-server.js";
import { UploadClient } from "../upload/client.js";
import { summarizeAndUpload } from "./pipeline.js";

let server: MockServerHandle;
let dir: string;

beforeEach(async () => {
  server = await startMockServer();
  dir = mkdtempSync(join(tmpdir(), "cs-pipeline-"));
});

afterEach(async () => {
  await server.stop();
});

describe("summarizeAndUpload pipeline (e2e with mocked claude)", () => {
  it("reads session, mocks claude, posts summary, then puts blob", async () => {
    // Build a minimal Claude Code-shaped JSONL.
    const path = join(dir, "session-pipeline-1.jsonl");
    const events = [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-05-09T10:00:00.000Z",
        sessionId: "session-pipeline-1",
        cwd: "/tmp/work",
        version: "1.0.0",
        gitBranch: "main",
        message: { role: "user", content: "please summarize me" },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-05-09T10:00:01.000Z",
        sessionId: "session-pipeline-1",
        cwd: "/tmp/work",
        version: "1.0.0",
        gitBranch: "main",
        message: {
          role: "assistant",
          model: "claude-3-5-sonnet",
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
    ];
    writeFileSync(path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);

    const client = new UploadClient({ serverUrl: server.url, token: "tok" });
    const result = await summarizeAndUpload("session-pipeline-1", {
      upload: client,
      jsonlPath: path,
      runClaudeImpl: () =>
        Promise.resolve({
          output: {
            title: "Pipeline e2e summary",
            summary: "User asked for a summary. The assistant acknowledged. No tools were used.",
            tags: ["e2e", "pipeline"],
            files_touched: [],
            prs_referenced: [],
          },
          meta: {
            duration_ms: 100,
            duration_api_ms: 80,
            num_turns: 1,
            stop_reason: "end_turn",
            total_cost_usd: 0.0001,
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            raw_usage: null,
          },
        }),
      minePrsImpl: () => Promise.resolve([]),
    });
    expect(result.status).toBe("ok");
    expect(result.title).toBe("Pipeline e2e summary");

    const summaryRequests = server.requests.filter((r) => r.path.endsWith("/summary"));
    expect(summaryRequests).toHaveLength(1);
    expect(summaryRequests[0]?.path).toBe("/api/sessions/session-pipeline-1/summary");
    const blobRequests = server.requests.filter((r) => r.path.endsWith("/blob"));
    expect(blobRequests).toHaveLength(1);
    expect(blobRequests[0]?.method).toBe("PUT");
    expect(blobRequests[0]?.path).toBe("/api/sessions/session-pipeline-1/blob");

    // Order check: summary uploaded before blob (REQ-061).
    const summaryIdx = server.requests.findIndex((r) => r.path.endsWith("/summary"));
    const blobIdx = server.requests.findIndex((r) => r.path.endsWith("/blob"));
    expect(summaryIdx).toBeLessThan(blobIdx);
  });

  it("agent-authored: providedSummary skips claude, merges deterministic, records agent run", async () => {
    const path = join(dir, "session-agent-1.jsonl");
    const events = [
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-05-09T10:00:00.000Z",
        sessionId: "session-agent-1",
        cwd: "/tmp/work",
        version: "1.0.0",
        message: { role: "user", content: "do work" },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-05-09T10:00:01.000Z",
        sessionId: "session-agent-1",
        cwd: "/tmp/work",
        version: "1.0.0",
        message: {
          role: "assistant",
          model: "claude-3-5-sonnet",
          content: [
            {
              type: "tool_use",
              id: "a1-call",
              name: "Write",
              input: { file_path: "/tmp/work/x.ts" },
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ];
    writeFileSync(path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);

    const client = new UploadClient({ serverUrl: server.url, token: "tok" });
    const result = await summarizeAndUpload("session-agent-1", {
      upload: client,
      jsonlPath: path,
      providedSummary: {
        title: "Agent title",
        summary: "The agent wrote this summary itself.",
        tags: ["agent"],
        files_touched: ["doc.md"],
        prs_referenced: [],
      },
      // Must NOT be called on the agent path.
      runClaudeImpl: () => Promise.reject(new Error("claude must not run for agent summaries")),
      minePrsImpl: () => Promise.resolve([]),
    });

    expect(result.status).toBe("ok");
    expect(result.model).toBe("agent");
    expect(result.title).toBe("Agent title");
    // agent-provided + deterministic (the Write tool call) are merged.
    expect(result.files_touched).toContain("doc.md");
    expect(result.files_touched).toContain("/tmp/work/x.ts");

    const summaryReqs = server.requests.filter((r) => r.path.endsWith("/summary"));
    expect(summaryReqs).toHaveLength(1);
    const runReqs = server.requests.filter((r) => r.path.endsWith("/summarization-runs"));
    expect(runReqs).toHaveLength(1);
    expect((runReqs[0]?.body as { claude_model: string }).claude_model).toBe("agent");
  });
});
