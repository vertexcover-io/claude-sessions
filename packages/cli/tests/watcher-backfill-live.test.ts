// AI-generated. See PROMPT.md for the prompts and model used.

import type { FSWatcher, watch as chokidarWatch } from "chokidar";

type ChokidarFactory = typeof chokidarWatch;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

interface FakeWatcher {
  watcher: FSWatcher;
  emitChange: (path: string) => void;
  emitAdd: (path: string) => void;
  closed: boolean;
}

const makeFakeChokidar = (): FakeWatcher => {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const fake: FakeWatcher = {
    closed: false,
    emitChange: (p: string) => {
      for (const h of handlers.change ?? []) h(p);
    },
    emitAdd: (p: string) => {
      for (const h of handlers.add ?? []) h(p);
    },
    watcher: {
      on(event: string, cb: (...args: unknown[]) => void) {
        const list = handlers[event] ?? [];
        list.push(cb);
        handlers[event] = list;
        return this;
      },
      close() {
        fake.closed = true;
        return Promise.resolve();
      },
    } as unknown as FSWatcher,
  };
  return fake;
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

const buildClient = (): UploadClient =>
  new UploadClient({ serverUrl: server.url, token: "tok", retryDelaysMs: [] });

const makeSummarizerStub = (): { summarize: ReturnType<typeof vi.fn>; stub: Summarizer } => {
  const summarize = vi.fn(async (sessionId: string, _path: string) => ({
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
  }));
  const stub = { summarize, inFlight: () => 0 } as unknown as Summarizer;
  return { summarize, stub };
};

describe("watcher backfill vs live (REQ-001, REQ-002)", () => {
  it("REQ-001 / EDGE-001: catch-up over pre-existing JSONLs does NOT arm end-detect", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const repo = makeTempGitRepo("git@github.com:fixture/backfill-no-arm.git");
    try {
      const files: string[] = [];
      for (let i = 0; i < 5; i++) {
        const sid = `session-pre-${i}`;
        const f = createSessionFile(fixture.projectsRoot, repo.path, sid, [
          buildEvent({ uuid: `b${i}-1`, sessionId: sid, cwd: repo.path }),
          buildEvent({ uuid: `b${i}-2`, sessionId: sid, cwd: repo.path, type: "assistant" }),
        ]);
        files.push(f.path);
      }

      const fake = makeFakeChokidar();
      const { summarize, stub } = makeSummarizerStub();

      const watcher = new JsonlWatcher({
        client: buildClient(),
        discover: () => files,
        chokidarFactory: ((_paths, _opts) => fake.watcher) as unknown as ChokidarFactory,
        summarizer: stub,
        silenceMs: 50,
      });

      await watcher.start();
      // Microtask flush.
      await Promise.resolve();
      expect(summarize).not.toHaveBeenCalled();

      // Push the clock well past silenceMs — backfill never armed the timer
      // so summarize must still be untouched.
      await vi.advanceTimersByTimeAsync(500);
      expect(summarize).not.toHaveBeenCalled();

      await watcher.stop();
      expect(fake.closed).toBe(true);
    } finally {
      vi.useRealTimers();
      repo.cleanup();
    }
  });

  it("REQ-002 / EDGE-002: a synthetic add event arms end-detect and fires summarize", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const repo = makeTempGitRepo("git@github.com:fixture/live-add.git");
    try {
      // One pre-existing file so chokidar gets a real dir to watch.
      const sidPre = "session-pre-live";
      const pre = createSessionFile(fixture.projectsRoot, repo.path, sidPre, [
        buildEvent({ uuid: "p1", sessionId: sidPre, cwd: repo.path }),
      ]);

      // The "live" 6th file — created on disk so consumeFile can read it,
      // but NOT in the discover list so it only enters via the add event.
      const sidLive = "session-live-add";
      const live = createSessionFile(fixture.projectsRoot, repo.path, sidLive, [
        buildEvent({ uuid: "L1", sessionId: sidLive, cwd: repo.path }),
        buildEvent({ uuid: "L2", sessionId: sidLive, cwd: repo.path, type: "assistant" }),
      ]);

      const fake = makeFakeChokidar();
      const { summarize, stub } = makeSummarizerStub();

      const watcher = new JsonlWatcher({
        client: buildClient(),
        discover: () => [pre.path],
        chokidarFactory: ((_paths, _opts) => fake.watcher) as unknown as ChokidarFactory,
        summarizer: stub,
        silenceMs: 50,
      });

      await watcher.start();
      await Promise.resolve();
      expect(summarize).not.toHaveBeenCalled();

      // Synthesize the chokidar add event for the new file.
      fake.emitAdd(live.path);
      // Let consumeSafe's microtasks settle and the upload mock-server reply.
      await vi.advanceTimersByTimeAsync(0);
      await watcher.drain();

      // Past silence — end-detect fires.
      await vi.advanceTimersByTimeAsync(100);
      // Allow the onEnded promise chain to flush.
      await Promise.resolve();
      await Promise.resolve();

      expect(summarize).toHaveBeenCalledTimes(1);
      expect(summarize).toHaveBeenCalledWith(sidLive, live.path);

      await watcher.stop();
    } finally {
      vi.useRealTimers();
      repo.cleanup();
    }
  });

  it("EDGE-011: two change events for the same path within silenceMs collapse to one summarize", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const repo = makeTempGitRepo("git@github.com:fixture/coalesce.git");
    try {
      const sidPre = "session-coalesce-pre";
      const pre = createSessionFile(fixture.projectsRoot, repo.path, sidPre, [
        buildEvent({ uuid: "cp1", sessionId: sidPre, cwd: repo.path }),
      ]);
      const sidLive = "session-coalesce-live";
      const live = createSessionFile(fixture.projectsRoot, repo.path, sidLive, [
        buildEvent({ uuid: "cl1", sessionId: sidLive, cwd: repo.path }),
      ]);

      const fake = makeFakeChokidar();
      const { summarize, stub } = makeSummarizerStub();

      const watcher = new JsonlWatcher({
        client: buildClient(),
        discover: () => [pre.path],
        chokidarFactory: ((_paths, _opts) => fake.watcher) as unknown as ChokidarFactory,
        summarizer: stub,
        silenceMs: 50,
      });

      await watcher.start();
      await Promise.resolve();

      // Two change events back-to-back, well under silenceMs.
      fake.emitChange(live.path);
      await vi.advanceTimersByTimeAsync(10);
      await watcher.drain();
      fake.emitChange(live.path);
      await vi.advanceTimersByTimeAsync(10);
      await watcher.drain();

      // Now wait past silenceMs from the most recent schedule.
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(summarize).toHaveBeenCalledTimes(1);
      expect(summarize).toHaveBeenCalledWith(sidLive, live.path);

      await watcher.stop();
    } finally {
      vi.useRealTimers();
      repo.cleanup();
    }
  });

  it("EDGE-014: empty discover list — start() resolves cleanly and never installs a chokidar listener", async () => {
    const fake = makeFakeChokidar();
    const factorySpy = vi.fn(() => fake.watcher);
    const { summarize, stub } = makeSummarizerStub();

    const watcher = new JsonlWatcher({
      client: buildClient(),
      discover: () => [],
      chokidarFactory: factorySpy as unknown as ChokidarFactory,
      summarizer: stub,
      silenceMs: 50,
    });

    await expect(watcher.start()).resolves.toBeUndefined();
    expect(factorySpy).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();

    await watcher.stop();
  });
});
