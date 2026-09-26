import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import { humanizeMinutes } from "@/lib/workspace/humanTime";
import type { RankedAction } from "@/lib/workspace/ranking";
import type { TimeToday } from "@/lib/workspace/productivity";
import type { PersonalCommitment } from "@/lib/workspace/personalOs";

/**
 * START MY DAY.
 *
 * A single deliberate act that turns an inbox into a plan: what today is for,
 * how much capacity exists, which decisions are pending, and the first thing to
 * execute. Everything shown is read from authoritative records.
 */
export function StartMyDayDialog({
  open,
  onOpenChange,
  greeting,
  objectives,
  time,
  plannedMinutes,
  decisionCount,
  promises,
  first,
  busy,
  onStart,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  greeting: string;
  objectives: string[];
  time: TimeToday;
  plannedMinutes: number;
  decisionCount: number;
  promises: PersonalCommitment[];
  first: RankedAction | null;
  busy?: boolean;
  onStart: (first: RankedAction | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{greeting} — here is your day</DialogTitle>
          <DialogDescription>
            Confirm the plan and start on the first executable action.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              What today is for
            </h3>
            <ul className="mt-2 space-y-1 text-sm">
              {objectives.length === 0 && (
                <li className="text-muted-foreground">
                  No prioritised work is assigned yet — take an unowned record to make the day count.
                </li>
              )}
              {objectives.map((o, i) => (
                <li key={i}>· {o}</li>
              ))}
            </ul>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <Stat label="Things queued" value={String(objectives.length)} />
            <Stat label="Pending decisions" value={String(decisionCount)} />
          </section>

          {promises.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Promises you owe customers
              </h3>
              <ul className="mt-2 space-y-1 text-sm">
                {promises.slice(0, 3).map((p) => (
                  <li key={p.id}>
                    · {p.account_name ?? "Customer"} — {p.commitment}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-lg border border-primary/30 bg-primary/[0.03] p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              First executable action
            </h3>
            {first ? (
              <>
                <p className="mt-1.5 text-sm font-semibold">{first.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {first.accountName && (
                    <Badge variant="outline" className="text-[10px]">
                      {first.accountName}
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {first.expectedOutcome}
                  </span>
                </div>
              </>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">
                Nothing executable is queued — start by taking an unowned record.
              </p>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Not now
          </Button>
          <Button onClick={() => onStart(first)} disabled={busy} data-testid="start-my-day-confirm">
            <Play className="mr-2 h-4 w-4" />
            {busy ? "Starting…" : first ? "Start my day" : "Open my day"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
