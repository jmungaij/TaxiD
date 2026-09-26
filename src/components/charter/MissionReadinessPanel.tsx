/**
 * Mission readiness score — replaces the flat "% complete" bar with an
 * actionable enterprise readiness assessment.
 */
import { Check, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { MissionReadiness } from "@/lib/charter/missionReadiness";

const BAND_LABEL: Record<MissionReadiness["band"], string> = {
  draft: "Draft mission",
  shaping: "Mission shaping",
  ready: "Ready for authorization",
  authorized: "Mission authorized",
};

export function MissionReadinessPanel({ readiness }: { readiness: MissionReadiness }) {
  return (
    <Card className="border-primary/20 bg-card/70 backdrop-blur">
      <CardContent className="pt-6">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Mission readiness</p>
            <p className="text-sm font-medium">{BAND_LABEL[readiness.band]}</p>
          </div>
          <p className="text-3xl font-semibold tabular-nums">{readiness.score}%</p>
        </div>
        <Progress
          value={readiness.score}
          className="mt-3"
          aria-label={`Mission readiness ${readiness.score} percent`}
        />
        <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {readiness.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              {c.done ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className={c.done ? "" : "text-muted-foreground"}>
                {c.label}
                <span className="sr-only">{c.done ? " complete" : " pending"}</span>
                {!c.done && <span className="block text-xs">{c.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
        {readiness.nextAction && (
          <p className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
            <span className="font-semibold">Next: </span>
            {readiness.nextAction}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
