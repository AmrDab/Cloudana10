import { cn } from "@/lib/utils";
import clsx from "clsx";

interface AvailabilityBarProps {
  available: number;
  total: number;
  className?: string;
  counts?: boolean;
}

export default function AvailabilityBar({
  available,
  total,
  className,
  counts,
}: AvailabilityBarProps) {
  const percentageFilled = Math.round(((total - available) / total) * 100);
  const availablePercentage = total > 0 ? ((available / total) * 100).toFixed(2) : "0";

  return (
    <div className={clsx("my-5 flex flex-col gap-1.5", className)}>
      {counts ? (
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold text-foreground md:text-sm lg:text-base">
            {available} Available
          </span>
          <span className="rounded border px-1.5 py-[1px] text-xs font-medium text-muted-foreground">
            Total: {total}
          </span>
        </div>
      ) : (
        <span className="text-lg font-semibold text-foreground md:text-sm lg:text-base">
          {percentageFilled}% Utilized
        </span>
      )}
      <div className="relative h-[3px] w-full rounded-full border border-border bg-secondary">
        <div
          className="absolute -top-[1px] bottom-[-1px] left-[-1px] bg-background"
          style={{
            width: `calc(${percentageFilled}% + 2px)`,
          }}
        >
          <div
            className={cn(
              "h-full rounded-l-full border border-primary bg-primary/40",
              percentageFilled === 100 ? "rounded-r-full" : "",
            )}
          />
        </div>
      </div>
    </div>
  );
}
