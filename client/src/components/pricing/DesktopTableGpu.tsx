import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import AvailabilityBar from "./AvailabilityBar";
import type { Gpus } from "@/pages/pricing/gpus";
import { modifyModel, formatPrice } from "@/pages/pricing/gpus";

interface DesktopTableGpuProps {
  isLoading: boolean;
  filteredData: Gpus["models"];
  counts?: boolean;
}

export default function DesktopTableGpu({
  isLoading,
  filteredData,
  counts,
}: DesktopTableGpuProps) {
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);

  return (
    <div className="hidden w-full overflow-x-auto md:block">
      <table className="w-full border-separate border-spacing-y-3" cellSpacing={0}>
        <thead>
          <tr className="w-full">
            <th className="w-[22%] text-left text-sm font-medium tracking-normal text-muted-foreground">
              GPU Model
            </th>
            <th className="w-[30%] text-left text-sm font-medium tracking-normal text-muted-foreground">
              Utilization
            </th>
            <th className="w-[16%] whitespace-nowrap text-left text-sm font-medium tracking-normal text-muted-foreground">
              Price Range
            </th>
            <th className="w-[13%] whitespace-nowrap text-left text-sm font-medium tracking-normal text-muted-foreground">
              <p className="relative w-min">
                Avg. Price
                <span className="absolute left-full ml-1"> per hour</span>
              </p>
            </th>
            <th className="w-[10%]"></th>
          </tr>
        </thead>
        <tbody className="mt-1">
          {isLoading
            ? Array.from({ length: 10 }).map((_, index) => (
                <tr
                  key={index}
                  className="overflow-hidden rounded-lg border-none bg-card shadow-sm outline-none"
                >
                  <td className="rounded-l-lg border-y border-l border-r text-base font-semibold xl:text-lg">
                    <div className="flex items-center gap-4">
                      <div className="ml-3 flex aspect-square w-11 items-center justify-center rounded-md border">
                        <Skeleton className="h-4 w-6" />
                      </div>
                      <div className="flex flex-1 flex-col gap-1">
                        <Skeleton className="h-6 w-32 lg:h-7 lg:w-40" />
                        <div className="flex gap-1">
                          <Skeleton className="h-5 w-14 rounded border" />
                          <Skeleton className="h-5 w-14 rounded border" />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="border-y border-r px-2 xl:px-6">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-5 w-16" />
                        <Skeleton className="h-5 w-16" />
                      </div>
                      <Skeleton className="h-4 w-full rounded-full" />
                    </div>
                  </td>
                  <td className="border-y border-r p-0">
                    <div className="flex h-full flex-col divide-y divide-border">
                      <div className="h-full py-2 text-center">
                        <Skeleton className="mx-auto h-5 w-24" />
                      </div>
                      <div className="py-2 text-center">
                        <Skeleton className="mx-auto h-5 w-24" />
                      </div>
                    </div>
                  </td>
                  <td className="border-y border-r px-4">
                    <div className="relative flex items-center justify-center gap-1 py-2">
                      <Skeleton className="h-7 w-20" />
                      <Skeleton className="absolute -right-2 -top-2 h-4 w-4 rounded-full" />
                    </div>
                  </td>
                  <td className="rounded-r-lg border-y border-r px-2 text-center xl:px-4">
                    <div className="flex items-center justify-center">
                      <Skeleton className="h-6 w-24 rounded-md" />
                    </div>
                  </td>
                </tr>
              ))
            : filteredData?.map((model, index) => (
                <tr
                  key={index}
                  className="overflow-hidden rounded-lg border-none bg-card shadow-sm outline-none transition-all"
                  onMouseEnter={() => setHoveredRowIndex(index)}
                  onMouseLeave={() => setHoveredRowIndex(null)}
                >
                  <td className="rounded-l-lg border-y border-l border-r text-base font-semibold xl:text-lg">
                    <div className="flex items-end gap-3">
                      <div className="ml-3 flex aspect-square size-11 items-center justify-center rounded-md border">
                        <img
                          src="/logos/nvidia.png"
                          alt="nvidia"
                          className="h-4 w-6"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                      <div className="flex flex-1 flex-col gap-1">
                        <p className="text-base font-semibold capitalize leading-[1.1] text-foreground">
                          {modifyModel(model.model)}
                        </p>
                        <div className="flex gap-1">
                          <p className="rounded border px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                            {model.ram}
                          </p>
                          <p className="rounded border px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                            {model.interface}
                          </p>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="border-y border-r px-2 xl:px-6">
                    <AvailabilityBar
                      available={model.availability.available}
                      total={model.availability.total}
                      counts={counts}
                    />
                  </td>
                  <td className="border-y border-r p-0">
                    <div className="flex h-full flex-col divide-y divide-border">
                      <p className="h-full py-2 text-center text-sm text-muted-foreground">
                        Min: <span className="ml-1 font-medium">{formatPrice(model.price.min)}</span>
                      </p>
                      <p className="py-2 text-center text-sm text-muted-foreground">
                        Max: <span className="ml-1 font-medium">{formatPrice(model.price.max)}</span>
                      </p>
                    </div>
                  </td>
                  <td className="border-y border-r px-4">
                    <HoverCard openDelay={200} closeDelay={200}>
                      <HoverCardTrigger className="relative flex items-center justify-center gap-1 py-2 text-base">
                        <span className="text-lg font-semibold">
                          {formatPrice(model.price.weightedAverage)}
                        </span>
                        <Info
                          size={16}
                          className="absolute -right-2 -top-2 text-muted-foreground"
                        />
                      </HoverCardTrigger>
                      <HoverCardContent align="center">
                        <div className="flex flex-col">
                          <div className="flex flex-col px-4 py-3">
                            <h2 className="text-sm font-medium">
                              {model.providerAvailability?.available || 0}{" "}
                              {model.providerAvailability?.available !== 1 ? "providers" : "provider"}
                              <br />
                              offering this model:
                            </h2>
                            <div className="mt-3 rounded-md border bg-muted px-4 py-3">
                              <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
                                <p className="text-base font-semibold">Avg price:</p>
                                <div className="text-base font-bold">
                                  {formatPrice(model.price.weightedAverage)}/hr
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <div className="flex flex-col items-center justify-center gap-1">
                                  <h3 className="text-sm text-muted-foreground">
                                    Max: <span>{formatPrice(model.price.max)}/hr</span>
                                  </h3>
                                </div>
                                <div>-</div>
                                <div className="flex flex-col items-center justify-center gap-1">
                                  <h3 className="text-sm text-muted-foreground">
                                    Min: <span>{formatPrice(model.price.min)}/hr</span>
                                  </h3>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  </td>
                  <td className="rounded-r-lg border-y border-r px-2 py-3 text-center xl:px-4">
                    <div className="flex flex-col gap-2">
                      <Link href="/user#deployments">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex h-auto w-full items-center gap-1.5 rounded-md px-2 py-[2px] text-xs font-medium md:px-2 lg:px-3"
                        >
                          <span className="whitespace-nowrap text-xs">Rent Now</span>
                          <ArrowUpRight className="h-[15px] w-[15px]" />
                        </Button>
                      </Link>
                      <Link href="/pricing/gpus-on-demand">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex h-auto w-full items-center gap-1.5 rounded-md px-2 py-[2px] text-xs font-medium md:px-2 lg:px-3"
                        >
                          <span className="whitespace-nowrap text-xs">Get Custom Quote</span>
                        </Button>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
