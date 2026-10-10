// Single-choice control with radiogroup semantics: one tab stop, arrow keys move and select.
// "segmented" = joined hairline segments; "chips" = separate wrapping chips.
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = { value: T; label: string };

const ON_BG = "bg-[color-mix(in_srgb,var(--c-work)_10%,var(--c-panel))] text-work";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
  invalid,
  describedBy,
  size = "md",
  variant = "segmented",
  className,
}: {
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  /** Accessible name (or pass labelledBy). */
  label?: string;
  labelledBy?: string;
  invalid?: boolean;
  describedBy?: string;
  size?: "sm" | "md";
  variant?: "segmented" | "chips";
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = options.findIndex((o) => o.value === value);
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    let next = step ? (i + step + options.length) % options.length : -1;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = options.length - 1;
    if (e.key === " ") {
      e.preventDefault();
      onChange(options[i].value);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  const seg = variant === "segmented";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(
        seg
          ? "inline-flex max-w-full gap-px overflow-hidden rounded-lg border bg-line-2 transition-colors duration-250"
          : "flex flex-wrap gap-2",
        seg && (invalid ? "border-burn" : "border-line-2"),
        className,
      )}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (idx < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "font-mono text-xs whitespace-nowrap transition-colors duration-150 focus-visible:relative focus-visible:z-10",
              size === "md" ? "h-10 px-3" : "h-8 px-3",
              seg ? "flex-1 focus-visible:-outline-offset-2" : "rounded-md border",
              seg && !on && "bg-panel text-muted-foreground hover:text-text",
              !seg && !on && "border-line-2 text-muted-foreground hover:bg-text/[.03] hover:text-text",
              !seg && on && "border-work/60",
              !seg && invalid && !on && "border-burn",
              on && ON_BG,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Multi-select chips (toggle buttons). */
export function ToggleChips<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
}: {
  options: SegmentOption<T>[];
  value: T[];
  onChange: (v: T[]) => void;
  labelledBy?: string;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "h-8 rounded-md border px-3 font-mono text-xs whitespace-nowrap transition-colors duration-150",
              on ? cn("border-work/60", ON_BG) : "border-line-2 text-muted-foreground hover:bg-text/[.03] hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
