/**
 * NEXT BEST ACTION QUEUE.
 *
 * The recommended actions in order, each one explainable: what to do, why, the
 * recorded evidence behind it, what is commercially at stake and when it should
 * happen. Nothing here changes a record — the person confirms and the existing
 * surfaces execute.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Clock, Compass, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TIMING_LABEL, type NextBestAction } from "@/lib/intelligence/nextBestAction";

const TONE: Record<NextBestAction["timing"], string> = {
  now: "border-l-destructive",
  today: "border-l-primary",
  this_week: "border-l-border",
  whenever: "border-l-muted",
};

export function NextBestActionQueue({
  actions,
  headline,
  loading,
  busyKey,
  onAccept,
}: {
  actions: NextBestAction[];
  headline: string;
  loading?: boolean;
  busyKey?: string | null;
  /** Records that the recommendation was acted on, where it came from a signal. */
  onAccept?: (action: NextBestAction) => void;
}) {
  return (
    <div className="space-y-3" data-testid="next-best-action-queue">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Compass className="h-4 w-4 text-primary" aria-hidden />
        <span className="font-medium">{headline}</span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      {!loading && actions.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Nothing in your book is asking for an action. New recommendations appear here the moment a record
            changes — a quiet deal, a proposal with no answer, a missing decision maker.
          </CardContent>
        </Card>
      )}

      <ol className="space-y-3">
        {actions.map((a, i) => (
          <li key={a.key}>
            <Card className={cn("border-l-4", TONE[a.timing])}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-muted-foreground">#{i + 1}</span>
                  <Badge variant={a.timing === "now" || a.timing === "today" ? "destructive" : "secondary"} className="text-[10px]">
                    <Clock className="mr-1 h-3 w-3" aria-hidden /> {TIMING_LABEL[a.timing]}
                  </Badge>
                  {a.customer && (
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{a.customer}</span>
                  )}
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    {a.source === "signal_register" ? "From the signal register" : "From pipeline inspection"}
                  </Badge>
                </div>

                <p className="font-semibold leading-snug">{a.action}</p>
                <p className="text-sm text-muted-foreground">{a.reason}</p>
                <p className="text-sm font-medium">{a.impactLine}</p>
                <p className="text-xs text-muted-foreground">{a.timingReason}</p>

                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Evidence and how it was ranked</summary>
                  <ul className="mt-1.5 space-y-1">
                    {a.evidence.map((e, idx) => (
                      <li key={idx}>
                        <span className="font-medium">{e.label}:</span> {e.value}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 rounded-md border bg-muted/30 p-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em]">Ranking factors</div>
                    <ul className="mt-1 space-y-1">
                      {a.factors.map((f, idx) => (
                        <li key={idx} className="flex items-start justify-between gap-2">
                          <span>
                            {f.label}
                            <span className="block text-[10px] opacity-70">{f.evidence}</span>
                          </span>
                          <span className="shrink-0 tabular-nums">{f.points > 0 ? `+${f.points}` : "context"}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-1.5 text-[10px]">Rank score {Math.round(a.score)}</div>
                  </div>
                </details>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" asChild>
                    <Link to={a.link}>
                      Open the record <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </Button>
                  {a.signalId && onAccept && (
                    <Button size="sm" variant="outline" disabled={busyKey === a.key} onClick={() => onAccept(a)}>
                      {busyKey === a.key ? (
                        "Recording…"
                      ) : (
                        <>
                          <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> I have done this
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default NextBestActionQueue;
