/**
 * STAGE 6 — THE AI PANEL surface.
 *
 * Renders the full recommendation set: the ordered plan against real available
 * hours, the patterns behind the load, the recorded risks and what to ask other
 * people for. Every statement traces to the derived model — this component adds
 * no judgement of its own.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, ChevronDown, Repeat, Sparkles, Timer, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { AiPanelModel, PlannedMove } from "@/lib/workspace/aiPanel";

function Move({ move }: { move: PlannedMove }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        move.beyondCapacity ? "border-dashed border-muted bg-muted/30" : "border-border bg-card",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
          {move.position}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{move.recommendation}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {move.title}
            {move.subject ? ` · ${move.subject}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            <Timer className="mr-1 h-3 w-3" aria-hidden />
            {move.minutes} min
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {move.confidence}%
          </Badge>
        </div>
      </div>

      {move.beyondCapacity && (
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          Beyond the hours available today — plan it for tomorrow rather than promising it now.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="secondary" className="h-7 text-xs">
          <Link to={move.action.to}>
            {move.action.label}
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide the reasoning" : "Why, and how"}
          <ChevronDown
            className={cn("ml-1 h-3.5 w-3.5 transition-transform motion-safe:duration-200", open && "rotate-180")}
            aria-hidden
          />
        </Button>
      </div>

      {open && (
        <div className="mt-2 space-y-2 border-t pt-2 text-xs text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">Because:</span> {move.because}
          </p>
          <p>
            <span className="font-semibold text-foreground">If ignored:</span> {move.ifIgnored}
          </p>
          {move.steps.length > 0 && (
            <ol className="list-decimal space-y-0.5 pl-4">
              {move.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          {move.evidence.length > 0 && (
            <ul className="space-y-0.5">
              {move.evidence.map((e) => (
                <li key={e}>· {e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function AiPanel({ model }: { model: AiPanelModel }) {
  return (
    <Card className="border-primary/25 bg-primary/[0.03]">
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1.5">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden /> {model.headline}
          </p>
          {model.narrative.map((line) => (
            <p key={line} className="text-sm text-muted-foreground">
              {line}
            </p>
          ))}
          {model.quietReason && <p className="text-sm text-muted-foreground">{model.quietReason}</p>}
        </div>

        {model.plan.length > 0 && (
          <div className="space-y-2">
            {model.plan.map((move) => (
              <Move key={move.key} move={move} />
            ))}
          </div>
        )}

        {model.patterns.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Repeat className="h-3.5 w-3.5" aria-hidden /> Patterns worth fixing once
              </p>
              {model.patterns.map((p) => (
                <div key={p.label} className="rounded-md border bg-card p-2.5">
                  <p className="text-sm font-medium capitalize">{p.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.meaning}</p>
                  <p className="mt-0.5 text-xs font-medium text-foreground">{p.fix}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {model.risks.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> What goes wrong if nothing changes
              </p>
              {model.risks.map((r) => (
                <div key={r.key} className="flex flex-wrap items-start justify-between gap-2 rounded-md border bg-card p-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {r.title}
                      {r.subject ? ` · ${r.subject}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.consequence}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {r.dueLabel && (
                      <Badge variant={r.severity === "critical" ? "destructive" : "outline"} className="text-[10px]">
                        {r.dueLabel}
                      </Badge>
                    )}
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                      <Link to={r.to}>Open</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {model.asks.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" aria-hidden /> Who to chase, and for what
              </p>
              {model.asks.map((a) => (
                <div key={a.waitingOn} className="rounded-md border bg-card p-2.5">
                  <p className="text-sm font-medium">
                    {a.waitingOn} · {a.count} item(s)
                    {a.oldestDueLabel ? ` · oldest ${a.oldestDueLabel}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.ask}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {model.blindSpots.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Excluded because they are not released to your account: {model.blindSpots.join(", ")}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
