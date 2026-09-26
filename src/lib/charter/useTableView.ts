/**
 * Sort + pagination state for a charter table. Keeps the page in range when
 * filters shrink the result set and resets to page 1 when sorting changes.
 */
import { useEffect, useMemo, useState } from "react";
import {
  nextSort, paginate, sortRows,
  type PageInfo, type SortAccessor, type SortState,
} from "@/lib/charter/tableView";

export function useTableView<T>(
  rows: readonly T[],
  accessors: Record<string, SortAccessor<T>>,
  initialPageSize = 25,
) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const sorted = useMemo(() => sortRows(rows, sort, accessors), [rows, sort, accessors]);
  const { rows: pageRows, info } = useMemo(() => paginate(sorted, page, pageSize), [sorted, page, pageSize]);

  // Keep the visible page valid when filters/sorting change the row count.
  useEffect(() => { if (page !== info.page) setPage(info.page); }, [info.page, page]);

  const toggleSort = (key: string) => {
    setSort((cur) => nextSort(cur, key));
    setPage(1);
  };

  return {
    rows: pageRows,
    info: info as PageInfo,
    sort,
    toggleSort,
    page: info.page,
    setPage,
    pageSize,
    setPageSize: (n: number) => { setPageSize(n); setPage(1); },
  };
}
