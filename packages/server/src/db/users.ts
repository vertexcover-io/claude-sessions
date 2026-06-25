// AI-generated. See PROMPT.md for the prompts and model used.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
 * 2. Else **adopt** an unlinked legacy row whose email the caller has proven
 *    they own, stamping the github fields onto it (preserving its `id` and
 *    every FK'd session).
 * 3. Else insert a fresh row.
 *
 * SECURITY: adoption is the account-takeover surface. It matches **only**
 * against the user's GitHub-**verified** emails (`verifiedEmails`, never the
 * unverified `/user.email` field) and **only** rows with `github_id IS NULL`,
 * so it can neither claim an address the user hasn't proven they own nor
 * re-link (hijack) an already-linked account.
 */
export const upsertGithubUser = async (
  db: DbClient,
  profile: GithubProfile,
  verifiedEmails: string[],
): Promise<AppUser> => {
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

  const lowered = verifiedEmails.map((e) => e.toLowerCase()).filter((e) => e.length > 0);
  if (lowered.length > 0) {
    const byEmail = await db
      .select()
      .from(users)
      .where(and(inArray(sql`lower(${users.email})`, lowered), isNull(users.githubId)))
      .limit(1);
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
