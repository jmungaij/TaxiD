/**
 * Phase 9 — Market Expansion & Network Intelligence.
 *
 * Five questions: which market, what is it worth, what does entry cost, can we
 * fulfil it, and does the council agree. Anything the evidence cannot support is
 * shown as a gap — never filled with a plausible number.
 */
import { useEffect, useMemo, useState } from "react";
import { Compass, Gauge, Globe2, Layers, Network, RefreshCw, ShieldAlert, Sprout, Users2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { StaffPageHeader } from "@/components/staff/primitives";
import {
  DEFAULT_ENVELOPE, buildExpansionProgramme, formatMeasureSafe, loadMarketRecords,
  type ExpansionProgramme, type MarketAssessment,
} from "@/lib/staff/expansion/ui";
import { PROVENANCE_LABEL } from "@/lib/staff/phase8/provenance";

function ProvenanceBadge({ provenance }: { provenance: string }) {
  const tone = provenance === "LIVE" ? "border-primary/40 text-primary"
    : provenance === "MODELLED" ? "border-info/40 text-info"
    : provenance === "SIMULATED" ? "border-warning/40 text-warning-foreground"
    : "border-border text-muted-foreground";
  return <Badge variant="outline" className={`text-[10px] tracking-wide ${tone}`}>{PROVENANCE_LABEL[provenance as keyof typeof PROVENANCE_LABEL] ?? provenance}</Badge>;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const tone = verdict === "go" || verdict === "advance" ? "bg-primary/15 text-primary border-primary/30"
    : verdict === "conditional_go" || verdict === "advance_with_conditions" ? "bg-info/15 text-info border-info/30"
    : verdict === "defer" || verdict === "hold" ? "bg-warning/15 text-warning-foreground border-warning/30"
    : "bg-destructive/15 text-destructive border-destructive/30";
  return <Badge variant="outline" className={tone}>{verdict.replace(/_/g, " ")}</Badge>;
}

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: typeof Globe2 }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 text-xs"><Icon className="h-3.5 w-3.5" /> {label}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

