/**
 * Charter operations analytics.
 *
 * Booking volumes by date and route, payment reconciliation rates and the most
 * common incident signals, resolved per asset domain so aviation, road and
 * marine performance can be read separately.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { charterApi, type CharterBookingRow } from "@/lib/charter/api";
import { DOMAIN_LEXICONS, resolveAssetDomain, type AssetDomainId } from "@/lib/charter/assetDomains";

const money = (n: number, ccy = "KES") =>
  `${ccy === "KES" ? "KSh" : ccy} ${new Intl.NumberFormat("en-KE").format(Math.round(n || 0))}`;

const PAID = new Set(["paid", "settled", "authorized"]);

export default function CharterAnalytics() {
  const [rows, setRows] = useState<CharterBookingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await charterApi.listBookings());
    } catch (e) {
      toast({
        title: "Could not load charter analytics",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(() => {
    const byDate = new Map<string, number>();
    const byRoute = new Map<string, { count: number; value: number }>();
    const byDomain = new Map<string, { count: number; paid: number; value: number }>();
    const incidents = new Map<string, number>();
    let paid = 0;
    let value = 0;

    rows.forEach((r) => {
      const day = (r.created_at ?? "").slice(0, 10) || "—";
      byDate.set(day, (byDate.get(day) ?? 0) + 1);

      const trip = (r.trip ?? {}) as Record<string, string>;
      const route = `${trip.origin ?? "—"} → ${trip.destination ?? "—"}`;
      const cur = byRoute.get(route) ?? { count: 0, value: 0 };
      byRoute.set(route, { count: cur.count + 1, value: cur.value + (r.amount || 0) });

      const dom = resolveAssetDomain(r.category_slug);
      const d = byDomain.get(dom) ?? { count: 0, paid: 0, value: 0 };
      const isPaid = PAID.has(r.payment_status);
      byDomain.set(dom, { count: d.count + 1, paid: d.paid + (isPaid ? 1 : 0), value: d.value + (r.amount || 0) });

      if (isPaid) paid += 1;
      value += r.amount || 0;

      (r.flight_events ?? []).forEach((e) => {
        if (e.reason_code) incidents.set(e.reason_code, (incidents.get(e.reason_code) ?? 0) + 1);
      });
      if (r.flight_status === "cancelled") incidents.set("cancelled", (incidents.get("cancelled") ?? 0) + 1);
    });

    const sortDesc = <T,>(m: Map<string, T>, key: (v: T) => number) =>
      [...m.entries()].sort((a, b) => key(b[1]) - key(a[1]));

    return {
      total: rows.length,
      paid,
      reconciliationRate: rows.length ? Math.round((paid / rows.length) * 100) : 0,
      value,
      dates: [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14),
      routes: sortDesc(byRoute, (v) => v.count).slice(0, 8),
      domains: sortDesc(byDomain, (v) => v.count),
      incidents: sortDesc(incidents, (v) => v).slice(0, 8),
    };
  }, [rows]);

  const maxDay = Math.max(1, ...stats.dates.map(([, n]) => n));

  return (
    <div className="container mx-auto space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Charter operations analytics</h1>
          <p className="text-sm text-muted-foreground">
            Volumes by date and route, reconciliation health and recurring incident signals.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Bookings" value={String(stats.total)} />
        <Stat label="Reconciled payments" value={`${stats.reconciliationRate}%`} hint={`${stats.paid} of ${stats.total}`} />
        <Stat label="Booked value" value={money(stats.value)} />
        <Stat label="Incident signals" value={String(stats.incidents.reduce((a, [, n]) => a + n, 0))} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Booking volume by date</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.dates.map(([day, n]) => (
              <div key={day} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{day}</span>
                <div className="h-2 flex-1 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(n / maxDay) * 100}%` }} />
                </div>
                <span className="w-8 text-right text-xs tabular-nums">{n}</span>
              </div>
            ))}
            {stats.dates.length === 0 && <p className="text-sm text-muted-foreground">No bookings recorded yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top routes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.routes.map(([route, v]) => (
              <div key={route} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-2 text-sm">
                <span className="truncate">{route}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {v.count} · {money(v.value)}
                </span>
              </div>
            ))}
            {stats.routes.length === 0 && <p className="text-sm text-muted-foreground">No routes yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Performance by product domain</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.domains.map(([dom, v]) => {
              const lex = DOMAIN_LEXICONS[dom as AssetDomainId];
              return (
                <div key={dom} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-2 text-sm">
                  <span>
                    {lex.brandEmoji} {lex.brandName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {v.count} bookings · {v.count ? Math.round((v.paid / v.count) * 100) : 0}% reconciled · {money(v.value)}
                  </span>
                </div>
              );
            })}
            {stats.domains.length === 0 && <p className="text-sm text-muted-foreground">No product activity yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Common incident signals</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {stats.incidents.map(([code, n]) => (
              <Badge key={code} variant="outline">
                {code.replace(/_/g, " ")} · {n}
              </Badge>
            ))}
            {stats.incidents.length === 0 && <p className="text-sm text-muted-foreground">No incidents recorded.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
