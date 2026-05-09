// AI-generated. See PROMPT.md for the prompts and model used.

import { Search } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SearchFilters } from "../components/SearchFilters";
import { useSearch } from "../lib/api";
import { formatCost, formatRepo } from "../lib/cn";

const FILTER_KEYS = ["repo", "branch", "agent", "model", "tag", "has_pr", "since"] as const;

const formatDate = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
};

export const SearchPage = () => {
  const [params, setParams] = useSearchParams();
  const initialQ = params.get("q") ?? "";
  const [query, setQuery] = useState(initialQ);

  // Re-seed the input when the URL `q` changes externally (back/forward,
  // home redirect, etc.). Don't read from the deprecated `tag` param.
  useEffect(() => {
    setQuery(params.get("q") ?? "");
  }, [params]);

  const activeFilters = FILTER_KEYS.map((k) => params.get(k)).filter(
    (v): v is string => v !== null && v !== "",
  );
  const hasAnyFilter = activeFilters.length > 0;
  const trimmedQuery = query.trim();

  // Fire a search when the user has typed a query OR any filter is set.
  // The `useSearch` queryKey memoizes on the whole filters object, so
  // changing a filter or typing in the box auto-refires.
  const filters =
    trimmedQuery.length > 0 || hasAnyFilter
      ? {
          q: trimmedQuery,
          repo: params.get("repo") ?? undefined,
          branch: params.get("branch") ?? undefined,
          agent: params.get("agent") ?? undefined,
          model: params.get("model") ?? undefined,
          tag: params.get("tag") ?? undefined,
          since: params.get("since") ?? undefined,
          has_pr:
            params.get("has_pr") === "true"
              ? true
              : params.get("has_pr") === "false"
                ? false
                : undefined,
        }
      : null;

  const search = useSearch(filters);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (trimmedQuery) next.set("q", trimmedQuery);
    else next.delete("q");
    setParams(next, { replace: true });
  };

  const isLoading = search.isFetching && !!filters;
  const results = search.data?.results ?? [];
  const showLandingPrompt = !filters && !search.isFetching;

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-3">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <Search size={16} className="text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions, summaries, tags…"
          className="flex-1 px-3 py-2 rounded border border-border bg-background text-sm"
        />
        <button type="submit" className="px-3 py-2 rounded bg-foreground text-background text-sm">
          Search
        </button>
      </form>

      <SearchFilters />

      <div className="space-y-3" data-testid="search-results">
        {showLandingPrompt && (
          <div className="text-sm text-muted-foreground">
            Type a query, pick a filter, or both — sessions are listed by recency when you haven't
            typed a query.
          </div>
        )}

        {filters && (
          <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
            <span>
              {isLoading
                ? "Searching…"
                : results.length === 0
                  ? "No results."
                  : `${results.length} result${results.length === 1 ? "" : "s"}`}
              {!isLoading && search.data?.strategy === "recency" && results.length > 0 && (
                <span className="ml-2 text-muted-foreground/80">(by recency)</span>
              )}
            </span>
            {search.isError && <span className="text-red-500">Search failed.</span>}
          </div>
        )}

        {results.map((r) => (
          <Link
            key={r.session_id}
            to={`/sessions/${r.session_id}`}
            className="block p-4 rounded-lg border border-border bg-card hover:bg-muted"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-medium text-sm">
                {r.title ?? `Session ${r.session_id.slice(0, 8)}`}
              </h3>
              <span className="text-xs font-mono text-muted-foreground">
                {formatCost(r.total_cost_usd)}
              </span>
            </div>
            {r.summary && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{r.summary}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{formatRepo(r.repo)}</span>
              {r.branch && <span className="font-mono">{r.branch}</span>}
              {r.agent && <span className="font-mono">{r.agent}</span>}
              {r.started_at && (
                <span className="font-mono ml-auto">{formatDate(r.started_at)}</span>
              )}
            </div>
            {r.tags && r.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {r.tags.slice(0, 6).map((t) => (
                  <span
                    key={t}
                    className="text-[11px] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
                {r.tags.length > 6 && (
                  <span className="text-[11px] text-muted-foreground">+{r.tags.length - 6}</span>
                )}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
};
