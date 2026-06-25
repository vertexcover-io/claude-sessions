// AI-generated. See PROMPT.md for the prompts and model used.

import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/cn";

export interface DropdownOption {
  value: string;
  label: string;
  avatarUrl?: string | null;
  count?: number;
}

interface FilterDropdownProps {
  /** Leading glyph shown when no avatar applies (and as the "all" row icon). */
  icon: ReactNode;
  /** Row + reset label for the cleared state, e.g. "All repositories". */
  allLabel: string;
  options: DropdownOption[];
  /** Currently-selected values. Empty array means "all". */
  selected: string[];
  /** When true, rows toggle and the menu stays open so several can be picked. */
  multiple?: boolean;
  onChange: (next: string[]) => void;
  testid?: string;
}

const Avatar = ({ url }: { url: string }) => (
  <img src={url} alt="" className="h-4 w-4 shrink-0 rounded-full" width={16} height={16} />
);

/**
 * A small custom-styled dropdown (vs. a native <select>) so options can carry
 * avatars + counts and the menu inherits the app's dark surface, border, and
 * focus treatment. Single-select replaces and closes; multi-select toggles and
 * stays open, surfacing the chosen labels (and a count) in the trigger. Closes
 * on outside-click and Escape.
 */
export const FilterDropdown = ({
  icon,
  allLabel,
  options,
  selected,
  multiple = false,
  onChange,
  testid,
}: FilterDropdownProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const selectedOptions = options.filter((o) => selected.includes(o.value));
  const active = selected.length > 0;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    // Focus the first selected row so arrows/Tab land somewhere sensible.
    activeRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (v: string) => {
    if (multiple) {
      const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
      onChange(next);
      // Keep the menu open so the user can pick several values in a row.
    } else {
      onChange([v]);
      setOpen(false);
    }
  };

  const clearAll = () => {
    onChange([]);
    if (!multiple) setOpen(false);
  };

  // Trigger text: cleared → allLabel; one → its label; many → comma-joined.
  const triggerLabel =
    selectedOptions.length === 0 ? allLabel : selectedOptions.map((o) => o.label).join(", ");
  const singleSelected = selectedOptions.length === 1 ? selectedOptions[0] : undefined;
  const firstSelectedValue = selected[0];

  const Row = ({ opt }: { opt: DropdownOption | null }) => {
    const v = opt?.value;
    const isSel = opt ? selected.includes(opt.value) : selected.length === 0;
    // Anchor initial focus on the first selected row (or "all" when cleared).
    const isFocusAnchor = opt ? opt.value === firstSelectedValue : selected.length === 0;
    return (
      <button
        type="button"
        // biome-ignore lint/a11y/useSemanticElements: a native <option> can't render an avatar/count row; this is a custom listbox option.
        role="option"
        aria-selected={isSel}
        ref={isFocusAnchor ? activeRef : undefined}
        onClick={() => (opt ? toggle(opt.value) : clearAll())}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30",
          isSel ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted",
        )}
      >
        {opt?.avatarUrl ? (
          <Avatar url={opt.avatarUrl} />
        ) : (
          <span className="grid h-4 w-4 shrink-0 place-items-center text-muted-foreground/70">
            {icon}
          </span>
        )}
        <span className="flex-1 truncate">{opt ? opt.label : allLabel}</span>
        {typeof opt?.count === "number" && (
          <span className="rounded-full bg-muted px-1.5 text-[11px] leading-5 text-muted-foreground">
            {opt.count}
          </span>
        )}
        {isSel && <Check size={14} className="shrink-0 text-foreground" />}
        {!isSel && v !== undefined && <span className="w-3.5 shrink-0" aria-hidden />}
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        data-testid={testid}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-2 rounded-lg border py-1.5 pl-2.5 pr-2 text-sm transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30",
          active
            ? "border-foreground/25 bg-foreground/5 text-foreground"
            : "border-border bg-background text-muted-foreground hover:bg-muted",
        )}
      >
        <span className={cn("shrink-0", active ? "text-foreground" : "text-muted-foreground/70")}>
          {singleSelected?.avatarUrl ? <Avatar url={singleSelected.avatarUrl} /> : icon}
        </span>
        <span className="max-w-[12rem] truncate font-medium">{triggerLabel}</span>
        {selectedOptions.length > 1 && (
          <span className="shrink-0 rounded-full bg-foreground px-1.5 text-[10px] leading-4 text-background">
            {selectedOptions.length}
          </span>
        )}
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          id={menuId}
          // biome-ignore lint/a11y/useSemanticElements: custom listbox (rows carry avatars/counts); a native <select> can't render them.
          role="listbox"
          aria-multiselectable={multiple}
          tabIndex={-1}
          className="absolute left-0 z-30 mt-1.5 max-h-72 min-w-[14rem] overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          <Row opt={null} />
          {options.length > 0 && <div className="my-1 h-px bg-border" />}
          {options.map((o) => (
            <Row key={o.value} opt={o} />
          ))}
        </div>
      )}
    </div>
  );
};
