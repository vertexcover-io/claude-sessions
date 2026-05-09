// AI-generated. See PROMPT.md for the prompts and model used.

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { verifyPassword } from "../auth/argon.js";
import { signToken } from "../auth/jwt.js";
import { type AuthVariables, buildRequireAuth } from "../auth/middleware.js";
import type { DbClient } from "../db/client.js";
import { users } from "../db/schema.js";
import type { Env } from "../env.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const exchangeSchema = z.object({
  code: z.string().min(8).max(32),
});

interface PairEntry {
  userId: string;
  email: string;
  role: "user" | "admin";
  expiresAt: number;
}

const pairCodes = new Map<string, PairEntry>();
const PAIR_TTL_MS = 5 * 60 * 1000;

const sweepExpired = (now: number): void => {
  for (const [code, entry] of pairCodes) {
    if (entry.expiresAt <= now) pairCodes.delete(code);
  }
};

const generatePairCode = (): string => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    const b = bytes[i] ?? 0;
    out += alphabet[b % alphabet.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
};

export const buildAuthRouter = (db: DbClient, env: Env): Hono<{ Variables: AuthVariables }> => {
  const router = new Hono<{ Variables: AuthVariables }>();
  const requireAuth = buildRequireAuth(env);

  router.post("/login", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid email or password" }, 400);

    const { email, password } = parsed.data;
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found[0];
    if (!user) return c.json({ error: "invalid email or password" }, 401);

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return c.json({ error: "invalid email or password" }, 401);

    const role = user.role === "admin" ? "admin" : "user";
    const cookieToken = await signToken(
      { sub: user.id, email: user.email, role, aud: "web" },
      env.JWT_SECRET,
    );
    const bearerToken = await signToken(
      { sub: user.id, email: user.email, role, aud: "cli" },
      env.JWT_SECRET,
    );
    setCookie(c, "session", cookieToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return c.json({
      token: bearerToken,
      user: { id: user.id, email: user.email, role },
    });
  });

  router.get("/me", requireAuth, (c) => {
    const user = c.get("user");
    return c.json({ user });
  });

  router.post("/logout", (c) => {
    deleteCookie(c, "session", { path: "/" });
    return c.json({ ok: true });
  });

  // POST /api/auth/mcp-token — issue a fresh JWT scoped for the MCP transport
  // (REQ-047). Caller must already be authenticated via cookie or bearer.
  router.post("/mcp-token", requireAuth, async (c) => {
    const user = c.get("user");
    const token = await signToken(
      { sub: user.id, email: user.email, role: user.role, aud: "mcp" },
      env.JWT_SECRET,
    );
    return c.json({ token });
  });

  router.post("/cli-code", requireAuth, (c) => {
    const user = c.get("user");
    const now = Date.now();
    sweepExpired(now);
    const code = generatePairCode();
    pairCodes.set(code, {
      userId: user.id,
      email: user.email,
      role: user.role,
      expiresAt: now + PAIR_TTL_MS,
    });
    return c.json({ code, expiresInSeconds: PAIR_TTL_MS / 1000 });
  });

  router.post("/cli-exchange", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = exchangeSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid code" }, 400);
    const code = parsed.data.code.trim().toUpperCase();
    const now = Date.now();
    sweepExpired(now);
    const entry = pairCodes.get(code);
    if (!entry || entry.expiresAt <= now) {
      return c.json({ error: "invalid or expired code" }, 401);
    }
    pairCodes.delete(code);
    const token = await signToken(
      { sub: entry.userId, email: entry.email, role: entry.role, aud: "cli" },
      env.JWT_SECRET,
    );
    return c.json({
      token,
      user: { id: entry.userId, email: entry.email, role: entry.role },
    });
  });

  return router;
};
