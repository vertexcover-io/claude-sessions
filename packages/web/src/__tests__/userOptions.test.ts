// AI-generated. See PROMPT.md for the prompts and model used.

import { describe, expect, it } from "vitest";
import type { User } from "../lib/types";
import { buildUserOptions } from "../lib/userOptions";

const me: User = {
  id: "u1",
  email: "me@example.test",
  role: "user",
  github_login: "me-login",
  avatar_url: "https://avatars.test/me",
};

const facet = (login: string, count = 1) => ({
  github_login: login,
  avatar_url: `https://avatars.test/${login}`,
  count,
});

describe("buildUserOptions", () => {
  it("adds the viewer when absent from the facet list", () => {
    const opts = buildUserOptions([facet("alice"), facet("bob")], me);
    const self = opts.find((o) => o.value === "me-login");
    expect(self).toBeDefined();
    expect(self?.label).toBe("me-login (you)");
    expect(self?.avatarUrl).toBe("https://avatars.test/me");
    // Viewer is surfaced first when newly added.
    expect(opts[0]?.value).toBe("me-login");
  });

  it("marks the viewer '(you)' without duplicating when already present", () => {
    const opts = buildUserOptions([facet("alice"), facet("me-login", 3)], me);
    const mine = opts.filter((o) => o.value === "me-login");
    expect(mine).toHaveLength(1);
    expect(mine[0]?.label).toBe("me-login (you)");
    expect(mine[0]?.count).toBe(3);
  });

  it("returns plain facet options when there is no signed-in user", () => {
    const opts = buildUserOptions([facet("alice")], undefined);
    expect(opts).toHaveLength(1);
    expect(opts[0]?.label).toBe("alice");
  });

  it("ignores a viewer without a github login", () => {
    const opts = buildUserOptions([facet("alice")], { ...me, github_login: null });
    expect(opts.map((o) => o.value)).toEqual(["alice"]);
  });
});
