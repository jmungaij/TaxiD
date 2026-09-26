import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { assessQuoteReadiness } from "@/lib/charter/quoteReadiness";
import type { MissionFare } from "@/lib/charter/smartFare";

/**
 * Quote readiness gate — shows whether the operator submission and the selected
 * route are complete enough to issue a binding SmartFare quote, and exactly
 * which rate card components and route availability checks are outstanding when
 * they are not.
 */
export default function QuoteReadinessPanel({ fare }: { fare: MissionFare }) {
  const r = assessQuoteReadiness(fare);
  const v = r.validation;

  const icon = (status: "pass" | "warn" | "fail") =>
    status === "pass"
      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      : status === "warn"
        ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning" />
        : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />;

  return (
    <Card className={r.blocked ? "border-status-warning/50" : "border-primary/50"}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Quote readiness</CardTitle>
          <Badge variant={r.blocked ? "secondary" : "default"}>
            {r.blocked ? "Indicative only" : "Binding quote eligible"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{r.blocked ? r.blockReason : v.summary}</p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Required cost components submitted</span>
            <span>{v.completionPct}%</span>
          </div>
          <Progress value={v.completionPct} />
        </div>

        {r.missingComponents.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Missing rate card components ({r.missingComponents.length})
            </p>
            {r.missingComponents.map((m) => (
              <div key={m.key} className="rounded-md border border-status-warning/40 bg-status-warning/5 p-2">
                <p className="text-xs font-medium">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.reason}</p>
              </div>
            ))}
          </div>
        )}

        {v.blocking.filter((b) => b.key === "availability" || b.key === "rate_card").map((b) => (
          <div key={b.key} className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
            <p className="text-xs font-medium">{b.label}</p>
            <p className="text-xs text-muted-foreground">{b.reason}</p>
          </div>
        ))}

        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Route availability checks
            {r.failedRouteChecks.length > 0 && ` — ${r.failedRouteChecks.length} failed`}
          </p>
          {r.routeChecks.map((c) => (
            <div key={c.key} className="flex gap-2">
              {icon(c.status)}
              <p className="text-xs">
                <span className="font-medium text-foreground">{c.label}</span>
                <span className="text-muted-foreground"> — {c.detail}</span>
              </p>
            </div>
          ))}
        </div>

        {v.advisory.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Advisory</p>
            {v.advisory.map((a) => (
              <p key={a.key} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{a.label}:</span> {a.reason}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
