// AI-generated. See PROMPT.md for the prompts and model used.

import { SlidersHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { type DropdownOption, FilterDropdown } from "./FilterDropdown";

export interface FilterBarFilter {
  testid: string;
  icon: ReactNode;
  allLabel: string;
  options: DropdownOption[];
  selected: string[];
  multiple?: boolean;
  onChange: (next: string[]) => void;
}

interface FilterBarProps {
  filters: FilterBarFilter[];
  testid?: string;
}

/**
 * Shared compact filter bar (label + dropdowns + clear). Each page supplies its
 * own filter definitions and option sources; this owns only the chrome so the
 * Home feed and repo view render identically without duplicating it.
 */
export const FilterBar = ({ filters, testid }: FilterBarProps) => {
  const activeCount = filters.filter((f) => f.selected.length > 0).length;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5"
      data-testid={testid}
    >
      <span className="flex items-center gap-1.5 pr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <SlidersHorizontal size={14} />
        Filters
        {activeCount > 0 && (
          <span className="ml-0.5 rounded-full bg-foreground px-1.5 text-[10px] leading-4 text-background">
            {activeCount}
          </span>
        )}
      </span>

      {filters.map((f) => (
        <FilterDropdown
          key={f.testid}
          testid={f.testid}
          icon={f.icon}
          allLabel={f.allLabel}
          options={f.options}
          selected={f.selected}
          multiple={f.multiple}
          onChange={f.onChange}
        />
      ))}

      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => {
            for (const f of filters) f.onChange([]);
          }}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          data-testid={testid ? `${testid}-clear` : "filter-clear"}
        >
          <X size={13} /> Clear
        </button>
      )}
    </div>
  );
};
