/**
 * TaxiD PARTNERS 360 — lifecycle task queue status.
 *
 * Every lifecycle-stage signal raises (or folds into) a partner-desk task. This
 * module reads `v_partner_lifecycle_task_queue`, the server-side view that joins
 * each signal to its task and computes the SLA clock, so the staff surface never
 * recomputes due dates from partial data. Dispatch state explains what actually
 * happened to the alert: dispatched, batched into an open throttle window, or
 * failed — with the reason carried alongside.
 */
import { supabase } from "@/integrations/supabase/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

export type DispatchState = "dispatched" | "batched" | "throttled" | "failed";
export type TaskSlaStatus = "on_track" | "at_risk" | "breached" | "met" | "no_task";

export interface LifecycleTaskRow {
  signal_id: string;
  session_id: string;
  lifecycle_stage: string;
  maturity_level: string | null;
  network_category: string | null;
  intent_bring: string | null;
  ab_variant: string | null;
  page_source: string | null;
  signalled_at: string;
  dispatch_state: DispatchState;
  dispatch_reason: string | null;
  batched_into_signal_id: string | null;
  notified_at: string | null;
  work_item_id: string | null;
  work_code: string | null;
  queue: string | null;
  title: string | null;
  work_state: string | null;
  priority: string | null;
  sla_minutes: number | null;
  sla_started_at: string | null;
  due_at: string | null;
  resolved_at: string | null;
  escalated_at: string | null;
  escalation_reason: string | null;
  assigned_to: string | null;
  elapsed_minutes: number | null;
  sla_progress_pct: number | null;
  sla_status: TaskSlaStatus;
}

export const DISPATCH_LABEL: Record<DispatchState, string> = {
  dispatched: "Alert sent",
  batched: "Batched into window",
  throttled: "Throttled",
  failed: "Dispatch failed",
};

export const SLA_LABEL: Record<TaskSlaStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  breached: "SLA breached",
  met: "Met in SLA",
  no_task: "No task raised",
};

export interface TaskQueueFilter {
  sessionId?: string;
  slaStatus?: TaskSlaStatus | "all";
  dispatchState?: DispatchState | "all";
  openOnly?: boolean;
  limit?: number;
}

export async function fetchLifecycleTasks(filter: TaskQueueFilter = {}): Promise<LifecycleTaskRow[]> {
  let q = db
    .from("v_partner_lifecycle_task_queue")
    .select("*")
    .order("signalled_at", { ascending: false })
    .limit(filter.limit ?? 300);

  if (filter.sessionId) q = q.eq("session_id", filter.sessionId);
  if (filter.slaStatus && filter.slaStatus !== "all") q = q.eq("sla_status", filter.slaStatus);
  if (filter.dispatchState && filter.dispatchState !== "all") q = q.eq("dispatch_state", filter.dispatchState);
  if (filter.openOnly) q = q.is("resolved_at", null);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as LifecycleTaskRow[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Human SLA countdown — "3h 12m left" or "1h 4m over". */
export function slaCountdown(row: LifecycleTaskRow, now = Date.now()): string {
  if (!row.due_at) return "—";
  const due = new Date(row.due_at).getTime();
  const reference = row.resolved_at ? new Date(row.resolved_at).getTime() : now;
  const deltaMin = Math.round((due - reference) / 60_000);
  const abs = Math.abs(deltaMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`;
  if (row.resolved_at) return deltaMin >= 0 ? `Closed ${span} inside SLA` : `Closed ${span} late`;
  return deltaMin >= 0 ? `${span} left` : `${span} over`;
}

export interface TaskQueueSummary {
  total: number;
  open: number;
  breached: number;
  atRisk: number;
  batched: number;
  failed: number;
  medianProgress: number;
}

export function summariseTasks(rows: LifecycleTaskRow[]): TaskQueueSummary {
  const progress = rows
    .map((r) => r.sla_progress_pct)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  const median = progress.length === 0 ? 0 : progress[Math.floor(progress.length / 2)];

  return {
    total: rows.length,
    open: rows.filter((r) => r.work_item_id && !r.resolved_at).length,
    breached: rows.filter((r) => r.sla_status === "breached").length,
    atRisk: rows.filter((r) => r.sla_status === "at_risk").length,
    batched: rows.filter((r) => r.dispatch_state === "batched").length,
    failed: rows.filter((r) => r.dispatch_state === "failed").length,
    medianProgress: Math.round(median),
  };
}
