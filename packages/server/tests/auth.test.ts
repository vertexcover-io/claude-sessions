// AI-generated. See PROMPT.md for the prompts and model used.

import type { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Db } from "../src/db/client.js";
import type { Env } from "../src/env.js";
import { type TestPgHandle, startTestPostgres, truncateAll } from "./helpers/pg-test-container.js";
import { seedUser } from "./helpers/seed.js";

const TEST_ENV: Env = {
  DATABASE_URL: "",
  JWT_SECRET: "test-secret-test-secret-test",
  EMBED_PROVIDER: "none",
  OPENAI_EMBED_MODEL: "text-embedding-3-small",
  PORT: 0,
  NODE_ENV: "test",
};

let pg: TestPgHandle;
let db: Db;
let app: Hono;
let env: Env;

beforeAll(async () => {
  pg = await startTestPostgres();
  db = pg.db;
  env = { ...TEST_ENV, DATABASE_URL: pg.url };
  app = buildApp(db.db, env);
}, 180_000);

afterAll(async () => {
  await pg.stop();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("GET /health", () => {
  it("returns ok without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });
});

describe("POST /api/auth/login (REQ-030, REQ-031)", () => {
  it("returns token + cookie on valid credentials", async () => {
    const seed = await seedUser(db.db, env.JWT_SECRET, {
      email: "alice@example.test",
      password: "s3cret-pass",
    });
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: seed.user.email, password: seed.user.password }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { token: string; user: { email: string } };
    expect(json.token).toBeTypeOf("string");
    expect(json.user.email).toBe("alice@example.test");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/session=/);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("rejects invalid password with 401", async () => {
    await seedUser(db.db, env.JWT_SECRET, {
      email: "bob@example.test",
      password: "real-pass",
    });
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bob@example.test", password: "wrong-pass" }),
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/invalid email or password/i);
  });

  it("rejects unknown email with 401", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.test", password: "x" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("auth-required routes (REQ-032)", () => {
  it("rejects /api/auth/me without token", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects /api/ingest without token", async () => {
    const res = await app.request("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("rejects /api/repos/enable without token", async () => {
    const res = await app.request("/api/repos/enable", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("returns user from /api/auth/me with valid bearer", async () => {
    const seed = await seedUser(db.db, env.JWT_SECRET);
    const res = await app.request("/api/auth/me", {
      headers: { authorization: `Bearer ${seed.token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { user: { id: string; email: string } };
    expect(json.user.id).toBe(seed.user.id);
    expect(json.user.email).toBe(seed.user.email);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie.toLowerCase()).toContain("session=");
  });
});

describe("POST /api/auth/cli-code + /api/auth/cli-exchange", () => {
  it("issues a code that exchanges for a cli-scoped bearer token", async () => {
    const seed = await seedUser(db.db, env.JWT_SECRET, { email: "pair@example.test" });
    const codeRes = await app.request("/api/auth/cli-code", {
      method: "POST",
      headers: { authorization: `Bearer ${seed.token}` },
    });
    expect(codeRes.status).toBe(200);
    const codeJson = (await codeRes.json()) as { code: string };
    expect(codeJson.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const exchangeRes = await app.request("/api/auth/cli-exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: codeJson.code }),
    });
    expect(exchangeRes.status).toBe(200);
    const exchangeJson = (await exchangeRes.json()) as {
      token: string;
      user: { id: string; email: string };
    };
    expect(exchangeJson.user.email).toBe("pair@example.test");
    const { verifyToken } = await import("../src/auth/jwt.js");
    const payload = await verifyToken(exchangeJson.token, env.JWT_SECRET);
    expect(payload.aud).toBe("cli");
    expect(payload.sub).toBe(seed.user.id);
  });

  it("rejects unknown codes", async () => {
    const res = await app.request("/api/auth/cli-exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "AAAA-BBBB" }),
    });
    expect(res.status).toBe(401);
  });

  it("a code is single-use", async () => {
    const seed = await seedUser(db.db, env.JWT_SECRET, { email: "single@example.test" });
    const codeRes = await app.request("/api/auth/cli-code", {
      method: "POST",
      headers: { authorization: `Bearer ${seed.token}` },
    });
    const { code } = (await codeRes.json()) as { code: string };
    const first = await app.request("/api/auth/cli-exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(first.status).toBe(200);
    const second = await app.request("/api/auth/cli-exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(second.status).toBe(401);
  });

  it("requires auth to mint a code", async () => {
    const res = await app.request("/api/auth/cli-code", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/mcp-token (REQ-047)", () => {
  it("returns a fresh JWT with audience=mcp scoped to the user", async () => {
    const seed = await seedUser(db.db, env.JWT_SECRET, { email: "mcp-token@example.test" });
    const res = await app.request("/api/auth/mcp-token", {
      method: "POST",
      headers: { authorization: `Bearer ${seed.token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { token: string };
    expect(json.token).toBeTypeOf("string");
    // verify the token round-trips with aud=mcp
    const { verifyToken } = await import("../src/auth/jwt.js");
    const payload = await verifyToken(json.token, env.JWT_SECRET);
    expect(payload.aud).toBe("mcp");
    expect(payload.sub).toBe(seed.user.id);
  });

  it("rejects without auth", async () => {
    const res = await app.request("/api/auth/mcp-token", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
