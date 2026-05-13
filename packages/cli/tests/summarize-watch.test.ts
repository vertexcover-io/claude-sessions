// AI-generated. See PROMPT.md for the prompts and model used.

import type { FSWatcher, watch as chokidarWatch } from "chokidar";

type ChokidarFactory = typeof chokidarWatch;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableCommand } from "../src/commands/enable.js";
import type { Summarizer } from "../src/summarizer/index.js";
import { UploadClient } from "../src/upload/client.js";
import { JsonlWatcher } from "../src/watcher/chokidar.js";
import { makeTempGitRepo } from "./helpers/git-repo.js";
import { type MockServerHandle, startMockServer } from "./helpers/mock-server.js";
import {
  type FixtureEnv,
  buildEvent,
  createSessionFile,
  makeFixtureEnv,
} from "./helpers/tmp-jsonl.js";

interface FakeChokidar {
  watcher: FSWatcher;
  emitAdd: (path: string) => void;
}

const makeFakeChokidar = (): FakeChokidar => {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    emitAdd: (p) => {
      for (const h of handlers.add ?? []) h(p);
    },
    watcher: {
      on(event: string, cb: (...args: unknown[]) => void) {
        const list = handlers[event] ?? [];
        list.push(cb);
        handlers[event] = list;
        return this;
      },
      close: () => Promise.resolve(),
    } as unknown as FSWatcher,
  };
};

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

describe("watcher wires summarizer end-detect (REQ-016)", () => {
  it("a live add event schedules end-detect; firing triggers Summarizer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const repo = makeTempGitRepo("git@github.com:fixture/summarizer-wire.git");
    try {
      const sid = "session-summarize-wire";
      const file = createSessionFile(fixture.projectsRoot, repo.path, sid, [
        buildEvent({ uuid: "w1", sessionId: sid, cwd: repo.path }),
        buildEvent({ uuid: "w2", sessionId: sid, cwd: repo.path, type: "assistant" }),
      ]);

      const client = new UploadClient({
        serverUrl: server.url,
        token: "tok",
        retryDelaysMs: [],
      });

      const summarized: string[] = [];
      const fakeSummarizer = {
        summarize: (sessionId: string, _path: string) => {
          summarized.push(sessionId);
          return Promise.resolve({
            session_id: sessionId,
            title: "x",
            summary: "x",
            tags: [],
            files_touched: [],
            prs_referenced: [],
            tool_call_counts: {},
            generated_at: new Date().toISOString(),
            model: "sonnet",
            status: "ok" as const,
          });
        },
        inFlight: () => 0,
      } as unknown as Summarizer;

      // Register the repo via enableCommand so the file is known on disk
      // (backfill no longer arms end-detect post-Phase 4).
      await enableCommand({
        path: repo.path,
        client,
      });

      // Start a fresh watcher with our summarizer wired in. Inject a fake
      // chokidar so we can synthesize a live `add` event for the same file
      // — this is what arms end-detect (silenceMs=10ms for the test).
      const fake = makeFakeChokidar();
      const watcher = new JsonlWatcher({
        client,
        summarizer: fakeSummarizer,
        silenceMs: 10,
        chokidarFactory: ((_paths, _opts) => fake.watcher) as unknown as ChokidarFactory,
      });
      await watcher.start();
      await Promise.resolve();
      // Catch-up alone must not arm end-detect.
      expect(summarized).toEqual([]);

      // Synthesize a live add event for the same file.
      fake.emitAdd(file.path);
      await vi.advanceTimersByTimeAsync(0);
      await watcher.drain();

      // Advance through the silence window.
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
      await watcher.stop();

      expect(summarized).toContain(sid);
    } finally {
      vi.useRealTimers();
      repo.cleanup();
    }
  });
});
