/**
 * SAFARID PERSONAL OPERATING SYSTEM v2 — pure engine.
 *
 * The employee dashboard is not a widget board. It is a personal operating
 * cockpit: one thing to do now, a realistic plan for the day, the promises the
 * employee owes customers, and an explicit close-of-day that regenerates
 * tomorrow.
 *
 * Everything in this module is PURE and deterministic. It only reads facts that
 * already exist on authoritative records (work items, customer commitments,
 * next actions). Nothing is invented: if a fact is absent, the engine says so
 * instead of guessing.
 */
import type { DecoratedWork } from "@/lib/orchestration/api";
import { isOpen } from "@/lib/orchestration/workLifecycle";
import {
  assignRelativeBands,
  resolveEffort,
  scoreWorkFacts,
  type PriorityBand,
  type ScoreContribution,
  type ScoreFactor,
  type WorkScoringFacts,
} from "@/lib/work/coreScore";

/* ------------------------------------------------------------------ inputs */

export interface PersonalCommitment {
  id: string;
  commitment: string;
  account_id: string;
  account_name: string | null;
  direction: "yalla_to_customer" | "customer_to_yalla";
  status: "open" | "in_progress" | "fulfilled" | "waived" | "cancelled";
  due_at: string | null;
  work_item_id: string | null;
  expected_outcome: string | null;
}

export interface PersonalNextAction {
  id: string;
  title: string;
  account_id: string;
  account_name: string | null;
  work_item_id: string;
  due_at: string | null;
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "in_progress" | "done" | "cancelled";
}

/* ------------------------------------------- scoring (canonical core only) */

/**
 * Effort comes from the triage norms recorded on the work item. This wrapper
 * exists only so callers keep a stable name; the estimate itself is decided in
 * the database and read back, never guessed per screen.
 */
export function estimateEffortMinutes(
  work: Pick<DecoratedWork, "work_kind" | "priority"> & {
    effort_minutes?: number | null;
    effort_basis?: string | null;
  },
): number {
  return resolveEffort({
    id: "",
    title: "",
    workKind: work.work_kind,
    priority: work.priority,
    effortMinutes: work.effort_minutes ?? null,
    effortBasis: work.effort_basis ?? null,
    slaStatus: "none",
  }).minutes;
}

export type PriorityFactor = ScoreFactor;
export type PriorityContribution = ScoreContribution;

export interface ScoredPersonalWork {
  work: DecoratedWork;
  score: number;
  reasons: string[];
  contributions: PriorityContribution[];
  effortMinutes: number;
  effortBasis: string;
  band: PriorityBand;
  /** True when the item carries a customer promise or revenue consequence. */
  revenueBearing: boolean;
  customerFacing: boolean;
  valuePerMinute: number | null;
}

type WorkWithTriage = DecoratedWork & {
  priority_band?: string | null;
  effort_minutes?: number | null;
  effort_basis?: string | null;
  value_score?: number | null;
  next_action?: string | null;
  next_action_due?: string | null;
  objective_id?: string | null;
};

/** Translate a decorated work row into the canonical scoring facts. */
function toFacts(work: DecoratedWork, commitments: PersonalCommitment[]): WorkScoringFacts {
  const w = work as WorkWithTriage;
  const linked = commitments.filter(
    (c) => c.work_item_id === work.id && (c.status === "open" || c.status === "in_progress"),
  );
  return {
    id: work.id,
    title: work.title,
    workKind: work.work_kind,
    priority: work.priority,
    band: w.priority_band ?? null,
    effortMinutes: w.effort_minutes ?? null,
    effortBasis: w.effort_basis ?? null,
    valueKes: w.value_score ?? null,
    slaStatus: work.sla.status as WorkScoringFacts["slaStatus"],
    slaRemainingMinutes: work.sla.remainingMinutes,
    slaDueAt: work.sla_due_at,
    lifecycleState: work.lifecycle_state,
    needsApproval: work.needs_approval,
    approvalState: work.approval_state,
    escalationLevel: work.escalation_level,
    nextAction: w.next_action ?? work.required_action ?? null,
    nextActionDue: w.next_action_due ?? null,
    objectiveId: w.objective_id ?? null,
    openPromises: linked.length,
    promiseEvidence: linked.map((c) => `${c.account_name ?? c.account_id}: ${c.commitment}`).join("; "),
  };
}

