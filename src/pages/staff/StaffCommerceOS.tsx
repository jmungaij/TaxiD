/**
 * Phase 9 §30 — SAFARID Commerce OS.
 *
 * One operating surface over the commerce loop: what demand exists, what
 * capacity can be committed, what requires intervention, what would happen
 * under stress, what SAFARID depends on, and whether the phase may be certified.
 *
 * Every figure carries provenance. Unreadable inputs render as DATA NOT
 * AVAILABLE — never as a plausible number.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FlaskConical, GitBranch, ListChecks, ShieldCheck, Waves } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { PROVENANCE_LABEL, formatMeasure, type Measure, type Provenance } from "@/lib/staff/phase8";
import {
  ANTI_PATTERN_LABEL, EXCEPTION_LABEL, FUNNEL_LABEL, STAGE_LABEL, COMMERCE_STAGES,
  assessResilience, buildExceptionQueue, certifyPhase9, computeFulfilmentFunnel,
  runStandardScenarios,
  type DependencyExposure, type ExitEvidence, type FulfilmentFunnel,
  type OperationalException, type ScenarioOutcome, type SimulationBaseline,
} from "@/lib/staff/phase9";

const tone: Record<Provenance, string> = {
  LIVE: "bg-success/15 text-success border-success/30",
  MODELLED: "bg-info/15 text-info border-info/30",
  SIMULATED: "bg-warning/15 text-warning-foreground border-warning/30",
  DEMO: "bg-warning/15 text-warning-foreground border-warning/30",
  UNAVAILABLE: "bg-muted text-muted-foreground border-border",
};

function ProvenanceBadge({ p }: { p: Provenance }) {
  return <Badge variant="outline" className={tone[p]}>{PROVENANCE_LABEL[p]}</Badge>;
}

function MeasureBlock({ m }: { m: Measure }) {
  return (
    <div className="space-y-1">
      <div className="font-medium tabular-nums">{formatMeasure(m)}</div>
      <div className="text-xs text-muted-foreground">{m.calculation}</div>
      {m.note ? <div className="text-xs text-muted-foreground">{m.note}</div> : null}
    </div>
  );
}

async function safeCount(table: string, apply?: (q: any) => any): Promise<number | null> {
  try {
    let q: any = (supabase as any).from(table).select("id", { count: "exact", head: true });
    if (apply) q = apply(q);
    const { count, error } = await q;
    if (error) return null;
    return count ?? null;
  } catch {
    return null;
  }
}

interface CommerceOsData {
  funnel: FulfilmentFunnel;
  exceptions: ReturnType<typeof buildExceptionQueue>;
  dependencies: DependencyExposure[];
  periodRevenue: number | null;
}

async function loadCommerceOs(): Promise<CommerceOsData> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const source = "dispatch + booking tables, rolling 7 days";

  const [requests, assignments, rejections, trips, operators, paid, settled] = await Promise.all([
    safeCount("dispatch_requests", (q) => q.gte("created_at", since)),
    safeCount("dispatch_assignments", (q) => q.gte("assigned_at", since)),
    safeCount("dispatch_rejections", (q) => q.gte("created_at", since)),
    safeCount("trip_bookings", (q) => q.gte("created_at", since)),
    safeCount("dispatch_supply_cells"),
    safeCount("mpesa_transactions", (q) => q.gte("created_at", since)),
    safeCount("charter_wallet_ledger", (q) => q.gte("created_at", since)),
  ]);

  const funnel = computeFulfilmentFunnel(
    {
      demand: requests,
      qualified_demand: null,
      available_capacity: operators,
      match: assignments,
      confirmed_booking: trips,
      fulfilled_transaction: null,
      paid_transaction: paid,
      settled_transaction: settled,
      repeat_transaction: null,
    },
    /* Contribution per fulfilled transaction is not yet observable from a
       single authoritative source, so the North Star must abstain. */
    null,
    source,
  );

  /* Exceptions are only surfaced where an evidenced signal exists. */
  const exceptionRows: OperationalException[] = [];
  if (rejections !== null && rejections > 0) {
    exceptionRows.push({
      id: "no_driver_aggregate",
      kind: "no_driver",
      bookingId: null,
      customerName: null,
      operatorName: null,
      location: null,
      revenueAtRisk: null,
      minutesToImpact: null,
      contractualPenalty: false,
      detectedAt: new Date().toISOString(),
      detail: `${rejections} dispatch rejection(s) in the last 7 days indicate unmatched demand.`,
      source: "dispatch_rejections",
    });
  }
  if (requests !== null && assignments !== null && requests > assignments) {
    exceptionRows.push({
      id: "sla_gap",
      kind: "sla_risk",
      bookingId: null,
      customerName: null,
      operatorName: null,
      location: null,
      revenueAtRisk: null,
      minutesToImpact: null,
      contractualPenalty: false,
      detectedAt: new Date().toISOString(),
      detail: `${requests - assignments} request(s) have no recorded assignment.`,
      source: "dispatch_requests vs dispatch_assignments",
    });
  }

  const dependencies: DependencyExposure[] = [
    { kind: "payment", name: "M-Pesa (Daraja)", share: 1, alternatives: 0, failoverHours: null, source: "mpesa_transactions — sole recorded collection rail" },
    { kind: "technology", name: "Lovable Cloud backend", share: 1, alternatives: 0, failoverHours: null, source: "platform architecture" },
    { kind: "category", name: "Individual mobility", share: null, alternatives: null, failoverHours: null, source: "category revenue split not yet attributable" },
    { kind: "location", name: "Nairobi", share: null, alternatives: null, failoverHours: null, source: "geographic revenue split not yet attributable" },
  ];

  return { funnel, exceptions: buildExceptionQueue(exceptionRows), dependencies, periodRevenue: null };
}

