import { Filter, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useSearchFacets } from "../lib/api";
import { cn, formatRepo } from "../lib/cn";

const labelClass = "text-xs text-muted-foreground font-medium mb-1 block";
const inputClass =
  "px-2 py-1.5 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-50";

const SegmentButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "px-2.5 py-1 text-xs border first:rounded-l last:rounded-r -ml-px first:ml-0 transition-colors",
      active
        ? "bg-foreground text-background border-foreground"
        : "bg-background text-muted-foreground border-border hover:bg-muted",
    )}
    aria-pressed={active}
  >
    {children}
  </button>
);

export const SearchFilters = () => {
  const [params, setParams] = useSearchParams();
  const facets = useSearchFacets();

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const repo = params.get("repo") ?? "";
  const branch = params.get("branch") ?? "";
  const agent = params.get("agent") ?? "";
  const model = params.get("model") ?? "";
  const hasPr = params.get("has_pr"); // "true" | "false" | null
  const since = params.get("since") ?? "";
  const tag = params.get("tag") ?? "";

  const hasAny = !!repo || !!branch || !!agent || !!model || hasPr !== null || !!since || !!tag;

  const clearAll = () => {
    const next = new URLSearchParams(params);
    for (const k of ["repo", "branch", "agent", "model", "has_pr", "since", "tag"]) {
      next.delete(k);
    }
    setParams(next, { replace: true });
  };

  // For the date input we need YYYY-MM-DD; persist back as full ISO at midnight UTC.
  const sinceDate = since ? since.slice(0, 10) : "";

  return (
    <div
      className="search-filters border border-border rounded-lg bg-card p-3 flex flex-wrap items-end gap-3"
      data-testid="search-filters"
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground self-start mt-5">
        <Filter size={12} /> Filters
      </div>

      <div>
        <span className={labelClass}>Repo</span>
        <select
          value={repo}
          onChange={(e) => set("repo", e.target.value || null)}
          className={inputClass}
          data-testid="filter-repo"
        >
          <option value="">All</option>
          {facets.data?.repos.map((r) => (
            <option key={r.canonical_url} value={r.canonical_url}>
              {r.display_name ?? formatRepo(r.canonical_url)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className={labelClass}>Branch</span>
        <select
          value={branch}
          onChange={(e) => set("branch", e.target.value || null)}
          className={inputClass}
          data-testid="filter-branch"
        >
          <option value="">All</option>
          {facets.data?.branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className={labelClass}>Agent</span>
        <select
          value={agent}
          onChange={(e) => set("agent", e.target.value || null)}
          className={inputClass}
          data-testid="filter-agent"
        >
          <option value="">All</option>
          {facets.data?.agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className={labelClass}>Model</span>
        <select
          value={model}
          onChange={(e) => set("model", e.target.value || null)}
          className={inputClass}
          data-testid="filter-model"
        >
          <option value="">All</option>
          {facets.data?.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className={labelClass}>Tag</span>
        <select
          value={tag}
          onChange={(e) => set("tag", e.target.value || null)}
          className={inputClass}
          data-testid="filter-tag"
          disabled={!facets.data?.tags.length}
        >
          <option value="">All</option>
          {facets.data?.tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className={labelClass}>Has PR</span>
        <div className="inline-flex" aria-label="Has PR">
          <SegmentButton active={hasPr === null} onClick={() => set("has_pr", null)}>
            Any
          </SegmentButton>
          <SegmentButton active={hasPr === "true"} onClick={() => set("has_pr", "true")}>
            Yes
          </SegmentButton>
          <SegmentButton active={hasPr === "false"} onClick={() => set("has_pr", "false")}>
            No
          </SegmentButton>
        </div>
      </div>

      <div>
        <span className={labelClass}>Since</span>
        <input
          type="date"
          value={sinceDate}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return set("since", null);
            // Persist as full ISO so the API's z.string().datetime() schema accepts it.
            set("since", new Date(`${v}T00:00:00Z`).toISOString());
          }}
          className={inputClass}
          data-testid="filter-since"
        />
      </div>

      {hasAny && (
        <button
          type="button"
          onClick={clearAll}
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground self-start mt-5"
          data-testid="filter-clear-all"
        >
          <X size={12} /> Clear filters
        </button>
      )}
    </div>
  );
};
