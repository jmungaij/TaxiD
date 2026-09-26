/**
 * Command centre — day close.
 *
 * Three columns of the same working day: TODAY (what actually moved, from the
 * frozen close), TOMORROW (what has already been promised) and the work queue
 * (what to pick up next). Every figure is read from the close records; closing
 * the day places tomorrow's first three actions on the task list.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CalendarCheck, Sunrise, ListChecks } from "lucide-react";
import { fetchSalesDayClose, KES } from "@/lib/sales/dayClose";
import { fetchTomorrowPlan, dayLabel } from "@/lib/sales/tomorrow";

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export default function DayCloseCommandCentre() {
  const qc = useQueryClient();

  const close = useQuery({ queryKey: ["sales-day-close"], queryFn: () => fetchSalesDayClose(null, false) });
  const plan = useQuery({ queryKey: ["sales-tomorrow-plan"], queryFn: () => fetchTomorrowPlan(null) });

  const closeDay = useMutation({
    mutationFn: () => fetchSalesDayClose(null, true),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["sales-day-close"] });
      void qc.invalidateQueries({ queryKey: ["sales-my-day"] });
      toast.success(
        res.tasks_placed
          ? `Day closed. ${res.tasks_placed} action${res.tasks_placed === 1 ? "" : "s"} placed for tomorrow.`
          : "Day closed. Nothing needed placing for tomorrow.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (close.isLoading || plan.isLoading) return <Skeleton className="h-72 w-full" />;

  if (close.error || plan.error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">Your day close could not be read.</p>
          <p className="text-muted-foreground">
            {((close.error ?? plan.error) as Error).message}
          </p>
        </CardContent>
      </Card>
    );
  }

  const d = close.data;
  const t = plan.data;
  const today = d?.today;
  const actions = d?.next_actions ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {dayLabel(d?.date)} — {d?.staff_name ?? "your desk"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Today's figures are frozen every evening at 7 PM Kenya time. Closing now places
            tomorrow's first actions on your list.
          </p>
        </div>
        <Button size="sm" disabled={closeDay.isPending} onClick={() => closeDay.mutate()}>
          <CalendarCheck className="mr-1.5 h-4 w-4" aria-hidden /> Close my day
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarCheck className="h-4 w-4" aria-hidden /> Today
            </CardTitle>
            <CardDescription>What actually moved, from the records.</CardDescription>
          </CardHeader>
          <CardContent>
            <Line label="New leads" value={String(today?.leads_created ?? 0)} />
            <Line label="Stages moved on" value={String(today?.stages_advanced ?? 0)} />
            <Line label="Replies given" value={String(today?.clocks_completed ?? 0)} />
            <Line label="Contracts signed" value={String(today?.contracts_signed ?? 0)} />
            <Line label="Contracts activated" value={String(today?.contracts_activated ?? 0)} />
            <Line label="Deals won" value={String(today?.won_count ?? 0)} />
            <Line label="Revenue recognised" value={KES(today?.contract_revenue_kes ?? 0)} />
            <div className="mt-3 rounded-md border p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                This month against target
              </p>
              <p className="mt-1 text-lg font-semibold tracking-tight">
                {KES(d?.month.figures.revenue_won_kes ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground">
                {d?.month.target_kes
                  ? `of ${KES(d.month.target_kes)} · ${d.month.attainment_pct ?? 0}% · ${KES(
                      d.month.remaining_kes ?? 0,
                    )} to go`
                  : "NO TARGET ON THE REGISTER"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sunrise className="h-4 w-4" aria-hidden /> Tomorrow
            </CardTitle>
            <CardDescription>{dayLabel(t?.tomorrow)} — already promised.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(t?.promises ?? []).length === 0 &&
              (t?.services ?? []).length === 0 &&
              (t?.contracts_waiting ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">NOTHING PROMISED FOR TOMORROW</p>
              )}
            {(t?.promises ?? []).slice(0, 6).map((p) => (
              <div key={p.lead_id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{p.organisation ?? p.lead_ref ?? "Lead"}</span>
                  {p.overdue ? (
                    <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                      Past its date
                    </Badge>
                  ) : (
                    <Badge variant="outline">Due tomorrow</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.awaiting_item ?? "Follow up"} · {KES(p.value_kes)}
                </p>
              </div>
            ))}
            {(t?.services ?? []).slice(0, 4).map((s) => (
              <div key={`svc-${s.lead_id}`} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{s.organisation ?? s.lead_ref ?? "Lead"}</span>
                  <Badge variant="secondary">Service tomorrow</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.origin ?? "origin not recorded"} → {s.destination ?? "destination not recorded"}
                </p>
              </div>
            ))}
            {(t?.contracts_waiting ?? []).slice(0, 4).map((c) => (
              <div key={`ctr-${c.contract_number}`} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{c.organisation ?? c.contract_number ?? "Contract"}</span>
                  <Badge variant="outline">
                    {c.waiting_on === "SIGNATURE" ? "Waiting on signature" : "Waiting on activation"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{KES(c.value_kes)}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4" aria-hidden /> Work queue
            </CardTitle>
            <CardDescription>Pick these up in this order.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {actions.length === 0 && (
              <p className="text-sm text-muted-foreground">NOTHING WAITING ON YOU RIGHT NOW</p>
            )}
            {actions.slice(0, 8).map((a, i) => (
              <div key={a.lead_id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {i + 1}. {a.organisation ?? a.lead_ref ?? "Unnamed lead"}
                  </span>
                  <Badge variant="outline">{a.stage.split("_").join(" ")}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{a.why}</p>
              </div>
            ))}
            {(t?.untouched_over_a_week ?? []).length > 0 && (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {t?.untouched_over_a_week.length} lead
                {t?.untouched_over_a_week.length === 1 ? "" : "s"} untouched for over a week.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
