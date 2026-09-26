import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, BarChart3, Building, Car, CreditCard, Crown, DollarSign,
  Gauge, Heart, Radio, ShieldAlert, Siren, TrendingUp, Truck, Users, Wallet, Zap,
} from "lucide-react";
import { logAdminAudit } from "@/lib/navLog";
import { ExecutiveMetricsProvider, useExecMetrics } from "@/providers/ExecutiveMetricsProvider";
import { RealtimeHealthWidget } from "@/components/admin/RealtimeHealthWidget";

interface Metric {
  id: string;
  metric_key: string;
  label: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  trend_pct: number | null;
  category: string;
  measured_at: string;
  updated_at: string;
}

interface Alert {
  id: string;
  severity: "info" | "warning" | "critical" | string;
  category: string;
  title: string;
  body: string | null;
  resource_url: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  revenue_today: DollarSign, revenue_mtd: DollarSign, revenue_ytd: TrendingUp,
  trips_today: Car, trips_this_hour: Activity, deliveries_today: Truck,
  corporate_spend_today: Building, driver_earnings_today: Wallet,
  wallet_float: Wallet, pending_settlements: CreditCard,
  risk_alerts: AlertTriangle, compliance_alerts: ShieldAlert, critical_incidents: Siren,
  fraud_cases: ShieldAlert, active_sos_events: Siren,
  customer_satisfaction: Heart, driver_satisfaction: Users, system_health: Gauge,
};

const CATEGORY_TONE: Record<string, string> = {
  revenue: "text-status-success dark:text-status-success",
  operations: "text-ai dark:text-ai",
  risk: "text-status-danger dark:text-status-danger",
  satisfaction: "text-status-warning dark:text-status-warning",
  system: "text-ai dark:text-ai",
};

function formatValue(m: Metric): string {
  if (m.value_text) return m.value_text;
  if (m.value_numeric == null) return "—";
  const v = Number(m.value_numeric);
  if (m.unit === "KES") return `KES ${v.toLocaleString()}`;
  if (m.unit === "%") return `${v.toFixed(1)}%`;
  return v.toLocaleString();
}

export default function ExecutiveCommandCenter() {
  return (
    <ExecutiveMetricsProvider>
      <ExecutiveCommandCenterInner />
    </ExecutiveMetricsProvider>
  );
}

