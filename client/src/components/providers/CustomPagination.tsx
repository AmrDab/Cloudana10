import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZES = [10, 20, 50] as const;

type Props = {
  pageIndex: number;
  totalPageCount: number;
  pageSize: number;
  setPageIndex: (page: number) => void;
  setPageSize: (size: number) => void;
};

export function CustomPagination({
  pageIndex,
  totalPageCount,
  pageSize,
  setPageIndex,
  setPageSize,
}: Props) {
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < totalPageCount - 1;

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 py-8">
      <div className="flex items-center gap-2">
        <Label className="text-muted-foreground text-sm">Rows per page</Label>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => setPageSize(Number(v))}
        >
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <span className="text-muted-foreground text-sm">
        Page {pageIndex + 1} of {totalPageCount || 1}
      </span>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              disabled={!canPrev}
              onClick={() => setPageIndex(pageIndex - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              disabled={!canNext}
              onClick={() => setPageIndex(pageIndex + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
