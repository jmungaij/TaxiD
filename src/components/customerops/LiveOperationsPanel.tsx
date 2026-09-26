/**
 * Customer Operations — Live Operations Map panel.
 *
 * Single live board for drivers, vehicles, deliveries, charters,
 * aircraft/marine assets, active incidents and delayed trips, with realtime
 * refresh on the underlying operational tables.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, MapPin, RefreshCw, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import StatCard from "@/components/common/StatCard";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import {
  LIVE_KIND_LABEL,
  LIVE_STATE_TONE,
  charterEntities,
  deliveryEntities,
  driverEntities,
  exceptionFeed,
  geoBounds,
  incidentEntities,
  liveSummary,
  projectPoint,
  tripEntities,
  type LiveEntity,
  type LiveKind,
} from "@/lib/customerops/liveOps";

const KIND_FILTERS: LiveKind[] = [
  "driver", "vehicle", "delayed_trip", "delivery", "charter", "aircraft", "boat", "incident",
];

const dotTone: Record<string, string> = {
  healthy: "bg-status-success",
  attention: "bg-status-warning",
  critical: "bg-destructive",
  offline: "bg-muted-foreground",
};

export function LiveOperationsPanel() {
  const [entities, setEntities] = useState<LiveEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [liveRefresh, setLiveRefresh] = useState(true);
  const [active, setActive] = useState<LiveKind[]>(KIND_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [drivers, deliveries, trips, charters, incidents] = await Promise.all([
        supabase
          .from("driver_locations")
          .select("driver_id,lat,lng,is_online,is_available,speed_kph,vehicle_id,battery_pct,updated_at")
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("delivery_orders")
          .select("id,order_number,status,pickup_lat,pickup_lng,sla_deadline,updated_at")
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("trip_bookings")
          .select("id,booking_number,status,pickup_lat,pickup_lng,pickup_eta,scheduled_for,updated_at")
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("charter_bookings")
          .select("id,reference,category_slug,asset_name,status,flight_status,updated_at")
          .order("updated_at", { ascending: false })
          .limit(100),
        supabase
          .from("service_incidents")
          .select("id,incident_number,service_name,title,severity,status,detected_at,resolved_at,updated_at")
          .order("updated_at", { ascending: false })
          .limit(100),
      ]);

      const firstError = [drivers, deliveries, trips, charters, incidents].find((r) => r.error)?.error;
      if (firstError) throw firstError;

      setEntities([
        ...driverEntities((drivers.data ?? []) as never),
        ...deliveryEntities((deliveries.data ?? []) as never),
        ...tripEntities((trips.data ?? []) as never),
        ...charterEntities((charters.data ?? []) as never),
        ...incidentEntities((incidents.data ?? []) as never),
      ]);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load live operations feed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!liveRefresh) return;
    const channel = supabase
      .channel("customerops-liveops")
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_locations" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_orders" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_bookings" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "service_incidents" }, () => void load())
      .subscribe();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [liveRefresh, load]);

  const visible = useMemo(() => entities.filter((e) => active.includes(e.kind)), [entities, active]);
  const summary = useMemo(() => liveSummary(entities), [entities]);
  const exceptions = useMemo(() => exceptionFeed(visible), [visible]);
  const bounds = useMemo(() => geoBounds(visible), [visible]);

  const toggle = (kind: LiveKind) =>
    setActive((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));

  return (
    <SectionErrorBoundary sectionName="Live Operations Map">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Live assets tracked"
            value={entities.filter((e) => e.kind !== "incident").length}
            icon={<Activity className="h-5 w-5 text-primary" />}
            description="Drivers, vehicles, parcels and charters"
          />
          <StatCard
            title="Delayed trips"
            value={entities.filter((e) => e.kind === "delayed_trip").length}
            icon={<MapPin className="h-5 w-5 text-primary" />}
            description="Past the promised pickup ETA"
          />
          <StatCard
            title="Active incidents"
            value={entities.filter((e) => e.kind === "incident").length}
            icon={<AlertTriangle className="h-5 w-5 text-primary" />}
            description="Unresolved service incidents"
          />
          <StatCard
            title="Critical exceptions"
            value={entities.filter((e) => e.state === "critical").length}
            icon={<Radio className="h-5 w-5 text-primary" />}
            description={updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : "Awaiting first feed"}
          />
        </div>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Operations layers</CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch id="liveops-refresh" checked={liveRefresh} onCheckedChange={setLiveRefresh} />
                <Label htmlFor="liveops-refresh" className="text-xs">
                  Realtime updates
                </Label>
              </div>
              <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {summary.map((s) => (
              <Button
                key={s.kind}
                type="button"
                size="sm"
                variant={active.includes(s.kind) ? "secondary" : "outline"}
                onClick={() => toggle(s.kind)}
                aria-pressed={active.includes(s.kind)}
              >
                {LIVE_KIND_LABEL[s.kind]} · {s.total}
                {s.critical > 0 && (
                  <Badge variant="destructive" className="ml-2 text-[10px]">
                    {s.critical}
                  </Badge>
                )}
              </Button>
            ))}
          </CardContent>
        </Card>

        <AsyncState
          loading={loading && entities.length === 0}
          error={error}
          isEmpty={!loading && entities.length === 0}
          emptyTitle="No live operational signals"
          emptyMessage="Nothing is currently moving on the platform, or telemetry has not reported yet."
          onRetry={() => void load()}
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,380px)]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Live map</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {bounds
                    ? `${bounds.points.length} geo-located assets · Nairobi operating window`
                    : "Selected layers have no geo-located assets"}
                </p>
              </CardHeader>
              <CardContent>
                <div
                  className="relative h-[420px] w-full overflow-hidden rounded-lg border bg-muted/30"
                  role="img"
                  aria-label="Live operations map of tracked assets"
                >
                  <div
                    className="absolute inset-0 opacity-40"
                    style={{
                      backgroundImage:
                        "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)",
                      backgroundSize: "48px 48px",
                    }}
                    aria-hidden
                  />
                  {bounds ? (
                    bounds.points.map((p) => {
                      const { x, y } = projectPoint(bounds, p.lat, p.lng);
                      return (
                        <span
                          key={p.id}
                          className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background ${dotTone[p.state]}`}
                          style={{ left: `${x}%`, top: `${y}%` }}
                          title={`${p.label} — ${p.detail}`}
                        />
                      );
                    })
                  ) : (
                    <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                      No coordinates in the selected layers
                    </p>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {(["healthy", "attention", "critical", "offline"] as const).map((s) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span className={`h-2.5 w-2.5 rounded-full ${dotTone[s]}`} aria-hidden />
                      {s}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Exception feed</CardTitle>
                <p className="text-xs text-muted-foreground">{exceptions.length} items need attention</p>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[460px] px-6 pb-6">
                  {exceptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">All selected layers are healthy.</p>
                  ) : (
                    <ul className="space-y-2">
                      {exceptions.map((e) => (
                        <li key={e.id} className={`rounded-lg border p-3 text-sm ${LIVE_STATE_TONE[e.state]}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-foreground">{e.label}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {LIVE_KIND_LABEL[e.kind]}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{e.detail}</p>
                          {e.href && (
                            <Button asChild size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs">
                              <Link to={e.href}>Open workspace</Link>
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </AsyncState>
      </div>
    </SectionErrorBoundary>
  );
}