/** Baseline for the simulation lab is explicitly SIMULATED, never live. */
const SIM_BASELINE: SimulationBaseline = {
  demand: 1000,
  effectiveCapacity: 900,
  contributionPerFulfilment: 180,
  operatorEarningsPerHour: 420,
  cancellationRate: 0.08,
  priceIndex: 1,
  source: "Reference baseline (not SAFARID actuals)",
};

const EXIT_EVIDENCE: ExitEvidence[] = [
  { id: "demand_detected", demonstratedBy: "phase9/supplyDemand.ts computeDemand", liveEvidence: null },
  { id: "supply_measured", demonstratedBy: "phase9/supplyDemand.ts computeSupply", liveEvidence: null },
  { id: "capacity_validated", demonstratedBy: "phase9/capacityCommitment.ts", liveEvidence: null },
  { id: "customers_qualified", demonstratedBy: "phase8/customerEconomics.ts", liveEvidence: null },
  { id: "opportunity_matched", demonstratedBy: "phase9/matching.ts", liveEvidence: null },
  { id: "price_under_policy", demonstratedBy: "phase9/capacityCommitment.ts constrained pricing", liveEvidence: null },
  { id: "booking_executed", demonstratedBy: "trip_bookings / charter_bookings", liveEvidence: null },
  { id: "operations_fulfil", demonstratedBy: "dispatch_assignments", liveEvidence: null },
  { id: "exceptions_escalated", demonstratedBy: "phase9/exceptionOps.ts", liveEvidence: null },
  { id: "payments_reconciled", demonstratedBy: "charter_wallet_reconciliation_runs", liveEvidence: null },
  { id: "operators_settled", demonstratedBy: "driver_payout_batches", liveEvidence: null },
  { id: "revenue_attributed", demonstratedBy: "phase9/commerceGraph.ts", liveEvidence: null },
  { id: "customer_value_measured", demonstratedBy: "phase8/customerEconomics.ts", liveEvidence: null },
  { id: "liquidity_measured", demonstratedBy: "phase9/supplyDemand.ts revenue-weighted liquidity", liveEvidence: null },
  { id: "failures_learned", demonstratedBy: "phase5/outcomes.ts learning engine", liveEvidence: null },
  { id: "demand_informs_supply", demonstratedBy: "phase9/supplyAcquisition.ts", liveEvidence: null },
];

