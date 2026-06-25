// AI-generated. See PROMPT.md for the prompts and model used.

import { ArrowLeft, GitBranch, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FilterBar } from "../components/FilterBar";
import { SessionCard } from "../components/SessionCard";
import { useMe, useRepoFacets, useRepoSessions } from "../lib/api";
import { formatRepo } from "../lib/cn";
import { buildUserOptions } from "../lib/userOptions";

export const RepoView = () => {
  const params = useParams();
  const canonical = params["*"] ?? "";
  const [userFilters, setUserFilters] = useState<string[]>([]);
  const [branchFilters, setBranchFilters] = useState<string[]>([]);
  const sessions = useRepoSessions(canonical, { users: userFilters, branches: branchFilters });
  const facets = useRepoFacets(canonical);
  const decoded = canonical;

  const me = useMe().data?.user;
  const branchOptions = (facets.data?.branches ?? []).map((b) => ({ value: b, label: b }));
  const userOptions = buildUserOptions(facets.data?.users ?? [], me);

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="mb-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> All repos
        </Link>
        <h1 className="text-xl font-semibold mt-2">{formatRepo(decoded)}</h1>
        <div className="text-xs text-muted-foreground font-mono mt-0.5">{decoded}</div>
      </div>

      <FilterBar
        testid="repo-filters"
        filters={[
          {
            testid: "repo-filter-branch",
            icon: <GitBranch size={14} />,
            allLabel: "All branches",
            options: branchOptions,
            selected: branchFilters,
            multiple: true,
            onChange: setBranchFilters,
          },
          {
            testid: "repo-filter-user",
            icon: <Users size={14} />,
            allLabel: "All users",
            options: userOptions,
            selected: userFilters,
            multiple: true,
            onChange: setUserFilters,
          },
        ]}
      />

      <div className="mt-4 space-y-3" data-testid="repo-sessions">
        {sessions.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {sessions.isError && (
          <div className="text-sm text-red-500">Failed to load sessions for this repo.</div>
        )}
        {sessions.data && sessions.data.sessions.length === 0 && (
          <div className="text-sm text-muted-foreground">No sessions for this repo yet.</div>
        )}
        {sessions.data?.sessions.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
      </div>
    </div>
  );
};
