import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { workspace360Path } from "@/lib/workspace360/links";

export interface RiderRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  phone_number: string | null;
  email: string | null;
  status: string | null;
  rider_tier: string | null;
  lifetime_trips: number | null;
  rating_avg: number | null;
}

export const riderName = (r: RiderRow) =>
  r.display_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";

export function RiderDirectoryTable({ rows, loading }: { rows: RiderRow[]; loading: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Rider</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Tier</TableHead>
          <TableHead className="text-right">Trips</TableHead>
          <TableHead className="text-right">Rating</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && (
          <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Loading…</TableCell></TableRow>
        )}
        {!loading && rows.length === 0 && (
          <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No riders.</TableCell></TableRow>
        )}
        {!loading && rows.map((r) => (
          <TableRow key={r.id} data-testid={`rider-row-${r.id}`}>
            <TableCell>
              <Link to={workspace360Path("rider", r.id)} className="font-medium hover:underline">
                {riderName(r)}
              </Link>
            </TableCell>
            <TableCell className="text-xs">
              {r.email ?? "—"}<br />{r.phone_number ?? "—"}
            </TableCell>
            <TableCell><Badge variant="outline">{r.status ?? "—"}</Badge></TableCell>
            <TableCell>{r.rider_tier ?? "—"}</TableCell>
            <TableCell className="text-right">{r.lifetime_trips ?? 0}</TableCell>
            <TableCell className="text-right">{Number(r.rating_avg ?? 0).toFixed(2)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export type ActivityColumn<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  /** Return a sortable primitive for this column. Omit to make the column non-sortable. */
  sortValue?: (row: T) => string | number | null | undefined;
};

export type ActivityTableProps<T> = {
  columns: ActivityColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  loadingMessage?: string;
};

export function ActivityTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyMessage = "No records.",
  loadingMessage = "Loading…",
}: ActivityTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    setSortKey(null); // third click clears sort
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, columns, sortKey, sortDir]);

  const statusMessage = loading
    ? loadingMessage
    : sortedRows.length === 0
      ? emptyMessage
      : `${sortedRows.length} row${sortedRows.length === 1 ? "" : "s"} shown${sortKey ? `, sorted by ${columns.find((c) => c.key === sortKey)?.header} ${sortDir === "asc" ? "ascending" : "descending"}` : ""}.`;

  return (
    <div>
      <div role="status" aria-live="polite" className="sr-only">{statusMessage}</div>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => {
              const sortable = !!c.sortValue;
              const isActive = sortKey === c.key;
              const Icon = !sortable ? null : !isActive ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
              const ariaSort: "ascending" | "descending" | "none" | undefined = !sortable
                ? undefined
                : !isActive ? "none" : sortDir === "asc" ? "ascending" : "descending";
              return (
                <TableHead
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={c.align === "right" ? "text-right" : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={`inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ${c.align === "right" ? "flex-row-reverse" : ""}`}
                      aria-label={
                        isActive
                          ? `Sort by ${c.header}, currently ${sortDir === "asc" ? "ascending" : "descending"}. Activate to ${sortDir === "asc" ? "sort descending" : "clear sorting"}.`
                          : `Sort by ${c.header}`
                      }
                    >
                      <span>{c.header}</span>
                      {Icon && <Icon className="h-3 w-3 opacity-70" aria-hidden="true" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
                  {loadingMessage}
                </span>
              </TableCell>
            </TableRow>
          )}
          {!loading && sortedRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
          {!loading && sortedRows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((c) => (
                <TableCell key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                  {c.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** CSV rows for operational reporting — one line per filtered rider. */
export function ridersToCsvRows(rows: RiderRow[]) {
  return rows.map((r) => ({
    rider_id: r.id,
    name: riderName(r),
    email: r.email ?? "",
    phone: r.phone_number ?? "",
    status: r.status ?? "",
    tier: r.rider_tier ?? "",
    lifetime_trips: r.lifetime_trips ?? 0,
    rating: Number(r.rating_avg ?? 0).toFixed(2),
  }));
}
