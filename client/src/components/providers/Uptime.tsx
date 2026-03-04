import { cn } from "@/lib/utils";

type Props = { value: number; showPeriod?: boolean };

export function Uptime({ value, showPeriod = true }: Props) {
  const pct = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 }).format(value);
  return (
    <span
      className={cn(
        "text-sm font-medium",
        value > 0.95 ? "text-green-500" : value > 0.8 ? "text-amber-500" : "text-muted-foreground"
      )}
      title={showPeriod ? "Uptime over the last 7 days" : undefined}
    >
      {pct}{showPeriod ? " (7d)" : ""}
    </span>
  );
}
