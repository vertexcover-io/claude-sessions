// AI-generated. See PROMPT.md for the prompts and model used.

import { eq } from "drizzle-orm";
import type { GithubProfile } from "../auth/github.js";
import type { DbClient } from "./client.js";
import { users } from "./schema.js";

export interface AppUser {
  id: string;
  email: string | null;
  githubLogin: string | null;
  avatarUrl: string | null;
  role: string;
}

/**
 * Resolve a GitHub profile to a `users` row, creating or updating as needed:
 *
 * 1. Match by `github_id` → refresh login/avatar/email (login + avatar can
 *    change on GitHub).
 * 2. Else match by `email` → **adopt** the existing (e.g. legacy password)
 *    row by stamping the github fields onto it, preserving its `id` and every
 *    FK'd session.
 * 3. Else insert a fresh row.
 */
export const upsertGithubUser = async (db: DbClient, profile: GithubProfile): Promise<AppUser> => {
  const toAppUser = (row: typeof users.$inferSelect): AppUser => ({
    id: row.id,
    email: row.email,
    githubLogin: row.githubLogin,
    avatarUrl: row.avatarUrl,
    role: row.role,
  });

  const byGithubId = await db.select().from(users).where(eq(users.githubId, profile.id)).limit(1);
  if (byGithubId[0]) {
    const updated = await db
      .update(users)
      .set({ githubLogin: profile.login, avatarUrl: profile.avatarUrl, email: profile.email })
      .where(eq(users.id, byGithubId[0].id))
      .returning();
    return toAppUser(updated[0] ?? byGithubId[0]);
  }

  if (profile.email) {
    const byEmail = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
    if (byEmail[0]) {
      const adopted = await db
        .update(users)
        .set({
          githubId: profile.id,
          githubLogin: profile.login,
          avatarUrl: profile.avatarUrl,
        })
        .where(eq(users.id, byEmail[0].id))
        .returning();
      return toAppUser(adopted[0] ?? byEmail[0]);
    }
  }

  const inserted = await db
    .insert(users)
    .values({
      githubId: profile.id,
      githubLogin: profile.login,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
      role: "user",
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Failed to upsert github user");
  return toAppUser(row);
};
