/**
 * STAGE 3 — EXECUTION PRIMITIVES for the unified NOW surface.
 *
 * A priority card is not a task row. It answers, in this order:
 *   WHAT do I need to do · WHO for · WHY now · WHAT IT IS WORTH ·
 *   WHAT HAPPENS IF I DON'T · FASTEST ACTION.
 *
 * Nothing is displayed that the source record did not state, and every action
 * routes into a system of record.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, ChevronDown, Clock, PauseCircle, Sparkles, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WorkloadSummary, WorkspaceItem, WorkTier } from "@/lib/workspace/intelligence";
import { briefFor } from "@/lib/workspace/aiBrief";

const TIER_ACCENT: Record<WorkTier, string> = {
  critical: "border-l-destructive",
  high: "border-l-primary",
  medium: "border-l-border",
  low: "border-l-border",
};

const TIER_LABEL: Record<WorkTier, string> = {
  critical: "Critical",
  high: "High",
  medium: "Standard",
  low: "Low",
};

const relativeDue = (iso: string | null): string | null => {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
};

/**
 * STAGE 5 — the AI brief on the card: what should happen next, why, what the
 * steps are, and how confident the recommendation is. Derived, never invented.
 */
export function BriefPanel({ item, expanded = false }: { item: WorkspaceItem; expanded?: boolean }) {
  const [open, setOpen] = React.useState(expanded);
  const brief = React.useMemo(() => briefFor(item), [item]);
  if (item.signal === "healthy") return null;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">What should happen next</p>
          <p className="text-sm font-medium leading-snug text-foreground">{brief.recommendation}</p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {brief.confidence}% confidence
        </Badge>
      </div>

      {brief.steps.length > 0 && (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 h-7 px-2 text-xs"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide the steps" : "Show the steps"}
            <ChevronDown
              className={cn("ml-1 h-3.5 w-3.5 transition-transform motion-safe:duration-200", open && "rotate-180")}
              aria-hidden
            />
          </Button>
          {open && (
            <ol className="mt-1 list-decimal space-y-1 pl-8 text-xs text-muted-foreground">
              {brief.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/** The dominant card: used for the single next best action. */
export function PriorityCard({ item, lead = false }: { item: WorkspaceItem; lead?: boolean }) {
  const [showEvidence, setShowEvidence] = React.useState(false);
  const due = relativeDue(item.dueAt);
  const overdue = item.signal === "overdue" || (due?.includes("overdue") ?? false);

  return (
    <Card
      className={cn(
        "border-l-4 transition-shadow motion-safe:duration-200 hover:shadow-md",
        TIER_ACCENT[item.tier],
        lead && "bg-card/95 shadow-sm ring-1 ring-primary/20",
      )}
    >
      <CardContent className={cn("space-y-3", lead ? "p-5" : "p-4")}>
        <div className="flex flex-wrap items-center gap-2">
          {item.subject && (
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {item.subject}
            </span>
          )}
          <Badge variant={item.tier === "critical" ? "destructive" : "secondary"} className="text-[10px]">
            {TIER_LABEL[item.tier]}
          </Badge>
          {due && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                overdue ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              <Clock className="h-3 w-3" aria-hidden /> {due}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Timer className="h-3 w-3" aria-hidden /> ~{item.minutes} min
          </span>
        </div>

        <p className={cn("font-semibold leading-snug", lead ? "text-lg" : "text-base")}>{item.title}</p>

        <p className="text-sm text-muted-foreground">{item.why}</p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {item.impact && <span className="font-medium text-foreground">{item.impact}</span>}
          {item.waitingOn && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <PauseCircle className="h-3.5 w-3.5" aria-hidden /> Waiting on {item.waitingOn}
            </span>
          )}
        </div>

        {item.consequence && (
          <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
            {item.consequence}
          </p>
        )}

        <BriefPanel item={item} expanded={lead} />

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size={lead ? "default" : "sm"} asChild>
            <Link to={item.primaryAction.to}>
              {item.primaryAction.label}
              <ArrowUpRight className="ml-1 h-4 w-4" aria-hidden />
            </Link>
          </Button>
          {item.secondaryActions.map((a) => (
            <Button key={a.to + a.label} size="sm" variant="outline" asChild>
              <Link to={a.to}>{a.label}</Link>
            </Button>
          ))}
          {item.evidence.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-xs"
              aria-expanded={showEvidence}
              onClick={() => setShowEvidence((v) => !v)}
            >
              Why this is here
              <ChevronDown
                className={cn(
                  "ml-1 h-3.5 w-3.5 transition-transform motion-safe:duration-200",
                  showEvidence && "rotate-180",
                )}
                aria-hidden
              />
            </Button>
          )}
        </div>

        {showEvidence && (
          <ul className="space-y-1 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            {item.evidence.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="text-foreground">{e.fact}</span>
                <span className="opacity-70">· {e.from}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const LEVEL_LABEL: Record<WorkloadSummary["level"], string> = {
  clear: "Clear",
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
};

const LEVEL_TONE: Record<WorkloadSummary["level"], string> = {
  clear: "text-muted-foreground",
  light: "text-primary",
  moderate: "text-primary",
  heavy: "text-destructive",
};

/** Workload read from real minutes of actionable work, grouped by reason. */
export function WorkloadStrip({ workload }: { workload: WorkloadSummary }) {
  const hours = Math.round((workload.minutes / 60) * 10) / 10;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Today's load</p>
        <p className={cn("text-lg font-semibold", LEVEL_TONE[workload.level])}>
          {LEVEL_LABEL[workload.level]}
        </p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">To act on</p>
        <p className="text-lg font-semibold">{workload.actionable}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimated time</p>
        <p className="text-lg font-semibold">{workload.minutes === 0 ? "—" : `${hours} h`}</p>
      </div>
      {workload.groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          {workload.groups.map((g) => (
            <Badge key={g.label} variant="outline" className="text-[11px]">
              {g.label} · {g.count}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
