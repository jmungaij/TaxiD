/**
 * Shared operational primitives for the Staff Portal work surfaces.
 *
 * The Staff Portal never restates master data; it presents work, its SLA, the
 * canonical entity it refers to, and the actions a person is authorised to take.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WORK_STATE_LABEL, type WorkState } from "@/lib/orchestration/workLifecycle";
import { QUEUE_LABEL, type OpsQueue, type Priority } from "@/lib/orchestration/rules";
import { slaLabel } from "@/lib/workspace/humanTime";
import type { SlaView } from "@/lib/orchestration/workLifecycle";

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] uppercase tracking-wide",
        priority === "critical" && "border-destructive/50 text-destructive",
        priority === "high" && "border-warning/50 text-warning",
        priority === "medium" && "border-info/50 text-info",
        priority === "low" && "border-muted-foreground/30 text-muted-foreground",
      )}
    >
      {priority}
    </Badge>
  );
}

export function StateBadge({ state }: { state: WorkState }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] tracking-wide",
        state === "escalated" && "border-destructive/50 text-destructive",
        state === "waiting" && "border-warning/50 text-warning",
        state === "in_progress" && "border-primary/50 text-primary",
        (state === "resolved" || state === "closed") && "border-success/50 text-success",
      )}
    >
      {WORK_STATE_LABEL[state]}
    </Badge>
  );
}

export function SlaBadge({ sla }: { sla: SlaView }) {
  // Staff never read raw machine values: minutes are spoken as human time.
  const label = slaLabel(sla).text;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] tracking-wide",
        sla.status === "breached" && "border-destructive/50 text-destructive",
        sla.status === "at_risk" && "border-warning/50 text-warning",
        sla.status === "on_track" && "border-info/50 text-info",
        sla.status === "met" && "border-success/50 text-success",
      )}
    >
      {label}
    </Badge>
  );
}

export function QueueBadge({ queue }: { queue: OpsQueue | null }) {
  if (!queue) return null;
  return (
    <Badge variant="outline" className="text-[10px] tracking-wide border-primary/30 text-primary">
      {QUEUE_LABEL[queue]}
    </Badge>
  );
}

/** Reference to the canonical record this work is about — never a copy of it. */
export function EntityRef({ type, id, entityRef }: { type: string | null; id: string | null; entityRef?: string | null }) {
  if (!type) return <span className="text-muted-foreground">No linked record</span>;
  return (
    <span className="text-xs text-muted-foreground">
      {type.replace(/_/g, " ")} · <span className="font-mono">{entityRef || (id ? `${id.slice(0, 8)}…` : "—")}</span>
    </span>

  );
}
