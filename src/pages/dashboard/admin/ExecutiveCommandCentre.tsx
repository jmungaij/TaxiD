/**
 * Executive Command Centre — Corporate Mobility.
 *
 * One real-time executive surface: revenue today, bookings today, active
 * vehicles, service-level compliance, conversion funnel, contract pipeline and
 * integration health. Reads production tables and aggregates through
 * `src/lib/corporate/executiveCommand.ts` (pure).
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SeoHead } from "@/components/seo/SeoHead";
import { Activity, AlertTriangle, Building2, Car, Gauge, RefreshCw, TrendingUp } from "lucide-react";
import { ReportExportMenu } from "@/components/executive/ReportExportMenu";
import { AlertHistoryTimeline } from "@/components/executive/AlertHistoryTimeline";
import { funnelReport, pipelineReport } from "@/lib/corporate/executiveExports";
import { evaluateExecutiveAlerts, selectAlertsToFire } from "@/lib/corporate/executiveAlerts";
import { dispatchExecutiveAlerts } from "@/lib/corporate/executiveAlertDispatch";
import { opportunityFromEnquiry, type CrmOpportunity } from "@/lib/corporate/crmPipeline";
import type { IntegrationKey } from "@/lib/platform/integrationResilience";
import {
  executiveSnapshot, formatKes, formatPct,
  type ExecutiveSnapshot, type ExecutiveSnapshotInput,
  type IntegrationSample,
} from "@/lib/corporate/executiveCommand";

const SERVICE_MAP: Record<string, IntegrationKey> = {
  mpesa: "mpesa", "m-pesa": "mpesa", daraja: "mpesa", payments: "mpesa",
  email: "email", resend: "email", mail: "email",
  maps: "maps", google_maps: "maps", geocoding: "maps",
  etims: "etims", kra: "etims", tax: "etims",
  storage: "storage", documents: "storage",
  dispatch: "dispatch", matching: "dispatch",
  sms: "sms", notifications: "sms",
};

const STATUS_TONE: Record<string, string> = {
  healthy: "bg-primary/15 text-primary border-primary/30",
  degraded: "bg-status-warning/15 text-status-warning border-status-warning/30 dark:text-status-warning",
  down: "bg-destructive/15 text-destructive border-destructive/30",
  unknown: "bg-muted text-muted-foreground",
};

const SLA_TONE: Record<string, string> = {
  excellent: "text-primary",
  on_target: "text-primary",
  at_risk: "text-status-warning dark:text-status-warning",
  breaching: "text-destructive",
};

function Kpi({
  label, value, hint, tone, icon: Icon,
}: {
  label: string; value: string; hint?: string;
  tone?: "warn" | "good"; icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur">
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>
        <p
          className={`mt-1 text-2xl font-semibold ${
            tone === "warn" ? "text-destructive" : tone === "good" ? "text-primary" : ""
          }`}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const EMPTY_INPUT: ExecutiveSnapshotInput = {
  invoices: [], bookings: [], vehicles: [], slaSamples: [],
  funnel: { enquiries: 0, qualified: 0, quoted: 0, approved: 0, booked: 0, invoiced: 0 },
  opportunities: [], integrations: [],
};

export default function ExecutiveCommandCentre() {
  const [snapshot, setSnapshot] = React.useState<ExecutiveSnapshot>(() => executiveSnapshot(EMPTY_INPUT));
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = React.useState<Date>(new Date());
  const [streaming, setStreaming] = React.useState(false);
  const alertSeen = React.useRef<Map<string, number>>(new Map());

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const [inv, appr, veh, enq, quotes, health] = await Promise.all([
        supabase.from("corporate_invoices")
          .select("id,total_cents,paid_cents,balance_cents,status,issued_at,created_at")
          .gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
        supabase.from("corporate_ride_approvals")
          .select("id,corporate_id,status,estimated_fare_cents,scheduled_for,created_at,decided_at,expires_at")
          .gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
        supabase.from("vehicles")
          .select("id,vehicle_type,vehicle_status").limit(1000),
        supabase.from("contact_submissions")
          .select("id,name,email,company,type,status,employee_count,handled_by,created_at,updated_at")
          .gte("created_at", since).order("created_at", { ascending: false }).limit(600),
        supabase.from("charter_quotes")
          .select("id,status,created_at").gte("created_at", since).limit(1000),
        supabase.from("service_health_metrics")
          .select("service_code,uptime_pct,p95_ms,error_count,request_count,window_end")
          .order("window_end", { ascending: false }).limit(200),
      ]);

      const row = (r: unknown) => r as Record<string, unknown>;
      const cents = (v: unknown) => (Number(v) || 0) / 100;

      const invoices = ((inv.data ?? []) as unknown[]).map((r) => {
        const i = row(r);
        return {
          id: String(i.id),
          totalKes: cents(i.total_cents),
          paidKes: cents(i.paid_cents),
          status: (i.status as string) ?? null,
          at: String(i.issued_at ?? i.created_at),
        };
      });

      const approvals = ((appr.data ?? []) as unknown[]).map(row);
      const bookings = approvals.map((a) => ({
        id: String(a.id),
        createdAt: String(a.created_at),
        scheduledFor: (a.scheduled_for as string) ?? null,
        status: String(a.status ?? "pending"),
        fareKes: cents(a.estimated_fare_cents),
        corporateId: (a.corporate_id as string) ?? null,
      }));

      // Approval decisions are the corporate service-level promise: a decision
      // must land before the request expires.
      const slaSamples = approvals.map((a) => ({
        id: String(a.id),
        label: `Approval ${String(a.id).slice(0, 8)}`,
        openedAt: String(a.created_at),
        dueAt: (a.expires_at as string) ?? null,
        closedAt: (a.decided_at as string) ?? null,
      }));

      const vehicles = ((veh.data ?? []) as unknown[]).map((r) => {
        const v = row(r);
        return {
          id: String(v.id),
          state: String(v.vehicle_status ?? "unknown").toLowerCase(),
          type: (v.vehicle_type as string) ?? null,
        };
      });

      const enquiries = ((enq.data ?? []) as unknown[]).map(row);
      const opportunities: CrmOpportunity[] = enquiries.map((r) =>
        opportunityFromEnquiry({
          id: String(r.id),
          company: (r.company as string) ?? null,
          name: (r.name as string) ?? null,
          email: (r.email as string) ?? null,
          status: (r.status as string) ?? null,
          type: (r.type as string) ?? null,
          employee_count: Number(r.employee_count) || null,
          handled_by: (r.handled_by as string) ?? null,
          created_at: String(r.created_at),
          updated_at: (r.updated_at as string) ?? null,
        }),
      );

      const quoteRows = ((quotes.data ?? []) as unknown[]).map(row);
      const funnel = {
        enquiries: enquiries.length,
        qualified: enquiries.filter((e) => {
          const s = String(e.status ?? "").toLowerCase();
          return s !== "new" && s !== "spam" && s !== "";
        }).length,
        quoted: quoteRows.length,
        approved: approvals.filter((a) => String(a.status) === "approved").length,
        booked: bookings.filter((b) => !!b.scheduledFor).length,
        invoiced: invoices.length,
      };

      const seen = new Set<IntegrationKey>();
      const integrations: IntegrationSample[] = [];
      for (const r of ((health.data ?? []) as unknown[]).map(row)) {
        const key = SERVICE_MAP[String(r.service_code ?? "").toLowerCase()];
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const requests = Number(r.request_count) || 0;
        const errors = Number(r.error_count) || 0;
        integrations.push({
          key,
          successes: Math.max(0, requests - errors),
          failures: errors,
          p95LatencyMs: Number(r.p95_ms) || null,
          lastFailureAt: errors > 0 ? String(r.window_end) : null,
        });
      }

      setSnapshot(
        executiveSnapshot({ invoices, bookings, vehicles, slaSamples, funnel, opportunities, integrations }),
      );
      setRefreshedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load executive metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  // Live streaming: any write to the source tables re-aggregates the snapshot
  // (debounced) instead of waiting for the 60s poll.
  React.useEffect(() => {
    let timer: number | undefined;
    const nudge = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 1_500);
    };
    const channel = supabase.channel("executive-command-centre");
    for (const table of ["corporate_invoices", "corporate_ride_approvals", "service_health_metrics"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, nudge);
    }
    channel.subscribe((status) => setStreaming(status === "SUBSCRIBED"));
    return () => {
      if (timer) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  // In-app + email alerting on SLA degradation, integration incidents and
  // circuit-breaker degraded mode (cooldown-protected).
  React.useEffect(() => {
    if (loading) return;
    const fire = selectAlertsToFire(evaluateExecutiveAlerts(snapshot), alertSeen.current);
    if (fire.length) void dispatchExecutiveAlerts(fire);
  }, [snapshot, loading]);

  const { revenue, bookings, fleet, sla, funnel, pipeline, integrations, posture } = snapshot;

  return (
    <div className="space-y-6">
      <SeoHead
        title="Executive Command Centre | TaxiD"
        description="Real-time corporate mobility executive view: revenue, bookings, fleet, service levels, funnel, contract pipeline and integration health."
        path="/dashboard/admin/executive-command-centre"
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Executive Command Centre</h1>
          <p className="text-sm text-muted-foreground">
            Live commercial and operational posture · last updated{" "}
            <time dateTime={refreshedAt.toISOString()}>{refreshedAt.toLocaleTimeString("en-KE")}</time>{" "}
            · {streaming ? "streaming live" : "auto-refresh 60s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={streaming ? STATUS_TONE.healthy : STATUS_TONE.unknown}>
            <Activity className={`mr-1 h-3.5 w-3.5 ${streaming ? "animate-pulse" : ""}`} aria-hidden />
            {streaming ? "Live" : "Polling"}
          </Badge>
          <Badge variant="outline" className={STATUS_TONE[posture.status]}>
            Integrations {posture.status}
          </Badge>
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/admin/my-alert-preferences">Alert preferences</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 pt-5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      {loading && !revenue.invoiceCount ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Revenue today"
              value={formatKes(revenue.invoicedKes)}
              hint={`${formatKes(revenue.collectedKes)} collected · ${
                revenue.deltaVsYesterdayPct == null ? "no prior day" : `${revenue.deltaVsYesterdayPct >= 0 ? "+" : ""}${revenue.deltaVsYesterdayPct.toFixed(1)}% vs yesterday`
              }`}
              icon={TrendingUp}
            />
            <Kpi
              label="Bookings today"
              value={String(bookings.created)}
              hint={`${bookings.completed} approved · ${bookings.pending} pending · ${formatKes(bookings.grossValueKes)} value`}
              icon={Building2}
            />
            <Kpi
              label="Active vehicles"
              value={`${fleet.active} / ${fleet.total}`}
              hint={`${formatPct(fleet.activePct)} available · ${fleet.maintenance} in maintenance`}
              icon={Car}
              tone={fleet.total > 0 && fleet.activePct < 60 ? "warn" : undefined}
            />
            <Kpi
              label="Service-level compliance"
              value={formatPct(sla.compliancePct)}
              hint={`${sla.breached} breached · ${sla.openOverdue} open overdue · band ${sla.band.replace("_", " ")}`}
              icon={Gauge}
              tone={sla.band === "breaching" ? "warn" : sla.band === "excellent" ? "good" : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">Conversion funnel · 90 days</CardTitle>
                  <ReportExportMenu
                    label="Export funnel"
                    build={() => funnelReport(funnel, snapshot.conversionPct)}
                    disabled={!funnel.length}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {funnel.map((s) => (
                  <div key={s.key}>
                    <div className="flex items-center justify-between text-sm">
                      <span>{s.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {s.count}
                        {s.stepConversionPct != null && ` · ${s.stepConversionPct.toFixed(0)}% step`}
                      </span>
                    </div>
                    <Progress value={Math.min(100, s.ofTopPct)} className="mt-1 h-2" />
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted-foreground">
                  Enquiry → invoice conversion {formatPct(snapshot.conversionPct)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">Contract pipeline</CardTitle>
                  <ReportExportMenu label="Export pipeline" build={() => pipelineReport(pipeline)} />
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Open pipeline</p>
                  <p className="text-lg font-semibold">{formatKes(pipeline.pipelineValueKes)}</p>
                  <p className="text-xs text-muted-foreground">{pipeline.open} opportunities</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Weighted forecast</p>
                  <p className="text-lg font-semibold">{formatKes(pipeline.weightedPipelineKes)}</p>
                  <p className="text-xs text-muted-foreground">Win rate {formatPct(pipeline.winRatePct)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Contracted</p>
                  <p className="text-lg font-semibold">{formatKes(pipeline.contractedKes)}</p>
                  <p className="text-xs text-muted-foreground">{pipeline.contractsInLegal} in commercial/legal</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Hygiene</p>
                  <p className={`text-lg font-semibold ${pipeline.stalled ? "text-status-warning dark:text-status-warning" : ""}`}>
                    {pipeline.stalled} stalled
                  </p>
                  <p className="text-xs text-muted-foreground">{pipeline.overdueActions} overdue actions</p>
                </div>
                <div className="col-span-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/dashboard/admin/corporate-os">Open CRM pipeline board</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Integration health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {integrations.map((i) => (
                  <div key={i.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-3">
                    <div>
                      <p className="text-sm font-medium">{i.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.calls ? `${i.calls} calls · success ${formatPct(i.successRatePct)}` : "No telemetry in window"}
                        {i.p95LatencyMs ? ` · p95 ${i.p95LatencyMs}ms` : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className={STATUS_TONE[i.status]}>{i.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Service-level watchlist</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className={`font-medium ${SLA_TONE[sla.band]}`}>
                  {sla.onTime}/{sla.total} decisions inside SLA
                </p>
                {sla.worst.length === 0 && <p className="text-muted-foreground">No breaches in window.</p>}
                {sla.worst.map((w) => (
                  <div key={w.id} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                    <span className="truncate">{w.label}</span>
                    <span className="text-xs text-destructive">{w.overdueHours.toFixed(1)}h over</span>
                  </div>
                ))}
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link to="/dashboard/admin/corporates/approvals">Open approvals inbox</Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          <AlertHistoryTimeline />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Fleet availability by class</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fleet.byType.slice(0, 8).map((t) => (
                <div key={t.type} className="rounded-md border border-border/60 p-3">
                  <p className="text-sm font-medium capitalize">{t.type.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted-foreground">{t.active} active of {t.total}</p>
                  <Progress value={t.total ? (t.active / t.total) * 100 : 0} className="mt-2 h-2" />
                </div>
              ))}
              {fleet.byType.length === 0 && (
                <p className="text-sm text-muted-foreground">No fleet records available.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
