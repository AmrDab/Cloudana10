import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { Info, ArrowUpRight } from "lucide-react";
import GpuFilter, { defaultFilters, type Filters } from "@/components/pricing/GpuFilter";
import GpuSort from "@/components/pricing/GpuSort";
import GpuAvailability from "@/components/pricing/GpuAvailability";
import DesktopTableGpu from "@/components/pricing/DesktopTableGpu";
import AvailabilityBar from "@/components/pricing/AvailabilityBar";

const GPU_API_URL = "https://console-api.akash.network/v1/gpu-prices";

// Simulate exact browser request headers from successful browser call
const fetchWithBrowserHeaders = async (url: string) => {
  const userAgent = typeof navigator !== 'undefined' 
    ? navigator.userAgent 
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
  
  const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
  const chromeVersion = chromeMatch ? chromeMatch[1] : '144';
  const isMobile = typeof navigator !== 'undefined' && /Mobile|Android|iPhone/i.test(navigator.userAgent);
  const platform = typeof navigator !== 'undefined' ? navigator.platform : 'Windows';
  
  const headers: HeadersInit = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8,ko;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Cache-Control': 'max-age=0',
    'Priority': 'u=0, i',
    'Sec-CH-UA': `"Not(A:Brand";v="8", "Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}"`,
    'Sec-CH-UA-Mobile': isMobile ? '?1' : '?0',
    'Sec-CH-UA-Platform': `"${platform}"`,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': userAgent,
  };
  
  if (typeof window !== 'undefined' && window.location) {
    headers['Referer'] = window.location.origin + '/';
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      headers: headers,
      redirect: 'follow',
    });
    
    if (response.ok) {
      return await response.json();
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    if (error instanceof TypeError && (error.message.includes('CORS') || error.message.includes('Failed to fetch'))) {
      console.log('CORS error detected, trying XMLHttpRequest...');
      
      try {
        return await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.withCredentials = true;
          xhr.setRequestHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7');
          xhr.setRequestHeader('Accept-Language', 'en-US,en;q=0.9,ru;q=0.8,ko;q=0.7');
          xhr.setRequestHeader('Cache-Control', 'max-age=0');
          
          if (typeof window !== 'undefined' && window.location) {
            xhr.setRequestHeader('Referer', window.location.origin + '/');
          }
          
          xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                reject(new Error('Failed to parse JSON response'));
              }
            } else {
              reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
            }
          };
          
          xhr.onerror = function() {
            reject(new Error('Network error occurred'));
          };
          
          xhr.send();
        });
      } catch (xhrError) {
        console.log('XMLHttpRequest also failed, using CORS proxy...', xhrError);
      }
    } else {
      console.log('Direct fetch failed, trying CORS proxy...', error);
    }

    // Final fallback: Use CORS proxy service
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch GPU data via proxy: ${response.statusText}`);
    }

    return response.json();
  }
};

export interface Gpus {
  availability: { total: number; available: number };
  models: Array<{
    vendor: string;
    model: string;
    ram: string;
    interface: string;
    availability: { total: number; available: number };
    providerAvailability: { total: number; available: number };
    price?: {
      min?: number | null;
      max?: number | null;
      avg?: number | null;
      med?: number | null;
      weightedAverage?: number | null;
    } | null;
  }>;
  time?: number;
}

export const formatPrice = (price: number | null | undefined) => {
  return price != null && price > 0 ? `$${price.toFixed(2)}` : "--";
};

const modelTexts: Record<string, string> = {
  rtx: "RTX ",
  gtx: "GTX ",
  ti: " Ti",
  ada: " Ada",
};

const formatText = (model: string) => {
  let formattedText = model;
  for (const key in modelTexts) {
    const regex = new RegExp(key, "gi");
    formattedText = formattedText.replace(regex, modelTexts[key]);
  }
  return formattedText;
};

export const modifyModel = (model: string) => {
  return model === "rtxa6000" ? "A6000" : formatText(model);
};

export default function GpuPricingPage() {
  const { data, isLoading, error } = useQuery<{ data: Gpus }>({
    queryKey: ["GPU_TABLE"],
    queryFn: async () => {
      const result = await fetchWithBrowserHeaders(GPU_API_URL);
      return { data: result };
    },
    refetchInterval: 1000 * 60,
    refetchIntervalInBackground: true,
    retry: 2,
  });

  const gpuData = data?.data;
  const [filteredData, setFilteredData] = useState<Gpus["models"]>([]);
  const [filters, setFilters] = useState<Filters>(defaultFilters);

  // Initialize filtered data when data loads
  useEffect(() => {
    if (gpuData?.models) {
      // Get top models first (h200, h100, a100)
      const modelPriorities = ["h200", "h100", "a100"];
      const topModels = gpuData.models
        .filter((model) => modelPriorities.includes(model.model))
        .sort((a, b) => {
          const aIndex = modelPriorities.indexOf(a.model);
          const bIndex = modelPriorities.indexOf(b.model);
          if (aIndex !== bIndex) return aIndex - bIndex;
          return b.availability.available - a.availability.available;
        });
      
      const rest = gpuData.models
        .filter((model) => !modelPriorities.includes(model.model))
        .sort((a, b) => b.availability.available - a.availability.available);
      
      setFilteredData([...topModels, ...rest]);
    }
  }, [gpuData]);

  const totalGpus =
    filteredData?.length > 0
      ? filteredData.reduce((prev, curr) => prev + (curr?.availability?.total ?? 0), 0)
      : gpuData?.availability?.total || 0;

  const totalAvailableGpus =
    filteredData?.length > 0
      ? filteredData.reduce((prev, curr) => prev + (curr?.availability?.available ?? 0), 0)
      : gpuData?.availability?.available || 0;

  return (
    <div className="mx-auto flex w-full max-w-[1250px] flex-col gap-0 md:gap-4">
      {/* Desktop View - Full Features */}
      <div className="hidden flex-col gap-5 xl:flex">
        <GpuAvailability
          totalGpus={totalGpus}
          totalAvailableGpus={totalAvailableGpus}
          isLoading={isLoading || false}
          counts={true}
        />
        <GpuFilter
          filters={filters}
          setFilters={setFilters}
          setFilteredData={setFilteredData}
          res={gpuData}
        />
      </div>

      {/* Mobile View - Compact */}
      <div className="flex flex-col gap-1 xl:hidden">
        <p className="text-sm text-muted-foreground md:text-base">Total Available GPUs</p>
        <div className="my-2 flex justify-between">
          <Card className="px-2 py-1">
            <span className="font-bold text-foreground">
              {totalAvailableGpus || 0}{" "}
            </span>
            <span className="text-sm text-muted-foreground">
              (of {totalGpus || 0})
            </span>
          </Card>
          <div className="flex gap-1">
            <GpuFilter
              filters={filters}
              setFilters={setFilters}
              setFilteredData={setFilteredData}
              res={gpuData}
            />
            <GpuSort
              setFilteredData={setFilteredData}
              res={gpuData}
              filters={filters}
            />
          </div>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="flex w-full flex-col gap-4 md:hidden">
        {isLoading
          ? Array.from({ length: 10 }).map((_, index) => (
              <Card key={index} className="flex flex-col gap-5 rounded-xl p-3 shadow-sm">
                <div className="flex items-center gap-3 p-2">
                  <Skeleton className="h-5 w-5" />
                  <Skeleton className="h-5 w-20" />
                </div>
                <div className="h-px w-full bg-border"></div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-1">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                </div>
                <div className="h-px w-full bg-border"></div>
                <Skeleton className="h-10 w-full rounded-md" />
              </Card>
            ))
          : filteredData?.map((model, index) => (
              <Card key={index} className="my-2 flex w-full flex-col p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-md border p-[14px_10px]">
                    <img
                      src="/logos/nvidia.png"
                      alt="nvidia"
                      className="h-4 w-6"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-xl font-semibold capitalize text-foreground">
                      {modifyModel(model.model)}
                    </p>
                    <p className="text-sm font-medium text-muted-foreground">
                      {model.ram} {model.interface}
                    </p>
                  </div>
                </div>

                <AvailabilityBar
                  available={model.availability.available}
                  total={model.availability.total}
                  className="my-0 border-y py-5"
                  counts={true}
                />

                <div className="flex flex-col justify-center gap-1 border-b pb-6 pt-2">
                  <div className="flex justify-between border-b pb-1.5 text-lg">
                    <span className="text-lg font-semibold md:text-base">Average price:</span>
                    <span className="font-semibold">
                      {formatPrice(model.price?.weightedAverage)}
                    </span>
                  </div>
                  <HoverCard openDelay={200} closeDelay={200}>
                    <HoverCardTrigger className="flex items-center justify-between pt-1.5">
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-sm font-medium text-muted-foreground">
                          Min: {formatPrice(model.price?.min)}
                        </span>
                        <span className="text-sm font-medium text-muted-foreground">-</span>
                        <span className="text-sm font-medium text-muted-foreground">
                          Max: {formatPrice(model.price?.max)}
                        </span>
                      </div>
                      <Info size={12} className="text-muted-foreground" />
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
                              <p className="text-base font-semibold text-foreground">Avg price:</p>
                              <div className="text-base font-bold">
                                {formatPrice(model.price?.weightedAverage)}/hr
                              </div>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <div className="flex flex-col items-center justify-center gap-1">
                                <h3 className="text-sm text-muted-foreground">
                                  Max: <span>{formatPrice(model.price?.max)}/hr</span>
                                </h3>
                              </div>
                              <div>-</div>
                              <div className="flex flex-col items-center justify-center gap-1">
                                <h3 className="text-sm text-muted-foreground">
                                  Min: <span>{formatPrice(model.price?.min)}/hr</span>
                                </h3>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                </div>
                <div className="flex flex-col justify-center gap-2 pt-6">
                  <Link href="/user#deployments">
                    <Button
                      className="inline-flex w-full justify-center gap-1.5 rounded-md bg-primary py-3 text-white"
                    >
                      <p className="text-sm font-medium text-inherit">Rent Now</p>
                      <ArrowUpRight className="h-[15px] w-[15px]" />
                    </Button>
                  </Link>
                  <Link href="/pricing/gpus-on-demand">
                    <Button
                      variant="secondary"
                      className="inline-flex w-full justify-center gap-1.5 rounded-md border py-3 text-sm font-medium"
                    >
                      Get Custom Quote
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}
      </div>

      {/* Desktop Table View */}
      <DesktopTableGpu
        isLoading={isLoading || false}
        filteredData={filteredData}
        counts={true}
      />

      {error && (
        <Card className="p-8 text-center">
          <p className="text-destructive mb-2">Failed to load GPU data.</p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Please try again later."}
          </p>
        </Card>
      )}

      {!isLoading && !error && (!gpuData?.models || gpuData.models.length === 0) && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No GPU data available at this time.</p>
        </Card>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        *Disclaimer: The pricing displayed is determined by a dynamic bidding engine, where providers compete to offer their compute resources. These prices offer transparency and insight into the spectrum of pricing options available within the marketplace. Please be aware that the prices displayed are subject to change based on real-time market conditions and individual provider offerings.
      </p>
    </div>
  );
}
