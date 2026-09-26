/**
 * Phase D11.0 — Executive Business Outcome panel.
 *
 * Renders Business Objective Health, Capability Health, and Executive
 * Confidence indexes derived from canonical governance + Decision Engine
 * outputs. No new dashboard, no duplicate KPIs.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Crown, ShieldAlert, ShieldCheck, Target, TrendingDown } from "lucide-react";
import type { BusinessOutcomeReport } from "@/lib/workspace360/businessOutcome";
import type { BusinessReadinessReport } from "@/lib/workspace360/businessReadiness";

const TONE = (score: number) =>
  score >= 90 ? "text-status-success" : score >= 70 ? "text-status-warning" : "text-status-danger";
const BORDER = (score: number) =>
  score >= 90 ? "border-status-success/30" : score >= 70 ? "border-status-warning/40" : "border-status-danger/40";

const RISK_TONE: Record<string, string> = {
  low: "bg-status-success/15 text-status-success border-status-success/40",
  medium: "bg-status-warning/15 text-status-warning border-status-warning/40",
  high: "bg-status-danger/15 text-status-danger border-status-danger/40",
  critical: "bg-status-danger/20 text-status-danger border-status-danger/50",
};

export function BusinessOutcomePanel({
  outcome, readiness,
}: {
  outcome: BusinessOutcomeReport;
  readiness: BusinessReadinessReport;
}) {
  return (
    <div className="space-y-6">
      {/* Executive Indices */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
          <Crown className="h-4 w-4" /> Executive Business Indices
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Executive Confidence", score: outcome.executiveConfidenceIndex },
            { label: "Marketplace Stability", score: outcome.marketplaceStabilityIndex },
            { label: "Customer Experience", score: outcome.customerExperienceIndex },
            { label: "Business Readiness", score: readiness.score },
          ].map((s) => (
            <Card key={s.label} className={BORDER(s.score)}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${TONE(s.score)}`}>
                  {s.score}
                  <span className="text-sm font-normal text-muted-foreground">/100</span>
                </div>
                {s.score >= 90
                  ? <ShieldCheck className="h-4 w-4 text-status-success mt-1" />
                  : <ShieldAlert className={`h-4 w-4 ${TONE(s.score)} mt-1`} />}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Business Objective Health */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
          <Target className="h-4 w-4" /> Business Objective Health
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {outcome.objectiveHealth.map((o) => (
            <Card key={o.objective} className={BORDER(o.healthScore)}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{o.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className={`text-xl font-bold ${TONE(o.healthScore)}`}>{o.healthScore}/100</div>
                  <Badge className={`${RISK_TONE[o.revenueRisk]} text-[10px]`}>
                    rev {o.revenueRisk}
                  </Badge>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground font-mono">
                  P0 {o.openP0} · P1 {o.openP1}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Business Readiness Dimensions */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Enterprise Business Readiness
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {readiness.dimensions.map((d) => (
            <Card key={d.dimension} className={BORDER(d.score)}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{d.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-lg font-bold ${TONE(d.score)}`}>{d.score}/100</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  worst risk <span className="font-mono">{d.worstRisk}</span> · P0 {d.openP0}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Highest Revenue Risks */}
      {outcome.topRevenueRisks.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
            <TrendingDown className="h-4 w-4" /> Highest Revenue Risks
          </h2>
          <Card>
            <CardContent className="p-3 space-y-2">
              {outcome.topRevenueRisks.map((r) => {
                const ctx = outcome.contexts[r.id];
                return (
                  <div key={r.id} className="rounded-md border p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="text-[10px]" variant="outline">{r.priority}</Badge>
                      <Badge className={`${RISK_TONE[ctx.impact.revenueRisk]} text-[10px]`}>
                        rev {ctx.impact.revenueRisk}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        biz impact {ctx.impact.businessImpactScore}/100 · exec priority {ctx.executivePriorityScore}
                      </span>
                    </div>
                    <div className="font-medium mt-1">{r.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">{ctx.executiveNarrative}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ctx.capabilities.map((c) => (
                        <Badge key={c} variant="secondary" className="text-[10px]">{c.replace(/_/g, " ")}</Badge>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

      {!outcome.passed && (
        <Card className="border-status-warning/40">
          <CardContent className="py-3 text-sm">
            <div className="font-medium">Business mapping drift ({outcome.score}/100)</div>
            <div className="text-xs text-muted-foreground font-mono">
              {outcome.failures.slice(0, 3).join(" · ")}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
