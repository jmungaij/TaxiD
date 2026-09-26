/**
 * Enterprise Mission Control workspace.
 *
 * Single operational view over every business domain with composite health,
 * revenue intelligence, SLA forecasting, account risk and explainable AI
 * recommendations. Real-time posture is supplied by the enterprise event mesh.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, ArrowUpRight, Gauge, RadioTower, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { buildMissionControl, type DomainHealthState, type MissionControlInput } from "@/lib/customerops/missionControl";
import { EnterpriseEventMesh, createMemoryTransport, type MeshStats } from "@/lib/customerops/eventMesh";
import { can } from "@/lib/customerops/governance";

const STATE_TONE: Record<DomainHealthState, string> = {
  healthy: "border-primary/30 bg-primary/5 text-primary",
  attention: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  unknown: "border-muted bg-muted/40 text-muted-foreground",
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

export interface MissionControlPanelProps {
  roles: string[];
  input: MissionControlInput;
}

export default function MissionControlPanel({ roles, input }: MissionControlPanelProps) {
  const view = useMemo(() => buildMissionControl(input), [input]);
  const [mesh, setMesh] = useState<MeshStats | null>(null);
  const canSeeRevenue = can("widget:revenue_intelligence", roles);
  const canSeeChurn = can("widget:churn_risk", roles);

  useEffect(() => {
    const transport = createMemoryTransport().transport;
    const bus = new EnterpriseEventMesh({ transport });
    const off = bus.onStatus((_s, stats) => setMesh(stats));
    bus.subscribe("cases", () => {});
    bus.subscribe("fleet", () => {});
    bus.subscribe("payments", () => {});
    void bus.connect().then(() => setMesh(bus.snapshot()));
    return () => { off(); bus.close(); };
  }, []);

  return (
    <div className="space-y-4">
      <Card className={`border ${STATE_TONE[view.state]}`}>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4" aria-hidden />
              Enterprise operational health
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {view.totals.active.toLocaleString()} active items · {view.totals.breaching} breaching · {view.totals.backlog} in backlog
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums">{view.compositeScore}<span className="text-base text-muted-foreground">/100</span></p>
            <Badge variant="outline" className="mt-1 capitalize">{view.state}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={view.compositeScore} aria-label="Composite operational health" />
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <RadioTower className="h-3.5 w-3.5" aria-hidden />
              Event mesh: <strong className="text-foreground">{mesh?.status ?? "connecting"}</strong>
            </span>
            <span>Replayed {mesh?.replayed ?? 0}</span>
            <span>Queued {mesh?.queued ?? 0}</span>
            <span>Pending optimistic {mesh?.pendingOptimistic ?? 0}</span>
            <span>Updated {new Date(view.generatedAt).toLocaleTimeString()}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {view.domains.map((d) => (
          <Card key={d.domain} className="border">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>{d.label}</span>
                <Badge variant="outline" className={STATE_TONE[d.state]}>{d.score}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between text-foreground">
                <span>{d.active} active</span>
                <span>{d.breaching} breaching</span>
                <span>{d.availabilityPct.toFixed(2)}%</span>
              </div>
              <Separator />
              <ul className="space-y-1">
                {d.drivers.map((driver) => <li key={driver}>· {driver}</li>)}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              {view.revenue.band === "declining" ? <TrendingDown className="h-4 w-4 text-destructive" aria-hidden /> : <TrendingUp className="h-4 w-4 text-primary" aria-hidden />}
              Revenue intelligence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {canSeeRevenue ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums">{kes(view.revenue.revenueTodayKes)}</span>
                  <Badge variant="outline" className="capitalize">{view.revenue.band} {view.revenue.deltaPct > 0 ? "+" : ""}{view.revenue.deltaPct}%</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div><dt>Net of refunds</dt><dd className="text-foreground">{kes(view.revenue.netKes)}</dd></div>
                  <div><dt>Pipeline</dt><dd className="text-foreground">{kes(view.revenue.pipelineKes)}</dd></div>
                  <div><dt>At risk</dt><dd className="text-foreground">{kes(view.revenue.atRiskKes)}</dd></div>
                  <div><dt>Risk ratio</dt><dd className="text-foreground">{view.revenue.riskRatioPct}%</dd></div>
                </dl>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Revenue intelligence is restricted to finance and executive roles.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4" aria-hidden />
              SLA forecast · next {input.sla.horizonHours}h
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular-nums">{view.sla.compliancePctForecast}%</span>
              <Badge variant="outline" className="capitalize">{view.sla.band.replace("_", " ")}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {view.sla.predictedBreaches} predicted breaches · capacity gap {view.sla.capacityGap}
            </p>
            <p className="text-xs">{view.sla.recommendation}</p>
          </CardContent>
        </Card>
      </div>

      {canSeeChurn && view.accounts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Corporate account risk
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {view.accounts.map((a) => (
              <div key={a.accountId} className="rounded-md border p-3 text-xs">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{a.name}</span>
                  <Badge variant="outline" className="capitalize">{a.band.replace("_", " ")} · {a.churnRiskPct}%</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{kes(a.revenueAtRiskKes)} annualised revenue at risk · {a.drivers.join(" · ")}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4" aria-hidden />
            AI operational recommendations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {view.recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No interventions recommended — every domain is within target.</p>
          ) : view.recommendations.map((r) => (
            <div key={r.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{r.title}</p>
                <div className="flex items-center gap-2">
                  <Badge variant={r.severity === "critical" ? "destructive" : "outline"} className="capitalize">{r.severity}</Badge>
                  <Badge variant="outline">Confidence {r.confidence}%</Badge>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{r.rationale}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {r.evidence.map((e) => <li key={e}>· {e}</li>)}
              </ul>
              {r.ctaPath && (
                <Button asChild size="sm" variant="secondary" className="mt-2">
                  <Link to={r.ctaPath}>
                    Open workspace
                    <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
