/**
 * Sortable table header + pagination footer for the Aviation Center tables.
 * Purely presentational — state lives in the parent via `useTableView`.
 */
import { TableHead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { ariaSort, PAGE_SIZES, type PageInfo, type SortState } from "@/lib/charter/tableView";

export function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort!.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={ariaSort(sort, sortKey)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? "text-primary" : "text-muted-foreground/60"}`} />
      </button>
    </TableHead>
  );
}

export function TablePagination({
  info,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label,
}: {
  info: PageInfo;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {info.total === 0 ? `No ${label}` : `${info.from}–${info.to} of ${info.total} ${label}`}
      </p>
      <div className="flex items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-[104px]" aria-label={`Rows per page for ${label}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s} / page</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          size="sm" variant="outline" className="h-8 px-2"
          disabled={info.page <= 1} onClick={() => onPageChange(info.page - 1)}
          aria-label={`Previous page of ${label}`}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          Page {info.page} / {info.pageCount}
        </span>
        <Button
          size="sm" variant="outline" className="h-8 px-2"
          disabled={info.page >= info.pageCount} onClick={() => onPageChange(info.page + 1)}
          aria-label={`Next page of ${label}`}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
