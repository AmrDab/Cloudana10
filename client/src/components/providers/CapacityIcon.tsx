import { cn } from "@/lib/utils";

type Props = { value: number; fontSize?: "small" | "medium" | "large" };

const sizeClass = { small: "w-4 h-2", medium: "w-5 h-2.5", large: "w-6 h-3" };

export function CapacityIcon({ value, fontSize = "medium" }: Props) {
  const pct = Math.max(0, Math.min(1, value));
  const fill = pct === 0 ? "bg-muted" : pct < 0.5 ? "bg-amber-500" : "bg-primary";
  return (
    <div
      className={cn("inline-flex rounded-sm overflow-hidden bg-muted/50 border border-border", sizeClass[fontSize])}
      title={`${Math.round(pct * 100)}%`}
    >
      <div className={cn("h-full transition-all", fill)} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}
