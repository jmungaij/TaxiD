/**
 * INTERVENE NOW — the manager's action list.
 *
 * Every row is a real situation read from a real record, with the record named,
 * so nothing here is a score or a mood. An empty list means nothing crossed the
 * declared thresholds — it is stated as such, never as "all good".
 */
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { InterventionCase, InterventionSeverity } from "@/lib/staff/org/interveneNow";

const SEVERITY_STYLE: Record<InterventionSeverity, string> = {
  critical: "border-destructive/50 bg-destructive/5",
  high: "border-warning/50 bg-warning/5",
  moderate: "border-border",
};

const SEVERITY_LABEL: Record<InterventionSeverity, string> = {
  critical: "Act today",
  high: "Act this week",
  moderate: "Keep an eye on it",
};

export function InterveneNowPanel({
  cases,
  visibleWorkItems,
}: {
  cases: InterventionCase[];
  /** How many of the team's work items the manager can actually see. */
  visibleWorkItems: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
          Intervene now
        </CardTitle>
        <CardDescription>
          Situations in your line that will not resolve on their own, ranked by what is at stake.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {cases.length === 0 ? (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">
            <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-success" aria-hidden />
            Nothing in your line crossed an intervention threshold
            {visibleWorkItems === 0
              ? " — and no work items are visible to you, so this is not a clean bill of health."
              : ` across the ${visibleWorkItems} work item(s) visible to you.`}
          </div>
        ) : (
          <ul className="space-y-2">
            {cases.map((c) => (
              <li key={c.id} className={`rounded-md border p-3 ${SEVERITY_STYLE[c.severity]}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{c.headline}</div>
                    <div className="text-xs text-muted-foreground">{c.subject}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {SEVERITY_LABEL[c.severity]}
                  </Badge>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{c.detail}</p>
                <p className="mt-1 flex items-center gap-1 text-xs font-medium">
                  <ArrowRight className="h-3 w-3" aria-hidden /> {c.action}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-muted-foreground opacity-80">{c.evidence}</span>
                  {c.staffId && (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" asChild>
                      <Link to={`/staff/org/people/${c.staffId}`}>Open person</Link>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default InterveneNowPanel;
