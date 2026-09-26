import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Gauge, Loader2 } from "lucide-react";

import {
  DEMAND_DECISION_LABEL,
  humanizeMinutes,
  type CapacityProfile,
  type CapacitySplit,
  type DemandDecision,
  type OutstandingDisposition,
  type WorkDisposition,
} from "@/lib/workspace";

/** The decisions an employee may record, and what each one commits them to. */
const DECISIONS: { value: WorkDisposition; label: string; needsDate?: boolean }[] = [
  { value: "continue", label: "Continue tomorrow", needsDate: true },
  { value: "reschedule", label: "Reschedule to a date", needsDate: true },
  { value: "waiting", label: "Waiting on someone else" },
  { value: "blocked", label: "Blocked — needs a decision" },
  { value: "reassign", label: "Reassign to someone with capacity" },
  { value: "automate", label: "Automate — should not be done by hand" },
  { value: "nurture", label: "Move to a nurture sequence" },
  { value: "close", label: "Close — no further work needed" },
  { value: "disqualify", label: "Disqualify — not real demand" },
  { value: "escalate", label: "Escalate — cannot be met" },
];

/** Decisions the engine proposes, mapped onto what the employee can record. */
const SUGGESTED: Partial<Record<DemandDecision, WorkDisposition>> = {
  waiting: "waiting",
  reassign: "reassign",
  automate: "automate",
  escalate: "escalate",
  can_defer: "reschedule",
};

/**
 * DEMAND vs CAPACITY — states the real load against the recorded capacity
 * profile and forces a named decision on everything that cannot fit. Nothing
 * here is estimated in the browser: effort, value and capacity all come from the
 * recorded work and the configured profile.
 */
export function CapacityDecisionPanel({
  demand,
  profile,
  outstanding,
  busyId,
  onDecide,
}: {
  demand: CapacitySplit;
  profile: CapacityProfile | null;
  outstanding: OutstandingDisposition[];
  busyId: string | null;
  onDecide: (input: {
    workItemId: string;
    disposition: WorkDisposition;
    reason: string;
    newDueDate?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [decision, setDecision] = React.useState<WorkDisposition>("reschedule");
  const [reason, setReason] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const undecided = new Set(outstanding.map((o) => o.workItemId));
  const needsDecision = demand.items.filter(
    (i) => i.decision !== "must_do" && i.decision !== "should_do",
  );

  const start = (workItemId: string, suggested?: DemandDecision) => {
    setOpenId(workItemId);
    setDecision((suggested ? SUGGESTED[suggested] : undefined) ?? "reschedule");
    setReason("");
    setDueDate("");
    setError(null);
  };

  const submit = async (workItemId: string) => {
    const needsDate = DECISIONS.find((d) => d.value === decision)?.needsDate;
    if (!reason.trim()) {
      setError("Record the reason — this decision is kept on the record.");
      return;
    }
    if (needsDate && !dueDate) {
      setError("A new date is required for this decision.");
      return;
    }
    const res = await onDecide({
      workItemId,
      disposition: decision,
      reason: reason.trim(),
      newDueDate: needsDate ? dueDate : null,
    });
    if (!res.ok) {
      setError(res.error ?? "The decision could not be recorded.");
      return;
    }
    setOpenId(null);
  };

  return (
    <Card data-testid="capacity-decisions">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-primary" /> Demand against capacity
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {demand.loadPct > 100
            ? "You are carrying more than one day of work. Decide what moves."
            : "Your open work fits the day."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={demand.loadPct > 100 ? "border-destructive/50 text-[10px] text-destructive" : "text-[10px]"}
          >
            {demand.loadPct}% loaded
          </Badge>
          {outstanding.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {outstanding.length} awaiting a decision
            </Badge>
          )}
        </div>

        {needsDecision.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Everything you own fits today's capacity. No renegotiation is needed.
          </p>
        ) : (
          <ul className="space-y-2">
            {needsDecision.map(({ scored, decision: proposed, why }) => (
              <li key={scored.work.id} className="rounded-md border p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{scored.work.title}</div>
                    <div className="text-xs text-muted-foreground">{why}</div>
                    <div className="text-xs text-muted-foreground">{scored.band}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {DEMAND_DECISION_LABEL[proposed]}
                    </Badge>
                    {undecided.has(scored.work.id) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => start(scored.work.id, proposed)}
                        data-testid="decide-work"
                      >
                        Record decision
                      </Button>
                    )}
                  </div>
                </div>

                {openId === scored.work.id && (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    <Select value={decision} onValueChange={(v) => setDecision(v as WorkDisposition)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DECISIONS.map((d) => (
                          <SelectItem key={d.value} value={d.value} className="text-xs">
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {DECISIONS.find((d) => d.value === decision)?.needsDate && (
                      <Input
                        type="date"
                        className="h-8 text-xs"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        aria-label="New date"
                      />
                    )}
                    <Textarea
                      rows={2}
                      className="text-xs"
                      placeholder="Why this decision? Kept on the record."
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      aria-label="Reason"
                    />
                    {error && <p className="text-xs text-destructive">{error}</p>}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs"
                        disabled={busyId === scored.work.id}
                        onClick={() => void submit(scored.work.id)}
                      >
                        {busyId === scored.work.id && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                        Save decision
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-3 text-xs"
                        onClick={() => setOpenId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default CapacityDecisionPanel;
