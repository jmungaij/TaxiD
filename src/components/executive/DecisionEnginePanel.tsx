/**
 * Phase D10.0 — Decision Engine panel.
 * Renders prioritized, explainable recommendations sourced only from
 * canonical certifiers, executive metrics, alerts, and ops signals.
 * Reused by Executive Intelligence and Operations Center — no new page.
 */
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Brain, ShieldAlert, ShieldCheck } from "lucide-react";
import type { DecisionEngineReport, Recommendation, RecoPriority } from "@/lib/workspace360/decisionEngine";

const PRIORITY_TONE: Record<RecoPriority, string> = {
  P0: "bg-status-danger/15 text-status-danger border-status-danger/40",
  P1: "bg-status-warning/15 text-status-warning border-status-warning/40",
  P2: "bg-ai/15 text-ai border-ai/40",
  P3: "bg-muted text-muted-foreground border-muted",
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-muted",
  in_progress: "bg-ai/15 text-ai border-ai/40",
  completed: "bg-status-success/15 text-status-success border-status-success/40",
  deferred: "bg-status-warning/15 text-status-warning border-status-warning/40",
  rejected: "bg-muted-foreground/15 text-muted-foreground border-border/40",
  expired: "bg-status-danger/15 text-status-danger border-status-danger/40",
};

function AxisBadges({ r }: { r: Recommendation }) {
  return (
    <div className="flex flex-wrap gap-1">
      {r.impactAxes.map((a) => (
        <Badge key={a} variant="outline" className="text-[10px] uppercase tracking-wide">{a.replace(/_/g, " ")}</Badge>
      ))}
    </div>
  );
}

function DomainBadges({ r }: { r: Recommendation }) {
  if (!r.affectedDomains?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {r.affectedDomains.map((d) => (
        <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>
      ))}
    </div>
  );
}

export function DecisionEnginePanel({
  report, limit, title = "Prioritized recommendations", compact = false,
}: {
  report: DecisionEngineReport;
  limit?: number;
  title?: string;
  compact?: boolean;
}) {
  const items = limit ? report.recommendations.slice(0, limit) : report.recommendations;
  const pass = report.passed;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Brain className="h-4 w-4 text-primary" /> {title}
          <Badge variant="outline" className="ml-1">{report.recommendations.length}</Badge>
          {pass
            ? <span className="inline-flex items-center gap-1 text-xs text-status-success ml-2"><ShieldCheck className="h-3 w-3" /> traceable</span>
            : <span className="inline-flex items-center gap-1 text-xs text-status-warning ml-2"><ShieldAlert className="h-3 w-3" /> traceability drift</span>}
          <span className="text-[10px] text-muted-foreground ml-auto font-mono">
            done {Math.round(report.execution.completionRate * 100)}% · success {Math.round(report.execution.successRate * 100)}% · P0 open {report.execution.p0Unresolved} · quality {report.quality.score}/100
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open recommendations — platform operating within canonical thresholds.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((r) => (
              <Link
                key={r.id}
                to={r.href}
                className="block rounded-md border p-3 hover:bg-accent transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={PRIORITY_TONE[r.priority] + " text-[10px]"}>{r.priority}</Badge>
                      <Badge className={(STATUS_TONE[r.execution.status] ?? STATUS_TONE.pending) + " text-[10px]"}>
                        {r.execution.status.replace(/_/g, " ")}
                      </Badge>
                      {r.ineffective && (
                        <Badge className="bg-status-danger/15 text-status-danger border-status-danger/40 text-[10px]">ineffective</Badge>
                      )}
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">{r.domain}</span>
                      <span className="text-xs text-muted-foreground">· confidence {Math.round(r.confidence * 100)}%</span>
                    </div>
                    <div className="font-medium mt-1 truncate">{r.title}</div>
                    {!compact && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.rationale}</div>
                    )}
                    {!compact && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <AxisBadges r={r} />
                        <DomainBadges r={r} />
                        <span className="text-[10px] text-muted-foreground font-mono">
                          src: {r.canonicalSources.join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 opacity-60 mt-1 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
        {!report.passed && (
          <div className="mt-3 rounded-md border border-status-warning/40 bg-status-warning/10 p-2 text-xs">
            <div className="font-medium">Traceability failures</div>
            {report.failures.slice(0, 5).map((f, i) => (
              <div key={i} className="font-mono text-[11px] text-muted-foreground">• {f}</div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
