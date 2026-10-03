// Button looks for the site (docs/V2_BRIEF.md §1: 8px radius, hover brightens 8 %, no scale).
// Class strings, so they apply to <a>, <button> and wouter <Link> alike.
import { cn } from "@/lib/utils";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-head text-sm font-medium " +
  "transition-[filter,background-color,border-color,color] duration-150 ease-settle disabled:cursor-not-allowed disabled:opacity-50";

export const btn = {
  primary: (size: "md" | "sm" = "md", className?: string) =>
    cn(base, size === "md" ? "h-11 px-4" : "h-9 px-3", "bg-ok text-[#04201C] hover:brightness-[1.08]", className),
  ghost: (size: "md" | "sm" = "md", className?: string) =>
    cn(
      base,
      size === "md" ? "h-11 px-4" : "h-9 px-3",
      "border border-line-2 bg-white/[.02] text-text hover:border-faint hover:bg-white/[.05]",
      className,
    ),
  /** Text-only action: underline on hover only. */
  link: (className?: string) =>
    cn("inline-flex items-center gap-1.5 font-head text-sm font-medium text-ok underline-offset-4 hover:underline", className),
};

/** 12px uppercase mono label (+.08em). */
export const monoLabel = "font-mono text-xs uppercase tracking-[.08em] text-faint";