export default function StaffCommerceOS() {
  const [data, setData] = useState<CommerceOsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loadCommerceOs()
      .then((d) => { if (alive) setData(d); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const scenarios: ScenarioOutcome[] = useMemo(() => runStandardScenarios(SIM_BASELINE), []);
  const resilience = useMemo(
    () => (data ? assessResilience(data.dependencies, data.periodRevenue) : []),
    [data],
  );
  const certification = useMemo(() => certifyPhase9(EXIT_EVIDENCE), []);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Commerce OS</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Demand, capacity, trust, matching, fulfilment and revenue as one operating system.
          Figures state their own provenance; nothing modelled or simulated is reported as SAFARID performance.
        </p>
      </header>

      <Tabs defaultValue="loop">
        <TabsList className="flex-wrap">
          <TabsTrigger value="loop"><GitBranch className="mr-2 h-4 w-4" />Commerce loop</TabsTrigger>
          <TabsTrigger value="exceptions"><AlertTriangle className="mr-2 h-4 w-4" />Exceptions</TabsTrigger>
          <TabsTrigger value="simulation"><FlaskConical className="mr-2 h-4 w-4" />Simulation lab</TabsTrigger>
          <TabsTrigger value="resilience"><Waves className="mr-2 h-4 w-4" />Resilience</TabsTrigger>
          <TabsTrigger value="certification"><ShieldCheck className="mr-2 h-4 w-4" />Certification</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ commerce loop */}
        <TabsContent value="loop" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue fulfilment funnel</CardTitle>
              <CardDescription>
                Demand → qualified demand → capacity → match → booking → fulfilment → payment → settlement → repeat.
                The bottleneck is the step SAFARID should fix, regardless of which team owns it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading || !data ? (
                <Skeleton className="h-56 w-full" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Step</TableHead>
                      <TableHead>Count</TableHead>
                      <TableHead>Conversion from previous</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.funnel.steps.map((s) => (
                      <TableRow key={s.step} className={s.isBottleneck ? "bg-warning/5" : undefined}>
                        <TableCell className="font-medium">
                          {FUNNEL_LABEL[s.step]}
                          {s.isBottleneck ? <Badge variant="outline" className="ml-2 border-warning/30 bg-warning/15 text-warning-foreground">Bottleneck</Badge> : null}
                        </TableCell>
                        <TableCell><MeasureBlock m={s.count} /></TableCell>
                        <TableCell><MeasureBlock m={s.conversion} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">North Star</CardTitle>
                <CardDescription>Successful fulfilled commercial demand — not rides, not GMV, not sign-ups.</CardDescription>
              </CardHeader>
              <CardContent>
                {loading || !data ? <Skeleton className="h-16 w-full" /> : (
                  <div className="space-y-2">
                    <ProvenanceBadge p={data.funnel.northStar.provenance} />
                    <MeasureBlock m={data.funnel.northStar} />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Commerce loop stages</CardTitle>
                <CardDescription>Every revenue event must be traceable through these stages.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {COMMERCE_STAGES.map((s) => (
                  <Badge key={s} variant="secondary" className="font-normal">{STAGE_LABEL[s]}</Badge>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------------------------------------------------- exceptions */}
        <TabsContent value="exceptions" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Exception queue</CardTitle>
              <CardDescription>
                {loading || !data ? "Loading evidenced signals…" : data.exceptions.headline}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading || !data ? (
                <Skeleton className="h-40 w-full" />
              ) : data.exceptions.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing requires intervention from the evidenced signals in this window. This is an absence of
                  detected exceptions, not proof of a healthy marketplace.
                </p>
              ) : (
                <div className="space-y-4">
                  {data.exceptions.items.map((e) => (
                    <div key={e.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{EXCEPTION_LABEL[e.kind]}</span>
                        <Badge variant="outline">{e.severity === "act_now" ? "Act now" : e.severity === "act_today" ? "Act today" : "Monitor"}</Badge>
                        <span className="text-xs text-muted-foreground">Priority {e.priority.toFixed(0)}/100</span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{e.detail}</p>
                      <p className="mt-2 text-sm"><span className="font-medium">Action: </span>{e.action}</p>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {e.factors.map((f) => (
                          <li key={f.factor}>{f.factor}: {f.observed} (+{f.contribution.toFixed(1)})</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --------------------------------------------------- simulation */}
        <TabsContent value="simulation" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Simulation lab</CardTitle>
              <CardDescription>
                Scenario outcomes against an explicit reference baseline. Simulated output is never SAFARID performance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scenario</TableHead>
                    <TableHead>Fulfilment</TableHead>
                    <TableHead>Contribution</TableHead>
                    <TableHead>Operator earnings / hr</TableHead>
                    <TableHead>Binding risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scenarios.map((s) => (
                    <TableRow key={s.scenarioId}>
                      <TableCell className="align-top">
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.question}</div>
                      </TableCell>
                      <TableCell className="align-top"><MeasureBlock m={s.fulfilmentRate} /></TableCell>
                      <TableCell className="align-top"><MeasureBlock m={s.contribution} /></TableCell>
                      <TableCell className="align-top"><MeasureBlock m={s.operatorEarningsPerHour} /></TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">{s.riskNote}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">{scenarios[0]?.disclaimer}</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --------------------------------------------------- resilience */}
        <TabsContent value="resilience" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dependency exposure</CardTitle>
              <CardDescription>Single points of failure across operators, categories, locations, payments and technology.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-40 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dependency</TableHead>
                      <TableHead>Concentration</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Mitigation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resilience.map((r) => (
                      <TableRow key={`${r.kind}:${r.name}`}>
                        <TableCell className="align-top">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">{r.kind}</div>
                        </TableCell>
                        <TableCell className="align-top"><MeasureBlock m={r.concentration} /></TableCell>
                        <TableCell className="align-top">
                          <Badge variant="outline" className={r.severity === "critical" ? "border-destructive/30 bg-destructive/10 text-destructive" : undefined}>
                            {r.severity.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">{r.mitigation}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ certification */}
        <TabsContent value="certification" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><ListChecks className="h-4 w-4" />Phase 9 exit criteria</CardTitle>
              <CardDescription>{certification.statement}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Progress value={(certification.demonstratedLive / certification.criteria.length) * 100} />
                <p className="text-xs text-muted-foreground">
                  {certification.demonstratedLive} of {certification.criteria.length} criteria demonstrated against live data.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Criterion</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certification.criteria.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.label}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={c.status === "demonstrated_live" ? tone.LIVE : c.status === "not_implemented" ? "border-destructive/30 bg-destructive/10 text-destructive" : tone.MODELLED}>
                          {c.status === "demonstrated_live" ? "Live" : c.status === "implemented_awaiting_data" ? "Awaiting data" : "Not implemented"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.detail}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Anti-patterns the auditor blocks on: {ANTI_PATTERN_LABEL.promise_without_supply}, {ANTI_PATTERN_LABEL.revenue_without_settlement},{" "}
                {ANTI_PATTERN_LABEL.false_live_metric}, {ANTI_PATTERN_LABEL.supply_without_quality_control}.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
