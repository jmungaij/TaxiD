/**
 * Charter table view model — deterministic column sorting + pagination shared
 * by the pricing audit and booking evidence tables in the Aviation Center.
 *
 * Pure functions so they can be unit tested without rendering a table.
 */
export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

export type SortAccessor<T> = (row: T) => string | number | null | undefined;

/** Cycle a header click: same column flips direction, new column starts ascending. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null; // third click clears sorting (back to source order)
}

/** Blank-aware comparison; blanks are reported separately so they can stay last. */
function compare(a: unknown, b: unknown): { blank: number | null; value: number } {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an || bn) return { blank: an && bn ? 0 : an ? 1 : -1, value: 0 };
  if (typeof a === "number" && typeof b === "number") return { blank: null, value: a - b };
  return {
    blank: null,
    value: String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }),
  };
}

export function sortRows<T>(
  rows: readonly T[],
  sort: SortState | null,
  accessors: Record<string, SortAccessor<T>>,
): T[] {
  if (!sort || !accessors[sort.key]) return [...rows];
  const get = accessors[sort.key];
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => {
    const c = compare(get(x), get(y));
    // Blanks are pinned to the bottom regardless of sort direction.
    return c.blank !== null ? c.blank : c.value * factor;
  });
}

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export interface PageInfo {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
}

/** Clamp the requested page and slice the rows for it. */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): { rows: T[]; info: PageInfo } {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (safePage - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return {
    rows: slice,
    info: {
      page: safePage,
      pageCount,
      total,
      from: total === 0 ? 0 : start + 1,
      to: start + slice.length,
    },
  };
}

/** aria-sort value for a table header cell. */
export const ariaSort = (sort: SortState | null, key: string): "ascending" | "descending" | "none" =>
  sort?.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
