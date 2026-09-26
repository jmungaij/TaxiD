import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReplanChange, TimelineEntry } from "@/lib/workspace";

const SHOWN = 10;

/**
 * TODAY — an ordered list of the work in front of the employee.
 *
 * Deliberately not a clock-by-clock schedule: employees told us that accounting
 * for every minute was the single biggest source of friction. The engine still
 * ranks and sizes work behind the scenes; here we only show the order, the state
 * and why each item matters.
 */
export function TodayTimeline({
  entries,
  replan,
  onAcceptReplan,
  onOpen,
}: {
  entries: TimelineEntry[];
  note: string;
  replan: ReplanChange[];
  onAcceptReplan: () => void;
  onOpen: (workId: string) => void;
}) {
  const real = entries.filter((e) => e.kind !== "close");
  const shown = real.slice(0, SHOWN);
  const hidden = real.length - shown.length;

  return (
    <section aria-labelledby="today-timeline" className="rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="today-timeline"
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
        >
          <ListChecks className="h-3.5 w-3.5 text-primary" /> Today, in order
        </h2>
        <span className="text-xs text-muted-foreground">
          {real.length} open item{real.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Work from the top. Nothing here asks you to log your time.
      </p>

      {replan.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
          <div className="font-medium text-foreground">
            {replan.length} change{replan.length === 1 ? "" : "s"} would reorder your list
          </div>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {replan.slice(0, 3).map((c) => (
              <li key={c.workId}>· {c.title} — {c.detail}</li>
            ))}
          </ul>
          <Button size="sm" variant="outline" className="mt-2" onClick={onAcceptReplan}>
            Reorder my list
          </Button>
        </div>
      )}

      {real.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nothing open — your list is clear.</p>
      ) : (
        <ol className="mt-4 space-y-0" data-testid="today-timeline">
          {shown.map((e, i) => (
            <li key={e.id} className="relative flex gap-4 border-l pb-4 pl-4 last:pb-0">
              <span
                className={cn(
                  "absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full",
                  e.kind === "current" && "bg-primary ring-4 ring-primary/15",
                  e.kind === "completed" && "bg-success",
                  e.kind === "planned" && "bg-muted-foreground/40",
                  e.kind === "spillover" && "bg-warning",
                )}
                aria-hidden
              />
              <span className="w-5 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      e.kind === "completed" && "text-muted-foreground line-through",
                    )}
                  >
                    {e.title}
                  </span>
                  {e.kind === "current" && <Badge className="text-[10px]">In progress</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{e.detail}</span>
              </span>
              {e.workId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => onOpen(e.workId!)}
                >
                  Open
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}

      {hidden > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {hidden} more item{hidden === 1 ? "" : "s"} are in your work queue.
        </p>
      )}
    </section>
  );
}
