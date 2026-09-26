/**
 * Corporate Mobility Enterprise Operating System.
 *
 * One operational surface over five capabilities that already exist in the
 * platform's data: the commercial CRM pipeline, configurable workflow
 * orchestration with SLA monitoring, live fleet intelligence, corporate account
 * health for customer success, and integration resilience posture.
 *
 * Reads production tables only and aggregates through pure libraries.
 */
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Download, RefreshCw, ShieldCheck } from "lucide-react";
import { SeoHead } from "@/components/seo/SeoHead";
import {
  CRM_STAGES, forecastByOwner, opportunityFromEnquiry, pipelineBoard,
  stageConversion, summarisePipeline, type CrmOpportunity,
} from "@/lib/corporate/crmPipeline";
import { slaState, startWorkflow, summariseWorkflows, WORKFLOW_DEFINITIONS, type WorkflowInstance } from "@/lib/platform/workflowEngine";
import {
  availabilityForecast, capacityByType, capacitySnapshot, fleetVehicleFromRow,
  FLEET_STATE_LABEL, utilisationByVehicle, type FleetVehicle,
} from "@/lib/corporate/fleetIntelligence";
import {
  HEALTH_BAND_CLASS, HEALTH_BAND_LABEL, portfolioHealth, successPlaybook,
  type AccountFacts,
} from "@/lib/corporate/accountHealth";
import {
  certifyIntegrationCoverage, INTEGRATION_POLICIES,
} from "@/lib/platform/integrationResilience";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

interface Dataset {
  opportunities: CrmOpportunity[];
  workflows: WorkflowInstance[];
  vehicles: FleetVehicle[];
  accounts: AccountFacts[];
}