/**
 * Score a single work item for THIS employee through the canonical core, so the
 * cockpit and the work queue can never disagree about the same item.
 */
export function scorePersonalWork(
  work: DecoratedWork,
  ctx: { commitments?: PersonalCommitment[]; now?: Date } = {},
): ScoredPersonalWork {
  const scored = scoreWorkFacts(toFacts(work, ctx.commitments ?? []), ctx.now ?? new Date());
  return {
    work,
    score: scored.score,
    reasons: scored.reasons,
    contributions: scored.contributions,
    effortMinutes: scored.effortMinutes,
    effortBasis: scored.effortBasis,
    band: scored.band,
    revenueBearing: scored.revenueBearing,
    customerFacing: scored.customerFacing,
    valuePerMinute: scored.valuePerMinute,
  };
}

export function scoreAll(
  work: DecoratedWork[],
  ctx: { commitments?: PersonalCommitment[]; now?: Date } = {},
): ScoredPersonalWork[] {
  const scored = work
    .filter((w) => isOpen(w.lifecycle_state))
    .map((w) => scorePersonalWork(w, ctx))
    .sort((a, b) => b.score - a.score || a.effortMinutes - b.effortMinutes);

  // Bands are relative to this person's own queue.
  const bands = assignRelativeBands(scored, (s) => ({
    score: s.score,
    slaStatus: s.work.sla.status as WorkScoringFacts["slaStatus"],
  }));
  return scored.map((s) => ({ ...s, band: bands.get(s) ?? s.band }));
}

/* ------------------------------------------------------------- day planner */

export type BlockReason = "breach_recovery" | "customer_promise" | "revenue" | "committed_sla" | "routine";

export interface PlannedBlock {
  workId: string;
  title: string;
  startAt: string;
  endAt: string;
  minutes: number;
  reason: BlockReason;
  why: string;
  score: number;
}

export interface DayPlan {
  blocks: PlannedBlock[];
  /** Work that did not fit today's remaining capacity. */
  spillover: ScoredPersonalWork[];
  plannedMinutes: number;
  capacityMinutes: number;
  /** Focus minutes already recorded today, deducted from usable capacity. */
  spentMinutes: number;
  /** True when demand exceeds the working day and something must be renegotiated. */
  overCommitted: boolean;
  note: string;
}

export interface DayPlanOptions {
  now?: Date;
  /** Local hour the working day ends. */
  endHour?: number;
  /** Interruption/meeting reserve subtracted from raw remaining time. */
  reserveRatio?: number;
  /** Real effort already recorded today (from focus sessions). */
  spentMinutes?: number;
  /**
   * Productive minutes for this person's role, from the recorded capacity
   * profile. When present it CAPS the plan: a day plan may never promise more
   * than the configured productive capacity, however much time is left on the
   * clock.
   */
  profileProductiveMinutes?: number;
}

function blockReason(s: ScoredPersonalWork, hasPromise: boolean): { reason: BlockReason; why: string } {
  if (s.work.sla.status === "breached")
    return { reason: "breach_recovery", why: "Recover a breached commitment first" };
  if (hasPromise) return { reason: "customer_promise", why: "A customer is waiting on this promise" };
  if (s.revenueBearing) return { reason: "revenue", why: "Moves revenue this week" };
  if (s.work.sla.status === "at_risk")
    return { reason: "committed_sla", why: "Protects a committed SLA still inside its window" };
  return { reason: "routine", why: "Keeps the queue clear" };
}

/**
 * Build a time-boxed plan for the remainder of the working day from real
 * capacity, not from wishful thinking.
 */
