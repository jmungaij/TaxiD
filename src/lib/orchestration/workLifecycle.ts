/**
 * Yalla orchestration — controlled work lifecycle and SLA engine.
 *
 * Staff cannot move work arbitrarily: transitions are validated here and
 * enforced again server-side by `ops_work_transition`. Time is operationalised —
 * every work item carries an SLA start, target, remaining time, breach risk and
 * escalation rule.
 */
import type { OpsQueue, Priority } from "./rules";
import {
  NAIROBI_BUSINESS_CALENDAR,
  addBusinessMinutes,
  businessMinutesBetween,
  businessMinutesUntil,
  type BusinessCalendar,
} from "@/lib/work/businessTime";

export const WORK_STATES = [
  "new",
  "triaged",
  "assigned",
  "in_progress",
  "waiting",
  "escalated",
  "resolved",
  "closed",
] as const;
export type WorkState = (typeof WORK_STATES)[number];

export const WORK_STATE_LABEL: Record<WorkState, string> = {
  new: "New",
  triaged: "Triaged",
  assigned: "Assigned",
  in_progress: "In progress",
  waiting: "Waiting",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

/** The only legal transitions. Anything else is rejected. */
export const WORK_TRANSITIONS: Record<WorkState, WorkState[]> = {
  new: ["triaged", "assigned", "escalated"],
  triaged: ["assigned", "escalated", "waiting"],
  assigned: ["in_progress", "waiting", "escalated", "triaged"],
  in_progress: ["waiting", "escalated", "resolved"],
  waiting: ["in_progress", "escalated", "resolved"],
  escalated: ["in_progress", "waiting", "resolved"],
  resolved: ["closed", "in_progress"],
  closed: [],
};

/** Transitions that may only be performed with a recorded reason. */
export const REASON_REQUIRED: WorkState[] = ["escalated", "waiting", "resolved", "closed"];

export interface TransitionCheck {
  allowed: boolean;
  reason?: string;
}

export function canTransition(from: WorkState, to: WorkState, opts?: { reason?: string; assignee?: string | null }): TransitionCheck {
  if (from === to) return { allowed: false, reason: "Work is already in that state" };
  if (!WORK_TRANSITIONS[from].includes(to)) {
    return { allowed: false, reason: `${WORK_STATE_LABEL[from]} cannot move directly to ${WORK_STATE_LABEL[to]}` };
  }
  if (REASON_REQUIRED.includes(to) && !opts?.reason?.trim()) {
    return { allowed: false, reason: `A reason is required to move work to ${WORK_STATE_LABEL[to]}` };
  }
  if ((to === "assigned" || to === "in_progress") && opts && opts.assignee === null) {
    return { allowed: false, reason: "Work must have an owner before it can be started" };
  }
  return { allowed: true };
}

export const isOpen = (state: WorkState) => state !== "resolved" && state !== "closed";

/* ------------------------------------------------------------------ SLA */

export type SlaStatus = "on_track" | "at_risk" | "breached" | "met";

export interface SlaView {
  status: SlaStatus;
  targetAt: string;
  remainingMinutes: number;
  elapsedMinutes: number;
  /** Fraction of the SLA window consumed, 0-1+. */
  consumed: number;
  /** Minute at which the escalation warning fires. */
  warnAtMinutes: number;
  /** Which clock produced the numbers above, so surfaces can say so. */
  clock: "business" | "elapsed";
  /** Wall-clock minutes since the clock started, for context only. */
  wallClockElapsedMinutes: number;
}

export interface SlaInput {
  startedAt: string;
  slaMinutes: number;
  /** Set when the work reached resolved/closed. */
  stoppedAt?: string | null;
  now?: string;
  /**
   * Working-hours clock by default: evenings, weekends and holidays do not
   * consume a commitment. Pass "elapsed" only for genuinely 24/7 commitments
   * (incident response, live trip safety).
   */
  clock?: "business" | "elapsed";
  /** Business calendar override; defaults to the Nairobi commercial desk. */
  calendar?: BusinessCalendar;
  /**
   * Working minutes the work spent waiting on a customer or another party. The
   * clock is not charged for time the employee could not act on.
   */
  pausedMinutes?: number;
}

/** Escalation warning fires at 80% of the SLA window. */
export const WARN_RATIO = 0.8;

/**
 * Evaluates a commitment on the WORKING clock.
 *
 * The deadline is the instant reached after consuming `slaMinutes` of published
 * working time from the start, so the date shown to a person is a real date they
 * can act on, and "breached" only ever means "working time was available and the
 * commitment still slipped".
 */
export function evaluateSla(input: SlaInput): SlaView {
  const clock = input.clock ?? "business";
  const calendar = input.calendar ?? NAIROBI_BUSINESS_CALENDAR;
  const start = new Date(input.startedAt);
  const end = new Date(input.stoppedAt ?? input.now ?? new Date().toISOString());
  const paused = Math.max(0, input.pausedMinutes ?? 0);

  const target =
    clock === "business"
      ? addBusinessMinutes(start, input.slaMinutes + paused, calendar)
      : new Date(start.getTime() + (input.slaMinutes + paused) * 60_000);

  const wallClockElapsedMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  const rawElapsed =
    clock === "business" ? businessMinutesBetween(start, end, calendar) : wallClockElapsedMinutes;
  const elapsedMinutes = Math.max(0, rawElapsed - paused);
  const remainingMinutes =
    clock === "business"
      ? businessMinutesUntil(target, end, calendar)
      : Math.round((target.getTime() - end.getTime()) / 60_000);

  const consumed = input.slaMinutes === 0 ? 1 : elapsedMinutes / input.slaMinutes;
  const warnAtMinutes = Math.round(input.slaMinutes * WARN_RATIO);

  let status: SlaStatus;
  if (input.stoppedAt) status = elapsedMinutes <= input.slaMinutes ? "met" : "breached";
  else if (elapsedMinutes > input.slaMinutes) status = "breached";
  else if (consumed >= WARN_RATIO) status = "at_risk";
  else status = "on_track";

  return {
    status,
    targetAt: target.toISOString(),
    remainingMinutes,
    elapsedMinutes,
    consumed,
    warnAtMinutes,
    clock,
    wallClockElapsedMinutes,
  };
}

/* ---------------------------------------------------- workspace bucketing */

export const WORKSPACE_BUCKETS = ["now", "next", "waiting", "approvals", "escalated", "overdue", "completed"] as const;
export type WorkspaceBucket = (typeof WORKSPACE_BUCKETS)[number];

export const BUCKET_LABEL: Record<WorkspaceBucket, string> = {
  now: "Now",
  next: "Next",
  waiting: "Waiting",
  approvals: "Approvals",
  escalated: "Escalated",
  overdue: "Overdue",
  completed: "Completed",
};

export interface BucketableWork {
  state: WorkState;
  priority: Priority;
  needsApproval: boolean;
  sla: SlaView;
}

export function bucketFor(work: BucketableWork): WorkspaceBucket {
  if (!isOpen(work.state)) return "completed";
  if (work.sla.status === "breached") return "overdue";
  if (work.state === "escalated") return "escalated";
  if (work.needsApproval) return "approvals";
  if (work.state === "waiting") return "waiting";
  if (work.priority === "critical" || work.priority === "high" || work.sla.status === "at_risk") return "now";
  return "next";
}

/** Operational sort: breach first, then priority, then least time remaining. */
export function compareWork(a: BucketableWork, b: BucketableWork): number {
  const order: Priority[] = ["critical", "high", "medium", "low"];
  const breach = Number(b.sla.status === "breached") - Number(a.sla.status === "breached");
  if (breach) return breach;
  const p = order.indexOf(a.priority) - order.indexOf(b.priority);
  if (p) return p;
  return a.sla.remainingMinutes - b.sla.remainingMinutes;
}

export interface QueueLoad {
  queue: OpsQueue;
  open: number;
  breached: number;
  atRisk: number;
  escalated: number;
  awaitingApproval: number;
}