function ExecutiveCommandCenterInner() {
  const live = useExecMetrics();
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pulse, setPulse] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date>(new Date());

  useEffect(() => {
    void loadMetrics();
    void loadAlerts();

    const metricsChan = supabase
      .channel("exec-metrics")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "executive_metrics" },
        (payload) => {
          const row = (payload.new ?? payload.old) as Metric | undefined;
          if (!row) return;
          setMetrics((prev) => {
            const next = prev.filter((m) => m.id !== row.id);
            if (payload.eventType !== "DELETE") next.push(row);
            return next.sort((a, b) => a.metric_key.localeCompare(b.metric_key));
          });
          setPulse(row.metric_key);
          setLastSync(new Date());
          window.setTimeout(() => setPulse(null), 1200);
        }
      )
      .subscribe();

    const alertsChan = supabase
      .channel("exec-alerts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "executive_alerts" },
        () => { void loadAlerts(); setLastSync(new Date()); }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(metricsChan);
      void supabase.removeChannel(alertsChan);
    };
  }, []);

  async function loadMetrics() {
    const { data } = await supabase
      .from("executive_metrics")
      .select("*")
      .order("metric_key", { ascending: true });
    setMetrics((data ?? []) as Metric[]);
    setLastSync(new Date());
  }

  async function loadAlerts() {
    const { data } = await supabase
      .from("executive_alerts")
      .select("*")
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(25);
    setAlerts((data ?? []) as Alert[]);
  }

  async function ackAlert(a: Alert) {
    await supabase
      .from("executive_alerts")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", a.id);
    void logAdminAudit({
      action: "executive_alert_ack",
      resourceType: "executive_alerts",
      resourceId: a.id,
      newValue: { acknowledged_at: new Date().toISOString() },
    });
  }

  const grouped = useMemo(() => {
    const g: Record<string, Metric[]> = { revenue: [], operations: [], risk: [], satisfaction: [], system: [] };
    for (const m of metrics) (g[m.category] ??= []).push(m);
    return g;
  }, [metrics]);

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Crown className="h-6 w-6 text-primary" /> Executive Command Center
          </h1>
          <p className="text-sm text-muted-foreground">
            Live national mobility cockpit — pushed via Realtime, not polled.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className={`inline-flex h-2 w-2 rounded-full ${live.connected ? "bg-status-success animate-pulse" : "bg-status-danger"}`} />
          {live.connected ? "Realtime connected" : "Reconnecting…"} · last sync {lastSync.toLocaleTimeString()}
          {criticalCount > 0 && (
            <Badge variant="destructive" className="ml-2">{criticalCount} critical</Badge>
          )}
        </div>
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
          <Radio className="h-4 w-4" /> Live Event Stream
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <EventTile label="Trips (live)" value={live.byCategory.trip} icon={Car} tone="text-ai" />
          <EventTile label="Driver activity" value={live.byCategory.driver} icon={Users} tone="text-status-success" />
          <EventTile label="Finance events" value={live.byCategory.finance} icon={DollarSign} tone="text-status-warning" />
          <EventTile label="Last event" value={live.lastEventAt ? new Date(live.lastEventAt).toLocaleTimeString() : "—"} icon={Zap} tone="text-ai" isText />
        </div>
        {live.recent.length > 0 && (
          <div className="mt-3 text-xs text-muted-foreground space-y-1 max-h-32 overflow-y-auto rounded-md border p-2">
            {live.recent.slice(0, 8).map((e) => (
              <div key={e.id} className="flex justify-between gap-2 font-mono">
                <span>{new Date(e.occurred_at).toLocaleTimeString()}</span>
                <span className="text-foreground">{e.event_type}</span>
                <span className="opacity-60">{e.category}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {(["revenue", "operations", "risk", "satisfaction", "system"] as const).map((cat) =>
        grouped[cat]?.length ? (
          <section key={cat}>
            <h2 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${CATEGORY_TONE[cat]}`}>
              {cat}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {grouped[cat].map((m) => {
                const Icon = ICONS[m.metric_key] ?? BarChart3;
                const flashing = pulse === m.metric_key;
                return (
                  <Card
                    key={m.id}
                    className={`transition-all ${flashing ? "ring-2 ring-primary shadow-lg" : ""}`}
                  >
                    <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-xs font-medium text-muted-foreground">
                        {m.label}
                      </CardTitle>
                      <Icon className={`h-4 w-4 ${CATEGORY_TONE[m.category]}`} />
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl font-bold">{formatValue(m)}</div>
                      {m.trend_pct != null && (
                        <div
                          className={`text-xs mt-1 ${
                            Number(m.trend_pct) >= 0 ? "text-status-success" : "text-status-danger"
                          }`}
                        >
                          {Number(m.trend_pct) >= 0 ? "▲" : "▼"} {Math.abs(Number(m.trend_pct)).toFixed(1)}%
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ) : null
      )}

      <RealtimeHealthWidget />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" /> Live Alerts ({alerts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 && (
            <p className="text-sm text-muted-foreground">No unacknowledged alerts.</p>
          )}
          <div className="space-y-2">
            {alerts.map((a) => (
              <div
                key={a.id}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={a.severity === "critical" ? "destructive" : "outline"}
                      className="uppercase text-[10px]"
                    >
                      {a.severity}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{a.category}</span>
                    <span className="text-xs text-muted-foreground">
                      · {new Date(a.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="font-medium mt-1">{a.title}</div>
                  {a.body && <div className="text-sm text-muted-foreground">{a.body}</div>}
                </div>
                <Button size="sm" variant="outline" onClick={() => ackAlert(a)}>
                  Acknowledge
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EventTile({
  label, value, icon: Icon, tone, isText,
}: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }>; tone: string; isText?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${tone}`} />
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold">{isText ? value : Number(value).toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}