export function buildDayPlan(
  scored: ScoredPersonalWork[],
  commitments: PersonalCommitment[] = [],
  opts: DayPlanOptions = {},
): DayPlan {
  const now = opts.now ?? new Date();
  const endHour = opts.endHour ?? 18;
  const reserveRatio = opts.reserveRatio ?? 0.25;
  const spentMinutes = Math.max(0, Math.round(opts.spentMinutes ?? 0));

  const end = new Date(now);
  end.setHours(endHour, 0, 0, 0);
  const rawMinutes = Math.max(0, Math.round((end.getTime() - now.getTime()) / 60_000));
  const clockCapacity = Math.round(rawMinutes * (1 - reserveRatio));
  const profileCapacity =
    typeof opts.profileProductiveMinutes === "number"
      ? Math.max(0, Math.round(opts.profileProductiveMinutes) - spentMinutes)
      : null;
  const capacityMinutes = profileCapacity === null ? clockCapacity : Math.min(clockCapacity, profileCapacity);


  const promiseIds = new Set(
    commitments
      .filter((c) => c.status === "open" || c.status === "in_progress")
      .map((c) => c.work_item_id)
      .filter(Boolean) as string[],
  );

  const blocks: PlannedBlock[] = [];
  const spillover: ScoredPersonalWork[] = [];
  let cursor = now.getTime();
  let planned = 0;

  for (const s of scored) {
    if (planned + s.effortMinutes > capacityMinutes) {
      spillover.push(s);
      continue;
    }
    const { reason, why } = blockReason(s, promiseIds.has(s.work.id));
    const startAt = new Date(cursor).toISOString();
    cursor += s.effortMinutes * 60_000;
    blocks.push({
      workId: s.work.id,
      title: s.work.title,
      startAt,
      endAt: new Date(cursor).toISOString(),
      minutes: s.effortMinutes,
      reason,
      why,
      score: s.score,
    });
    planned += s.effortMinutes;
  }

  const overCommitted = spillover.length > 0;
  const spentNote = spentMinutes ? ` ${spentMinutes} min of focused effort already recorded today.` : "";
  const note =
    (capacityMinutes === 0
      ? "The working day is over. Close the day and let the system replan tomorrow."
      : overCommitted
        ? `${spillover.length} item(s) cannot fit today. Renegotiate, delegate or escalate rather than silently slipping.`
        : "Today's committed work fits the remaining capacity.") + spentNote;

  return {
    blocks,
    spillover,
    plannedMinutes: planned,
    capacityMinutes,
    spentMinutes,
    overCommitted,
    note,
  };

}

/* ------------------------------------------------------- demand vs capacity */

export type DemandDecision =
  | "must_do"
  | "should_do"
  | "can_defer"
  | "waiting"
  | "automate"
  | "reassign"
  | "escalate"
  | "close";

export const DEMAND_DECISION_LABEL: Record<DemandDecision, string> = {
  must_do: "Must do today",
  should_do: "Should do today",
  can_defer: "Can defer",
  waiting: "Waiting on someone else",
  automate: "Candidate for automation",
  reassign: "Reassign — no capacity here",
  escalate: "Escalate — cannot be met",
  close: "Close or disqualify",
};

export interface DemandItem {
  scored: ScoredPersonalWork;
  decision: DemandDecision;
  why: string;
}

export interface CapacitySplit {
  capacityMinutes: number;
  demandMinutes: number;
  /** Demand as a share of capacity; 250 means two and a half days of work. */
  loadPct: number;
  items: DemandItem[];
  note: string;
}

/**
 * Split real demand against real capacity and force an explicit decision on
 * every item that cannot fit. Nothing is silently carried: work either fits, is
 * waiting on someone, or must be reassigned, automated, escalated or closed.
 */
