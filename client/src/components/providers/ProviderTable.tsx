import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ClientProviderList } from "@/lib/provider-types";
import { ProviderTableRow } from "./ProviderTableRow";

type Props = {
  providers: ClientProviderList[];
  sortOption: string;
};

const SORT_GPU = "gpu-available-desc";

export function ProviderTable({ providers, sortOption }: Props) {
  const isSortingGpu = sortOption === SORT_GPU;

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-white/10 hover:bg-transparent">
          <TableHead className="w-[12%] font-medium text-muted-foreground">Name</TableHead>
          <TableHead className="w-[12%] text-center font-medium text-muted-foreground">
            Location
          </TableHead>
          <TableHead className="w-[8%] text-center font-medium text-muted-foreground">
            Uptime (7d)
          </TableHead>
          <TableHead className="w-[15%] font-medium text-muted-foreground">CPU</TableHead>
          <TableHead
            className={cn(
              "w-[15%] font-medium text-muted-foreground",
              isSortingGpu && "font-bold text-primary"
            )}
          >
            GPU
          </TableHead>
          <TableHead className="w-[15%] font-medium text-muted-foreground">Memory</TableHead>
          <TableHead className="w-[15%] font-medium text-muted-foreground">Disk</TableHead>
          <TableHead className="w-[8%] text-center font-medium text-muted-foreground">Audited</TableHead>
          <TableHead className="w-[10%] text-center font-medium text-muted-foreground">
            Favorite
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {providers.map((p) => (
          <ProviderTableRow key={p.owner} provider={p} />
        ))}
      </TableBody>
    </Table>
  );
}
