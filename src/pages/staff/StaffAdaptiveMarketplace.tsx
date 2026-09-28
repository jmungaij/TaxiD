/**
 * Phase 11 — Executive Adaptive Command Centre (§11.28, §11.29, §11.30, §11.31).
 *
 * Not another KPI dashboard. This surface answers: what is happening, what is
 * about to happen, why, what TaxiD should do, what happens if it does nothing,
 * what the expected value is, who must approve, and what happened after the last
 * decision. Everything the evidence cannot support is shown as an instrumentation
 * gap rather than a plausible number.
 */
import { useEffect, useState } from "react";
import {
  Activity, AlertTriangle, BadgeCheck, Brain, Gauge, HelpCircle, Layers,
  Radar, RefreshCw, ShieldCheck, Sparkles, Split, TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { StaffPageHeader } from "@/components/staff/primitives";
import { formatMeasure } from "@/lib/staff/phase8/provenance";
import {
  AUTONOMY_LABEL, AGENT_CONTRACTS, CAUSAL_LABEL, INTERVENTION_LABEL, KILL_SWITCHES,
  LOOP_STAGE_LABEL, POLICY_REGISTRY, PREDICTION_LABEL, SIGNAL_DOMAIN_LABEL,
  STATE_LABEL_TEXT, loadAdaptiveState, type AdaptiveState,
} from "@/lib/staff/phase11";

const kes = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "Not observed" : `KES ${Math.round(cents / 100).toLocaleString()}`;

function StatusBadge({ status }: { status: string }) {
  const tone =
    ["complete", "pass", "met", "aligned", "healthy", "compounding", "recommended", "balanced"].includes(status)
      ? "bg-primary/15 text-primary border-primary/30"
      : ["blocked", "fail", "breached", "material_gap", "retire", "rejected", "activity_only"].includes(status)
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : ["conditional", "viable", "watch", "suggestive"].includes(status)
          ? "bg-info/15 text-info border-info/30"
          : "bg-warning/15 text-warning-foreground border-warning/30";
  return <Badge variant="outline" className={tone}>{status.replace(/_/g, " ")}</Badge>;
}

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: typeof Radar }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 text-xs">
          <Icon className="h-3.5 w-3.5" /> {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

export default function StaffAdaptiveMarketplace() {
  const [state, setState] = useState<AdaptiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAdaptiveState()
      .then((s) => {
        if (!cancelled) {
          setState(s);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "The adaptive layer could not be assembled");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="Adaptive Marketplace Engine"
        lede="Sense → understand → predict → simulate → decide → approve → act → observe → measure → learn → adapt. Closed-loop enterprise intelligence under human governance — never uncontrolled autonomy."
        actions={
          <Button variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Re-run the loop
          </Button>
        }
      />

      {error ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive" /> The adaptive layer is unavailable
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {loading || !state ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat
              icon={Radar}
              label="Loop status"
              value={state.run.closed ? "Closed" : `Open at ${LOOP_STAGE_LABEL[state.run.blockedAt ?? "sense"]}`}
              sub={state.run.trigger}
            />
            <Stat
              icon={Gauge}
              label="Certification"
              value={`${state.certification.score}/100`}
              sub={state.certification.verdict.toUpperCase()}
            />
            <Stat
              icon={TrendingUp}
              label="Contribution at risk"
              value={kes(state.priorityCell?.valueAtRiskCents ?? null)}
              sub={state.priorityCell ? STATE_LABEL_TEXT[state.priorityCell.label] : "No measurable cell"}
            />
            <Stat
              icon={ShieldCheck}
              label="Governance"
              value={`${state.governance.contracts} contracts · ${state.governance.policies} policies`}
              sub={`${state.governance.killSwitches} kill switch(es), ${state.governance.killSwitchesEngaged} engaged`}
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4" /> Verdict
              </CardTitle>
              <CardDescription>{state.certification.narrative}</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{state.run.narrative}</CardContent>
          </Card>

          <Tabs defaultValue="loop">
            <TabsList className="flex w-full flex-wrap justify-start">
              <TabsTrigger value="loop">Adaptive loop</TabsTrigger>
              <TabsTrigger value="sensing">Sensing &amp; state</TabsTrigger>
              <TabsTrigger value="predict">Prediction</TabsTrigger>
              <TabsTrigger value="decide">Decide</TabsTrigger>
              <TabsTrigger value="governance">Governance</TabsTrigger>
              <TabsTrigger value="reliability">Reliability</TabsTrigger>
              <TabsTrigger value="learning">Learning</TabsTrigger>
              <TabsTrigger value="certification">Certification</TabsTrigger>
            </TabsList>

            {/* ------------------------------------------------------------ loop */}
            <TabsContent value="loop" className="space-y-4 pt-4">
              <div className="grid gap-2 md:grid-cols-2">
                {state.run.stages.map((s) => (
                  <div key={s.stage} className="flex items-start gap-3 rounded-md border border-border/60 p-3">
                    <span
                      aria-hidden
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        s.status === "complete" ? "bg-primary" : s.status === "blocked" ? "bg-destructive" : "bg-warning"
                      }`}
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{LOOP_STAGE_LABEL[s.stage]}</span>
                        <StatusBadge status={s.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">{s.detail}</p>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{s.evidence}</p>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* --------------------------------------------------------- sensing */}
            <TabsContent value="sensing" className="space-y-4 pt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Enterprise sensing layer</CardTitle>
                  <CardDescription>
                    {state.sensing.instrumented} of {state.sensing.catalogued} catalogued signals have a system of record;{" "}
                    {state.sensing.observed} were observed and admitted in this window.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Progress value={state.sensing.coveragePct} className="h-1.5" />
                  <div className="grid gap-2 md:grid-cols-3">
                    {state.sensing.byDomain.map((d) => (
                      <div key={d.domain} className="rounded-md border border-border/60 p-3 text-xs">
                        <div className="font-medium">{SIGNAL_DOMAIN_LABEL[d.domain]}</div>
                        <div className="text-muted-foreground">
                          {d.instrumented}/{d.total} instrumented · {d.observed} observed
                        </div>
                      </div>
                    ))}
                  </div>
                  {state.sensing.blindSpots.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Blind spots: {state.sensing.blindSpots.join(", ")}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Marketplace state</CardTitle>
                  <CardDescription>
                    {state.stateSummary.measured} of {state.stateSummary.cells} cells measurable · mean dimensional completeness{" "}
                    {state.stateSummary.instrumentation}%
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cell</TableHead>
                        <TableHead>Service &amp; window</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead className="text-right">Tension</TableHead>
                        <TableHead className="text-right">At risk</TableHead>
                        <TableHead className="text-right">Completeness</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.states.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-xs">
                            <div className="font-medium">{c.granularity.city ?? c.granularity.market}</div>
                            <div className="text-muted-foreground">{c.granularity.corridor ?? c.granularity.zone ?? "—"}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {c.granularity.service} · {c.granularity.window}
                          </TableCell>
                          <TableCell><StatusBadge status={c.label} /></TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{c.tension ?? "—"}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{kes(c.valueAtRiskCents)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{c.completeness}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ------------------------------------------------------ prediction */}
            <TabsContent value="predict" className="space-y-4 pt-4">
              <div className="grid gap-4 md:grid-cols-3">
                {state.predictions.map((p) => (
                  <Card key={`${p.kind}-${p.cellId}`}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{PREDICTION_LABEL[p.kind]}</CardTitle>
                      <CardDescription>{p.horizon}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="text-lg font-semibold tabular-nums">{formatMeasure(p.forecast)}</div>
                      <div className="text-muted-foreground">
                        {p.confidence === null ? "Confidence withheld" : `${p.confidence}% confidence`}
                        {p.uncertainty ? ` · band ${p.uncertainty.low}–${p.uncertainty.high}` : ""}
                      </div>
                      <div className="text-muted-foreground">Method: {p.method}</div>
                      <div className="text-muted-foreground">{p.note}</div>
                      {p.drivers.length > 0 ? (
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          Drivers: {p.drivers.join(" · ")}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Prediction performance (Gate B)</CardTitle>
                  <CardDescription>
                    {state.predictionCoverage.gateBReady
                      ? `${state.predictionCoverage.measured} kind(s) scored against actuals`
                      : "No prediction has yet been scored against an actual outcome — accuracy may not be claimed"}
                  </CardDescription>
                </CardHeader>
                {state.predictionQuality.length > 0 ? (
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Kind</TableHead>
                          <TableHead className="text-right">Samples</TableHead>
                          <TableHead className="text-right">MAPE</TableHead>
                          <TableHead className="text-right">Bias</TableHead>
                          <TableHead>Calibrated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {state.predictionQuality.map((q) => (
                          <TableRow key={q.kind}>
                            <TableCell className="text-xs">{PREDICTION_LABEL[q.kind]}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{q.samples}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{q.mape === null ? "—" : `${q.mape}%`}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{q.bias === null ? "—" : `${q.bias}%`}</TableCell>
                            <TableCell className="text-xs">{q.calibrated === null ? "not assessed" : q.calibrated ? "yes" : "no"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                ) : null}
              </Card>
            </TabsContent>

            {/* ---------------------------------------------------------- decide */}
            <TabsContent value="decide" className="space-y-4 pt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Next best action</CardTitle>
                  <CardDescription>{state.run.optimiser.narrative}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Intervention</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Contribution</TableHead>
                        <TableHead className="text-right">EIEV</TableHead>
                        <TableHead className="text-right">Confidence</TableHead>
                        <TableHead>Verdict</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-xs font-medium">Do nothing (baseline)</TableCell>
                        <TableCell className="text-right text-xs">—</TableCell>
                        <TableCell className="text-right text-xs">—</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{kes(0)}</TableCell>
                        <TableCell className="text-right text-xs">100%</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{state.run.optimiser.baseline.rationale}</TableCell>
                      </TableRow>
                      {state.run.optimiser.ranked.map((r) => (
                        <TableRow key={r.option.id}>
                          <TableCell className="text-xs">
                            <div className="font-medium">{INTERVENTION_LABEL[r.option.kind]}</div>
                            <div className="text-muted-foreground">{r.option.description}</div>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{kes(r.option.costCents)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{kes(r.expectedContributionCents)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{kes(r.eiev)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.option.confidence}%</TableCell>
                          <TableCell><StatusBadge status={r.verdict} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <HelpCircle className="h-4 w-4" /> Why this recommendation?
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs">
                    {state.why === null ? (
                      <p className="text-muted-foreground">No recommendation reached the decision stage, so nothing may be explained.</p>
                    ) : (
                      <>
                        <p className="font-medium">{state.why.recommendation}</p>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Evidence</div>
                          <ul className="list-disc pl-4 text-muted-foreground">
                            {state.why.evidence.map((v) => <li key={v}>{v}</li>)}
                          </ul>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Data sources</div>
                          <p className="text-muted-foreground">{state.why.dataSources.join(" · ")}</p>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Assumptions</div>
                          <p className="text-muted-foreground">{state.why.assumptions.join(" · ")}</p>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Model &amp; confidence</div>
                          <p className="text-muted-foreground">
                            {state.why.model} · {state.why.confidence === null ? "confidence withheld" : `${state.why.confidence}%`}
                          </p>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Expected impact</div>
                          <p className="text-muted-foreground">{state.why.expectedImpact}</p>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Risks</div>
                          <p className="text-muted-foreground">{state.why.risks.join(" · ")}</p>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Alternatives</div>
                          <ul className="list-disc pl-4 text-muted-foreground">
                            {state.why.alternatives.map((v) => <li key={v}>{v}</li>)}
                          </ul>
                        </div>
                        <Separator />
                        <p className="text-muted-foreground">{state.why.decisionThreshold}</p>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Split className="h-4 w-4" /> What if?
                    </CardTitle>
                    <CardDescription>Decision science, not a single point forecast.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs">
                    {state.whatIf.map((b) => (
                      <div key={b.question}>
                        <div className="font-medium">{b.question}</div>
                        <p className="text-muted-foreground">{b.outcome}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Multi-sided incentive balance</CardTitle>
                  <CardDescription>Optimised on incremental contribution, never on gross bookings.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {state.incentives.length === 0 ? (
                    <p className="text-muted-foreground">No incentive-bearing intervention is currently valued.</p>
                  ) : (
                    state.incentives.map((i) => (
                      <div key={i.side} className="flex items-center justify-between gap-2">
                        <span className="capitalize">{i.side.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">
                          cost {kes(i.totalCostCents)} → contribution {kes(i.totalContributionCents)}
                          {i.returnRatio === null ? "" : ` (×${i.returnRatio})`}
                        </span>
                      </div>
                    ))
                  )}
                  <Separator />
                  <div className="flex items-center gap-2">
                    <StatusBadge status={state.flywheel.verdict} />
                    <span className="text-muted-foreground">{state.flywheel.narrative}</span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ------------------------------------------------------ governance */}
            <TabsContent value="governance" className="space-y-4 pt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Authority decision</CardTitle>
                  <CardDescription>
                    {state.run.authority
                      ? `${AUTONOMY_LABEL[state.run.authority.effectiveLevel]} · ${
                          state.run.authority.requiresApproval
                            ? `requires ${state.run.authority.approverRole}`
                            : "executes under guardrails"
                        }`
                      : "No action reached the authority gate"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  {(state.run.authority?.reasons ?? ["—"]).map((r) => <p key={r}>{r}</p>)}
                  {state.run.authority?.policy ? (
                    <p className="text-foreground">
                      Policy {state.run.authority.policy.id}: {state.run.authority.policy.statement}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><Brain className="h-4 w-4" /> Agent contracts</CardTitle>
                  <CardDescription>
                    {state.governance.contracts} contracts, {state.governance.defectiveContracts.length} defective. Autonomy:{" "}
                    {Object.entries(state.governance.autonomyDistribution).map(([k, v]) => `${k}×${v}`).join(" · ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead>Purpose</TableHead>
                        <TableHead>Authority</TableHead>
                        <TableHead>Prohibited</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {AGENT_CONTRACTS.map((a) => (
                        <TableRow key={a.key}>
                          <TableCell className="text-xs font-medium">{a.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{a.purpose}</TableCell>
                          <TableCell className="text-xs">{a.authority}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{a.actionsProhibited.join("; ")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Policy engine</CardTitle>
                    <CardDescription>The AI layer operates inside policy, not around it.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    {POLICY_REGISTRY.map((p) => (
                      <div key={p.id} className="rounded-md border border-border/60 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium capitalize">{p.domain.replace(/_/g, " ")}</span>
                          <Badge variant="outline" className="text-[10px]">{p.maxAutonomy}</Badge>
                        </div>
                        <p className="text-muted-foreground">{p.statement}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Kill switches &amp; human takeover</CardTitle>
                    <CardDescription>Technically enforced, not merely written in policy.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    {KILL_SWITCHES.map((k) => (
                      <div key={k.scope} className="rounded-md border border-border/60 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{k.scope.replace(/_/g, " ")}</span>
                          <StatusBadge status={k.enabled ? "met" : "blocked"} />
                        </div>
                        <p className="text-muted-foreground">Rollback: {k.rollback}</p>
                        <p className="text-muted-foreground">Takeover: {k.manualTakeover}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ----------------------------------------------------- reliability */}
            <TabsContent value="reliability" className="space-y-4 pt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Service level objectives</CardTitle>
                  <CardDescription>{state.reliability.narrative}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SLO</TableHead>
                        <TableHead>Target</TableHead>
                        <TableHead className="text-right">Observed</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.reliability.slos.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="text-xs font-medium">{s.label}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{s.target}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{s.observed === null ? "—" : s.observed}</TableCell>
                          <TableCell><StatusBadge status={s.status} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{s.source}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Trust &amp; safety intelligence</CardTitle>
                    <CardDescription>
                      Detect → score → explain → verify → intervene → review → learn. No punishment on an opaque score.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs text-muted-foreground">
                    <p>{state.trust.findings} finding(s) across {state.trust.patternsCovered}/{state.trust.patternsTotal} monitored patterns.</p>
                    <p>{state.trust.blocked} finding(s) correctly blocked before intervention.</p>
                    <p>{state.trust.noPunishmentWithoutReview ? "No finding progressed without verification and a named reviewer." : "A finding progressed without review — this must be corrected."}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Exception learning loop</CardTitle>
                    <CardDescription>Every exception becomes structured, classified data.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs text-muted-foreground">
                    <p>{state.exceptions.total} exception(s), {state.exceptions.systemic} systemic, {state.exceptions.unclassified} unclassified.</p>
                    <p>AI detection rate: {state.exceptions.aiDetectionRate === null ? "not measured" : `${state.exceptions.aiDetectionRate}%`}.</p>
                    {state.exceptions.patterns.map((p) => (
                      <p key={p.signature}>Recurring ×{p.occurrences}: {p.example}</p>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* -------------------------------------------------------- learning */}
            <TabsContent value="learning" className="space-y-4 pt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Digital twin → reality comparator</CardTitle>
                  <CardDescription>{state.run.calibration.narrative}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dimension</TableHead>
                        <TableHead className="text-right">Expected</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.run.calibration.results.map((r) => (
                        <TableRow key={r.dimension}>
                          <TableCell className="text-xs capitalize">{r.dimension.replace(/_/g, " ")}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.expected === null ? "—" : r.expected}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.actual === null ? "—" : r.actual}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.variancePct === null ? "—" : `${r.variancePct}%`}</TableCell>
                          <TableCell><StatusBadge status={r.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm"><BadgeCheck className="h-4 w-4" /> Prove it</CardTitle>
                    <CardDescription>The only economic claim Phase 11 is permitted to make.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <p className="text-foreground">{state.proof.claimable}</p>
                    <p className="text-muted-foreground">
                      Correlated but not causally validated: {kes(state.proof.correlatedContributionCents)}
                    </p>
                    <Separator />
                    <div className="space-y-1">
                      <div className="font-medium">Intervention ledger</div>
                      {state.proof.entries.map((e) => (
                        <div key={e.id} className="text-muted-foreground">
                          <div>{e.interventionClass}</div>
                          <div>Prediction: {e.prediction} · Action: {e.action}</div>
                          <div>
                            Outcome: {e.actualOutcome ?? "not observed"} · Variance:{" "}
                            {e.variancePct === null ? "—" : `${e.variancePct}%`} · {CAUSAL_LABEL[e.causal]}
                          </div>
                          <div>Lesson: {e.lesson ?? "none recorded"}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm"><Layers className="h-4 w-4" /> Model register &amp; drift</CardTitle>
                    <CardDescription>
                      {state.models.healthy} healthy · {state.models.needingAction} needing action · {state.models.unevaluated} unevaluated
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    {state.models.models.map((m) => (
                      <div key={m.model.id} className="rounded-md border border-border/60 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{m.model.name}</span>
                          <StatusBadge status={m.status} />
                        </div>
                        <p className="text-muted-foreground">
                          {m.model.owner} · {m.model.version} · {m.model.trainingProvenance}
                        </p>
                        <p className="text-muted-foreground">
                          {m.issues.length === 0 ? "No open issues" : `Issues: ${m.issues.join(", ")}`}
                        </p>
                        <p className="text-muted-foreground">Retirement: {m.model.retirementCriteria}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* --------------------------------------------------- certification */}
            <TabsContent value="certification" className="space-y-4 pt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4" /> Gates A–J
                  </CardTitle>
                  <CardDescription>{state.certification.narrative}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">Gate</TableHead>
                        <TableHead>Requirement</TableHead>
                        <TableHead>Evidence</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.certification.gates.map((g) => (
                        <TableRow key={g.id}>
                          <TableCell className="text-xs font-semibold">{g.id}</TableCell>
                          <TableCell className="text-xs">
                            <div className="font-medium">{g.name}</div>
                            <div className="text-muted-foreground">{g.requirement}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {g.evidence}
                            {g.remediation ? <div className="mt-1 text-warning-foreground">{g.remediation}</div> : null}
                          </TableCell>
                          <TableCell><StatusBadge status={g.passed ? "pass" : "fail"} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Instrumentation gaps</CardTitle>
                  <CardDescription>
                    Exit condition {state.certification.exitConditionMet ? "met" : "not met"} — the loop must close on a real
                    condition, with measured outcome and tested incrementality.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-xs text-muted-foreground">
                  {state.gaps.length === 0 ? <p>No open gaps.</p> : state.gaps.map((g) => <p key={g}>• {g}</p>)}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