export function splitDemand(
  scored: ScoredPersonalWork[],
  capacityMinutes: number,
  commitments: PersonalCommitment[] = [],
): CapacitySplit {
  const promiseIds = new Set(
    commitments
      .filter((c) => c.status === "open" || c.status === "in_progress")
      .map((c) => c.work_item_id)
      .filter(Boolean) as string[],
  );

  const items: DemandItem[] = [];
  let used = 0;
  let demand = 0;

  for (const s of scored) {
    demand += s.effortMinutes;
    const blocked = s.work.lifecycle_state === "waiting" || (s.work.needs_approval && s.work.approval_state === "pending");
    if (blocked) {
      items.push({
        scored: s,
        decision: "waiting",
        why: "Held by someone else — chase it, do not plan time for it",
      });
      continue;
    }

    const fits = used + s.effortMinutes <= capacityMinutes;
    if (fits) {
      const mustDo =
        s.work.sla.status === "breached" || s.work.sla.status === "at_risk" || promiseIds.has(s.work.id);
      used += s.effortMinutes;
      items.push({
        scored: s,
        decision: mustDo ? "must_do" : "should_do",
        why: mustDo
          ? "A committed deadline or a customer promise depends on it today"
          : "Fits today's capacity and moves the queue",
      });
      continue;
    }

    // Beyond capacity: the decision depends on what the record says.
    if (s.work.sla.status === "breached") {
      items.push({
        scored: s,
        decision: "escalate",
        why: "Already breached and there is no capacity today — escalate rather than let it slip further",
      });
    } else if (s.revenueBearing && (s.valuePerMinute ?? 0) > 0) {
      items.push({
        scored: s,
        decision: "reassign",
        why: "Carries recorded value but no capacity here — move it to someone with room",
      });
    } else if (s.band === "P5") {
      items.push({
        scored: s,
        decision: s.valuePerMinute === null ? "automate" : "can_defer",
        why:
          s.valuePerMinute === null
            ? "Low-value, no recorded value or engagement — handle by a standard nurture sequence, not by hand"
            : "Low band work that can wait without breaking a commitment",
      });
    } else {
      items.push({
        scored: s,
        decision: "can_defer",
        why: "No deadline today and nothing is waiting on it",
      });
    }
  }

  const loadPct = capacityMinutes > 0 ? Math.round((demand / capacityMinutes) * 100) : 0;
  const note =
    capacityMinutes === 0
      ? "No productive capacity left today — decide each item rather than planning work."
      : loadPct > 100
        ? `Demand is ${loadPct}% of today's capacity. ${
            items.filter((i) => i.decision !== "must_do" && i.decision !== "should_do").length
          } item(s) need a decision other than "do it today".`
        : `Demand is ${loadPct}% of today's capacity.`;

  return { capacityMinutes, demandMinutes: demand, loadPct, items, note };
}



/* -------------------------------------------------------------- focus mode */

export interface FocusTarget {
  scored: ScoredPersonalWork;
  /** One-sentence answer to "why this, now?" */
  because: string;
  /** What must be true for this to count as done. */
  definitionOfDone: string;
}

export function focusTarget(
  scored: ScoredPersonalWork[],
  commitments: PersonalCommitment[] = [],
): FocusTarget | null {
  const top = scored[0];
  if (!top) return null;
  const promise = commitments.find(
    (c) => c.work_item_id === top.work.id && (c.status === "open" || c.status === "in_progress"),
  );
  const because = promise
    ? `${promise.account_name ?? "A customer"} is waiting on: ${promise.commitment}`
    : top.work.sla.status === "breached"
      ? "This commitment is already breached and is damaging trust right now"
      : top.reasons[0];
  const definitionOfDone =
    top.work.required_action ??
    (promise?.expected_outcome ?? "Record the outcome and the state change on the canonical record");
  return { scored: top, because, definitionOfDone };
}

/* -------------------------------------------------------- customer waiting */

export interface WaitingCustomer {
  accountId: string;
  accountName: string;
  /** Oldest open promise age in hours. */
  waitingHours: number | null;
  openPromises: number;
  overduePromises: number;
  nextDueAt: string | null;
}

export function customerWaitingQueue(
  commitments: PersonalCommitment[],
  now = new Date(),
): WaitingCustomer[] {
  const open = commitments.filter(
    (c) => c.direction === "yalla_to_customer" && (c.status === "open" || c.status === "in_progress"),
  );
  const byAccount = new Map<string, PersonalCommitment[]>();
  for (const c of open) {
    const list = byAccount.get(c.account_id) ?? [];
    list.push(c);
    byAccount.set(c.account_id, list);
  }
  const out: WaitingCustomer[] = [];
  for (const [accountId, list] of byAccount) {
    const dues = list.map((c) => c.due_at).filter(Boolean) as string[];
    dues.sort();
    const overdue = dues.filter((d) => new Date(d).getTime() < now.getTime());
    const oldest = dues[0] ? (now.getTime() - new Date(dues[0]).getTime()) / 3_600_000 : null;
    out.push({
      accountId,
      accountName: list[0].account_name ?? "Unnamed account",
      waitingHours: oldest !== null && oldest > 0 ? Math.round(oldest) : null,
      openPromises: list.length,
      overduePromises: overdue.length,
      nextDueAt: dues.find((d) => new Date(d).getTime() >= now.getTime()) ?? dues[0] ?? null,
    });
  }
  return out.sort(
    (a, b) => b.overduePromises - a.overduePromises || (b.waitingHours ?? 0) - (a.waitingHours ?? 0),
  );
}

