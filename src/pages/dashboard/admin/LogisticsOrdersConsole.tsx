import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Layers, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import OrderIdFilter from "@/components/logistics/orders/OrderIdFilter";
import BulkActivityDialog from "@/components/logistics/orders/BulkActivityDialog";
import DispatchPlanner from "@/components/logistics/orders/DispatchPlanner";
import {
  activityLabel, EMPTY_ACTIVITY_MODEL, loadActivityModel, type ActivityModel,
} from "@/lib/logistics/orders/activityModel";
import { formatOpsTime } from "@/lib/logistics/orders/schedule";

interface OrderRow {
  id: string;
  order_number: string;
  module: string;
  status: string;
  payment_status: string;
  pickup_address: string;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  sla_deadline: string | null;
  total_amount: number | null;
  currency: string;
  created_at: string;
}

interface PackageRow {
  order_id: string;
  dropoff_address: string | null;
  assigned_driver_id: string | null;
  status: string;
}

const PAGE_SIZE = 25;

/**
 * Dispatch Orders Console — the operational surface over `delivery_orders`.
 * Every control here executes a server RPC: nothing mutates state client-side.
 */
export default function LogisticsOrdersConsole() {
  const [model, setModel] = useState<ActivityModel>(EMPTY_ACTIVITY_MODEL);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [packages, setPackages] = useState<Record<string, PackageRow[]>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => {
    loadActivityModel()
      .then(setModel)
      .catch((e: Error) => setError(e.message));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let query = supabase
      .from("delivery_orders")
      .select(
        "id,order_number,module,status,payment_status,pickup_address,pickup_window_start,pickup_window_end,sla_deadline,total_amount,currency,created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (ids.length > 0) query = query.in("order_number", ids); // parameterised, never string-built
    if (activityFilter !== "all") query = query.eq("status", activityFilter);

    const { data, error: err, count } = await query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (err) {
      setLoading(false);
      setError(err.message);
      return;
    }
    const list = (data ?? []) as OrderRow[];
    setRows(list);
    setTotal(count ?? list.length);
    setUnmatched(ids.filter((id) => !list.some((r) => r.order_number === id)));

    if (list.length) {
      const { data: pkgs } = await supabase
        .from("packages")
        .select("order_id,dropoff_address,assigned_driver_id,status")
        .in("order_id", list.map((r) => r.id));
      const grouped: Record<string, PackageRow[]> = {};
      for (const p of (pkgs ?? []) as PackageRow[]) {
        (grouped[p.order_id] ??= []).push(p);
      }
      setPackages(grouped);
    } else {
      setPackages({});
    }
    setLoading(false);
  }, [ids, activityFilter, page]);

  useEffect(() => { load(); }, [load]);

  const selectedOrders = useMemo(
    () => rows.filter((r) => selected[r.id]).map((r) => ({ id: r.id, order_number: r.order_number, status: r.status })),
    [rows, selected],
  );
  const allOnPage = rows.length > 0 && rows.every((r) => selected[r.id]);

  return (
    <div className="container mx-auto space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dispatch Orders Console</h1>
          <p className="text-sm text-muted-foreground">
            Bulk activity control, batch scanning and pickup planning over live logistics orders.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      <Tabs defaultValue="orders" className="space-y-4">
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="planner">Pickup planner</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
          <OrderIdFilter
            ids={ids}
            unmatched={unmatched}
            onChange={(next) => { setIds(next); setPage(0); }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Select value={activityFilter} onValueChange={(v) => { setActivityFilter(v); setPage(0); }}>
              <SelectTrigger className="w-52"><SelectValue placeholder="All activities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All activities</SelectItem>
                {model.activities.map((a) => (
                  <SelectItem key={a.code} value={a.code}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-[11px]">{total} order{total === 1 ? "" : "s"}</Badge>

            {selectedOrders.length > 0 && (
              <div className="ms-auto flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5">
                <span className="text-xs font-medium">{selectedOrders.length} selected</span>
                <Button size="sm" onClick={() => setBulkOpen(true)}>
                  <Layers className="mr-1 h-3.5 w-3.5" /> Update Activity · {selectedOrders.length} orders
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected({})}>Clear</Button>
              </div>
            )}
          </div>

          {error && (
            <Card className="flex items-center gap-2 border-status-danger/40 p-4 text-sm text-status-danger">
              <AlertTriangle className="h-4 w-4" /> {error}
              <Button size="sm" variant="outline" className="ms-auto" onClick={load}>Retry</Button>
            </Card>
          )}

          <Card className="overflow-x-auto border-border/70">
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">Logistics orders</caption>
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 p-3">
                    <Checkbox
                      aria-label="Select all on this page"
                      checked={allOnPage}
                      onCheckedChange={(v) =>
                        setSelected((prev) => {
                          const next = { ...prev };
                          for (const r of rows) { if (v) next[r.id] = true; else delete next[r.id]; }
                          return next;
                        })
                      }
                    />
                  </th>
                  <th className="p-3 text-left">Order</th>
                  <th className="p-3 text-left">Route</th>
                  <th className="p-3 text-left">Activity</th>
                  <th className="p-3 text-left">Driver</th>
                  <th className="p-3 text-left">Scheduled</th>
                  <th className="p-3 text-left">Exception</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}><td colSpan={7} className="p-3"><Skeleton className="h-6 w-full" /></td></tr>
                  ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-sm text-muted-foreground">
                      No orders match the current filters.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const pkgs = packages[r.id] ?? [];
                  const exception = pkgs.some((p) => p.status === "failed") || r.status === "failed";
                  return (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="p-3">
                        <Checkbox
                          aria-label={`Select ${r.order_number}`}
                          checked={!!selected[r.id]}
                          onCheckedChange={(v) =>
                            setSelected((prev) => {
                              const next = { ...prev };
                              if (v) next[r.id] = true; else delete next[r.id];
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="p-3">
                        <div className="font-mono text-xs">{r.order_number}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.module} · {r.currency} {r.total_amount ?? 0} · {r.payment_status}
                        </div>
                      </td>
                      <td className="max-w-[16rem] p-3 text-xs">
                        <div className="truncate">{r.pickup_address}</div>
                        <div className="truncate text-muted-foreground">
                          → {pkgs[0]?.dropoff_address ?? "—"}
                          {pkgs.length > 1 && ` (+${pkgs.length - 1})`}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-[11px]">{activityLabel(model, r.status)}</Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {pkgs.find((p) => p.assigned_driver_id) ? "Assigned" : "Unassigned"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{formatOpsTime(r.pickup_window_start)}</td>
                      <td className="p-3 text-xs">
                        {exception ? (
                          <Badge variant="outline" className="border-status-danger/50 text-[11px] text-status-danger">
                            Exception
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="planner">
          <DispatchPlanner
            // Terminal orders cannot be rescheduled server-side, so the planner
            // never offers them as draggable — no dead interaction.
            orders={rows
              .filter((r) => !["delivered", "cancelled", "closed", "returned"].includes(r.status))
              .map((r) => ({
                id: r.id,
                order_number: r.order_number,
                status: r.status,
                pickup_address: r.pickup_address,
                pickup_window_start: r.pickup_window_start,
                pickup_window_end: r.pickup_window_end,
              }))}
            onChanged={load}
          />
        </TabsContent>
      </Tabs>

      <BulkActivityDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        orders={selectedOrders}
        model={model}
        onCompleted={() => { setSelected({}); load(); toast.info("Orders reloaded from the server."); }}
      />
    </div>
  );
}
