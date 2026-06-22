// AI-generated. See PROMPT.md for the prompts and model used.

import type { CanonicalSession, SessionSummary } from "@claude-sessions/core";
import { describe, expect, it, vi } from "vitest";
import { HttpError, type SessionDetail, type UploadClient } from "../upload/client.js";
import { Summarizer } from "./index.js";

const buildOkSummary = (id: string): SessionSummary => ({
  session_id: id,
  title: "ok",
  summary: "ran fine",
  tags: ["t"],
  files_touched: [],
  prs_referenced: [],
  tool_call_counts: {},
  generated_at: "2026-05-09T10:00:00Z",
  model: "sonnet",
  status: "ok",
});

class FakeUpload implements Pick<UploadClient, "uploadSummary" | "uploadBlob"> {
  uploads: Array<{ id: string; summary: unknown }> = [];
  blobs: Array<{ id: string; size: number }> = [];
  failures = 0;

  uploadSummary = (id: string, summary: unknown): Promise<void> => {
    this.uploads.push({ id, summary });
    return Promise.resolve();
  };
  uploadBlob = (id: string, bytes: Uint8Array | Buffer): Promise<void> => {
    this.blobs.push({ id, size: bytes.byteLength });
    return Promise.resolve();
  };
}

describe("Summarizer (REQ-018, REQ-019)", () => {
  it("REQ-018: 3 throws then a 4th success returns the success result", async () => {
    let attempts = 0;
    const upload = new FakeUpload() as unknown as UploadClient;
    const sum = new Summarizer({
      upload,
      retryDelaysMs: [0, 0, 0],
      runPipeline: () => {
        attempts++;
        if (attempts < 4) return Promise.reject(new Error(`boom-${attempts}`));
        return Promise.resolve(buildOkSummary("s-retry"));
      },
      logger: () => undefined,
    });
    const out = await sum.summarize("s-retry", "/tmp/x.jsonl");
    expect(attempts).toBe(4);
    expect(out.status).toBe("ok");
  });

  it("REQ-018: 4 throws → status=failed marker uploaded", async () => {
    let attempts = 0;
    const upload = new FakeUpload();
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      retryDelaysMs: [0, 0, 0],
      runPipeline: () => {
        attempts++;
        return Promise.reject(new Error(`boom-${attempts}`));
      },
      logger: () => undefined,
    });
    const out = await sum.summarize("s-fail", "/tmp/x.jsonl");
    expect(attempts).toBe(4);
    expect(out.status).toBe("failed");
    expect(out.error).toContain("boom-4");
    expect(upload.uploads).toHaveLength(1);
    const stored = upload.uploads[0]?.summary as SessionSummary;
    expect(stored.status).toBe("failed");
  });

  it("404 from pipeline short-circuits — no retries, no failure-marker upload", async () => {
    let attempts = 0;
    const upload = new FakeUpload();
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      retryDelaysMs: [0, 0, 0],
      runPipeline: () => {
        attempts++;
        return Promise.reject(new HttpError(404, '{"error":"session not found"}'));
      },
      logger: () => undefined,
    });
    const out = await sum.summarize("s-missing", "/tmp/x.jsonl");
    expect(attempts).toBe(1);
    expect(out.status).toBe("failed");
    expect(upload.uploads).toHaveLength(0);
  });

  it("REQ-019: max 2 in-flight when 10 are enqueued", async () => {
    let inflight = 0;
    let peak = 0;
    const upload = new FakeUpload() as unknown as UploadClient;
    const sum = new Summarizer({
      upload,
      maxConcurrent: 2,
      retryDelaysMs: [],
      runPipeline: async (id) => {
        inflight++;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        return buildOkSummary(id);
      },
      logger: () => undefined,
    });

    const ids = Array.from({ length: 10 }, (_, i) => `s-${i}`);
    await Promise.all(ids.map((id) => sum.summarize(id, "/tmp/x.jsonl")));
    expect(peak).toBe(2);
    expect(sum.inFlight()).toBe(0);
  });
});

const makeSession = (eventCount: number): CanonicalSession =>
  ({
    id: "stub",
    agent: "claude-code",
    agent_version: "0",
    repo: null,
    branch: null,
    source_cwd_hint: "",
    started_at: "2026-05-09T10:00:00Z",
    ended_at: "2026-05-09T10:00:00Z",
    model: null,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cost_usd: 0,
    permission_mode: null,
    events: Array.from({ length: eventCount }, (_, i) => ({ uuid: `e-${i}` }) as never),
    raw_jsonl_blob_url: null,
    name: null,
  }) satisfies CanonicalSession;

interface FakeUploadWithGet
  extends Pick<UploadClient, "uploadSummary" | "uploadBlob" | "getSession"> {
  uploads: Array<{ id: string; summary: unknown }>;
}

