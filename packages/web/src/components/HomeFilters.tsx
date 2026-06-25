// AI-generated. See PROMPT.md for the prompts and model used.

import { FolderGit2, Users } from "lucide-react";
import { useMe, useSearchFacets } from "../lib/api";
import { formatRepo } from "../lib/cn";
import { buildUserOptions } from "../lib/userOptions";
import { FilterBar } from "./FilterBar";

interface HomeFiltersProps {
  repos: string[];
  users: string[];
  onReposChange: (v: string[]) => void;
  onUsersChange: (v: string[]) => void;
}

/**
 * Compact filter bar for the Home feed. Repo + user values come from the
 * org-wide search facets, so the menus only list repos/users that actually
 * have sessions. Both filters are multi-select (OR within, AND across).
 */
export const HomeFilters = ({ repos, users, onReposChange, onUsersChange }: HomeFiltersProps) => {
  const facets = useSearchFacets();
  const me = useMe().data?.user;
  const repoOptions = (facets.data?.repos ?? []).map((r) => ({
    value: r.canonical_url,
    label: r.display_name ?? formatRepo(r.canonical_url),
  }));
  const userOptions = buildUserOptions(facets.data?.users ?? [], me);

  return (
    <FilterBar
      testid="home-filters"
      filters={[
        {
          testid: "home-filter-repo",
          icon: <FolderGit2 size={14} />,
          allLabel: "All repositories",
          options: repoOptions,
          selected: repos,
          multiple: true,
          onChange: onReposChange,
        },
        {
          testid: "home-filter-user",
          icon: <Users size={14} />,
          allLabel: "All users",
          options: userOptions,
          selected: users,
          multiple: true,
          onChange: onUsersChange,
        },
      ]}
    />
  );
};