const EMPTY: Dataset = { opportunities: [], workflows: [], vehicles: [], accounts: [] };

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" | "good" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${tone === "warn" ? "text-destructive" : tone === "good" ? "text-primary" : ""}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function CorporateOperatingSystem() {
  const [data, setData] = React.useState<Dataset>(EMPTY);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [enq, veh, corps, appr, inv] = await Promise.all([
        supabase.from("contact_submissions")
          .select("id,name,email,company,type,status,employee_count,handled_by,created_at,updated_at")
          .order("created_at", { ascending: false }).limit(400),
        supabase.from("vehicles")
          .select("id,vehicle_code,number_plate,vehicle_type,seating_capacity,vehicle_status")
          .limit(500),
        supabase.from("corporate_accounts")
          .select("id,legal_name,trading_name,status,created_at").limit(200),
        supabase.from("corporate_ride_approvals")
          .select("id,corporate_id,status,estimated_fare_cents,created_at,expires_at").limit(1000),
        supabase.from("corporate_invoices")
          .select("id,corporate_id,status,total_cents,created_at").limit(1000),
      ]);

      const enquiries = (enq.data ?? []) as Array<Record<string, unknown>>;
      const opportunities = enquiries.map((r) =>
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

      const vehicles = ((veh.data ?? []) as Array<Record<string, unknown>>).map((r) =>
        fleetVehicleFromRow({
          id: String(r.id),
          vehicle_code: (r.vehicle_code as string) ?? null,
          number_plate: (r.number_plate as string) ?? null,
          vehicle_type: (r.vehicle_type as string) ?? null,
          seating_capacity: Number(r.seating_capacity) || null,
          vehicle_status: (r.vehicle_status as string) ?? null,
        }),
      );

      const approvals = (appr.data ?? []) as Array<Record<string, unknown>>;
      const invoices = (inv.data ?? []) as Array<Record<string, unknown>>;

      // Live approvals are represented as employee-booking workflow instances so
      // the orchestrator monitors real SLA state, not a synthetic queue.
      const workflows = approvals.slice(0, 200).map((r) => {
        const amountKes = (Number(r.estimated_fare_cents) || 0) / 100;
        const w = startWorkflow({
          id: String(r.id),
          definitionKey: "employee_booking",
          subjectRef: `APR-${String(r.id).slice(0, 8)}`,
          corporateId: (r.corporate_id as string) ?? null,
          context: { amountKes },
          at: String(r.created_at),
        });
        const status = String(r.status ?? "pending");
        if (status === "approved") return { ...w, status: "approved" as const };
        if (status === "rejected") return { ...w, status: "rejected" as const };
        return w;
      });

      const accounts: AccountFacts[] = ((corps.data ?? []) as Array<Record<string, unknown>>).map((c) => {
        const id = String(c.id);
        const mine = approvals.filter((a) => a.corporate_id === id);
        const myInv = invoices.filter((i) => i.corporate_id === id);
        const now = Date.now();
        const spend = mine.reduce((s, a) => s + (Number(a.estimated_fare_cents) || 0) / 100, 0);
        const open = mine.filter((a) => a.status === "pending");
        return {
          corporateId: id,
          name: (c.trading_name as string) || (c.legal_name as string) || "Corporate account",
          status: (c.status as string) ?? null,
          walletBalanceKes: 0,
          creditLimitKes: 0,
          arrearsKes: myInv
            .filter((i) => ["issued", "overdue", "partially_paid"].includes(String(i.status)))
            .reduce((s, i) => s + (Number(i.total_cents) || 0) / 100, 0),
          tripsThisPeriod: mine.filter((a) => a.status === "approved").length,
          tripsPrevPeriod: 0,
          spendThisPeriodKes: spend,
          spendPrevPeriodKes: 0,
          activeEmployees: 0,
          enrolledEmployees: 0,
          openApprovals: open.length,
          overdueApprovals: open.filter((a) => a.expires_at && new Date(String(a.expires_at)).getTime() < now).length,
          failedTrips: mine.filter((a) => a.status === "expired").length,
          openTickets: 0,
          policyViolations: 0,
          expiringDocuments: 0,
          expiredDocuments: 0,
          lastBookingAt: mine[0] ? String(mine[0].created_at) : null,
          onboardedAt: (c.created_at as string) ?? null,
        };
      });

      setData({ opportunities, workflows, vehicles, accounts });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load operating-system data");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const filter = query.trim().toLowerCase();
  const crm = React.useMemo(
    () => data.opportunities.filter((o) => !filter || o.company.toLowerCase().includes(filter)),
    [data.opportunities, filter],
  );
  const pipeline = React.useMemo(() => summarisePipeline(crm), [crm]);
  const board = React.useMemo(() => pipelineBoard(crm), [crm]);
  const owners = React.useMemo(() => forecastByOwner(crm), [crm]);
  const conversion = React.useMemo(() => stageConversion(crm), [crm]);
  const wf = React.useMemo(() => summariseWorkflows(data.workflows), [data.workflows]);
  const wfSla = React.useMemo(
    () => data.workflows.map((w) => slaState(w)).filter((s) => s.stepId).sort((a, b) => b.consumedPct - a.consumedPct),
    [data.workflows],
  );
  const capacity = React.useMemo(() => capacitySnapshot(data.vehicles), [data.vehicles]);
  const byType = React.useMemo(() => capacityByType(data.vehicles), [data.vehicles]);
  const util = React.useMemo(() => utilisationByVehicle(data.vehicles), [data.vehicles]);
  const forecast = React.useMemo(
    () => availabilityForecast(data.vehicles, [6, 12, 24, 48].map((h) => ({
      at: new Date(Date.now() + h * 3_600_000).toISOString(),
      vehiclesRequired: data.workflows.filter((w) => w.status === "in_progress").length,
    }))),
    [data.vehicles, data.workflows],
  );
  const portfolio = React.useMemo(() => portfolioHealth(data.accounts), [data.accounts]);
  const plays = React.useMemo(() => successPlaybook(data.accounts), [data.accounts]);
  const coverage = React.useMemo(() => certifyIntegrationCoverage(), []);

  const exportPortfolio = () => {
    const header = "corporate,name,score,band,adoption_pct,runway_days,reliability_pct,risks";
    const rows = portfolio.accounts.map((a) =>
      [a.corporateId, `"${a.name.replace(/"/g, '""')}"`, a.score, a.band, a.adoptionPct, a.runwayDays,
        a.reliabilityPct, `"${a.risks.join("; ").replace(/"/g, '""')}"`].join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "corporate-account-health.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <SeoHead
        title="Corporate Mobility Operating System | SAFARID"
        description="Enterprise CRM pipeline, workflow SLA orchestration, live fleet intelligence, account health and integration resilience in one operating surface."
        path="/dashboard/admin/corporate-os"
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Corporate Mobility Operating System</h1>
          <p className="text-sm text-muted-foreground">
            Commercial pipeline, workflow SLAs, fleet capacity, account health and integration posture.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="w-56"
            placeholder="Filter by company"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter by company"
          />
          <Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
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

      {loading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <Tabs defaultValue="crm">
          <TabsList className="flex-wrap">
            <TabsTrigger value="crm">CRM pipeline</TabsTrigger>
            <TabsTrigger value="workflows">Workflow orchestration</TabsTrigger>
            <TabsTrigger value="fleet">Fleet intelligence</TabsTrigger>
            <TabsTrigger value="accounts">Account command centre</TabsTrigger>
            <TabsTrigger value="resilience">Resilience</TabsTrigger>
          </TabsList>

          {/* ---------------- CRM ---------------- */}
          <TabsContent value="crm" className="space-y-4 pt-4">
            <div className="grid gap-4 md:grid-cols-4">
              <Kpi label="Open pipeline" value={kes(pipeline.pipelineValueKes)} hint={`${pipeline.open} open opportunities`} />
              <Kpi label="Weighted forecast" value={kes(pipeline.weightedPipelineKes)} hint="Probability-adjusted" />
              <Kpi label="Win rate" value={`${pipeline.winRatePct}%`} hint={`${pipeline.won} won · ${pipeline.lost} lost`} />
              <Kpi label="Stalled deals" value={String(pipeline.stalled)} hint={`${pipeline.overdueActions} overdue actions`} tone={pipeline.stalled ? "warn" : "good"} />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Pipeline board · {CRM_STAGES.length} stages</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <div className="flex gap-3 pb-2">
                  {board.filter((c) => c.phase !== "closed" || c.count > 0).map((c) => (
                    <div key={c.stage} className="min-w-[172px] rounded-lg border bg-card p-3">
                      <p className="text-xs font-medium">{c.label}</p>
                      <p className="text-xs text-muted-foreground">{Math.round(c.probability * 100)}% · SLA {c.slaDays}d</p>
                      <p className="mt-2 text-xl font-semibold">{c.count}</p>
                      <p className="text-xs text-muted-foreground">{kes(c.valueKes)}</p>
                      {c.stalled > 0 && <Badge variant="destructive" className="mt-2 text-[10px]">{c.stalled} stalled</Badge>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">Salesperson forecast</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {owners.length === 0 && <p className="text-sm text-muted-foreground">No opportunities yet.</p>}
                  {owners.map((o) => (
                    <div key={o.owner} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <div>
                        <p className="font-medium">{o.owner}</p>
                        <p className="text-xs text-muted-foreground">
                          {o.open} open · win {o.winRatePct}% · cycle {o.avgCycleDays}d
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{kes(o.forecastKes)}</p>
                        <p className="text-xs text-muted-foreground">commit {kes(o.commitKes)}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Stage conversion</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {conversion.slice(0, 10).map((c) => (
                    <div key={c.stage} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>{c.label}</span>
                        <span className="text-muted-foreground">{c.reached} · {c.conversionPct}%</span>
                      </div>
                      <Progress value={Math.min(100, c.conversionPct)} className="h-1.5" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ---------------- Workflows ---------------- */}
          <TabsContent value="workflows" className="space-y-4 pt-4">
            <div className="grid gap-4 md:grid-cols-4">
              <Kpi label="In progress" value={String(wf.inProgress)} hint={`${wf.total} tracked`} />
              <Kpi label="SLA compliance" value={`${wf.compliancePct}%`} tone={wf.compliancePct >= 95 ? "good" : "warn"} />
              <Kpi label="Breached" value={String(wf.breached)} tone={wf.breached ? "warn" : "good"} hint={`${wf.atRisk} at risk`} />
              <Kpi label="Avg hours on step" value={`${wf.avgHoursOnActiveStep}h`} />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Configured workflows · {WORKFLOW_DEFINITIONS.length}</CardTitle></CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-2">
                {WORKFLOW_DEFINITIONS.map((d) => (
                  <div key={d.key} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{d.label}</p>
                      <Badge variant="secondary" className="text-[10px]">{d.domain}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>
                    <p className="mt-2 text-xs">{d.steps.length} steps · {d.steps.map((s) => s.label).join(" → ")}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">SLA monitor · active steps</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {wfSla.length === 0 && <p className="text-sm text-muted-foreground">No active workflow steps.</p>}
                {wfSla.slice(0, 25).map((s) => (
                  <div key={s.workflowId} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{s.subjectRef} · {s.stepLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.owners.join(", ")} · {s.hoursElapsed}h of {s.slaHours}h
                          {s.escalateTo ? ` · escalates to ${s.escalateTo}` : ""}
                        </p>
                      </div>
                      <Badge
                        variant={s.breached ? "destructive" : "secondary"}
                        className={s.atRisk && !s.breached ? "border-primary/40 text-primary" : ""}
                      >
                        {s.breached ? "SLA breached" : s.atRisk ? "At risk" : "In SLA"}
                      </Badge>
                    </div>
                    <Progress value={Math.min(100, s.consumedPct)} className="mt-2 h-1.5" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Fleet ---------------- */}
          <TabsContent value="fleet" className="space-y-4 pt-4">
            <div className="grid gap-4 md:grid-cols-4">
              <Kpi label="Fleet size" value={String(capacity.total)} hint={`${capacity.deployable} deployable`} />
              <Kpi label="Readiness" value={`${capacity.readinessPct}%`} tone={capacity.readinessPct >= 80 ? "good" : "warn"} />
              <Kpi label="Utilisation" value={`${capacity.utilisationPct}%`} />
              <Kpi label="Out of service" value={String(capacity.outOfService)} tone={capacity.outOfService ? "warn" : "good"} />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Capacity by state</CardTitle></CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {(Object.keys(FLEET_STATE_LABEL) as Array<keyof typeof FLEET_STATE_LABEL>).map((k) => (
                  <div key={k} className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">{FLEET_STATE_LABEL[k]}</p>
                    <p className="text-lg font-semibold">{capacity.byState[k]}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">Capacity by vehicle type</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {byType.length === 0 && <p className="text-sm text-muted-foreground">No vehicles registered.</p>}
                  {byType.map((t) => (
                    <div key={t.type} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <span className="capitalize">{t.type}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.available} available · {t.engaged} engaged · {t.outOfService} out · {t.seatsAvailable} seats
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Availability forecast</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {forecast.map((f) => (
                    <div key={f.at} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <span>{new Date(f.at).toLocaleString("en-KE", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        need {f.vehiclesRequired} / have {f.vehiclesAvailable} · load {f.loadPct}%
                        <Badge variant={f.status === "shortfall" ? "destructive" : "secondary"}>{f.status}</Badge>
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {util.some((u) => u.trips > 0) && (
              <Card>
                <CardHeader><CardTitle className="text-base">Vehicle utilisation</CardTitle></CardHeader>
                <CardContent className="space-y-1">
                  {util.slice(0, 15).map((u) => (
                    <div key={u.id} className="flex justify-between text-sm">
                      <span>{u.code}</span>
                      <span className="text-xs text-muted-foreground">{u.utilisationPct}% · {u.trips} trips · {kes(u.revenueKes)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ---------------- Accounts ---------------- */}
          <TabsContent value="accounts" className="space-y-4 pt-4">
            <div className="grid gap-4 md:grid-cols-4">
              <Kpi label="Accounts" value={String(portfolio.count)} hint={`avg health ${portfolio.avgScore}`} />
              <Kpi label="At risk" value={String(portfolio.atRisk.length)} tone={portfolio.atRisk.length ? "warn" : "good"} />
              <Kpi label="Revenue at risk" value={kes(portfolio.revenueAtRiskKes)} tone={portfolio.revenueAtRiskKes ? "warn" : "good"} />
              <Kpi label="Expansion ready" value={String(portfolio.expansionReady.length)} tone="good" />
            </div>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">Account health</CardTitle>
                <Button variant="outline" size="sm" className="gap-2" data-analytics="admin.corporate_os.export_portfolio_csv" onClick={exportPortfolio}>
                  <Download className="h-4 w-4" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {portfolio.accounts.length === 0 && <p className="text-sm text-muted-foreground">No corporate accounts yet.</p>}
                {portfolio.accounts.map((a) => (
                  <div key={a.corporateId} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{a.name}</p>
                        <p className="text-xs text-muted-foreground">
                          adoption {a.adoptionPct}% · runway {a.runwayDays}d · reliability {a.reliabilityPct}%
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={HEALTH_BAND_CLASS[a.band]}>{HEALTH_BAND_LABEL[a.band]}</Badge>
                        <span className="text-lg font-semibold">{a.score}</span>
                      </div>
                    </div>
                    {a.risks.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                        {a.risks.slice(0, 3).map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Customer success playbook</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {plays.length === 0 && <p className="text-sm text-muted-foreground">No plays outstanding.</p>}
                {plays.slice(0, 25).map((p, i) => (
                  <div key={`${p.corporateId}-${p.kind}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                    <div>
                      <p className="font-medium">{p.title} · <span className="text-muted-foreground">{p.name}</span></p>
                      <p className="text-xs text-muted-foreground">{p.detail} · owner {p.owner}</p>
                    </div>
                    <Badge variant={p.priority === 1 ? "destructive" : "secondary"}>P{p.priority}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Resilience ---------------- */}
          <TabsContent value="resilience" className="space-y-4 pt-4">
            <Card className={coverage.passed ? "border-primary/40" : "border-destructive/40"}>
              <CardContent className="flex items-center gap-2 pt-5 text-sm">
                <ShieldCheck className={`h-4 w-4 ${coverage.passed ? "text-status-success" : "text-destructive"}`} />
                {coverage.passed
                  ? `All ${INTEGRATION_POLICIES.length} critical integrations have retry, breaker and degraded-mode policies.`
                  : coverage.findings.join("; ")}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Integration policies</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {INTEGRATION_POLICIES.map((p) => (
                  <div key={p.key} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{p.label}</p>
                      <div className="flex gap-1">
                        {p.requiresIdempotencyKey && <Badge variant="secondary" className="text-[10px]">idempotent</Badge>}
                        {p.queueOnFailure && <Badge variant="secondary" className="text-[10px]">queued replay</Badge>}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.retry.maxAttempts} attempts · backoff {p.retry.baseDelayMs}ms→{p.retry.maxDelayMs}ms ·
                      breaker at {p.breakerThreshold} failures for {Math.round(p.breakerCooldownMs / 1000)}s
                    </p>
                    <p className="mt-1 text-xs">{p.degradedMode}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
