import { cn } from "@/lib/utils";
import { STATUS_LABEL, type ServiceStatus } from "@/lib/services";

/** Service status chip — data, not marketing (docs/V2_BRIEF.md §2.5). */
export function StatusChip({ status, className }: { status: ServiceStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] leading-5 tracking-wide whitespace-nowrap",
        status === "live" && "bg-ok text-bg",
        status === "early" && "border border-work/60 text-work",
        status === "planned" && "border border-line-2 text-muted-foreground",
        className,
      )}
    >
      {status === "live" && <span className="size-1.5 rounded-full bg-bg" aria-hidden />}
      {STATUS_LABEL[status]}
    </span>
  );
}
