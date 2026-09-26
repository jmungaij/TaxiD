import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Compass, Play } from "lucide-react";

import type { RankedAction } from "@/lib/workspace/ranking";

/**
 * RANKED NEXT BEST ACTIONS.
 *
 * An ordered shortlist of everything that could sensibly be done next —
 * assigned work and unowned records together — each startable in one click.
 * Position is always explainable: the reasons that produced the rank are
 * attached to the item, never hidden behind a score.
 */
export function NextBestActionsPanel({
  actions,
  busyKey,
  
  onStart,
  onOpen,
  loading,
}: {
  actions: RankedAction[];
  busyKey: string | null;
  
  onStart: (action: RankedAction) => void;
  onOpen: (workId: string) => void;
  loading?: boolean;
}) {
  return (
    <Card className="border-primary/20 bg-primary/[0.02]" data-testid="next-best-actions">
      <CardContent className="pt-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Compass className="h-3.5 w-3.5 text-primary" /> Next best actions
          </div>
          <Badge variant="outline" className="text-[10px]">
            {actions.length} queued
          </Badge>
        </div>

        {loading && <div className="mt-4 h-24 animate-pulse rounded-lg bg-muted" />}

        {!loading && actions.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing is ranked above your current focus — you are clear once it is done.
          </p>
        )}

        <ol className="mt-3 space-y-2">
          {actions.map((a, i) => (
            <li key={a.key} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-muted-foreground">#{i + 1}</span>
                    <span className="truncate text-sm font-semibold">{a.title}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {a.accountName && (
                      <Badge variant="outline" className="text-[10px]">
                        {a.accountName}
                      </Badge>
                    )}
                    <Badge
                      variant={a.origin === "assigned" ? "secondary" : "outline"}
                      className="text-[10px]"
                    >
                      {a.origin === "assigned" ? "Assigned to you" : "Unowned — take it"}
                    </Badge>
                  </div>
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Why this is ranked here</summary>
                    <ul className="mt-1.5 space-y-1">
                      {a.reasons.map((r, idx) => (
                        <li key={idx}>· {r}</li>
                      ))}
                    </ul>
                    {a.factors.length > 0 && (
                      <div className="mt-2 rounded-md border bg-muted/30 p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em]">
                          Ranking factors
                        </div>
                        <ul className="mt-1 space-y-1">
                          {a.factors.map((f, idx) => (
                            <li key={idx} className="flex items-start justify-between gap-2">
                              <span>
                                {f.label}
                                <span className="block text-[10px] opacity-70">{f.evidence}</span>
                              </span>
                              <span className="shrink-0 tabular-nums">
                                {f.points > 0 ? `+${f.points}` : "context"}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-1.5 text-[10px]">
                          Rank score {Math.round(a.score)} · source: {a.source}
                        </div>
                      </div>
                    )}
                  </details>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Button size="sm" disabled={busyKey === a.key} onClick={() => onStart(a)}>
                    {busyKey === a.key ? (
                      "Starting…"
                    ) : a.origin === "assigned" ? (
                      <>
                        <Play className="mr-1 h-3.5 w-3.5" /> Start
                      </>
                    ) : (
                      <>
                        Take it <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </>
                    )}
                  </Button>
                  {a.workId && (
                    <Button size="sm" variant="ghost" onClick={() => onOpen(a.workId!)}>
                      Context
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
