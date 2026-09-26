/**
 * RESPONSE TIME BOARD.
 *
 * Every open commitment with a clock on it: what is due, when, and what has
 * already run over. The clocks and their escalation levels are computed and
 * enforced by the database — this page only reads them.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { AlarmClock, PauseCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { SLA_PROCESS_LABEL, fetchSlaBoard, runSlaSweep, type SlaClock } from "@/lib/sales/governance";

function remaining(c: SlaClock) {
  if (c.paused) return "Paused — waiting on the customer";
  const m = c.minutes_remaining;
  if (m < 0) {
    const over = Math.abs(m);
    return over >= 60 ? `Overdue by ${Math.round(over / 60)}h` : `Overdue by ${over}m`;
  }
  return m >= 60 ? `${Math.round(m / 60)}h left` : `${m}m left`;
}

export default function SlaBoard({ scope = "mine" as "mine" | "team" }) {
  const qc = useQueryClient();
  const [view, setView] = React.useState<"mine" | "team">(scope);
  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-sla-board", view],
    queryFn: () => fetchSlaBoard(view),
    refetchInterval: 60_000,
    retry: false,
  });

  const sweep = async () => {
    try {
      const r = await runSlaSweep();
      toast({
        title: "Clocks checked",
        description: `${r.breached} newly overdue · ${r.escalated} escalated to a manager`,
      });
      void qc.invalidateQueries({ queryKey: ["sales-sla-board"] });
      void qc.invalidateQueries({ queryKey: ["sales-target-dashboard"] });
    } catch (e) {
      toast({
        title: "Could not check the clocks",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (error) return null;

  const clocks = data?.clocks ?? [];
  const overdue = clocks.filter((c) => c.breached).length;

  return (
    <section className="glass-panel rounded-2xl p-5" aria-label="Response times">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <AlarmClock className="h-4 w-4 text-primary" aria-hidden /> Response times
          </h2>
          <p className="text-xs text-muted-foreground">
            {clocks.length === 0
              ? "Nothing is on the clock right now."
              : `${clocks.length} open commitment${clocks.length === 1 ? "" : "s"}${overdue ? ` · ${overdue} overdue` : ""}.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5">
            <Button size="sm" variant={view === "mine" ? "secondary" : "ghost"} onClick={() => setView("mine")}>
              Mine
            </Button>
            <Button size="sm" variant={view === "team" ? "secondary" : "ghost"} onClick={() => setView("team")}>
              My team
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={sweep}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Check clocks
          </Button>
        </div>
      </div>

      {clocks.length > 0 && (
        <div className="mt-4 space-y-2">
          {clocks.map((c) => (
            <Card key={c.clock_id} className={cn(c.breached && "border-destructive/40")}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    {SLA_PROCESS_LABEL[c.process] ?? c.process}
                    {c.organisation ? ` — ${c.organisation}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{c.entity_ref ?? "—"}</span>
                    {c.staff_name ? ` · ${c.staff_name}` : ""} · due{" "}
                    {new Date(c.due_at).toLocaleString("en-KE")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {c.paused && (
                    <Badge variant="outline" className="gap-1">
                      <PauseCircle className="h-3 w-3" aria-hidden /> Paused
                    </Badge>
                  )}
                  {c.escalation_level > 0 && (
                    <Badge variant="outline" className="border-[hsl(var(--status-warning)/0.5)] text-[hsl(var(--status-warning))]">
                      Escalation level {c.escalation_level}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={cn(c.breached && "border-destructive/50 text-destructive")}
                  >
                    {remaining(c)}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