/* -------------------------------------------------------- commitment health */

export interface CommitmentHealth {
  total: number;
  open: number;
  overdue: number;
  dueToday: number;
  undated: number;
  keptRatePct: number | null;
  state: "healthy" | "slipping" | "critical" | "unknown";
  note: string;
}

export function commitmentHealth(
  commitments: PersonalCommitment[],
  now = new Date(),
): CommitmentHealth {
  if (commitments.length === 0) {
    return {
      total: 0,
      open: 0,
      overdue: 0,
      dueToday: 0,
      undated: 0,
      keptRatePct: null,
      state: "unknown",
      note: "No customer promises are recorded against you yet.",
    };
  }
  const today = now.toISOString().slice(0, 10);
  const openItems = commitments.filter((c) => c.status === "open" || c.status === "in_progress");
  const overdue = openItems.filter((c) => c.due_at && new Date(c.due_at).getTime() < now.getTime());
  const dueToday = openItems.filter((c) => c.due_at?.slice(0, 10) === today);
  const undated = openItems.filter((c) => !c.due_at);
  const decided = commitments.filter((c) => c.status === "fulfilled" || c.status === "cancelled");
  const kept = decided.filter((c) => c.status === "fulfilled");
  const keptRatePct = decided.length ? Math.round((kept.length / decided.length) * 100) : null;

  const state = overdue.length >= 3 ? "critical" : overdue.length > 0 ? "slipping" : "healthy";
  const note =
    state === "critical"
      ? "Multiple promises are past due. Renegotiate dates with the customer today."
      : state === "slipping"
        ? "A promise has slipped. Close it or reset the date explicitly."
        : undated.length
          ? `${undated.length} promise(s) have no date — an undated promise is not a commitment.`
          : "Every open promise still has a live date.";

  return {
    total: commitments.length,
    open: openItems.length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    undated: undated.length,
    keptRatePct,
    state,
    note,
  };
}

/* ------------------------------------------------------- opportunity momentum */

export interface AccountMomentum {
  accountId: string;
  accountName: string;
  openWork: number;
  openPromises: number;
  breached: number;
  lastMovementAt: string | null;
  /** Days since the last recorded movement on this relationship. */
  staleDays: number | null;
  state: "moving" | "cooling" | "stalled" | "unknown";
}

export function accountMomentum(
  nextActions: PersonalNextAction[],
  commitments: PersonalCommitment[],
  work: DecoratedWork[],
  now = new Date(),
): AccountMomentum[] {
  const names = new Map<string, string>();
  for (const c of commitments) if (c.account_name) names.set(c.account_id, c.account_name);
  for (const a of nextActions) if (a.account_name) names.set(a.account_id, a.account_name);

  const workById = new Map(work.map((w) => [w.id, w]));
  const accountIds = new Set([...names.keys()]);
  const out: AccountMomentum[] = [];

  for (const accountId of accountIds) {
    const actions = nextActions.filter((a) => a.account_id === accountId);
    const promises = commitments.filter((c) => c.account_id === accountId);
    const linkedWork = [...actions.map((a) => a.work_item_id), ...promises.map((p) => p.work_item_id)]
      .filter(Boolean)
      .map((id) => workById.get(id as string))
      .filter(Boolean) as DecoratedWork[];

    const movements = [
      ...linkedWork.map((w) => w.created_at),
      ...linkedWork.map((w) => w.completed_at).filter(Boolean),
    ].filter(Boolean) as string[];
    movements.sort();
    const lastMovementAt = movements.at(-1) ?? null;
    const staleDays = lastMovementAt
      ? Math.floor((now.getTime() - new Date(lastMovementAt).getTime()) / 86_400_000)
      : null;

    const state: AccountMomentum["state"] =
      staleDays === null ? "unknown" : staleDays <= 3 ? "moving" : staleDays <= 10 ? "cooling" : "stalled";

    out.push({
      accountId,
      accountName: names.get(accountId) ?? "Unnamed account",
      openWork: linkedWork.filter((w) => isOpen(w.lifecycle_state)).length,
      openPromises: promises.filter((p) => p.status === "open" || p.status === "in_progress").length,
      breached: linkedWork.filter((w) => w.sla.status === "breached").length,
      lastMovementAt,
      staleDays,
      state,
    });
  }

  const rank: Record<AccountMomentum["state"], number> = { stalled: 0, cooling: 1, moving: 2, unknown: 3 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || b.openPromises - a.openPromises);
}

