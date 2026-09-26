/**
 * SAFARID PARTNERS 360 — lifecycle task queue status.
 *
 * Every lifecycle-stage signal either raised a partner-desk task, folded into an
 * open throttle window, or failed to dispatch. This surface shows all three, with
 * the SLA clock computed server-side (`v_partner_lifecycle_task_queue`): elapsed
 * time, progress against the SLA, whether the task is on track, at risk or
 * breached, and the verbatim reason when a dispatch did not go out.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ListChecks, RefreshCw, Timer } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePartnerFunnelRealtime } from "@/lib/partners/history";
import { labelOf } from "@/lib/partners/journeyDrill";
import {
  DISPATCH_LABEL,
  SLA_LABEL,
  fetchLifecycleTasks,
  slaCountdown,
  summariseTasks,
  type DispatchState,
  type LifecycleTaskRow,
  type TaskSlaStatus,
} from "@/lib/partners/taskQueue";

const SLA_TONE: Record<TaskSlaStatus, string> = {
  on_track: "bg-status-success/15 text-status-success",
  at_risk: "bg-status-warning/15 text-status-warning",
  breached: "bg-destructive/15 text-destructive",
  met: "bg-muted text-muted-foreground",
  no_task: "bg-muted text-muted-foreground",
};

const DISPATCH_TONE: Record<DispatchState, "default" | "secondary" | "outline" | "destructive"> = {
  dispatched: "default",
  batched: "secondary",
  throttled: "outline",
  failed: "destructive",
};

const fmt = (iso: string) => new Date(iso).toLocaleString("en-KE");

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function LifecycleTaskQueue() {
  const [sla, setSla] = useState<TaskSlaStatus | "all">("all");
  const [dispatch, setDispatch] = useState<DispatchState | "all">("all");
  const [openOnly, setOpenOnly] = useState(true);

  const query = useQuery({
    queryKey: ["yp-task-queue", sla, dispatch, openOnly],
    queryFn: () => fetchLifecycleTasks({ slaStatus: sla, dispatchState: dispatch, openOnly }),
    refetchInterval: 60_000,
  });

  usePartnerFunnelRealtime(() => void query.refetch(), "task-queue");

  const rows: LifecycleTaskRow[] = query.data ?? [];
  const summary = useMemo(() => summariseTasks(rows), [rows]);

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="Lifecycle task queue"
        eyebrow="SAFARID Partners 360"
        lede="Each lifecycle-stage signal, the partner-desk task it raised, its SLA clock, and why any alert did not go out."
        actions={
          <Button size="sm" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Signals" value={summary.total} hint={openOnly ? "Open tasks only" : "All records"} />
        <Kpi label="Open tasks" value={summary.open} />
        <Kpi label="SLA breached" value={summary.breached} hint="Past the due time" />
        <Kpi label="At risk" value={summary.atRisk} hint="Over 75% of the SLA elapsed" />
        <Kpi
          label="Batched · failed"
          value={`${summary.batched} · ${summary.failed}`}
          hint="Folded into a throttle window vs dispatch failures"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" aria-hidden /> Queue
          </CardTitle>
          <CardDescription>
            Median SLA consumption across the shown records is {summary.medianProgress}%. Throttling folds rapid
            stage changes inside one window into a single alert and a single task, so duplicates never reach the desk.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={sla} onValueChange={(v) => setSla(v as TaskSlaStatus | "all")}>
              <SelectTrigger className="w-[210px]" aria-label="Filter by SLA status">
                <SelectValue placeholder="SLA status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All SLA states</SelectItem>
                {(Object.keys(SLA_LABEL) as TaskSlaStatus[]).map((k) => (
                  <SelectItem key={k} value={k}>{SLA_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={dispatch} onValueChange={(v) => setDispatch(v as DispatchState | "all")}>
              <SelectTrigger className="w-[210px]" aria-label="Filter by dispatch state">
                <SelectValue placeholder="Dispatch state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All dispatch states</SelectItem>
                {(Object.keys(DISPATCH_LABEL) as DispatchState[]).map((k) => (
                  <SelectItem key={k} value={k}>{DISPATCH_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button size="sm" variant={openOnly ? "default" : "outline"} onClick={() => setOpenOnly((v) => !v)}>
              {openOnly ? "Showing open only" : "Showing all records"}
            </Button>
          </div>

          {query.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : query.isError ? (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {(query.error as Error).message}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No lifecycle tasks match these filters.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.signal_id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{labelOf("stage", r.lifecycle_stage)}</Badge>
                    <Badge variant={DISPATCH_TONE[r.dispatch_state]}>{DISPATCH_LABEL[r.dispatch_state]}</Badge>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SLA_TONE[r.sla_status]}`}>
                      {SLA_LABEL[r.sla_status]}
                    </span>
                    {r.work_code && <span className="text-xs font-medium tabular-nums">{r.work_code}</span>}
                    {r.escalated_at && <Badge variant="destructive">Escalated</Badge>}
                    <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Timer className="h-3.5 w-3.5" aria-hidden />
                      {slaCountdown(r)}
                    </span>
                  </div>

                  <p className="mt-1.5 text-sm font-medium">{r.title ?? "No task raised for this signal"}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      `Signalled ${fmt(r.signalled_at)}`,
                      r.due_at ? `due ${fmt(r.due_at)}` : null,
                      r.queue ? `queue ${r.queue}` : null,
                      r.priority ? `priority ${r.priority}` : null,
                      r.intent_bring ? `brings ${labelOf("bring", r.intent_bring)}` : null,
                      r.maturity_level ? `level ${labelOf("level", r.maturity_level)}` : null,
                    ].filter(Boolean).join(" · ")}
                  </p>

                  {typeof r.sla_progress_pct === "number" && r.sla_status !== "no_task" && (
                    <div className="mt-2">
                      <Progress
                        value={Math.min(100, Math.max(0, r.sla_progress_pct))}
                        aria-label={`SLA consumed ${Math.round(r.sla_progress_pct)} percent`}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {Math.round(r.sla_progress_pct)}% of the {r.sla_minutes ?? "—"} minute SLA consumed
                        {r.elapsed_minutes != null ? ` · ${Math.round(r.elapsed_minutes)} min elapsed` : ""}
                      </p>
                    </div>
                  )}

                  {(r.dispatch_reason || r.batched_into_signal_id || r.escalation_reason) && (
                    <p className="mt-2 rounded-lg border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
                      {r.dispatch_state === "failed" ? "Failure reason: " : "Dispatch note: "}
                      {r.dispatch_reason ?? "—"}
                      {r.batched_into_signal_id ? " · folded into an earlier signal in the same window" : ""}
                      {r.escalation_reason ? ` · escalation: ${r.escalation_reason}` : ""}
                    </p>
                  )}

                  <div className="mt-2">
                    <Button size="sm" variant="ghost" asChild>
                      <Link to={`/staff/partners/funnel/${r.session_id}`}>Open partner journey</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
