// AI-generated. See PROMPT.md for the prompts and model used.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artifactsCommand } from "../src/commands/artifacts.js";
import { UploadClient } from "../src/upload/client.js";
import { type MockServerHandle, startMockServer } from "./helpers/mock-server.js";

let server: MockServerHandle;
let projectsRoot: string;
let cwd: string;

const SESSION_ID = "artifacts-session-uuid";

interface UploadedArtifact {
  path: string;
  mime_type: string;
  content: string;
}

const encodeCwd = (path: string): string => path.replace(/\//g, "-");

const writeToolUseEvent = (
  uuid: string,
  tool: string,
  filePath: string,
): Record<string, unknown> => ({
  type: "assistant",
  uuid,
  parentUuid: null,
  timestamp: "2026-06-01T10:00:00.000Z",
  sessionId: SESSION_ID,
  cwd,
  version: "1.0.0",
  message: {
    role: "assistant",
    model: "claude-3-5-sonnet",
    content: [
      {
        type: "tool_use",
        id: `${uuid}-call`,
        name: tool,
        input: { file_path: filePath },
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  },
});

const writeSessionFile = (events: Record<string, unknown>[]): void => {
  const dir = join(projectsRoot, encodeCwd(cwd));
  mkdirSync(dir, { recursive: true });
  const text = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
  writeFileSync(join(dir, `${SESSION_ID}.jsonl`), text);
};

const buildClient = (): UploadClient =>
  new UploadClient({ serverUrl: server.url, token: "test-token", retryDelaysMs: [] });

const wireArtifacts = (): UploadedArtifact[] => {
  const uploaded: UploadedArtifact[] = [];
  let n = 0;
  server.setMethodHandler("POST", `/api/sessions/${SESSION_ID}/artifacts`, (req) => {
    const body = req.body as UploadedArtifact;
    uploaded.push(body);
    n += 1;
    return { status: 200, body: { ok: true, id: `art-${n}`, byte_size: body.content.length } };
  });
  return uploaded;
};

const captureStdio = async (
  fn: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  let stdout = "";
  let stderr = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = await fn();
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
};

beforeEach(async () => {
  server = await startMockServer();
  projectsRoot = mkdtempSync(join(tmpdir(), "cs-artifacts-projects-"));
  cwd = mkdtempSync(join(tmpdir(), "cs-artifacts-cwd-"));
});

afterEach(async () => {
  await server.stop();
  rmSync(projectsRoot, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("artifacts command", () => {
  it("auto-derive pushes only Markdown files; non-md writes are skipped", async () => {
    const aPath = join(cwd, "a.md");
    const bPath = join(cwd, "b.ts");
    writeFileSync(aPath, "# Title\n");
    writeFileSync(bPath, "export const x = 1;\n");
    writeSessionFile([
      writeToolUseEvent("ev-1", "Write", aPath),
      writeToolUseEvent("ev-2", "Edit", bPath),
    ]);
    const uploaded = wireArtifacts();

    const { code, stdout, stderr } = await captureStdio(() =>
      artifactsCommand({ sessionId: SESSION_ID, client: buildClient(), projectsRoot }),
    );

    expect(code).toBe(0);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.path).toBe(aPath);
    expect(uploaded[0]?.mime_type).toBe("text/markdown");
    expect(stderr).toContain(`skip (not markdown): ${bPath}`);
    expect(stdout).toContain("pushed 1 artifact(s)");
  });

  it("auto-derive excludes Read-only files and non-markdown writes", async () => {
    const written = join(cwd, "written.md");
    const readonly = join(cwd, "readonly.md");
    const notebook = join(cwd, "nb.ipynb");
    writeFileSync(written, "# Written\n");
    writeFileSync(readonly, "# Only read, never written\n");
    writeFileSync(notebook, '{"cells": []}\n');

    const notebookEvent: Record<string, unknown> = {
      type: "assistant",
      uuid: "ev-nb",
      parentUuid: null,
      timestamp: "2026-06-01T10:00:00.000Z",
      sessionId: SESSION_ID,
      cwd,
      version: "1.0.0",
      message: {
        role: "assistant",
        model: "claude-3-5-sonnet",
        content: [
          {
            type: "tool_use",
            id: "ev-nb-call",
            name: "NotebookEdit",
            input: { notebook_path: notebook },
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    };

    writeSessionFile([
      writeToolUseEvent("ev-1", "Write", written),
      writeToolUseEvent("ev-2", "Read", readonly),
      notebookEvent,
    ]);
    const uploaded = wireArtifacts();

    const { code } = await captureStdio(() =>
      artifactsCommand({ sessionId: SESSION_ID, client: buildClient(), projectsRoot }),
    );

    expect(code).toBe(0);
    // Only the written .md survives: readonly is Read-only, nb.ipynb is non-md.
    const paths = uploaded.map((u) => u.path);
    expect(paths).toEqual([written]);
    expect(paths).not.toContain(readonly);
    expect(paths).not.toContain(notebook);
  });

  it("--file uses replace semantics (ignores auto-derived files)", async () => {
    const derived = join(cwd, "derived.ts");
    const chosen = join(cwd, "chosen.md");
    writeFileSync(derived, "export const y = 2;\n");
    writeFileSync(chosen, "# Chosen\n");
    writeSessionFile([writeToolUseEvent("ev-1", "Write", derived)]);
    const uploaded = wireArtifacts();

    const { code } = await captureStdio(() =>
      artifactsCommand({
        sessionId: SESSION_ID,
        client: buildClient(),
        projectsRoot,
        files: [chosen],
      }),
    );

    expect(code).toBe(0);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.path).toBe(chosen);
  });

  it("md-only applies to --file too: a non-md override is skipped", async () => {
    const tsPath = join(cwd, "explicit.ts");
    writeFileSync(tsPath, "export const k = 1;\n");
    // A valid anchor event so the session resolves; the override replaces it anyway.
    writeSessionFile([writeToolUseEvent("ev-1", "Read", join(cwd, "ignored.md"))]);
    const uploaded = wireArtifacts();

    const { code, stdout, stderr } = await captureStdio(() =>
      artifactsCommand({
        sessionId: SESSION_ID,
        client: buildClient(),
        projectsRoot,
        files: [tsPath],
      }),
    );

    expect(code).toBe(0);
    expect(uploaded).toHaveLength(0);
    expect(stderr).toContain(`skip (not markdown): ${tsPath}`);
    expect(stdout).toContain("no artifacts to push");
  });

  it("--dry-run uploads nothing", async () => {
    const aPath = join(cwd, "a.md");
    writeFileSync(aPath, "# z\n");
    writeSessionFile([writeToolUseEvent("ev-1", "Write", aPath)]);
    const uploaded = wireArtifacts();

    const { code, stdout } = await captureStdio(() =>
      artifactsCommand({
        sessionId: SESSION_ID,
        client: buildClient(),
        projectsRoot,
        dryRun: true,
      }),
    );

    expect(code).toBe(0);
    expect(uploaded).toHaveLength(0);
    expect(stdout).toContain(aPath);
    const artifactRequests = server.requests.filter((r) => r.path.endsWith("/artifacts"));
    expect(artifactRequests).toHaveLength(0);
  });

  it("redacts secrets before upload", async () => {
    const secretPath = join(cwd, "config.md");
    writeFileSync(secretPath, "OPENAI_KEY=sk-abcdefghijklmnopqrstuvwxyz0123456789\n");
    writeSessionFile([writeToolUseEvent("ev-1", "Write", secretPath)]);
    const uploaded = wireArtifacts();

    const { code } = await captureStdio(() =>
      artifactsCommand({
        sessionId: SESSION_ID,
        client: buildClient(),
        projectsRoot,
        files: [secretPath],
      }),
    );

    expect(code).toBe(0);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(uploaded[0]?.content).toContain("[REDACTED:");
  });

  it("skips binary (non-utf8) markdown files but still exits 0", async () => {
    const binPath = join(cwd, "blob.md");
    writeFileSync(binPath, Buffer.from([0x00, 0x01, 0x02, 0x00]));
    const okPath = join(cwd, "ok.md");
    writeFileSync(okPath, "# hello\n");
    writeSessionFile([writeToolUseEvent("ev-1", "Write", binPath)]);
    const uploaded = wireArtifacts();

    const { code, stderr } = await captureStdio(() =>
      artifactsCommand({
        sessionId: SESSION_ID,
        client: buildClient(),
        projectsRoot,
        files: [binPath, okPath],
      }),
    );

    expect(code).toBe(0);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.path).toBe(okPath);
    expect(stderr).toContain("skip (binary)");
  });

  it("returns 1 when the session is not found locally", async () => {
    const { code, stderr } = await captureStdio(() =>
      artifactsCommand({ sessionId: "does-not-exist", client: buildClient(), projectsRoot }),
    );
    expect(code).toBe(1);
    expect(stderr).toContain("session not found locally");
  });
});