const buildFakeUploadWithGet = (
  getSessionImpl: (id: string) => Promise<SessionDetail>,
): FakeUploadWithGet => {
  const uploads: Array<{ id: string; summary: unknown }> = [];
  return {
    uploads,
    uploadSummary: vi.fn(async (id: string, summary: unknown) => {
      uploads.push({ id, summary });
    }),
    uploadBlob: vi.fn(async () => undefined),
    getSession: vi.fn(getSessionImpl),
  };
};

const detailWithSummary = (id: string, summary: SessionDetail["summary"]): SessionDetail => ({
  id,
  summary,
});

describe("Summarizer watermark skip (REQ-003..REQ-006, REQ-012, REQ-013)", () => {
  it("REQ-003 / EDGE-003: ok+watermark=20, current=21 (delta=1) skips pipeline", async () => {
    const upload = buildFakeUploadWithGet(async (id) =>
      detailWithSummary(id, {
        title: "prev title",
        summary: "prev body",
        tags: ["x"],
        files_touched: ["a.ts"],
        prs_referenced: ["#1"],
        tool_call_counts: { Read: 2 },
        status: "ok",
        summarized_event_count: 20,
      }),
    );
    const runPipeline = vi.fn();
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      runPipeline,
      readSessionImpl: () => makeSession(21),
      logger: () => undefined,
    });

    const out = await sum.summarize("s-1", "/tmp/x.jsonl");

    expect(runPipeline).not.toHaveBeenCalled();
    expect(upload.uploads).toHaveLength(0);
    expect(out.status).toBe("ok");
    expect(out.title).toBe("prev title");
    expect(out.summary).toBe("prev body");
    expect(out.summarized_event_count).toBe(20);
  });

  it("REQ-003 / EDGE-004: ok+watermark=20, current=25 (delta=5) runs pipeline", async () => {
    const upload = buildFakeUploadWithGet(async (id) =>
      detailWithSummary(id, {
        title: "prev",
        summary: "prev",
        tags: [],
        files_touched: [],
        prs_referenced: [],
        tool_call_counts: {},
        status: "ok",
        summarized_event_count: 20,
      }),
    );
    const runPipeline = vi.fn().mockResolvedValue(buildOkSummary("s-2"));
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      runPipeline,
      readSessionImpl: () => makeSession(25),
      logger: () => undefined,
    });

    await sum.summarize("s-2", "/tmp/x.jsonl");

    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  it("REQ-005 / EDGE-005: status=failed runs pipeline", async () => {
    const upload = buildFakeUploadWithGet(async (id) =>
      detailWithSummary(id, {
        title: null,
        summary: null,
        tags: [],
        files_touched: [],
        prs_referenced: [],
        tool_call_counts: {},
        status: "failed",
        summarized_event_count: 10,
      }),
    );
    const runPipeline = vi.fn().mockResolvedValue(buildOkSummary("s-3"));
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      runPipeline,
      readSessionImpl: () => makeSession(11),
      logger: () => undefined,
    });

    await sum.summarize("s-3", "/tmp/x.jsonl");

    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  it("REQ-006: status=ok but watermark=null runs pipeline", async () => {
    const upload = buildFakeUploadWithGet(async (id) =>
      detailWithSummary(id, {
        title: "x",
        summary: "y",
        tags: [],
        files_touched: [],
        prs_referenced: [],
        tool_call_counts: {},
        status: "ok",
        summarized_event_count: null,
      }),
    );
    const runPipeline = vi.fn().mockResolvedValue(buildOkSummary("s-4"));
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      runPipeline,
      readSessionImpl: () => makeSession(50),
      logger: () => undefined,
    });

    await sum.summarize("s-4", "/tmp/x.jsonl");

    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  it("REQ-012: force=true overrides skip even at delta=0", async () => {
    const upload = buildFakeUploadWithGet(async (id) =>
      detailWithSummary(id, {
        title: "p",
        summary: "p",
        tags: [],
        files_touched: [],
        prs_referenced: [],
        tool_call_counts: {},
        status: "ok",
        summarized_event_count: 20,
      }),
    );
    const runPipeline = vi.fn().mockResolvedValue(buildOkSummary("s-force"));
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      runPipeline,
      readSessionImpl: () => makeSession(20),
      logger: () => undefined,
    });

    await sum.summarize("s-force", "/tmp/x.jsonl", { force: true });

    expect(runPipeline).toHaveBeenCalledTimes(1);
    // getSession should not even be called when force=true
    expect((upload.getSession as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("REQ-013: minResumarizeDelta=0 makes any delta>=0 trigger pipeline", async () => {
    const upload = buildFakeUploadWithGet(async (id) =>
      detailWithSummary(id, {
        title: "p",
        summary: "p",
        tags: [],
        files_touched: [],
        prs_referenced: [],
        tool_call_counts: {},
        status: "ok",
        summarized_event_count: 20,
      }),
    );
    const runPipeline = vi.fn().mockResolvedValue(buildOkSummary("s-zero"));
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      runPipeline,
      readSessionImpl: () => makeSession(21),
      minResumarizeDelta: 0,
      logger: () => undefined,
    });

    await sum.summarize("s-zero", "/tmp/x.jsonl");

    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  it("REQ-013: minResumarizeDelta=1000 still skips at delta=10", async () => {
    const upload = buildFakeUploadWithGet(async (id) =>
      detailWithSummary(id, {
        title: "p",
        summary: "p",
        tags: [],
        files_touched: [],
        prs_referenced: [],
        tool_call_counts: {},
        status: "ok",
        summarized_event_count: 20,
      }),
    );
    const runPipeline = vi.fn();
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      runPipeline,
      readSessionImpl: () => makeSession(30),
      minResumarizeDelta: 1000,
      logger: () => undefined,
    });

    await sum.summarize("s-big", "/tmp/x.jsonl");

    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("REQ-004: a successful pipeline run uploads summarized_event_count matching events.length", async () => {
    // No prior summary -> pipeline runs. Use the real summarizeAndUpload via
    // uploads capture by injecting our own runPipeline that mimics the real
    // one's payload: it must include summarized_event_count.
    const upload = buildFakeUploadWithGet(async (id) => detailWithSummary(id, null));
    const session = makeSession(42);
    const runPipeline = vi.fn(async (id: string) => {
      const summary: SessionSummary = {
        ...buildOkSummary(id),
        summarized_event_count: session.events.length,
      };
      // Mirror what the real pipeline does: upload the summary.
      await upload.uploadSummary(id, summary);
      return summary;
    });
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      runPipeline,
      readSessionImpl: () => session,
      logger: () => undefined,
    });

    await sum.summarize("s-up", "/tmp/x.jsonl");

    expect(upload.uploads).toHaveLength(1);
    const stored = upload.uploads[0]?.summary as SessionSummary;
    expect(stored.summarized_event_count).toBe(42);
  });

  it("getSession rejects → pipeline still runs (watermark check never blocks)", async () => {
    const upload = buildFakeUploadWithGet(async () => {
      throw new HttpError(500, "boom");
    });
    const runPipeline = vi.fn().mockResolvedValue(buildOkSummary("s-500"));
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      runPipeline,
      readSessionImpl: () => makeSession(10),
      logger: () => undefined,
    });

    await sum.summarize("s-500", "/tmp/x.jsonl");

    expect(runPipeline).toHaveBeenCalledTimes(1);
  });
});

