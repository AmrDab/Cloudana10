import { useEffect, useState, useMemo, type ChangeEventHandler } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Search, RefreshCw, X, ExternalLink } from "lucide-react";
import { useProviderList } from "@/hooks/useProviders";
import { useFavoriteProviders } from "@/hooks/useFavoriteProviders";
import type { ClientProviderList } from "@/lib/provider-types";
import { ProviderMap } from "@/components/providers/ProviderMap";
import { ProviderTable } from "@/components/providers/ProviderTable";
import { NetworkCapacity } from "@/components/providers/NetworkCapacity";
import { CheckboxWithLabel } from "@/components/providers/CheckboxWithLabel";
import { CustomPagination } from "@/components/providers/CustomPagination";

type SortId =
  | "active-leases-desc"
  | "active-leases-asc"
  | "my-leases-desc"
  | "my-active-leases-desc"
  | "gpu-available-desc";

const SORT_OPTIONS: { id: SortId; title: string }[] = [
  { id: "active-leases-desc", title: "Active Leases (desc)" },
  { id: "active-leases-asc", title: "Active Leases (asc)" },
  { id: "my-leases-desc", title: "Your Leases (desc)" },
  { id: "my-active-leases-desc", title: "Your Active Leases (desc)" },
  { id: "gpu-available-desc", title: "GPUs Available (desc)" },
];

