// AI-generated. See PROMPT.md for the prompts and model used.

import { describe, expect, it, vi } from "vitest";
import { UploadClient } from "./client.js";

describe("UploadClient.getSession", () => {
  it("exposes summarized_event_count from the embedded summary payload", async () => {
    const payload = {
      id: "s1",
      summary: {
        title: "demo",
        summary: "did stuff",
        tags: ["a"],
        files_touched: ["src/x.ts"],
        prs_referenced: [],
        tool_call_counts: { Bash: 2 },
        status: "ok" as const,
        summarized_event_count: 42,
      },
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const client = new UploadClient({
      serverUrl: "http://example.test",
      token: "tok",
      fetchImpl,
    });

    const session = await client.getSession("s1");
    expect(session.id).toBe("s1");
    expect(session.summary?.summarized_event_count).toBe(42);
    expect(session.summary?.status).toBe("ok");
  });
});