/* -------------------------------------------------------- dynamic replanning */

export interface ReplanChange {
  workId: string;
  title: string;
  kind: "inserted" | "promoted" | "dropped";
  detail: string;
}

/**
 * Compare the plan the employee is working to against the plan the engine would
 * build now. Consequential moves are surfaced for confirmation — the system
 * never silently rewrites someone's day.
 */
export function detectReplan(current: PlannedBlock[], proposed: PlannedBlock[]): ReplanChange[] {
  const currentIndex = new Map(current.map((b, i) => [b.workId, i]));
  const proposedIndex = new Map(proposed.map((b, i) => [b.workId, i]));
  const changes: ReplanChange[] = [];

  proposed.forEach((b, i) => {
    const was = currentIndex.get(b.workId);
    if (was === undefined) {
      changes.push({ workId: b.workId, title: b.title, kind: "inserted", detail: b.why });
    } else if (i < was - 1) {
      changes.push({
        workId: b.workId,
        title: b.title,
        kind: "promoted",
        detail: `Moved up ${was - i} place(s): ${b.why}`,
      });
    }
  });

  current.forEach((b) => {
    if (!proposedIndex.has(b.workId)) {
      changes.push({
        workId: b.workId,
        title: b.title,
        kind: "dropped",
        detail: "No longer fits today's capacity — carry it to tomorrow or renegotiate",
      });
    }
  });

  return changes;
}

/* ------------------------------------------------------------- day close */

export interface DayCloseSummary {
  date: string;
  completedToday: number;
  stillOpen: number;
  carriedOver: number;
  breachedOpen: number;
  promisesDueTomorrow: number;
  /** Ordered opening moves for tomorrow. */
  tomorrowFirstThree: { workId: string; title: string; why: string }[];
  /** Blocking facts the employee must resolve before closing honestly. */
  blockers: string[];
}

export function dayCloseSummary(
  work: DecoratedWork[],
  scored: ScoredPersonalWork[],
  commitments: PersonalCommitment[],
  now = new Date(),
): DayCloseSummary {
  const today = now.toISOString().slice(0, 10);
  const completedToday = work.filter(
    (w) => (w.completed_at ?? w.closed_at ?? "").slice(0, 10) === today,
  ).length;
  const openWork = work.filter((w) => isOpen(w.lifecycle_state));
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);

  const blockers: string[] = [];
  const undatedPromises = commitments.filter(
    (c) => (c.status === "open" || c.status === "in_progress") && !c.due_at,
  );
  if (undatedPromises.length)
    blockers.push(`${undatedPromises.length} customer promise(s) still have no committed date.`);
  const noAction = openWork.filter((w) => !w.required_action);
  if (noAction.length) blockers.push(`${noAction.length} open item(s) have no recorded next action.`);

  return {
    date: today,
    completedToday,
    stillOpen: openWork.length,
    carriedOver: openWork.filter((w) => w.created_at.slice(0, 10) < today).length,
    breachedOpen: openWork.filter((w) => w.sla.status === "breached").length,
    promisesDueTomorrow: commitments.filter(
      (c) => (c.status === "open" || c.status === "in_progress") && c.due_at?.slice(0, 10) === tomorrow,
    ).length,
    tomorrowFirstThree: scored.slice(0, 3).map((s) => ({
      workId: s.work.id,
      title: s.work.title,
      why: s.reasons[0],
    })),
    blockers,
  };
}

/* ------------------------------------------------------------------ format */

export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const BLOCK_REASON_LABEL: Record<BlockReason, string> = {
  breach_recovery: "Breach recovery",
  customer_promise: "Customer promise",
  revenue: "Revenue",
  committed_sla: "Committed SLA",
  routine: "Routine",
};
