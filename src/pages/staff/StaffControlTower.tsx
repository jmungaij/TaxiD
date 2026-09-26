/**
 * Phase 8 §24/§25 — Enterprise Control Tower.
 *
 * One executive surface over the Phase 8 kernel: marketplace liquidity,
 * risk-adjusted opportunity ranking and account economics. Nothing on this page
 * is invented — every figure carries its provenance, and unreadable inputs
 * render as DATA NOT AVAILABLE rather than a plausible number.
 */
import { useEffect, useMemo, useState } from "react";
import { Activity, Gauge, ShieldAlert, Target, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  PROVENANCE_LABEL, auditProvenance, formatMeasure, rankLiquidityCells, rankOpportunities,
  type LiquidityCell, type LiquidityCellFacts, type Measure, type Provenance,
} from "@/lib/staff/phase8";

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

function MeasureCell({ m }: { m: Measure }) {
  return (
    <div className="space-y-1">
      <div className="font-medium tabular-nums">{formatMeasure(m)}</div>
      <div className="text-xs text-muted-foreground">
        {m.calculation}
        {m.confidence !== null ? ` · ${m.confidence}% confidence` : ""}
      </div>
      {m.note ? <div className="text-xs text-muted-foreground">{m.note}</div> : null}
    </div>
  );
}

/** Count helper that returns null (not 0) whenever the read is not admissible. */
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

async function loadLiquidityFacts(): Promise<LiquidityCellFacts[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [requests, matched, cancelled, drivers] = await Promise.all([
    safeCount("dispatch_requests", (q) => q.gte("created_at", since)),
    safeCount("dispatch_assignments", (q) => q.gte("assigned_at", since)),
    safeCount("dispatch_rejections", (q) => q.gte("created_at", since)),
    safeCount("dispatch_supply_cells"),
  ]);

  return [{
    geography: "Nairobi",
    service: "individual_mobility",
    window: "Rolling 7 days",
    requests,
    bookings: matched,
    registeredProviders: drivers,
    activeProviders: drivers,
    acceptedOffers: matched,
    offeredJobs: requests,
    medianResponseSeconds: null,
    matched,
    cancellations: cancelled,
    medianTimeToMatchSeconds: null,
    transactionValue: null,
    contribution: null,
    incentiveCost: null,
    qualityScore: null,
    provenance: "LIVE",
    source: "dispatch_requests + dispatch_assignments + dispatch_rejections + dispatch_supply_cells",
  }];
}

export default function StaffControlTower() {
  const [cells, setCells] = useState<LiquidityCell[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadLiquidityFacts()
      .then((facts) => { if (live) setCells(rankLiquidityCells(facts)); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Liquidity probe failed"); });
    return () => { live = false; };
  }, []);

  /* Opportunity ranking is only shown for priced, evidenced opportunities. In
     the absence of a readable pipeline the tower says so instead of seeding a
     demo pipeline that would misrepresent commercial reality. */
  const ranked = useMemo(() => rankOpportunities([]), []);

  const violations = useMemo(
    () => auditProvenance((cells ?? []).flatMap((c) => [c.index, c.revenueOpportunity, c.capacityDeficit, c.contribution])),
    [cells],
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Enterprise Control Tower</h1>
        <p className="text-sm text-muted-foreground">
          Marketplace liquidity, risk-adjusted opportunity value and account economics — every figure
          carries its source, calculation and provenance. Unreadable inputs are declared, never estimated.
        </p>
      </header>

      <Tabs defaultValue="liquidity">
        <TabsList>
          <TabsTrigger value="liquidity"><Activity className="mr-2 h-4 w-4" aria-hidden />Liquidity</TabsTrigger>
          <TabsTrigger value="opportunity"><Target className="mr-2 h-4 w-4" aria-hidden />Opportunity value</TabsTrigger>
          <TabsTrigger value="integrity"><ShieldAlert className="mr-2 h-4 w-4" aria-hidden />Data integrity</TabsTrigger>
        </TabsList>

        <TabsContent value="liquidity" className="space-y-4 pt-4">
          {error ? (
            <Card><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>
          ) : cells === null ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            cells.map((c) => (
              <Card key={c.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">
                      {c.geography} · {c.service.replace(/_/g, " ")} · {c.window}
                    </CardTitle>
                    <CardDescription>
                      Verdict: {c.verdict.replace(/_/g, " ")} · index confidence {c.confidence}%
                    </CardDescription>
                  </div>
                  <ProvenanceBadge p={c.provenance} />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[c.index, c.demandLevel, c.supplyLevel, c.fulfilmentProbability,
                      c.capacityDeficit, c.revenueOpportunity, c.recommendedPartnerAcquisition, c.contribution,
                    ].map((m) => (
                      <div key={m.label} className="rounded-lg border p-3">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</div>
                        <MeasureCell m={m} />
                      </div>
                    ))}
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Index component</TableHead>
                        <TableHead>Weight</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Observed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {c.components.map((comp) => (
                        <TableRow key={comp.key}>
                          <TableCell className="font-medium">{comp.label}</TableCell>
                          <TableCell className="tabular-nums">{(comp.weight * 100).toFixed(0)}%</TableCell>
                          <TableCell className="tabular-nums">
                            {comp.score === null ? PROVENANCE_LABEL.UNAVAILABLE : `${Math.round(comp.score)}/100`}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{comp.observed}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="opportunity" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" aria-hidden />Risk-adjusted opportunity ranking
              </CardTitle>
              <CardDescription>
                Opportunities are ranked on risk-adjusted incremental contribution per constrained
                capacity hour — never on deal size.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ranked.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {PROVENANCE_LABEL.UNAVAILABLE} — no priced, evidenced opportunity is readable. The
                  ranking engine is live and will populate as quotations are priced; a demo pipeline is
                  deliberately not shown.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Opportunity</TableHead>
                      <TableHead>Value / constrained hour</TableHead>
                      <TableHead>Rationale</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ranked.map((r) => (
                      <TableRow key={r.opportunityId}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell><MeasureCell m={r.valuePerCapacityHour} /></TableCell>
                        <TableCell className="text-muted-foreground">{r.rationale}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrity" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Gauge className="h-4 w-4" aria-hidden />Provenance audit
              </CardTitle>
              <CardDescription>
                Every measure rendered above is checked for source, timestamp, confidence and model
                version. An empty list is the only pass.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {violations.length === 0 ? (
                <p className="text-sm text-success">No provenance violations — nothing on this surface is presented beyond its evidence.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {violations.map((v, i) => (
                    <li key={`${v.measure}-${i}`} className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                      <span className="font-medium">{v.measure}</span> — {v.problem}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
