// AI-generated. See PROMPT.md for the prompts and model used.

import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FSWatcher, watch as chokidarWatch } from "chokidar";

type ChokidarFactory = typeof chokidarWatch;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableCommand } from "../src/commands/enable.js";
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
  emitError: (err: unknown) => void;
  added: string[];
  closed: boolean;
}

const makeFakeChokidar = (): FakeWatcher => {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const fake: FakeWatcher = {
    closed: false,
    added: [],
    emitChange: (p: string) => {
      for (const h of handlers.change ?? []) h(p);
    },
    emitAdd: (p: string) => {
      for (const h of handlers.add ?? []) h(p);
    },
    emitError: (err: unknown) => {
      for (const h of handlers.error ?? []) h(err);
    },
    watcher: {
      on(event: string, cb: (...args: unknown[]) => void) {
        const list = handlers[event] ?? [];
        list.push(cb);
        handlers[event] = list;
        return this;
      },
      add(path: string) {
        fake.added.push(path);
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

const ingestedSessionIds = (): string[] =>
  server.requests
    .filter((r) => r.path === "/api/ingest")
    .map((r) => (r.body as { session?: { id?: string } } | null)?.session?.id)
    .filter((id): id is string => typeof id === "string");

// The watcher only tails and uploads — it no longer summarizes. These tests
// pin the chokidar wiring (catch-up + live add → consume + ingest); the
// upload/offset/retry semantics themselves live in watch.test.ts.
describe("watcher tail: catch-up + live add (REQ-001, REQ-002)", () => {
  it("REQ-001: catch-up over pre-existing JSONLs ingests their events", async () => {
    const repo = makeTempGitRepo("git@github.com:fixture/backfill-tail.git");
    try {
      await enableCommand({
        path: repo.path,
        client: buildClient(),
        skipBackfill: true,
        refreshDaemon: () => undefined,
      });
      const files: string[] = [];
      for (let i = 0; i < 3; i++) {
        const sid = `tail-pre-${i}`;
        const f = createSessionFile(fixture.projectsRoot, repo.path, sid, [
          buildEvent({ uuid: `b${i}-1`, sessionId: sid, cwd: repo.path }),
          buildEvent({ uuid: `b${i}-2`, sessionId: sid, cwd: repo.path, type: "assistant" }),
        ]);
        files.push(f.path);
      }

      const fake = makeFakeChokidar();
      const watcher = new JsonlWatcher({
        client: buildClient(),
        discover: () => files,
        chokidarFactory: ((_paths, _opts) => fake.watcher) as unknown as ChokidarFactory,
      });

      await watcher.start();
      await watcher.drain();

      const ids = ingestedSessionIds();
      for (let i = 0; i < 3; i++) expect(ids).toContain(`tail-pre-${i}`);

      await watcher.stop();
      expect(fake.closed).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("REQ-002: a live add event consumes & ingests the new session", async () => {
    const repo = makeTempGitRepo("git@github.com:fixture/live-tail.git");
    try {
      await enableCommand({
        path: repo.path,
        client: buildClient(),
        skipBackfill: true,
        refreshDaemon: () => undefined,
      });

      // One pre-existing file so chokidar gets a real dir to watch.
      const sidPre = "tail-live-pre";
      const pre = createSessionFile(fixture.projectsRoot, repo.path, sidPre, [
        buildEvent({ uuid: "p1", sessionId: sidPre, cwd: repo.path }),
      ]);

      // The "live" file — on disk so consumeFile can read it, but NOT in the
      // discover list, so it only enters via the add event.
      const sidLive = "tail-live-add";
      const live = createSessionFile(fixture.projectsRoot, repo.path, sidLive, [
        buildEvent({ uuid: "L1", sessionId: sidLive, cwd: repo.path }),
        buildEvent({ uuid: "L2", sessionId: sidLive, cwd: repo.path, type: "assistant" }),
      ]);

      const fake = makeFakeChokidar();
      const watcher = new JsonlWatcher({
        client: buildClient(),
        discover: () => [pre.path],
        chokidarFactory: ((_paths, _opts) => fake.watcher) as unknown as ChokidarFactory,
      });

      await watcher.start();
      await watcher.drain();

      fake.emitAdd(live.path);
      await watcher.drain();

      expect(ingestedSessionIds()).toContain(sidLive);

      await watcher.stop();
    } finally {
      repo.cleanup();
    }
  });

  it("bounds live subagent-dir watches to recent sessions and survives watcher errors", async () => {
    const repo = makeTempGitRepo("git@github.com:fixture/subagent-watch.git");
    try {
      await enableCommand({
        path: repo.path,
        client: buildClient(),
        skipBackfill: true,
        refreshDaemon: () => undefined,
      });

      const mkSessionWithSubagents = (sid: string): string => {
        const f = createSessionFile(fixture.projectsRoot, repo.path, sid, [
          buildEvent({ uuid: `${sid}-1`, sessionId: sid, cwd: repo.path }),
        ]);
        const subDir = join(dirname(f.path), sid, "subagents");
        mkdirSync(subDir, { recursive: true });
        writeFileSync(join(subDir, "agent-aaaa1111bbbb2222.jsonl"), "");
        return f.path;
      };

      const recent = mkSessionWithSubagents("recent-session");
      const old = mkSessionWithSubagents("old-session");
      // Age the old session's main file well past the live-watch window so its
      // subagents dir is NOT watched (would otherwise exhaust inotify at scale).
      const past = Date.now() - 1000 * 60 * 60 * 72;
      utimesSync(old, new Date(past), new Date(past));

      let watchedDirs: string[] = [];
      const fake = makeFakeChokidar();
      const watcher = new JsonlWatcher({
        client: buildClient(),
        discover: () => [recent, old],
        logger: () => undefined,
        chokidarFactory: ((paths: string[] | string) => {
          watchedDirs = Array.isArray(paths) ? paths : [paths];
          return fake.watcher;
        }) as unknown as ChokidarFactory,
      });

      await watcher.start();
      await watcher.drain();

      const recentSub = join(dirname(recent), "recent-session", "subagents");
      const oldSub = join(dirname(old), "old-session", "subagents");
      expect(watchedDirs).toContain(recentSub);
      expect(watchedDirs).not.toContain(oldSub);

      // An ENOSPC-style watcher error must not crash the process.
      expect(() => fake.emitError(new Error("ENOSPC: watch limit reached"))).not.toThrow();

      await watcher.stop();
    } finally {
      repo.cleanup();
    }
  });

  it("EDGE-014: empty discover — start() resolves cleanly and never installs a chokidar listener", async () => {
    const fake = makeFakeChokidar();
    const factorySpy = vi.fn(() => fake.watcher);

    const watcher = new JsonlWatcher({
      client: buildClient(),
      discover: () => [],
      chokidarFactory: factorySpy as unknown as ChokidarFactory,
    });

    await expect(watcher.start()).resolves.toBeUndefined();
    expect(factorySpy).not.toHaveBeenCalled();

    await watcher.stop();
  });
});