export default function StaffExpansion() {
  const [programme, setProgramme] = useState<ExpansionProgramme | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const records = await loadMarketRecords();
    const p = buildExpansionProgramme(records, DEFAULT_ENVELOPE);
    setProgramme(p);
    setSelectedId((prev) => prev ?? p.assessments[0]?.record.definition.id ?? null);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const selected: MarketAssessment | null = useMemo(
    () => programme?.assessments.find((a) => a.record.definition.id === selectedId) ?? null,
    [programme, selectedId],
  );

  const decidable = programme?.assessments.filter((a) => a.decision.evidenceRequired.length === 0).length ?? 0;

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Phase 9 · Market expansion"
        title="Where should Yalla go next — and what would it cost to be right?"
        lede="Candidate markets scored on evidenced signals, projected through a digital twin, stressed, gated, and allocated capital only when the return is provable."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Re-run programme
          </Button>
        }
      />

      {loading || !programme ? (
        <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat icon={Globe2} label="Candidate markets" value={String(programme.assessments.length)}
              sub={`${decidable} decidable on current evidence`} />
            <Stat icon={Layers} label="Committed capital"
              value={formatMeasureSafe(programme.portfolio.committedCapital)}
              sub={`of KES ${programme.portfolio.envelope.totalCapitalKes.toLocaleString()} envelope`} />
            <Stat icon={Gauge} label="Expected annual contribution"
              value={formatMeasureSafe(programme.portfolio.expectedContribution)}
              sub="Simulated — not Yalla performance" />
            <Stat icon={ShieldAlert} label="Evidence backlog"
              value={String(programme.evidenceBacklog.length)}
              sub="markets blocked from any decision" />
          </div>

          <p className="mt-4 text-sm text-muted-foreground">{programme.portfolio.narrative}</p>

          <Tabs defaultValue="markets" className="mt-8">
            <TabsList className="flex-wrap">
              <TabsTrigger value="markets">Markets</TabsTrigger>
              <TabsTrigger value="decision">Entry decision</TabsTrigger>
              <TabsTrigger value="twin">Digital twin</TabsTrigger>
              <TabsTrigger value="seeding">Seeding</TabsTrigger>
              <TabsTrigger value="portfolio">Portfolio & capital</TabsTrigger>
              <TabsTrigger value="council">AI council</TabsTrigger>
            </TabsList>

            <TabsContent value="markets" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Attractiveness ranking</CardTitle>
                  <CardDescription>Renormalised over evidenced weight. A market below the 60% assessability floor is not scored.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Market</TableHead><TableHead>Score</TableHead><TableHead>Band</TableHead>
                        <TableHead>Evidence</TableHead><TableHead>Entry</TableHead><TableHead>Gaps</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {programme.assessments.map((a) => (
                        <TableRow key={a.record.definition.id}
                          className="cursor-pointer" onClick={() => setSelectedId(a.record.definition.id)}>
                          <TableCell className="font-medium">
                            {a.record.definition.name}
                            <div className="text-xs text-muted-foreground">{a.record.definition.country} · {a.record.definition.tier}</div>
                          </TableCell>
                          <TableCell className="tabular-nums">{formatMeasureSafe(a.attractiveness.score)}</TableCell>
                          <TableCell><Badge variant="outline">{a.attractiveness.band.replace(/_/g, " ")}</Badge></TableCell>
                          <TableCell className="space-x-1">
                            <ProvenanceBadge provenance={a.record.evidenceGrade} />
                            <span className="text-xs text-muted-foreground">{a.attractiveness.coveragePct}% weight</span>
                          </TableCell>
                          <TableCell><VerdictBadge verdict={a.decision.verdict} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                            {a.record.gaps.length ? a.record.gaps.join(", ") : "None"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="decision" className="mt-6 space-y-4">
              {!selected ? null : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Compass className="h-4 w-4" /> {selected.record.definition.name} — entry gates
                      <VerdictBadge verdict={selected.decision.verdict} />
                    </CardTitle>
                    <CardDescription>{selected.decision.rationale}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Gate</TableHead><TableHead>Requirement</TableHead><TableHead>Observed</TableHead><TableHead>Result</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.decision.gates.map((g) => (
                          <TableRow key={g.id}>
                            <TableCell className="font-medium">{g.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{g.requirement}</TableCell>
                            <TableCell className="text-xs">{g.observed}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={
                                g.passed === true ? "border-primary/40 text-primary"
                                : g.passed === false ? "border-destructive/40 text-destructive"
                                : "border-warning/40 text-warning-foreground"}>
                                {g.passed === true ? "pass" : g.passed === false ? "fail" : "no evidence"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {selected.decision.conditions.length > 0 && (
                      <div>
                        <Separator className="mb-3" />
                        <div className="text-sm font-medium">Conditions on capital release</div>
                        <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                          {selected.decision.conditions.map((c) => <li key={c}>{c}</li>)}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="twin" className="mt-6">
              {!selected ? null : selected.twin.months.length === 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{selected.record.definition.name} — twin not projectable</CardTitle>
                    <CardDescription>{selected.twin.blockers.join(" ")}</CardDescription>
                  </CardHeader>
                </Card>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <Stat icon={Gauge} label="Peak cash need" value={formatMeasureSafe(selected.twin.peakCashNeed)} sub="Simulated" />
                    <Stat icon={Users2} label="Contribution breakeven" value={formatMeasureSafe(selected.twin.breakevenMonth)} sub="Months from launch" />
                    <Stat icon={Network} label="Final-month contribution" value={formatMeasureSafe(selected.twin.month24Contribution)} sub="Simulated" />
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Stressed scenarios</CardTitle>
                      <CardDescription>Strategy × stress. Robust strategy: {selected.matrix.mostRobustStrategy?.replace(/_/g, " ") ?? "none viable"}.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead>Scenario</TableHead><TableHead>Peak cash</TableHead><TableHead>Breakeven</TableHead><TableHead>Unserved</TableHead><TableHead>Verdict</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {selected.matrix.scenarios.map((s) => (
                            <TableRow key={s.label}>
                              <TableCell className="text-sm">{s.label}</TableCell>
                              <TableCell className="tabular-nums">{formatMeasureSafe(s.peakCashNeed)}</TableCell>
                              <TableCell className="tabular-nums">{formatMeasureSafe(s.breakevenMonth)}</TableCell>
                              <TableCell className="tabular-nums">{s.unservedShare === null ? "—" : `${s.unservedShare.toFixed(1)}%`}</TableCell>
                              <TableCell><VerdictBadge verdict={s.verdict} /></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>

            <TabsContent value="seeding" className="mt-6">
              {!selected ? null : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sprout className="h-4 w-4" /> {selected.record.definition.name} — {selected.seeding.side.replace(/_/g, "-")} seeding
                    </CardTitle>
                    <CardDescription>{selected.seeding.sideRationale}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selected.seeding.blockers.length > 0 && (
                      <ul className="list-disc pl-5 text-sm text-warning-foreground">
                        {selected.seeding.blockers.map((b) => <li key={b}>{b}</li>)}
                      </ul>
                    )}
                    {selected.seeding.waves.length > 0 && (
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead>Wave</TableHead><TableHead>Window</TableHead><TableHead>Supply</TableHead><TableHead>Riders</TableHead><TableHead>Budget</TableHead><TableHead>Checkpoint</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {selected.seeding.waves.map((w) => (
                            <TableRow key={w.wave}>
                              <TableCell>{w.wave}</TableCell>
                              <TableCell className="text-xs">{w.window}</TableCell>
                              <TableCell className="tabular-nums">{w.supplyUnits.toLocaleString()}</TableCell>
                              <TableCell className="tabular-nums">{w.riderTargets.toLocaleString()}</TableCell>
                              <TableCell className="tabular-nums">{formatMeasureSafe(w.incentiveBudget)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[300px]">{w.checkpoint}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    <div className="text-sm">
                      Total seeding budget: <span className="font-semibold">{formatMeasureSafe(selected.seeding.totalBudget)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">Liquidity target {selected.seeding.liquidityTarget} trips/operator/week</span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="portfolio" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Capital allocation</CardTitle>
                  <CardDescription>
                    Envelope KES {programme.portfolio.envelope.totalCapitalKes.toLocaleString()} · {programme.portfolio.envelope.launchTeams} launch teams · {programme.portfolio.envelope.minReturnMultiple}× hurdle
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Rank</TableHead><TableHead>Market</TableHead><TableHead>Wave</TableHead><TableHead>Requested</TableHead><TableHead>Allocated</TableHead><TableHead>Return</TableHead><TableHead>Status</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {programme.portfolio.allocations.map((a) => (
                        <TableRow key={a.marketId}>
                          <TableCell className="tabular-nums">{a.rank || "—"}</TableCell>
                          <TableCell className="font-medium">{a.marketName}
                            <div className="text-xs text-muted-foreground max-w-[320px]">{a.reason}</div>
                          </TableCell>
                          <TableCell className="tabular-nums">{a.wave || "—"}</TableCell>
                          <TableCell className="tabular-nums">{formatMeasureSafe(a.requestedCapital)}</TableCell>
                          <TableCell className="tabular-nums">{formatMeasureSafe(a.allocatedCapital)}</TableCell>
                          <TableCell className="tabular-nums">{a.returnMultiple === null ? "—" : `${a.returnMultiple.toFixed(2)}×`}</TableCell>
                          <TableCell><Badge variant="outline">{a.status.replace(/_/g, " ")}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="council" className="mt-6">
              {!selected ? null : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      AI Expansion Council — {selected.record.definition.name}
                      <VerdictBadge verdict={selected.council.recommendation} />
                    </CardTitle>
                    <CardDescription>{selected.council.rationale}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selected.council.opinions.map((o) => (
                      <div key={o.seat} className="rounded-lg border border-border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">{o.title}</div>
                          <div className="flex items-center gap-2">
                            <VerdictBadge verdict={o.position} />
                            <span className="text-xs text-muted-foreground tabular-nums">{o.confidence}% confidence</span>
                          </div>
                        </div>
                        <Progress value={o.confidence} className="mt-2 h-1" />
                        <p className="mt-2 text-sm text-muted-foreground">{o.reasoning}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Would change its mind: {o.wouldChangeMind}</p>
                      </div>
                    ))}
                    {selected.council.dissent.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Dissent recorded from {selected.council.dissent.map((d) => d.title).join(", ")} — preserved, not averaged away.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
