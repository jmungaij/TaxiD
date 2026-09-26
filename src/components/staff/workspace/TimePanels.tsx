import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Activity, Gauge, Timer, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fillWindow,
  humanizeMinutes,
  MICRO_WINDOWS,
  type MicroFill,
  type ScoredPersonalWork,
  type TimeToday,
  type TodayProgress,
  type WorkloadHealth,
} from "@/lib/workspace";

/* ------------------------------------------------------------ time today */

export function TimeTodayPanel({ time }: { time: TimeToday }) {
  const pct =
    time.usableMinutes > 0
      ? Math.min(100, Math.round((time.plannedMinutes / time.usableMinutes) * 100))
      : 0;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Gauge className="h-3.5 w-3.5 text-primary" /> Time today
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Metric label="Usable" value={humanizeMinutes(time.usableMinutes)} />
          <Metric label="Planned" value={humanizeMinutes(time.plannedMinutes)} />
          <Metric label="Completed" value={humanizeMinutes(time.completedMinutes)} />
          <Metric label="Unplanned" value={humanizeMinutes(time.remainingMinutes)} />
        </dl>
        <Progress value={pct} className="mt-4 h-1.5" />
        <p className="mt-2 text-xs text-muted-foreground">
          {pct}% of your remaining usable time is planned. A quarter of the day
          ({humanizeMinutes(time.reserveMinutes)}) is reserved for interruptions.
          {time.reserveExhausted &&
            " Your interruption reserve is exhausted — consider moving one flexible item to tomorrow."}
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums tracking-tight">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------- workload health */

export function WorkloadHealthPanel({
  health,
  onReplan,
}: {
  health: WorkloadHealth;
  onReplan: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-primary" /> Workload health
          </div>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              health.state === "healthy" && "border-success/50 text-success",
              health.state === "tight" && "border-warning/50 text-warning",
              (health.state === "overloaded" || health.state === "critical") &&
                "border-destructive/50 text-destructive",
            )}
          >
            {health.label}
          </Badge>
        </div>
        <p className="mt-3 text-sm">{health.message}</p>
        {health.recommendation && (
          <>
            <p className="mt-1 text-xs text-muted-foreground">{health.recommendation}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={onReplan}>
              Replan remaining day
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- today progress */

export function ProgressPanel({ progress }: { progress: TodayProgress }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Today's progress
        </div>
        {!progress.hasData ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing has been planned or completed today yet.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm">
              <span className="text-lg font-semibold tabular-nums">
                {progress.completed} / {progress.planned}
              </span>{" "}
              planned activities completed
            </p>
            <Progress value={progress.pct} className="mt-3 h-1.5" />
            <p className="mt-2 text-xs text-muted-foreground">
              {progress.remaining} remaining · {progress.carriedOver} moved to tomorrow
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------- micro-time */

/**
 * Micro-time engine surface: detect the window, propose only work that fits,
 * and let the employee commit the window to a real plan.
 */
export function MicroTimePanel({
  scored,
  availableMinutes,
  onStartFocus,
  onOpen,
}: {
  scored: ScoredPersonalWork[];
  availableMinutes: number;
  onStartFocus: (workId: string) => void;
  onOpen: (workId: string) => void;
}) {
  const [window, setWindow] = useState<number>(
    availableMinutes > 0 ? Math.min(availableMinutes, 30) : 15,
  );
  const [fill, setFill] = useState<MicroFill | null>(null);

  const plan = () => setFill(fillWindow(scored, window));

  return (
    <Card data-testid="micro-time">
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Timer className="h-3.5 w-3.5 text-primary" /> Available time
          </div>
          <span className="text-xs text-muted-foreground">
            {humanizeMinutes(availableMinutes)} unplanned
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {MICRO_WINDOWS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setWindow(m);
                setFill(fillWindow(scored, m));
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                window === m
                  ? "border-primary bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {m} min
            </button>
          ))}
        </div>

        <Button size="sm" className="mt-3" onClick={plan}>
          Plan my {window} minutes
        </Button>

        {fill && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-muted-foreground">{fill.note}</p>
            {fill.items.map((s) => (
              <div key={s.work.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.work.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {humanizeMinutes(s.effortMinutes)} · {s.reasons[0]}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpen(s.work.id)}>
                    Open
                  </Button>
                  <Button size="sm" className="h-7 px-2 text-xs" onClick={() => onStartFocus(s.work.id)}>
                    Start
                  </Button>
                </div>
              </div>
            ))}
            {fill.items.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {humanizeMinutes(fill.usedMinutes)} of {humanizeMinutes(fill.requestedMinutes)} committed ·{" "}
                {humanizeMinutes(fill.leftoverMinutes)} spare
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- quick wins */

export function QuickWinsPanel({
  items,
  onStartFocus,
}: {
  items: ScoredPersonalWork[];
  onStartFocus: (workId: string) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-primary" /> Quick wins
        </div>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No short items are open — nothing you own can be finished in one sitting right now.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((s) => (
              <li key={s.work.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm">{s.work.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {humanizeMinutes(s.effortMinutes)}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => onStartFocus(s.work.id)}
                  >
                    Start
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
