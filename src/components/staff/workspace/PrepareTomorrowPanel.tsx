import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarClock, CheckCircle2, Loader2, Lock } from "lucide-react";
import {
  humanizeMinutes,
  openReasonGroups,
  REPLAN_LABEL,
  type CommercialReplan,
  type TomorrowPrep,
} from "@/lib/workspace";

/**
 * PREPARE TOMORROW — carries unfinished work forward and states, for every open
 * item, the recorded reason it did not close today. Nothing is invented: each
 * line is an open work record the employee still owns.
 */
export function PrepareTomorrowPanel({
  prep,
  replan,
  busy,
  onCarry,
  onOpen,
}: {
  prep: TomorrowPrep;
  /** Live commercial replan — what tomorrow should actually hold, and why. */
  replan?: CommercialReplan;
  busy: boolean;
  onCarry: (workIds: string[], reason?: string) => void | Promise<void>;
  onOpen: (workId: string) => void;
}) {
  const groups = React.useMemo(() => openReasonGroups(prep), [prep]);
  const carryable = prep.carry.filter((c) => c.actionable && !c.alreadyScheduled);

  return (
    <Card data-testid="prepare-tomorrow">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-primary" /> Prepare tomorrow
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {prep.note} Carrying an item writes tomorrow's date ({prep.date}) and the reason to the work
          record.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {prep.carry.length} open
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            ~{humanizeMinutes(prep.plannedMinutes)} of recorded effort
          </Badge>
          <Button
            size="sm"
            disabled={busy || carryable.length === 0}
            onClick={() => onCarry(carryable.map((c) => c.workId), "Carried forward at day close")}
            data-testid="carry-all"
          >
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Carry {carryable.length || "nothing"} into tomorrow
          </Button>
        </div>

        {prep.carry.length > 0 && (
          <ul className="space-y-2">
            {prep.carry.map((c) => (
              <li key={c.workId} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-2.5">
                <div className="min-w-0">
                  <button
                    className="text-left text-sm font-medium hover:underline"
                    onClick={() => onOpen(c.workId)}
                  >
                    {c.title}
                  </button>
                  <div className="text-xs text-muted-foreground">{c.why}</div>
                  <div className="text-xs text-muted-foreground">
                    {humanizeMinutes(c.effortMinutes)} of recorded effort
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.alreadyScheduled ? (
                    <Badge variant="outline" className="text-[10px]">
                      <CheckCircle2 className="mr-1 h-3 w-3 text-success" /> Scheduled
                    </Badge>
                  ) : !c.actionable ? (
                    <Badge variant="outline" className="text-[10px]">
                      <Lock className="mr-1 h-3 w-3" /> Held elsewhere
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={busy}
                      onClick={() => onCarry([c.workId], c.why)}
                      data-testid="carry-one"
                    >
                      Carry into tomorrow
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {replan && replan.recommendations.length > 0 && (
          <div
            className={
              replan.capacityConflict
                ? "rounded-md border border-warning/50 bg-warning/5 p-3"
                : "rounded-md border p-3"
            }
            data-testid="commercial-replan"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Replanned from live commercial records
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {replan.note}{" "}
              {replan.capacityMinutes === null
                ? "No productive capacity is recorded for your role, so nothing is capped."
                : `Tomorrow holds ${humanizeMinutes(replan.capacityMinutes)} of productive time; ${humanizeMinutes(
                    replan.plannedMinutes,
                  )} is planned.`}
              {replan.capacityConflict
                ? ` Carried work totals ${humanizeMinutes(prep.plannedMinutes)} — more than tomorrow contains, so the overflow needs a decision.`
                : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                {replan.movedToday} deal{replan.movedToday === 1 ? "" : "s"} moved today
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {replan.stalled} stalled 10+ working days
              </Badge>
            </div>
            <ul className="mt-2 space-y-1.5">
              {replan.recommendations.map((r) => (
                <li key={r.workId} className="rounded-md border bg-card p-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      className="text-left text-sm font-medium hover:underline"
                      onClick={() => onOpen(r.workId)}
                    >
                      {r.title}
                    </button>
                    <Badge
                      variant={r.disposition === "continue" ? "secondary" : "outline"}
                      className="text-[10px]"
                    >
                      {REPLAN_LABEL[r.disposition]}
                    </Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">{r.why}</div>
                  {r.stage && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground opacity-80">
                      Stage {r.stage}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {groups.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Still open — and why
            </div>
            <div className="mt-2 space-y-2">
              {groups.map((g) => (
                <div key={g.category} className="rounded-md border p-2.5">
                  <div className="text-sm font-medium">{g.reason}</div>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {g.items.map((i) => (
                      <li key={i.workId}>{i.title}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {prep.promisesDueTomorrow.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
            <div className="text-sm font-semibold">Customer promises due tomorrow</div>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {prep.promisesDueTomorrow.map((p) => (
                <li key={p.id}>
                  {p.account ? `${p.account}: ` : ""}
                  {p.commitment}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default PrepareTomorrowPanel;
