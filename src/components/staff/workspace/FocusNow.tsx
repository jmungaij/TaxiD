import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  Clock,
  Compass,
  Play,
  Sparkles,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  dueLabel,
  
  type DiscretionaryOption,
  type FocusTarget,
  type NextBestAction,
} from "@/lib/workspace";

/* --------------------------------------------------------------- FOCUS NOW */

/**
 * FOCUS NOW — the dominant surface of the cockpit. One item, why it is first,
 * how long it should take, and the single action that starts real work.
 */
export function FocusNowPanel({
  focus,
  confidence,
  busy,
  onStartFocus,
  onOpen,
  onRecordOutcome,
  onAskWhy,
}: {
  focus: FocusTarget | null;
  confidence: { level: string; because: string };
  busy: boolean;
  onStartFocus: (workId: string) => void;
  onOpen: (workId: string) => void;
  onRecordOutcome: (workId: string) => void;
  onAskWhy: () => void;
}) {
  if (!focus) {
    return (
      <section
        aria-labelledby="focus-now"
        className="rounded-2xl border bg-card p-6 sm:p-8"
        data-testid="focus-now-empty"
      >
        <h2 id="focus-now" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Focus now
        </h2>
        <p className="mt-3 text-2xl font-semibold tracking-tight">Nothing needs you right now</p>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Your queues are clear. Use the time to advance a stalled relationship below.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          No prioritised work is currently assigned to you.
        </p>
      </section>
    );
  }

  const { scored, because, definitionOfDone } = focus;
  const w = scored.work;
  const due = dueLabel(w.sla_due_at, new Date());

  return (
    <section
      aria-labelledby="focus-now"
      className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-6 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] sm:p-8"
      data-testid="focus-now"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="focus-now"
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary"
        >
          <Target className="h-3.5 w-3.5" /> Focus now
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="text-[10px]">
            Confidence · {confidence.level}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            <Clock className="mr-1 h-3 w-3" />
            {due.text}
          </Badge>
        </div>
      </div>

      <h3 className="mt-3 text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">{w.title}</h3>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {w.entity_ref && <span className="font-medium text-foreground">{w.entity_ref}</span>}
        {w.service_line && <span>· {w.service_line}</span>}
        <span>· {w.priority} priority</span>
        <span className={cn("·", due.tone === "danger" && "text-destructive")}>· {due.text}</span>
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Why now?
          </div>
          <p className="mt-1.5 text-sm">{because}</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Done means
          </div>
          <p className="mt-1.5 text-sm">{definitionOfDone}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button size="lg" disabled={busy} onClick={() => onStartFocus(w.id)} data-testid="start-focus">
          <Play className="mr-2 h-4 w-4" /> Work on this
        </Button>
        <Button variant="outline" onClick={() => onOpen(w.id)}>
          View details
        </Button>
        <Button variant="outline" onClick={() => onRecordOutcome(w.id)}>
          Mark complete
        </Button>
        <Button variant="ghost" onClick={onAskWhy}>
          <Sparkles className="mr-2 h-4 w-4" /> Ask Yalla
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{confidence.because}</p>
    </section>
  );
}

/* -------------------------------------------------------- NEXT BEST ACTION */

export function NextBestActionPanel({
  nba,
  onDoIt,
  onOpen,
}: {
  nba: NextBestAction | null;
  onDoIt: (workId: string) => void;
  onOpen: (workId: string) => void;
}) {
  return (
    <Card className="border-primary/20 bg-primary/[0.02]" data-testid="next-best-action">
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Compass className="h-3.5 w-3.5 text-primary" /> Next best action
        </div>
        {!nba ? (
          <div className="mt-3 text-sm text-muted-foreground">
            <span className="block font-medium text-foreground">Nothing queued after this</span>
            You're clear once the current item is done.
          </div>
        ) : (
          <>
            <div className="mt-3 text-base font-semibold leading-snug">
              {nba.scored.work.title}
            </div>
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Why this is recommended</summary>
              <ul className="mt-2 space-y-1">
                {nba.reasons.map((r, i) => (
                  <li key={i}>· {r}</li>
                ))}
                <li>· Source: {nba.source}</li>
              </ul>
            </details>
            <p className="mt-2 text-xs text-muted-foreground">Expected outcome: {nba.expectedOutcome}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onDoIt(nba.scored.work.id)}>
                Do it now <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onOpen(nba.scored.work.id)}>
                Open context
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------ clear day */

/** An empty queue becomes productive discretionary time, not a broken screen. */
export function ClearDayPanel({
  options,
  onAction,
}: {
  options: DiscretionaryOption[];
  onAction: (action: DiscretionaryOption["action"]) => void;
}) {
  return (
    <Card data-testid="clear-day">
      <CardContent className="pt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          You're clear
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No urgent work is currently assigned to you. Use your available time deliberately.
        </p>
        <ul className="mt-4 space-y-2">
          {options.map((o) => (
            <li key={o.title}>
              <button
                type="button"
                onClick={() => onAction(o.action)}
                className="w-full rounded-lg border px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="block text-xs text-muted-foreground">{o.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
