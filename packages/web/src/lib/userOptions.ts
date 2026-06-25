// AI-generated. See PROMPT.md for the prompts and model used.

import type { DropdownOption } from "../components/FilterDropdown";
import type { User } from "./types";

interface FacetUser {
  github_login: string;
  avatar_url: string | null;
  count: number;
}

/**
 * Build the user-filter dropdown options from a facet list, always including
 * the signed-in viewer so they can filter to their own sessions even when they
 * have none yet (in this repo, or org-wide). Their row is marked "(you)".
 */
export const buildUserOptions = (
  facetUsers: FacetUser[],
  me: User | undefined,
): DropdownOption[] => {
  const myLogin = me?.github_login ?? undefined;
  const options: DropdownOption[] = facetUsers.map((u) => ({
    value: u.github_login,
    label: u.github_login === myLogin ? `${u.github_login} (you)` : u.github_login,
    avatarUrl: u.avatar_url,
    count: u.count,
  }));

  if (myLogin && !options.some((o) => o.value === myLogin)) {
    options.unshift({
      value: myLogin,
      label: `${myLogin} (you)`,
      avatarUrl: me?.avatar_url ?? null,
    });
  }

  return options;
};
