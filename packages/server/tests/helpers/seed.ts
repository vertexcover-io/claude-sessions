// AI-generated. See PROMPT.md for the prompts and model used.

import { signToken } from "../../src/auth/jwt.js";
import type { DbClient } from "../../src/db/client.js";
import { grantUserRepo, upsertRepo } from "../../src/db/repos.js";
import { users } from "../../src/db/schema.js";

export interface SeededUser {
  id: string;
  email: string;
  githubLogin: string;
  role: "user" | "admin";
}

export interface SeedResult {
  user: SeededUser;
  token: string;
  repoId: string;
  repoCanonical: string;
}

export interface SeedOptions {
  email?: string;
  githubLogin?: string;
  githubId?: number;
  role?: "user" | "admin";
  repoUrl?: string;
  grantRepo?: boolean;
}

const randomSuffix = (): string => Math.random().toString(36).slice(2, 10);

export const seedUser = async (
  db: DbClient,
  jwtSecret: string,
  opts: SeedOptions = {},
): Promise<SeedResult> => {
  const githubLogin = opts.githubLogin ?? `user-${randomSuffix()}`;
  const email = opts.email ?? `${githubLogin}@example.test`;
  const githubId = opts.githubId ?? Math.floor(Math.random() * 1_000_000_000);
  const role = opts.role ?? "user";
  const repoUrl = opts.repoUrl ?? "github.com/example/repo";
  const grantRepo = opts.grantRepo ?? true;

  const inserted = await db
    .insert(users)
    .values({
      email,
      githubId,
      githubLogin,
      avatarUrl: `https://avatars.test/${githubLogin}`,
      role,
    })
    .returning({ id: users.id, email: users.email, githubLogin: users.githubLogin });
  const row = inserted[0];
  if (!row) throw new Error("Failed to seed user");

  const repo = await upsertRepo(db, repoUrl);
  if (grantRepo) {
    await grantUserRepo(db, row.id, repo.id, "owner");
  }

  const token = await signToken(
    {
      sub: row.id,
      email: row.email ?? `${githubLogin}@users.noreply.github.com`,
      role,
      aud: "cli",
    },
    jwtSecret,
  );

  return {
    user: {
      id: row.id,
      email: row.email ?? email,
      githubLogin: row.githubLogin ?? githubLogin,
      role,
    },
    token,
    repoId: repo.id,
    repoCanonical: repo.canonicalUrl,
  };
};
