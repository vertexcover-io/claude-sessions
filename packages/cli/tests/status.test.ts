// AI-generated. See PROMPT.md for the prompts and model used.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { statusCommand } from "../src/commands/status.js";
import { writeCredentials } from "../src/config/credentials.js";
import { type FixtureEnv, makeFixtureEnv } from "./helpers/tmp-jsonl.js";

let fixture: FixtureEnv;

beforeEach(() => {
  fixture = makeFixtureEnv();
});

afterEach(() => {
  fixture.cleanup();
});

describe("status command auth reporting", () => {
  it("reports not-logged-in and exits non-zero when credentials are absent", () => {
    const result = statusCommand({ capture: true });
    expect(result.exit).toBe(1);
    expect(result.output).toMatch(/AUTH\s+not logged in/);
    expect(result.output).toMatch(/claude-sessions login/);
  });

  it("reports the authenticated identity and server when logged in", async () => {
    await writeCredentials({
      server_url: "http://localhost:3000",
      token: "test-token",
      user_email: "ritesh@vertexcover.io",
    });
    const result = statusCommand({ capture: true });
    expect(result.exit).toBe(0);
    expect(result.output).toMatch(/AUTH\s+ritesh@vertexcover\.io @ http:\/\/localhost:3000/);
  });
});
