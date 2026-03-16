import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Link } from "wouter";

interface GpuAvailabilityProps {
  totalGpus: number;
  totalAvailableGpus: number;
  isLoading: boolean;
  counts?: boolean;
}

export default function GpuAvailability({
  totalGpus,
  totalAvailableGpus,
  isLoading,
  counts,
}: GpuAvailabilityProps) {
  const usedGpus = totalGpus - totalAvailableGpus;
  const usedPercentage = totalGpus > 0 ? ((usedGpus / totalGpus) * 100).toFixed(2) : "0";
  const availablePercentage = totalGpus > 0 ? ((totalAvailableGpus / totalGpus) * 100).toFixed(2) : "0";

  return (
    <div className="flex flex-col gap-3">
      {isLoading ? (
        <Skeleton className="h-9 w-64" />
      ) : (
        <div className="flex flex-col">
          <h1 className="text-2xl font-semibold">GPU Pricing and Availability</h1>
          <p className="text-sm text-muted-foreground">
            We can access as many GPUs as you need.{" "}
            <Link href="/pricing/gpus-on-demand" className="text-primary underline hover:text-primary/80">
              Get a Custom Quote
            </Link>
            !
          </p>
        </div>
      )}
      <div className="flex gap-1">
        {isLoading ? (
          <>
            {counts && <Skeleton className="h-8 w-32 rounded-full" />}
            <Skeleton className="h-8 w-64 rounded-full" />
          </>
        ) : (
          <>
            {counts && (
              <Card className="flex items-center gap-1.5 rounded-full border px-4 py-1">
                <p className="text-xs font-medium text-muted-foreground">Total GPUs:</p>
                <p className="text-sm font-semibold text-foreground">{totalGpus}</p>
              </Card>
            )}
            <Card className="flex items-center gap-1.5 rounded-full border px-4 py-1">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">Available GPUs:</p>
                <p className="text-sm font-semibold text-foreground">
                  {totalAvailableGpus > 0 ? availablePercentage : 0}%
                </p>
              </div>
              <div className="h-full w-[1.5px] bg-border" />
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">Used:</p>
                <p className="text-sm font-semibold text-foreground">
                  {totalGpus > 0 ? usedPercentage : 0}%
                </p>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
