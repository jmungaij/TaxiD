/**
 * Logistics live transaction monitor + support lookup.
 *
 * Reads the authoritative operational tables directly under RLS (admin /
 * super_admin / operations_admin only), so an operator can answer "is the
 * lifecycle healthy?" and "what happened to this shipment?" without touching
 * the database.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, AlertTriangle } from "lucide-react";

interface OrderRow {
  id: string;
  order_number: string;
  module: string;
  status: string;
  payment_status: string;
  total_amount: number | null;
  created_at: string;
  sla_deadline: string | null;
  metadata: Record<string, unknown> | null;
}

interface Metric {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
  detail: string;
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

export function LogisticsLiveOps() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<{
    order: OrderRow | null;
    packages: { tracking_number: string; status: string; id: string }[];
    events: { event_type: string; notes: string | null; occurred_at: string }[];
    pod: number;
    dispatch: { status: string; assigned_driver_id: string | null; attempts: number }[];
  } | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data, error: err } = await supabase
      .from("delivery_orders")
      .select("id, order_number, module, status, payment_status, total_amount, created_at, sla_deadline, metadata")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (err) setError(err.message);
    setOrders((data as OrderRow[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo<Metric[]>(() => {
    const rows = orders ?? [];
    const total = rows.length;
    const paid = rows.filter((o) => o.payment_status === "paid").length;
    const pending = rows.filter((o) => o.payment_status === "pending").length;
    const delivered = rows.filter((o) => o.status === "delivered").length;
    const cancelled = rows.filter((o) => o.status === "cancelled").length;
    const failed = rows.filter((o) => o.status === "failed").length;
    const hold = rows.filter((o) => o.status === "compliance_review").length;
    const revenue = rows.filter((o) => o.payment_status === "paid").reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

    return [
      { label: "Bookings (30d)", value: String(total), tone: "neutral", detail: "Orders created through the booking spine." },
      {
        label: "Payment settled",
        value: pct(paid, total),
        tone: total === 0 ? "neutral" : paid / Math.max(total, 1) >= 0.9 ? "ok" : "warn",
        detail: `${paid} settled against the verified provider ledger, ${pending} awaiting confirmation.`,
      },
      {
        label: "Delivered",
        value: pct(delivered, total),
        tone: total === 0 ? "neutral" : "ok",
        detail: `${delivered} completed with proof of delivery where required.`,
      },
      {
        label: "Failure / cancel",
        value: pct(cancelled + failed, total),
        tone: failed > 0 ? "bad" : "neutral",
        detail: `${failed} creation failures, ${cancelled} cancellations, ${hold} on compliance hold.`,
      },
      {
        label: "Settled value",
        value: `KSh ${revenue.toLocaleString("en-KE")}`,
        tone: "neutral",
        detail: "Confirmed collections only — unpaid orders are excluded.",
      },
    ];
  }, [orders]);

  const search = useCallback(async () => {
    const q = query.trim().toUpperCase();
    if (q.length < 6) return;
    setSearching(true);
    setLookup(null);
    try {
      let orderId: string | null = null;
      let order: OrderRow | null = null;

      if (q.startsWith("YM")) {
        const { data: pkg } = await supabase.from("packages").select("order_id").eq("tracking_number", q).maybeSingle();
        orderId = (pkg as { order_id: string | null } | null)?.order_id ?? null;
      }
      const { data: ord } = orderId
        ? await supabase.from("delivery_orders").select("*").eq("id", orderId).maybeSingle()
        : await supabase.from("delivery_orders").select("*").eq("order_number", q).maybeSingle();
      order = (ord as OrderRow) ?? null;
      if (!order) {
        setLookup({ order: null, packages: [], events: [], pod: 0, dispatch: [] });
        return;
      }
      const { data: pkgs } = await supabase
        .from("packages")
        .select("id, tracking_number, status")
        .eq("order_id", order.id);
      const ids = (pkgs ?? []).map((p) => p.id);
      const { data: events } = ids.length
        ? await supabase
            .from("package_events")
            .select("event_type, notes, occurred_at")
            .in("package_id", ids)
            .order("occurred_at", { ascending: true })
            .limit(200)
        : { data: [] as never[] };
      const { count: pod } = ids.length
        ? await supabase.from("proof_of_delivery").select("id", { count: "exact", head: true }).in("package_id", ids)
        : { count: 0 };
      const { data: dispatch } = await supabase
        .from("delivery_dispatch_jobs")
        .select("status, assigned_driver_id, attempts")
        .eq("order_id", order.id);

      setLookup({
        order,
        packages: (pkgs as { id: string; tracking_number: string; status: string }[]) ?? [],
        events: (events as { event_type: string; notes: string | null; occurred_at: string }[]) ?? [],
        pod: pod ?? 0,
        dispatch: (dispatch as { status: string; assigned_driver_id: string | null; attempts: number }[]) ?? [],
      });
    } finally {
      setSearching(false);
    }
  }, [query]);

  const toneClass: Record<Metric["tone"], string> = {
    ok: "text-primary",
    warn: "text-accent-foreground",
    bad: "text-destructive",
    neutral: "text-foreground",
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Transaction lifecycle health (30 days)</CardTitle>
          <CardDescription>
            Booking → payment → dispatch → delivery, measured from the authoritative operational tables.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" /> {error}
            </p>
          )}
          {!orders ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {metrics.map((m) => (
                <div key={m.label} className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</p>
                  <p className={`mt-1 text-2xl font-semibold ${toneClass[m.tone]}`}>{m.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{m.detail}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shipment investigation</CardTitle>
          <CardDescription>Search by booking reference (ORD-…) or tracking number (YM…).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void search()}
              placeholder="ORD-AB12CD34EF or YM1A2B3C4D5E"
              aria-label="Booking reference or tracking number"
            />
            <Button onClick={() => void search()} disabled={searching || query.trim().length < 6}>
              <Search className="mr-2 h-4 w-4" /> Investigate
            </Button>
          </div>

          {lookup && !lookup.order && <p className="text-sm text-muted-foreground">No shipment matches that reference.</p>}

          {lookup?.order && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{lookup.order.order_number}</span>
                <Badge variant="outline">{lookup.order.status}</Badge>
                <Badge variant={lookup.order.payment_status === "paid" ? "default" : "secondary"}>
                  payment: {lookup.order.payment_status}
                </Badge>
                <Badge variant="outline">{String(lookup.order.metadata?.offering_code ?? lookup.order.module)}</Badge>
                <span className="text-sm text-muted-foreground">
                  KSh {Number(lookup.order.total_amount ?? 0).toLocaleString("en-KE")}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 text-sm">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Parcels</p>
                  {lookup.packages.map((p) => (
                    <p key={p.id} className="font-mono text-xs">
                      {p.tracking_number} · {p.status}
                    </p>
                  ))}
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Dispatch</p>
                  {lookup.dispatch.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No dispatch job</p>
                  ) : (
                    lookup.dispatch.map((d, i) => (
                      <p key={i} className="text-xs">
                        {d.status} · attempts {d.attempts} · {d.assigned_driver_id ? "assigned" : "unassigned"}
                      </p>
                    ))
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Proof of delivery</p>
                  <p className="text-xs">{lookup.pod > 0 ? `${lookup.pod} record(s) captured` : "Not captured"}</p>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs uppercase text-muted-foreground">Event history</p>
                <ol className="space-y-1">
                  {lookup.events.map((e, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-mono">{new Date(e.occurred_at).toLocaleString("en-KE")}</span> · {e.event_type}
                      {e.notes ? ` — ${e.notes}` : ""}
                    </li>
                  ))}
                  {lookup.events.length === 0 && <li className="text-xs text-muted-foreground">No events recorded.</li>}
                </ol>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default LogisticsLiveOps;
