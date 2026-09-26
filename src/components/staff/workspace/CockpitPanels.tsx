import { WorkspaceEmptyState } from "@/components/staff/workspace/WorkspaceEmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Gauge, History, Stamp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  humanizeMinutes,
  relativeTime,
  type ApprovalItem,
  type DayPlan,
  type SessionChange,
} from "@/lib/workspace";

/* ------------------------------------------------------------------ capacity */

/** Human capacity — the scheduling arithmetic stays behind the details line. */
export function CapacityPanel({ plan }: { plan: DayPlan }) {
  const planned = plan.plannedMinutes;
  const capacity = plan.capacityMinutes;
  const flexible = Math.max(0, capacity - planned);
  const pct = capacity > 0 ? Math.min(100, Math.round((planned / capacity) * 100)) : 0;
  const state = plan.overCommitted ? "Over-committed" : pct > 85 ? "Tight" : "Healthy";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-primary" /> Today's capacity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Figure label="Usable time" value={humanizeMinutes(capacity)} />
          <Figure label="Committed" value={humanizeMinutes(planned)} />
          <Figure label="Flexible" value={humanizeMinutes(flexible)} />
        </div>
        <Progress value={pct} className="h-2" />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Planned {pct}% of remaining time</span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              state === "Healthy" && "border-success/50 text-success",
              state === "Tight" && "border-warning/50 text-warning",
              state === "Over-committed" && "border-destructive/50 text-destructive",
            )}
          >
            {state}
          </Badge>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">How this was calculated</summary>
          <p className="mt-2">
            {plan.note} Effort already recorded today: {humanizeMinutes(plan.spentMinutes)}.
          </p>
        </details>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tracking-tight">{value}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- approvals */

/** Decisions this employee owns — sourced from canonical work, not a new store. */
export function ApprovalsPanel({
  approvals,
  onOpen,
}: {
  approvals: ApprovalItem[];
  onOpen: (workId: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Stamp className="h-4 w-4 text-primary" /> Requires your decision
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {approvals.length === 0 && (
          <WorkspaceEmptyState
            title="Nothing awaits your decision"
            message="No work in your queue is currently held for an approval. Requests routed to you appear here immediately."
            actions={[
              { label: "Review the board", to: "/staff/board" },
              { label: "Set up assignments", to: "/staff/org/people" },
            ]}
          />
        )}
        {approvals.map((a) => (
          <div key={a.work.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{a.work.title}</div>
              <p className="mt-1 text-xs text-muted-foreground">{a.reason}</p>
              <p className="mt-1 text-xs text-muted-foreground">Requested {a.requestedAgo}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onOpen(a.work.id)}>
              Review
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------- since last session */

export function SinceLastSessionPanel({
  changes,
  onOpen,
}: {
  changes: SessionChange[];
  onOpen: (workId: string) => void;
}) {
  if (!changes.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-primary" /> Since your last session
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {changes.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              <span
                className={cn(
                  "font-medium",
                  c.tone === "warning" && "text-warning",
                  c.tone === "success" && "text-success",
                )}
              >
                {c.label}
              </span>
              <span className="text-muted-foreground"> — {c.detail}</span>
            </div>
            {c.workId && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpen(c.workId!)}>
                Open
              </Button>
            )}
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          Your priorities below have been recalculated from these changes.
        </p>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------- last synced */

export function LiveStamp({ at }: { at: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
      Updated {relativeTime(at)}
    </span>
  );
}
