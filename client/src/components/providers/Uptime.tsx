import { cn } from "@/lib/utils";

type Props = { value: number };

export function Uptime({ value }: Props) {
  return (
    <span
      className={cn(
        "text-sm font-medium",
        value > 0.95 ? "text-green-500" : value > 0.8 ? "text-amber-500" : "text-muted-foreground"
      )}
    >
      {new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 }).format(value)}
    </span>
  );
}
