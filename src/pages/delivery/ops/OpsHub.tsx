/**
 * Delivery Operations — Enterprise Logistics OS console entry.
 *
 * Phase 8.1 upgrade (composition-only, frozen primitives):
 *   - Dashboard 360 surface integration: every widget reads the same canonical
 *     readings (`collectOpsReadings`) used by the 360 consoles and sidebar.
 *   - Real-time workspace health alerts with auditable event logging to the
 *     immutable `alerts_events` stream when thresholds are crossed.
 *   - Capability registry drilldowns: each ELOS indicator opens the underlying
 *     capabilities and governance artifacts.
 *   - Readiness certificate snapshot export (JSON certificate + CSV gap matrix).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import StatCard from "@/components/common/StatCard";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { useWorkspaceHealth, formatFreshness, getWorkspaceHealthSnapshot } from "@/lib/workspaces/health";
import { ELOS_SHORT_NAME, certifyElos } from "@/lib/logistics/elos";
import { certifyLogisticsReadiness } from "@/lib/logistics/logisticsReadiness";
import {
  buildReadinessSnapshot,
  collectOpsReadings,
  evaluateOpsThresholds,
  opsMetricDrilldown,
  snapshotEvidenceRows,
} from "@/lib/logistics/opsHubIntelligence";
import { loadOpsAlertEvents, recordOpsAlerts, type OpsAlertEventRow } from "@/lib/logistics/opsHubAlertLog";
import { WORKSPACE360_DEFERRED_ADOPTIONS } from "@/lib/workspace360/domains";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { toCsv, downloadCsv } from "@/lib/csv";
import {
  Package,
  Truck,
  MapPin,
  ClipboardCheck,
  ArrowRight,
  Activity,
  Gauge,
  ShieldCheck,
  LayoutGrid,
  Download,
  BellRing,
} from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";

const TILES = [
  {
    to: "/delivery/ops/packages",
    label: "Packages",
    desc: "Create packages and inspect immutable lifecycle timelines.",
    icon: Package,
    kpi: "Parcel integrity",
  },
  {
    to: "/delivery/ops/dispatch",
    label: "Dispatch Console",
    desc: "Queues, ranked candidates and driver assignments.",
    icon: Truck,
    kpi: "Assignment latency",
  },
  {
    to: "/delivery/ops/routes",
    label: "Route Planner",
    desc: "Live route segments, ETAs and movement tracking.",
    icon: MapPin,
    kpi: "ETA accuracy",
  },
  {
    to: "/delivery/ops/pod",
    label: "Proof of Delivery",
    desc: "Capture POD photos, signatures and audit notes.",
    icon: ClipboardCheck,
    kpi: "POD completion",
  },
] as const;

const STREAM_TONE: Record<string, string> = {
  certified: "bg-status-success/12 text-status-success border-status-success/25",
  conditional: "bg-status-warning/12 text-status-warning border-status-warning/25",
  blocked: "bg-status-danger/12 text-status-danger border-status-danger/25",
};

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-status-danger/12 text-status-danger border-status-danger/25",
  warning: "bg-status-warning/12 text-status-warning border-status-warning/25",
  info: "bg-primary/10 text-primary border-primary/25",
};

/** Dashboard 360 surfaces this console federates with. */
const SURFACES_360 = [
  { domain: "package", label: "Package 360", to: "/delivery/ops/packages" },
  { domain: "courier", label: "Courier 360", to: "/delivery/ops/dispatch" },
  { domain: "logistics", label: "Logistics 360", to: "/dashboard/admin/logistics-center" },
  { domain: "fleet", label: "Fleet 360", to: "/dashboard/admin/fleet" },
] as const;