export default function ProviderListPage() {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<SortId>("gpu-available-desc");
  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState(true);
  const [filterAudited, setFilterAudited] = useState(false);
  const [filterFavorites, setFilterFavorites] = useState(false);

  const { data: providers, isFetching: loading, refetch } = useProviderList();
  const { favoriteProviders } = useFavoriteProviders();

  const filtered = useMemo(() => {
    if (!providers) return [];
    let list = [...providers];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (x) =>
          x.hostUri?.toLowerCase().includes(q) ||
          x.owner?.toLowerCase().includes(q) ||
          (x.name ?? "").toLowerCase().includes(q)
      );
    }
    if (filterActive) list = list.filter((x) => x.isOnline);
    if (filterFavorites) list = list.filter((x) => favoriteProviders.includes(x.owner));
    if (filterAudited) list = list.filter((x) => x.isAudited);

    list.sort((a, b) => {
      if (sort === "gpu-available-desc") {
        const ga = a.availableStats.gpu + a.pendingStats.gpu + a.activeStats.gpu;
        const gb = b.availableStats.gpu + b.pendingStats.gpu + b.activeStats.gpu;
        return gb - ga;
      }
      if (sort === "name-asc") return (a.name || a.hostUri || "").localeCompare(b.name || b.hostUri || "");
      if (sort === "name-desc") return (b.name || b.hostUri || "").localeCompare(a.name || a.hostUri || "");
      if (sort === "region-asc") return (a.ipRegion || "").localeCompare(b.ipRegion || "");
      return 0;
    });

    return list;
  }, [providers, search, filterActive, filterAudited, filterFavorites, favoriteProviders, sort]);

  const start = pageIndex * pageSize;
  const pageProviders = filtered.slice(start, start + pageSize);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));

  const networkCapacity = useMemo(() => {
    if (!filtered.length) return null;
    let aCpu = 0,
      tCpu = 0,
      aGpu = 0,
      tGpu = 0,
      aMem = 0,
      tMem = 0,
      aStore = 0,
      tStore = 0;
    for (const p of filtered) {
      aCpu += (p.activeStats.cpu + p.pendingStats.cpu) / 1000;
      tCpu += (p.activeStats.cpu + p.pendingStats.cpu + p.availableStats.cpu) / 1000;
      aGpu += p.activeStats.gpu + p.pendingStats.gpu;
      tGpu += p.activeStats.gpu + p.pendingStats.gpu + p.availableStats.gpu;
      aMem += p.activeStats.memory + p.pendingStats.memory;
      tMem += p.activeStats.memory + p.pendingStats.memory + p.availableStats.memory;
      aStore += p.activeStats.storage + p.pendingStats.storage;
      tStore += p.activeStats.storage + p.pendingStats.storage + p.availableStats.storage;
    }
    if (tCpu + tGpu + tMem + tStore === 0) return null;
    return {
      activeCPU: aCpu,
      totalCPU: tCpu,
      activeGPU: aGpu,
      totalGPU: tGpu,
      activeMemory: aMem,
      totalMemory: tMem,
      activeStorage: aStore,
      totalStorage: tStore,
    };
  }, [filtered]);

  useEffect(() => {
    setPageIndex(0);
  }, [search, filterActive, filterAudited, filterFavorites, sort]);

  const onSearchChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setSearch(e.target.value);
    setPageIndex(0);
  };

  const handleSortChange = (v: string) => {
    setSort(v as SortId);
  };

  const activeCount = providers?.filter((x) => x.isOnline).length ?? 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Network Capacity</h1>
        {providers && providers.length > 0 && (
          <p className="mt-2 text-muted-foreground text-base">
            <span className="font-bold text-primary text-2xl">{activeCount}</span> active providers
          </p>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-10 w-10 text-primary" />
        </div>
      )}

      {providers && providers.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
          <div className="lg:col-span-2">
            {networkCapacity && (
              <NetworkCapacity
                activeCPU={networkCapacity.activeCPU}
                totalCPU={networkCapacity.totalCPU}
                activeGPU={networkCapacity.activeGPU}
                totalGPU={networkCapacity.totalGPU}
                activeMemory={networkCapacity.activeMemory}
                totalMemory={networkCapacity.totalMemory}
                activeStorage={networkCapacity.activeStorage}
                totalStorage={networkCapacity.totalStorage}
                compact
              />
            )}
          </div>
          <div className="lg:col-span-3">
            <ProviderMap providers={providers} />
          </div>
        </div>
      )}

      {providers && providers.length > 0 && (
        <>
          <div className="flex justify-end">
            <Link href="/provider/register">
              <Button
                variant="secondary"
                size="sm"
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Become a provider
              </Button>
            </Link>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-4 pt-4">
              <h2 className="text-2xl font-bold">Providers</h2>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => refetch()}
                aria-label="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <div className="flex flex-wrap items-center gap-6">
                <CheckboxWithLabel
                  checked={filterActive}
                  onCheckedChange={(v) => {
                    setFilterActive(v);
                    setPageIndex(0);
                  }}
                  label="Active"
                />
                <CheckboxWithLabel
                  checked={filterAudited}
                  onCheckedChange={(v) => {
                    setFilterAudited(v);
                    setPageIndex(0);
                  }}
                  label="Audited"
                />
                <CheckboxWithLabel
                  checked={filterFavorites}
                  onCheckedChange={(v) => {
                    setFilterFavorites(v);
                    setPageIndex(0);
                  }}
                  label="Favorites"
                />
              </div>
            </div>

            <div className="my-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={onSearchChange}
                  placeholder="Search providers"
                  className="pl-9"
                />
                {search && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                    onClick={() => {
                      setSearch("");
                      setPageIndex(0);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="flex min-w-[200px] items-end gap-2 sm:w-auto">
                <Label className="text-muted-foreground text-sm">Sort by</Label>
                <Select value={sort} onValueChange={handleSortChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {SORT_OPTIONS.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          <span className="text-muted-foreground text-sm">{o.title}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ProviderTable providers={pageProviders} sortOption={sort} />

            {pageProviders.length === 0 && (
              <div className="py-8 text-center text-muted-foreground">No provider found.</div>
            )}

            {filtered.length > 0 && (
              <CustomPagination
                pageIndex={pageIndex}
                totalPageCount={pageCount}
                pageSize={pageSize}
                setPageIndex={setPageIndex}
                setPageSize={(s) => {
                  setPageSize(s);
                  setPageIndex(0);
                }}
              />
            )}
          </div>
        </>
      )}

      {providers && providers.length === 0 && !loading && (
        <div className="py-12 text-center text-muted-foreground">No providers available.</div>
      )}
    </div>
  );
}
