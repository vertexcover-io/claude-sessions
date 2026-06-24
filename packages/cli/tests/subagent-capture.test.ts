// AI-generated. See PROMPT.md for the prompts and model used.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enableCommand } from "../src/commands/enable.js";
import { UploadClient } from "../src/upload/client.js";
import { consumeFile } from "../src/watcher/consume.js";
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

const buildClient = (): UploadClient =>
  new UploadClient({ serverUrl: server.url, token: "tok", retryDelaysMs: [] });

const encodeCwd = (path: string): string => path.replace(/\//g, "-");

const ingestPayloads = (): { session?: { id?: string; parent_session_id?: string } }[] =>
  server.requests
    .filter((r) => r.path === "/api/ingest")
    .map((r) => r.body as { session?: { id?: string; parent_session_id?: string } });

describe("subagent capture (CAPTURE track)", () => {
  it("uploads a subagent transcript keyed by agentId with parent_session_id", async () => {
    const repo = makeTempGitRepo("git@github.com:fixture/subagent.git");
    try {
      await enableCommand({
        path: repo.path,
        client: buildClient(),
        skipBackfill: true,
        refreshDaemon: () => undefined,
      });

      const mainId = "12345678-90ab-cdef-1234-567890abcdef";
      const agentId = "a782c5e94c0f7ae85";
      // Subagent file: internal sessionId collides with the parent's id.
      const subDir = join(fixture.projectsRoot, encodeCwd(repo.path), mainId, "subagents");
      mkdirSync(subDir, { recursive: true });
      const subPath = join(subDir, `agent-${agentId}.jsonl`);
      const lines = [
        buildEvent({ uuid: "s1", sessionId: mainId, cwd: repo.path }),
        buildEvent({ uuid: "s2", sessionId: mainId, cwd: repo.path, type: "assistant" }),
      ].map((e) => ({ ...e, isSidechain: true }));
      writeFileSync(subPath, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);

      const res = await consumeFile(subPath, buildClient());
      expect(res.skipped).toBe(false);

      const sessions = ingestPayloads().map((p) => p.session);
      const child = sessions.find((s) => s?.id === agentId);
      expect(child).toBeDefined();
      expect(child?.parent_session_id).toBe(mainId);
    } finally {
      repo.cleanup();
    }
  });

  it("rides agent_id through the ingest payload of an Agent tool_use", async () => {
    const repo = makeTempGitRepo("git@github.com:fixture/agentid.git");
    try {
      await enableCommand({
        path: repo.path,
        client: buildClient(),
        skipBackfill: true,
        refreshDaemon: () => undefined,
      });

      const sid = "parent-with-agent";
      const agentId = "deadbeefcafe";
      const call = {
        type: "assistant",
        uuid: "a-call",
        parentUuid: null,
        timestamp: new Date().toISOString(),
        sessionId: sid,
        cwd: repo.path,
        version: "1.0.0",
        gitBranch: "main",
        message: {
          role: "assistant",
          model: "claude-3-5-sonnet",
          content: [{ type: "tool_use", id: "tu-agent", name: "Agent", input: { prompt: "go" } }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      };
      const result = {
        type: "user",
        uuid: "u-result",
        parentUuid: "a-call",
        timestamp: new Date().toISOString(),
        sessionId: sid,
        cwd: repo.path,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-agent",
              content: `Async agent launched successfully.\nagentId: ${agentId} (internal ...)`,
            },
          ],
        },
      };
      const file = createSessionFile(fixture.projectsRoot, repo.path, sid, [
        call as unknown as Record<string, unknown>,
        result as unknown as Record<string, unknown>,
      ]);

      const res = await consumeFile(file.path, buildClient());
      expect(res.skipped).toBe(false);

      const events = ingestPayloads().flatMap(
        (p) =>
          (p as { events?: { type?: string; payload?: { agent_id?: string } }[] }).events ?? [],
      );
      const toolEvent = events.find((e) => e.payload?.agent_id !== undefined);
      expect(toolEvent?.payload?.agent_id).toBe(agentId);
    } finally {
      repo.cleanup();
    }
  });
});