export default function OpsHub() {
  const { user } = useAuth();
  const health = useWorkspaceHealth("delivery_logistics");
  const cert = useMemo(() => certifyElos(), []);
  const readiness = useMemo(() => certifyLogisticsReadiness(), []);
  const fleetHealth = useMemo(() => getWorkspaceHealthSnapshot("fleet"), []);

  const readings = useMemo(
    () => collectOpsReadings(health, cert, readiness),
    [health, cert, readiness],
  );
  const alerts = useMemo(() => evaluateOpsThresholds(readings), [readings]);
  const [events, setEvents] = useState<OpsAlertEventRow[]>([]);
  const [drilldownKey, setDrilldownKey] = useState<string | null>(null);
  const drilldown = useMemo(
    () => (drilldownKey ? opsMetricDrilldown(drilldownKey) : null),
    [drilldownKey],
  );

  // Auditable logging of threshold crossings (deduped by idempotency key).
  useEffect(() => {
    if (!user || alerts.length === 0) return;
    let active = true;
    void recordOpsAlerts(alerts, user.id).then((written) => {
      if (active && written.length > 0) void loadOpsAlertEvents().then((rows) => active && setEvents(rows));
    });
    return () => { active = false; };
  }, [alerts, user]);

  // Real-time alert feed — one channel, torn down on unmount.
  useEffect(() => {
    if (!user) return;
    let active = true;
    void loadOpsAlertEvents().then((rows) => active && setEvents(rows));
    const channel = supabase
      .channel("ops-hub-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts_events", filter: "stream=eq.logistics" },
        () => { void loadOpsAlertEvents().then((rows) => active && setEvents(rows)); },
      )
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [user]);

  const exportSnapshot = useCallback((format: "json" | "csv") => {
    const snapshot = buildReadinessSnapshot({ health, elos: cert, readiness });
    const stamp = snapshot.generatedAt.slice(0, 19).replace(/[:T]/g, "-");
    if (format === "csv") {
      downloadCsv(`elos-readiness-evidence-${stamp}.csv`, toCsv(snapshotEvidenceRows(snapshot)));
    } else {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `elos-readiness-certificate-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    toast({
      title: "Readiness snapshot exported",
      description: `${snapshot.decision} · score ${snapshot.score}/100 · fingerprint ${snapshot.fingerprint.slice(0, 12)}`,
    });
  }, [health, cert, readiness]);

  return (
    <MarketingLayout>
      <div className="container mx-auto max-w-[1400px] space-y-10 px-4 py-10">
        <EnterpriseHeroBand
          eyebrow={`${ELOS_SHORT_NAME} · Enterprise Logistics Operating System`}
          title={
            <h1 className="text-3xl font-semibold leading-[1.1] tracking-tight sm:text-[2.6rem]">
              Delivery Operations
            </h1>
          }
          subtitle="Mission control for packages, dispatch, routing and proof of delivery — federated with the Dashboard 360 surfaces and governed by the ELOS capability registry."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground">
                <Activity className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {health.connectionState === "live" ? "Live feed" : `Feed: ${health.connectionState}`}
              </Badge>
              <Badge variant="outline" className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground">
                Updated {formatFreshness(health.lastUpdated)}
              </Badge>
              <AppButton analytics="delivery_ops_readiness_certificate_download" action="submit" size="sm" variant="secondary" onClick={() => exportSnapshot("json")}>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Certificate
              </AppButton>
              <AppButton analytics="delivery_ops_gap_matrix_csv_download" action="submit" size="sm" variant="secondary" onClick={() => exportSnapshot("csv")}>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Gap matrix
              </AppButton>
            </div>
          }
        />

        <section aria-label="Logistics operating metrics" className="space-y-3">
          <SectionHeading
            title="Operating indicators"
            hint="Select any indicator to drill into the capabilities and governance artifacts behind it."
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DrilldownStat metricKey="workspace_health" onOpen={setDrilldownKey}>
              <StatCard
                title="Workspace health"
                value={`${health.healthScore}`}
                description={`Status: ${health.status} · fleet ${fleetHealth.healthScore}`}
                icon={<Gauge className="h-4 w-4" aria-hidden />}
                tone={health.status === "healthy" ? "success" : health.status === "critical" ? "danger" : "warning"}
                trend={{ value: Math.abs(health.trend), isPositive: health.trend >= 0 }}
              />
            </DrilldownStat>
            <DrilldownStat metricKey="elos_maturity" onOpen={setDrilldownKey}>
              <StatCard
                title="ELOS maturity"
                value={`${cert.score}/100`}
                description={`${cert.capabilities} capabilities · ${cert.pillars} pillars`}
                icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
                tone={cert.score >= 80 ? "success" : "primary"}
              />
            </DrilldownStat>
            <DrilldownStat metricKey="capability_activation" onOpen={setDrilldownKey}>
              <StatCard
                title="Capability activation"
                value={`${cert.activationRate}%`}
                description={`${cert.operating} operating · ${cert.piloting} piloting`}
                icon={<LayoutGrid className="h-4 w-4" aria-hidden />}
                tone="primary"
              />
            </DrilldownStat>
            <DrilldownStat metricKey="logistics_readiness" onOpen={setDrilldownKey}>
              <StatCard
                title="Logistics readiness"
                value={`${readiness.score}/100`}
                description={`${readiness.decision.replace("_", " ")} · AI gov ${readiness.aiGovernance.score}`}
                icon={<Activity className="h-4 w-4" aria-hidden />}
                tone={readiness.decision === "GO" ? "success" : readiness.decision === "NO_GO" ? "danger" : "warning"}
              />
            </DrilldownStat>
          </div>
        </section>

        <section aria-label="Operations consoles" className="space-y-3">
          <SectionHeading title="Operations consoles" hint="Execution surfaces for the daily delivery flow." />
          <div className="grid gap-5 sm:grid-cols-2">
            {TILES.map((t) => {
              const Icon = t.icon;
              return (
                <Link key={t.to} to={t.to} className="group focus-visible:outline-none">
                  <Card className="h-full transition-all duration-base group-hover:border-primary/45 group-hover:shadow-enterprise-lg group-focus-visible:ring-2 group-focus-visible:ring-ring">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className="rounded-xl bg-primary/10 p-3 text-primary shadow-enterprise-sm">
                          <Icon className="h-6 w-6" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-base font-semibold tracking-tight">
                            {t.label}
                            <ArrowRight className="h-4 w-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
                          </div>
                          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t.desc}</p>
                          <div className="mt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                            {t.kpi}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>

        <section aria-label="Operational value streams" className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base tracking-tight">
                Operational flow · Order → Warehouse → Dispatch → Delivery → Settlement
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {readiness.valueStreams.streams.slice(0, 6).map((s) => (
                <div key={s.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium tracking-tight">{s.name}</span>
                    <Badge variant="outline" className={STREAM_TONE[s.status]}>{s.status}</Badge>
                  </div>
                  <Progress value={s.score} className="h-1.5" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {s.stages.join(" → ")}
                    {s.weakestCapability ? ` · constraint: ${s.weakestCapability.label}` : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base tracking-tight">
                  <BellRing className="h-4 w-4 text-status-warning" aria-hidden />
                  Threshold alerts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {alerts.length === 0 ? (
                  <p className="text-muted-foreground">All monitored thresholds are within tolerance.</p>
                ) : (
                  alerts.map((a) => (
                    <button
                      key={a.idempotencyKey}
                      type="button"
                      onClick={() => setDrilldownKey(a.metricKey)}
                      className="w-full rounded-lg border border-border/70 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{a.label}</span>
                        <Badge variant="outline" className={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.message}</p>
                    </button>
                  ))
                )}
                {events.length > 0 && (
                  <div className="space-y-1.5 border-t border-border/60 pt-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                      Audit log · last {events.length}
                    </div>
                    {events.slice(0, 5).map((e) => (
                      <div key={e.id} className="text-xs leading-relaxed text-muted-foreground">
                        <span className="tabular-nums">{new Date(e.created_at).toLocaleString()}</span> · {e.metric_key} · {e.severity}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base tracking-tight">Dashboard 360 surfaces</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {SURFACES_360.map((s) => {
                  const deferred = WORKSPACE360_DEFERRED_ADOPTIONS[s.domain as keyof typeof WORKSPACE360_DEFERRED_ADOPTIONS];
                  return (
                    <Link
                      key={s.domain}
                      to={s.to}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{s.label}</span>
                        <span className="block text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                          {deferred ? "Federated via ELOS surface" : "Adopted 360 workspace"}
                        </span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base tracking-tight">AI recommendations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {readiness.priorityActions.slice(0, 4).map((a) => (
                  <div key={`${a.area}-${a.action}`} className="rounded-lg border border-border/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{a.area}</div>
                    <div className="text-xs leading-relaxed">{a.action}</div>
                    <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">Impact +{a.impact}</div>
                  </div>
                ))}
                <Link
                  to="/dashboard/admin/logistics-capabilities"
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <span>Capability registry</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>

      <Dialog open={drilldown !== null} onOpenChange={(o) => !o && setDrilldownKey(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="tracking-tight">{drilldown?.label} · capability drilldown</DialogTitle>
            <DialogDescription>
              Capabilities and governance artifacts that produce this indicator.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              {drilldown?.capabilities.map((c) => (
                <Link
                  key={c.id}
                  to={c.surface}
                  className="block rounded-lg border border-border/70 px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    <Badge variant="secondary">{c.stage}</Badge>
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    {c.owner} · {c.kpi}
                  </div>
                </Link>
              ))}
            </div>
            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                Governance artifacts
              </div>
              {drilldown?.artifacts.map((a) => (
                <Link key={a.href} to={a.href} className="flex items-center justify-between gap-3 text-sm text-primary hover:underline">
                  {a.label}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MarketingLayout>
  );
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground/80">{hint}</p>
    </div>
  );
}

function DrilldownStat({
  metricKey,
  onOpen,
  children,
}: {
  metricKey: string;
  onOpen: (key: string) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(metricKey)}
      aria-label={`Open capability drilldown for ${metricKey.replace(/_/g, " ")}`}
      className="rounded-xl text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}