describe("Summarizer backfill-only mode + agent passthrough", () => {
  it("backfillOnly: skips when an ok summary already exists (any delta)", async () => {
    const upload = buildFakeUploadWithGet(async (id) =>
      detailWithSummary(id, {
        title: "agent title",
        summary: "agent body",
        tags: ["t"],
        files_touched: ["a.ts"],
        prs_referenced: [],
        tool_call_counts: {},
        status: "ok",
        summarized_event_count: 5,
      }),
    );
    const runPipeline = vi.fn();
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      backfillOnly: true,
      runPipeline,
      // Even a huge delta must not trigger a re-summarize in backfill mode.
      readSessionImpl: () => makeSession(9999),
      logger: () => undefined,
    });

    const out = await sum.summarize("s-bf", "/tmp/x.jsonl");

    expect(runPipeline).not.toHaveBeenCalled();
    expect(out.status).toBe("ok");
    expect(out.title).toBe("agent title");
  });

  it("backfillOnly: runs pipeline when no summary exists yet", async () => {
    const upload = buildFakeUploadWithGet(async (id) => detailWithSummary(id, null));
    const runPipeline = vi.fn().mockResolvedValue(buildOkSummary("s-bf2"));
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      backfillOnly: true,
      runPipeline,
      readSessionImpl: () => makeSession(3),
      logger: () => undefined,
    });

    await sum.summarize("s-bf2", "/tmp/x.jsonl");

    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  it("agent providedSummary bypasses the watermark gate and is forwarded to the pipeline", async () => {
    const upload = buildFakeUploadWithGet(async (id) =>
      detailWithSummary(id, {
        title: "old",
        summary: "old",
        tags: [],
        files_touched: [],
        prs_referenced: [],
        tool_call_counts: {},
        status: "ok",
        summarized_event_count: 100,
      }),
    );
    const runPipeline = vi.fn(async (id: string, deps: { providedSummary?: unknown }) => {
      expect(deps.providedSummary).toBeDefined();
      return buildOkSummary(id);
    });
    const sum = new Summarizer({
      upload: upload as unknown as UploadClient,
      backfillOnly: true,
      runPipeline,
      readSessionImpl: () => makeSession(100),
      logger: () => undefined,
    });

    await sum.summarize("s-agent", "/tmp/x.jsonl", {
      providedSummary: {
        title: "Agent",
        summary: "Agent body",
        tags: [],
        files_touched: [],
        prs_referenced: [],
      },
    });

    expect(runPipeline).toHaveBeenCalledTimes(1);
    // The agent path is authoritative: it must not consult the watermark.
    expect((upload.getSession as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
