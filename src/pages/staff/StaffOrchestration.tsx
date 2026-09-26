/**
 * Phase 10 — Mission Control Tower (§10.17, §10.39, §10.40).
 *
 * This is not a dashboard of tiles. It is the operating surface of the platform:
 * what demand exists, what supply can serve it, what the matching engine decided,
 * where the chain breaks, what the council recommends, and whether the whole
 * architecture is certifiable. Anything the evidence cannot support is shown as a
 * gap — never filled with a plausible number.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Activity, BadgeCheck, Boxes, Brain, GitBranch, Layers, Network, RefreshCw,
  ShieldAlert, Signal, Users2, Workflow,
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
import { formatMeasure, PROVENANCE_LABEL, type Measure } from "@/lib/staff/phase8/provenance";
import {
  loadOrchestrationState, MISSION_LABEL, STATE_LABEL, TRUST_FACET_LABEL,
  type MissionDemonstration, type OrchestrationState,
} from "@/lib/staff/phase10";

function ProvenanceBadge({ provenance }: { provenance: string }) {
  const tone = provenance === "LIVE" ? "border-primary/40 text-primary"
    : provenance === "MODELLED" ? "border-info/40 text-info"
    : provenance === "SIMULATED" ? "border-warning/40 text-warning-foreground"
    : "border-border text-muted-foreground";
  return (
    <Badge variant="outline" className={`text-[10px] tracking-wide ${tone}`}>
      {PROVENANCE_LABEL[provenance as keyof typeof PROVENANCE_LABEL] ?? provenance}
    </Badge>
  );
}

function MeasureCell({ measure }: { measure: Measure }) {
  return (
    <div className="flex items-center gap-2">
      <span className="tabular-nums">{formatMeasure(measure)}</span>
      <ProvenanceBadge provenance={measure.provenance} />
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const tone = verdict === "pass" || verdict === "autopilot" || verdict === "healthy" || verdict === "balanced"
    ? "bg-primary/15 text-primary border-primary/30"
    : verdict === "conditional" || verdict === "approval_required"
      ? "bg-info/15 text-info border-info/30"
      : verdict === "fail" || verdict === "human_decision"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : "bg-warning/15 text-warning-foreground border-warning/30";
  return <Badge variant="outline" className={tone}>{verdict.replace(/_/g, " ")}</Badge>;
}

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: typeof Network }) {
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

function MissionChain({ demo }: { demo: MissionDemonstration }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{MISSION_LABEL[demo.missionType]}</span>
        <VerdictBadge verdict={demo.chainComplete ? "pass" : "fail"} />
        <span className="text-xs text-muted-foreground">
          {demo.statesExecuted.length} of {demo.machine.length} governed states executed
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {demo.stages.map((stage) => (
          <div key={stage.stage} className="flex items-start gap-3 rounded-md border border-border/60 p-3">
            <span
              aria-hidden
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${stage.evidenced ? "bg-primary" : "bg-warning"}`}
            />
            <div className="min-w-0">
              <div className="text-xs font-medium">{stage.stage}</div>
              <div className="text-xs text-muted-foreground">{stage.detail}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">{stage.source}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Matching decision</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="text-muted-foreground">{demo.match.best?.explanation ?? demo.match.noMatchReason ?? "No match produced"}</p>
            {demo.match.best ? (
              <div className="space-y-1">
                {demo.match.best.components.map((c) => (
                  <div key={c.dimension} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{c.dimension.replace(/_/g, " ")}</span>
                    <span className="tabular-nums">{c.score === null ? "not measured" : Math.round(c.score)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {demo.match.rejected.length > 0 ? (
              <p className="text-muted-foreground">
                Rejected: {demo.match.rejected.map((r) => `${r.providerName} (${r.infeasibilities.join("; ")})`).join(" · ")}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Trust &amp; safety</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <Progress value={demo.trust.completeness} className="h-1.5" />
            <p className="text-muted-foreground">{demo.trust.narrative}</p>
            {demo.trust.missing.length > 0 ? (
              <p className="text-muted-foreground">
                Missing: {demo.trust.missing.map((f) => TRUST_FACET_LABEL[f]).join(", ")}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Exception &amp; decision</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <VerdictBadge verdict={demo.exception.mode} />
              <span className="text-muted-foreground">{demo.exception.exception.kind.replace(/_/g, " ")}</span>
            </div>
            <p className="text-muted-foreground">{demo.exception.recommendation}</p>
            <Separator />
            <p className="text-muted-foreground">{demo.decision.recommendation}</p>
            <p className="text-muted-foreground">
              Authority: {demo.decision.approvalRequirement.replace(/_/g, " ")} · confidence {demo.decision.confidence}%
            </p>
          </CardContent>
        </Card>
      </div>

      {demo.blockers.length > 0 ? (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
          <div className="mb-1 font-medium">Blockers on this chain</div>
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {demo.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function StaffOrchestration() {
  const [state, setState] = useState<OrchestrationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const next = await loadOrchestrationState();
    setState(next);
    setSelected((prev) => prev ?? next.demonstrations[0]?.missionType ?? null);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const demo = useMemo(
    () => state?.demonstrations.find((d) => d.missionType === selected) ?? state?.demonstrations[0] ?? null,
    [state, selected],
  );

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Phase 10 · Platform orchestration"
        title="How Yalla orchestrates demand, supply and money across every market and service"
        lede="One mission object, one state machine, one matching engine and one economic chain — coordinating independent providers rather than owning assets. Certification is earned on evidence, not presentation."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Re-run orchestration
          </Button>
        }
      />

      {loading || !state ? (
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              icon={BadgeCheck}
              label="Phase 10 certification"
              value={`${state.certification.score}/100`}
              sub={state.certification.verdict.toUpperCase()}
            />
            <Stat
              icon={Layers}
              label="Breadth demonstrated"
              value={`${state.certification.breadth.productLines} products`}
              sub={`${state.certification.breadth.demandTypes} demand types · ${state.certification.breadth.supplyKinds} supply types`}
            />
            <Stat
              icon={Activity}
              label="Recognised revenue"
              value={state.facts.recognisedRevenueCents === null ? "Not observed" : `KES ${Math.round(state.facts.recognisedRevenueCents / 100).toLocaleString()}`}
              sub={`${state.facts.transactions} transactions in the spine`}
            />
            <Stat
              icon={Users2}
              label="Independent supply"
              value={`${state.facts.providers || state.providers.length}`}
              sub={`${state.facts.customers} distinct customers served`}
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Certification verdict</CardTitle>
                  <CardDescription>{state.certification.narrative}</CardDescription>
                </div>
                <VerdictBadge verdict={state.certification.verdict} />
              </div>
            </CardHeader>
            <CardContent><Progress value={state.certification.score} className="h-2" /></CardContent>
          </Card>

          <Tabs defaultValue="chain">
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="chain"><Workflow className="mr-1.5 h-3.5 w-3.5" /> Mission chain</TabsTrigger>
              <TabsTrigger value="liquidity"><Signal className="mr-1.5 h-3.5 w-3.5" /> Liquidity brain</TabsTrigger>
              <TabsTrigger value="products"><Boxes className="mr-1.5 h-3.5 w-3.5" /> Products &amp; revenue</TabsTrigger>
              <TabsTrigger value="supply"><Users2 className="mr-1.5 h-3.5 w-3.5" /> Provider 360</TabsTrigger>
              <TabsTrigger value="council"><Brain className="mr-1.5 h-3.5 w-3.5" /> Certification &amp; council</TabsTrigger>
              <TabsTrigger value="graph"><GitBranch className="mr-1.5 h-3.5 w-3.5" /> Knowledge &amp; network</TabsTrigger>
            </TabsList>

            <TabsContent value="chain" className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                {state.demonstrations.map((d) => (
                  <Button
                    key={d.missionType}
                    size="sm"
                    variant={d.missionType === demo?.missionType ? "default" : "outline"}
                    onClick={() => setSelected(d.missionType)}
                  >
                    {MISSION_LABEL[d.missionType]}
                  </Button>
                ))}
              </div>
              {demo ? <MissionChain demo={demo} /> : null}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Universal state machine for this product</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  {demo?.machine.map((s) => (
                    <Badge
                      key={s}
                      variant="outline"
                      className={demo.statesExecuted.includes(s) ? "border-primary/40 text-primary" : "text-muted-foreground"}
                    >
                      {STATE_LABEL[s]}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="liquidity" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Demand and supply balance, ranked by value at stake</CardTitle>
                  <CardDescription>Cells without telemetry are reported as unmeasured rather than assumed balanced.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cell</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Balance</TableHead>
                        <TableHead>Leading intervention</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.liquidity.map((l) => (
                        <TableRow key={l.cell.id}>
                          <TableCell className="text-xs">
                            <div className="font-medium">{l.cell.market} · {l.cell.zone}</div>
                            <div className="text-muted-foreground">{l.cell.service} · {l.cell.window}</div>
                          </TableCell>
                          <TableCell><VerdictBadge verdict={l.state} /></TableCell>
                          <TableCell className="text-xs"><MeasureCell measure={l.supplyGap} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {l.interventions[0]?.action ?? l.gaps[0] ?? "No intervention required"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="products" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Product 360 and the enterprise revenue tree</CardTitle>
                  <CardDescription>{state.revenueTree.label}: {formatMeasure(state.revenueTree.revenue)} revenue · {formatMeasure(state.revenueTree.contribution)} contribution</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product line</TableHead>
                        <TableHead>Missions</TableHead>
                        <TableHead>Revenue</TableHead>
                        <TableHead>Contribution</TableHead>
                        <TableHead>Margin</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.products.map((p) => (
                        <TableRow key={p.entry.productLine}>
                          <TableCell className="text-xs">
                            <div className="font-medium">{p.entry.label}</div>
                            <div className="text-muted-foreground">{p.entry.ownerRole} · {p.entry.revenueModel}</div>
                          </TableCell>
                          <TableCell className="text-xs"><MeasureCell measure={p.missions} /></TableCell>
                          <TableCell className="text-xs"><MeasureCell measure={p.revenue} /></TableCell>
                          <TableCell className="text-xs"><MeasureCell measure={p.contribution} /></TableCell>
                          <TableCell className="text-xs"><MeasureCell measure={p.contributionMargin} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Enterprise KPI tree</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {state.kpiTree.children.map((k) => (
                    <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-3 text-xs">
                      <div>
                        <div className="font-medium">{k.label}</div>
                        <div className="text-muted-foreground">Owner {k.owner}{k.feeds ? ` · feeds ${k.feeds.replace(/_/g, " ")}` : ""}</div>
                      </div>
                      <MeasureCell measure={k.measure} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="supply" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Independent providers coordinated by the platform</CardTitle>
                  <CardDescription>Quality is withheld where telemetry coverage is insufficient, rather than estimated.</CardDescription>
                </CardHeader>
                <CardContent>
                  {state.providers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">The provider registry returned no readable rows for this role.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Provider</TableHead>
                          <TableHead>Kind</TableHead>
                          <TableHead>Quality</TableHead>
                          <TableHead>Standing</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {state.providers.slice(0, 12).map((p) => (
                          <TableRow key={p.identity.providerId}>
                            <TableCell className="text-xs">
                              <div className="font-medium">{p.identity.name}</div>
                              <div className="text-muted-foreground">{p.identity.markets.join(", ") || "Market not recorded"}</div>
                            </TableCell>
                            <TableCell className="text-xs">{p.identity.kind}</TableCell>
                            <TableCell className="text-xs tabular-nums">
                              {p.quality.score === null ? "Withheld" : `${Math.round(p.quality.score)}/100`}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {p.riskFlags[0] ?? p.quality.note ?? "No risk flags"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="council" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Phase 10 certification criteria</CardTitle>
                  <CardDescription>Presentation earns nothing. Each criterion passes only on evidence.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Requirement</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>Evidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.certification.criteria.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-xs font-medium">{c.requirement}</TableCell>
                          <TableCell><VerdictBadge verdict={c.passed ? "pass" : "fail"} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {c.evidence}
                            {c.remediation ? <div className="mt-0.5 text-warning-foreground">{c.remediation}</div> : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Exception autopilot posture</CardTitle>
                  <CardDescription>
                    {state.exceptions.total} exception(s) routed · automation rate{" "}
                    {state.exceptions.automationRate === null ? "not measurable" : `${Math.round(state.exceptions.automationRate)}%`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3 text-xs">
                  <div><div className="text-muted-foreground">Automated</div><div className="text-lg font-semibold tabular-nums">{state.exceptions.autopilot}</div></div>
                  <div><div className="text-muted-foreground">Approval required</div><div className="text-lg font-semibold tabular-nums">{state.exceptions.approvalRequired}</div></div>
                  <div><div className="text-muted-foreground">Human decision</div><div className="text-lg font-semibold tabular-nums">{state.exceptions.humanDecision}</div></div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="graph" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Enterprise knowledge graph</CardTitle>
                  <CardDescription>
                    {state.knowledge.instrumented} of {state.knowledge.total} entities have an authoritative source of truth
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <MeasureCell measure={state.knowledge.coverage} />
                  {state.knowledge.gaps.length > 0 ? (
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {state.knowledge.gaps.map((g) => <li key={g}>{g}</li>)}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Network effects</CardTitle>
                  <CardDescription>{state.network.narrative}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <MeasureCell measure={state.network.score} />
                  {state.network.unmeasured.length > 0 ? (
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {state.network.unmeasured.map((g) => <li key={g}>{g}</li>)}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {state.gaps.length > 0 ? (
            <Card className="border-warning/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldAlert className="h-4 w-4" /> Instrumentation gaps
                </CardTitle>
                <CardDescription>Reported rather than filled with plausible numbers.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {state.gaps.map((g) => <li key={g}>{g}</li>)}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
