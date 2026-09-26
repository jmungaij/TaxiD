/**
 * Phase D11.1 — Business Forecast & Early Warning panel.
 *
 * Renders the deterministic Business Forecast Report inside the
 * existing Executive Intelligence page. No new dashboard, no new
 * routes. Every value traces back to canonical executive_metrics
 * or governance outputs.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingDown, TrendingUp, Minus, AlertTriangle,
  ShieldAlert, ShieldCheck, Activity, Timer,
} from "lucide-react";
import type {
  BusinessForecastReport,
  ExecutiveRiskHeatmapItem,
  EarlyWarning,
} from "@/lib/workspace360/businessForecast";

const RISK_TONE: Record<string, string> = {
  low: "text-status-success border-status-success/30",
  medium: "text-status-warning border-status-warning/40",
  high: "text-status-warning border-status-warning/40",
  critical: "text-status-danger border-status-danger/50",
};

function DirIcon({ dir }: { dir: "up" | "down" | "flat" }) {
  if (dir === "up") return <TrendingUp className="h-3.5 w-3.5 text-status-success" />;
  if (dir === "down") return <TrendingDown className="h-3.5 w-3.5 text-status-danger" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function WarningRow({ w }: { w: EarlyWarning }) {
  return (
    <div className={`rounded-md border p-2 text-sm ${RISK_TONE[w.severity] ?? ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium truncate">{w.headline}</div>
        <Badge variant="outline" className="uppercase text-[10px]">{w.severity}</Badge>
      </div>
      <div className="text-xs text-muted-foreground mt-1">{w.rationale}</div>
      <div className="text-[11px] text-muted-foreground mt-1">
        horizon {w.horizon} · Δ {w.projectedDeltaPct.toFixed(2)}% · confidence {(w.confidence * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function HeatmapRow({ h }: { h: ExecutiveRiskHeatmapItem }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{h.label}</div>
        <div className="text-[11px] text-muted-foreground">
          health {h.healthScore} → {h.projectedHealthScore}
          {h.timeToCriticalHours != null && (
            <span className="ml-2 inline-flex items-center gap-1 text-status-danger">
              <Timer className="h-3 w-3" /> TTC ~{h.timeToCriticalHours}h
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Badge variant="outline" className={RISK_TONE[h.currentRisk]}>{h.currentRisk}</Badge>
        <span className="text-muted-foreground">→</span>
        <Badge variant="outline" className={RISK_TONE[h.forecastRisk]}>{h.forecastRisk}</Badge>
      </div>
    </div>
  );
}

export function BusinessForecastPanel({ report }: { report: BusinessForecastReport }) {
  const criticals = report.warnings.filter((w) => w.severity === "critical" || w.severity === "high");
  const topInterventions = report.interventions.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Business Forecast (D11.1)
          <Badge variant="outline">{report.score}/100</Badge>
          {report.passed
            ? <ShieldCheck className="h-3.5 w-3.5 text-status-success" />
            : <ShieldAlert className="h-3.5 w-3.5 text-status-warning" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Readiness projection */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border p-2">
            <div className="text-[11px] text-muted-foreground">Now</div>
            <div className="text-lg font-bold">{report.readinessProjection.current}</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-[11px] text-muted-foreground">24h</div>
            <div className="text-lg font-bold">{report.readinessProjection.in24h}</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-[11px] text-muted-foreground">7d</div>
            <div className="text-lg font-bold">{report.readinessProjection.in7d}</div>
          </div>
        </div>

        {/* Early warnings */}
        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-primary mb-2 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Early warnings
            <Badge variant="outline">{report.warnings.length}</Badge>
          </div>
          {report.warnings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No forward-looking risks detected.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {(criticals.length ? criticals : report.warnings).slice(0, 6).map((w) => (
                <WarningRow key={w.id} w={w} />
              ))}
            </div>
          )}
        </section>

        {/* Risk heatmap */}
        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Executive risk heatmap</div>
          <div className="space-y-1.5">
            {report.heatmap.map((h) => <HeatmapRow key={h.objective} h={h} />)}
          </div>
        </section>

        {/* Cross-domain propagation */}
        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Cross-domain forecast (24h)</div>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {report.crossDomain.map((n) => (
              <div key={n.node} className="flex items-center justify-between rounded-md border p-1.5">
                <span className="truncate">{n.label}</span>
                <span className={`font-mono ${n.deltaPct >= 0 ? "text-status-success" : "text-status-danger"}`}>
                  {n.deltaPct >= 0 ? "+" : ""}{n.deltaPct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Intervention ranking */}
        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Business intervention ranking</div>
          {topInterventions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No open recommendations to rank.</p>
          ) : (
            <div className="space-y-1.5">
              {topInterventions.map((r) => (
                <a
                  key={r.recoId}
                  href={r.href}
                  className="flex items-center justify-between rounded-md border p-2 text-xs hover:bg-muted/50"
                  data-analytics="d111.intervention.click"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="text-[10px] text-muted-foreground">
                      rev {r.revenueProtected} · driver {r.driverRetention} · mkt {r.marketplaceLiquidity} · sla {r.slaPreservation}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{r.priority}</Badge>
                    <span className="font-mono">{r.businessValueScore}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>

        {/* Certification footer */}
        <div className="text-[11px] text-muted-foreground border-t pt-2">
          Certification {report.certification.score}/100 · determinism {report.certification.determinismChecked ? "✓" : "✗"} · deps {report.certification.dependenciesResolved ? "✓" : "✗"} · confidence {report.certification.confidenceCalibrated ? "✓" : "✗"}
          {report.certification.failures.length > 0 && (
            <span className="text-status-warning"> · {report.certification.failures.length} findings</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default BusinessForecastPanel;

// Re-render helper for direction icon (unused export removed).
export { DirIcon };
