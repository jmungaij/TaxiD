/**
 * PERSONAL OPERATING SYSTEM — productivity engine.
 *
 * Pure, deterministic derivations that turn the employee's already-loaded
 * records (work items, promises, focus effort, day plan) into the answers the
 * cockpit must give in five seconds: what now, what next, how much time, what
 * is blocked, am I on track, what remains.
 *
 * Nothing here fetches, models or invents. If a fact is absent, the function
 * says so rather than guessing.
 */
import type { DecoratedWork } from "@/lib/orchestration/api";
import { isOpen } from "@/lib/orchestration/workLifecycle";
import { humanizeMinutes } from "./humanTime";
import type {
  DayPlan,
  PersonalCommitment,
  ScoredPersonalWork,
  WaitingCustomer,
} from "./personalOs";

/* --------------------------------------------------------------- day phase */

export type DayPhase = "plan" | "execute" | "prepare" | "complete" | "close";

export interface DayPhaseView {
  phase: DayPhase;
  label: string;
  prompt: string;
}

/** The cockpit's tone follows the working day rather than a fixed layout. */
export function dayPhase(now: Date = new Date(), endHour = 18): DayPhaseView {
  const h = now.getHours();
  if (h >= endHour) return { phase: "close", label: "Close", prompt: "What should move to tomorrow?" };
  if (h >= endHour - 2)
    return { phase: "complete", label: "Complete", prompt: "What remains before you finish today?" };
  if (h < 9) return { phase: "plan", label: "Plan", prompt: "What needs to happen today?" };
  if (h >= 12 && h < 14)
    return { phase: "prepare", label: "Prepare", prompt: "What do you need ready for this afternoon?" };
  return { phase: "execute", label: "Execute", prompt: "What should you do now?" };
}

/* ------------------------------------------------------------ micro time */

export const MICRO_WINDOWS = [5, 15, 30, 60] as const;
export type MicroWindow = (typeof MICRO_WINDOWS)[number];

/** Unplanned usable minutes left in the day — the window Yalla can fill. */
export function availableMinutes(plan: DayPlan): number {
  return Math.max(0, plan.capacityMinutes - plan.plannedMinutes);
}

export interface MicroFill {
  requestedMinutes: number;
  items: ScoredPersonalWork[];
  usedMinutes: number;
  leftoverMinutes: number;
  note: string;
}

/**
 * Greedy best-fit: fill a window with the highest-priority work that genuinely
 * fits, largest-first so the window is not fragmented by trivia.
 */
export function fillWindow(scored: ScoredPersonalWork[], minutes: number): MicroFill {
  const budget = Math.max(0, Math.round(minutes));
  const candidates = scored.filter((s) => s.effortMinutes <= budget);
  const items: ScoredPersonalWork[] = [];
  let used = 0;
  for (const s of candidates) {
    if (used + s.effortMinutes > budget) continue;
    items.push(s);
    used += s.effortMinutes;
  }
  const leftover = budget - used;
  const note = !budget
    ? "No usable time remains in the working day."
    : items.length === 0
      ? `Nothing you own fits inside ${humanizeMinutes(budget)}. The smallest open item needs ${
          scored.length ? humanizeMinutes(Math.min(...scored.map((s) => s.effortMinutes))) : "no recorded effort"
        }.`
      : `${items.length} item(s) fit — ${humanizeMinutes(used)} of ${humanizeMinutes(budget)} used.`;
  return { requestedMinutes: budget, items, usedMinutes: used, leftoverMinutes: leftover, note };
}

/** Short, completable work sized to the employee's real remaining window. */
export function quickWins(scored: ScoredPersonalWork[], windowMinutes: number): ScoredPersonalWork[] {
  const cap = Math.min(30, Math.max(5, Math.round(windowMinutes || 0)));
  return scored.filter((s) => s.effortMinutes <= cap).slice(0, 6);
}

/* ------------------------------------------------------ next best action */

export interface NextBestAction {
  scored: ScoredPersonalWork;
  minutes: number;
  /** Ordered, recorded reasons — every line is auditable. */
  reasons: string[];
  expectedOutcome: string;
  fitsWindow: boolean;
  source: string;
}

/**
 * The single highest-value use of the time the employee actually has. Blocked
 * work is never recommended unless the employee can unblock it themselves.
 */
export function nextBestAction(
  scored: ScoredPersonalWork[],
  ctx: {
    commitments?: PersonalCommitment[];
    waiting?: WaitingCustomer[];
    windowMinutes?: number;
    skipWorkId?: string | null;
    now?: Date;
  } = {},
): NextBestAction | null {
  const window = Math.max(0, Math.round(ctx.windowMinutes ?? 0));
  const pool = scored.filter(
    (s) => s.work.id !== ctx.skipWorkId && !isExternallyBlocked(s.work),
  );
  if (!pool.length) return null;

  const fitting = window > 0 ? pool.filter((s) => s.effortMinutes <= window) : [];
  const chosen = fitting[0] ?? pool[0];

  const promise = (ctx.commitments ?? []).find(
    (c) => c.work_item_id === chosen.work.id && (c.status === "open" || c.status === "in_progress"),
  );
  const wait = (ctx.waiting ?? []).find((w) => w.accountName === chosen.work.entity_ref);

  const reasons: string[] = [];
  if (promise) reasons.push(`${promise.account_name ?? "A customer"} is waiting on: ${promise.commitment}`);
  if (wait?.waitingHours) reasons.push(`${wait.accountName} has been waiting ${wait.waitingHours}h`);
  for (const c of chosen.contributions.filter((c) => c.points > 0).slice(0, 3)) reasons.push(c.label);
  if (window > 0)
    reasons.push(
      chosen.effortMinutes <= window
        ? `Fits the ${humanizeMinutes(window)} you have before your next commitment`
        : `Needs ${humanizeMinutes(chosen.effortMinutes)} — longer than the ${humanizeMinutes(window)} you have left`,
    );

  return {
    scored: chosen,
    minutes: chosen.effortMinutes,
    reasons,
    expectedOutcome:
      chosen.work.required_action ??
      promise?.expected_outcome ??
      "Record the outcome and the state change on the canonical record",
    fitsWindow: window > 0 && chosen.effortMinutes <= window,
    source: workProvenance(chosen.work),
  };
}

/** Where this work came from — provenance the employee can open. */
export function workProvenance(work: DecoratedWork): string {
  const queue = work.ops_queue ? `${work.ops_queue} queue` : "orchestration";
  return work.entity_type ? `${queue} · ${work.entity_type}` : queue;
}

/* --------------------------------------------------- waiting and blockers */

/** Work parked on someone/something outside the employee's control. */
export function isExternallyBlocked(work: DecoratedWork): boolean {
  if (work.needs_approval && work.approval_state === "pending") return true;
  return work.lifecycle_state === "waiting";
}

export interface BlockedItem {
  work: DecoratedWork;
  blocker: string;
  impact: "high" | "medium" | "low";
  /** True when the employee can clear the blocker themselves. */
  selfResolvable: boolean;
}

export function blockedWork(work: DecoratedWork[]): BlockedItem[] {
  return work
    .filter((w) => isOpen(w.lifecycle_state) && isExternallyBlocked(w))
    .map((w) => {
      const approval = w.needs_approval && w.approval_state === "pending";
      return {
        work: w,
        blocker: approval
          ? "Awaiting an approval decision"
          : (w.required_action ?? "Parked — waiting on an external response"),
        impact:
          w.sla.status === "breached" || w.priority === "critical"
            ? ("high" as const)
            : w.priority === "high"
              ? ("medium" as const)
              : ("low" as const),
        selfResolvable: !approval,
      };
    })
    .sort((a, b) => (a.impact === b.impact ? 0 : a.impact === "high" ? -1 : b.impact === "high" ? 1 : 0));
}

/** What the employee is waiting FOR — grouped by the thing that is holding work. */
export function waitingOn(work: DecoratedWork[], now = new Date()) {
  return blockedWork(work).map((b) => ({
    ...b,
    waitingMinutes: Math.max(
      0,
      Math.round(
        (now.getTime() -
          new Date(b.work.approval_requested_at ?? b.work.created_at).getTime()) /
          60_000,
      ),
    ),
  }));
}

/* ------------------------------------------------------- workload health */

export type WorkloadState = "healthy" | "tight" | "overloaded" | "critical";

export interface WorkloadHealth {
  state: WorkloadState;
  label: string;
  message: string;
  /** Concrete recommendation when the day does not fit. */
  recommendation: string | null;
  overBy: number;
  plannedPct: number;
}

export function workloadHealth(plan: DayPlan, scored: ScoredPersonalWork[]): WorkloadHealth {
  const demand = scored.reduce((t, s) => t + s.effortMinutes, 0);
  const overBy = Math.max(0, demand - plan.capacityMinutes);
  const plannedPct =
    plan.capacityMinutes > 0
      ? Math.min(100, Math.round((plan.plannedMinutes / plan.capacityMinutes) * 100))
      : 0;
  const breached = scored.filter((s) => s.work.sla.status === "breached").length;

  if (breached >= 2 || overBy > 120)
    return {
      state: "critical",
      label: "Critical",
      message:
        breached >= 2
          ? `${breached} commitments are already breached and the remaining day cannot absorb them.`
          : `You have ${humanizeMinutes(overBy)} more committed work than available time.`,
      recommendation: "Replan the remaining day and renegotiate at least one date today.",
      overBy,
      plannedPct,
    };
  if (overBy > 0)
    return {
      state: overBy > 45 ? "overloaded" : "tight",
      label: overBy > 45 ? "Overloaded" : "Tight",
      message: `Your commitments exceed your remaining capacity by ${humanizeMinutes(overBy)}.`,
      recommendation: "Move a flexible item to tomorrow, delegate it, or ask for assistance.",
      overBy,
      plannedPct,
    };
  return {
    state: "healthy",
    label: "Healthy",
    message:
      plan.capacityMinutes === 0
        ? "The working day is over. Close the day so tomorrow can be planned."
        : "You have enough capacity to complete today's committed work.",
    recommendation: null,
    overBy: 0,
    plannedPct,
  };
}

/* --------------------------------------------------------- time and progress */

export interface TimeToday {
  usableMinutes: number;
  plannedMinutes: number;
  completedMinutes: number;
  remainingMinutes: number;
  reserveMinutes: number;
  reserveExhausted: boolean;
}

export function timeToday(plan: DayPlan, reserveRatio = 0.25): TimeToday {
  const raw = plan.capacityMinutes / (1 - reserveRatio || 1);
  const reserve = Math.max(0, Math.round(raw - plan.capacityMinutes));
  return {
    usableMinutes: plan.capacityMinutes,
    plannedMinutes: plan.plannedMinutes,
    completedMinutes: plan.spentMinutes,
    remainingMinutes: Math.max(0, plan.capacityMinutes - plan.plannedMinutes),
    reserveMinutes: reserve,
    reserveExhausted: plan.spentMinutes > 0 && plan.spentMinutes >= reserve && reserve > 0,
  };
}

export interface TodayProgress {
  completed: number;
  planned: number;
  remaining: number;
  carriedOver: number;
  pct: number;
  hasData: boolean;
}

export function todayProgress(
  work: DecoratedWork[],
  plan: DayPlan,
  now = new Date(),
): TodayProgress {
  const today = now.toISOString().slice(0, 10);
  const completed = work.filter((w) => (w.completed_at ?? w.closed_at ?? "").slice(0, 10) === today).length;
  const remaining = plan.blocks.length;
  const planned = completed + remaining;
  return {
    completed,
    planned,
    remaining,
    carriedOver: plan.spillover.length,
    pct: planned > 0 ? Math.round((completed / planned) * 100) : 0,
    hasData: planned > 0,
  };
}

/* -------------------------------------------------------------- timeline */

export type TimelineKind = "completed" | "current" | "planned" | "spillover" | "close";

export interface TimelineEntry {
  id: string;
  workId: string | null;
  time: string | null;
  title: string;
  minutes: number | null;
  detail: string;
  kind: TimelineKind;
}

/**
 * A live productivity timeline for the rest of the day — recorded completions,
 * the block in flight, then the planned blocks and an explicit close.
 */
export function todayTimeline(
  plan: DayPlan,
  work: DecoratedWork[],
  now = new Date(),
): TimelineEntry[] {
  const today = now.toISOString().slice(0, 10);
  const entries: TimelineEntry[] = [];

  for (const w of work) {
    const at = w.completed_at ?? w.closed_at;
    if (!at || at.slice(0, 10) !== today) continue;
    entries.push({
      id: `done-${w.id}`,
      workId: w.id,
      time: at,
      title: w.title,
      minutes: null,
      detail: "Completed",
      kind: "completed",
    });
  }

  plan.blocks.forEach((b, i) => {
    const started = new Date(b.startAt).getTime() <= now.getTime();
    const ended = new Date(b.endAt).getTime() <= now.getTime();
    entries.push({
      id: `block-${b.workId}`,
      workId: b.workId,
      time: b.startAt,
      title: b.title,
      minutes: b.minutes,
      detail: started && !ended ? `In progress · ${b.why}` : b.why,
      kind: i === 0 && started && !ended ? "current" : "planned",
    });
  });

  for (const s of plan.spillover.slice(0, 3)) {
    entries.push({
      id: `spill-${s.work.id}`,
      workId: s.work.id,
      time: null,
      title: s.work.title,
      minutes: s.effortMinutes,
      detail: "Does not fit today — carry forward or renegotiate",
      kind: "spillover",
    });
  }

  entries.sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time) return -1;
    if (b.time) return 1;
    return 0;
  });

  entries.push({
    id: "close",
    workId: null,
    time: null,
    title: "Day close and tomorrow preparation",
    minutes: null,
    detail: "Record what happened, carry the rest forward",
    kind: "close",
  });

  return entries;
}

/* -------------------------------------------------- discretionary options */

export interface DiscretionaryOption {
  title: string;
  detail: string;
  action: "momentum" | "ask" | "tomorrow" | "quickwins";
}

/** An empty queue is time, not a broken page. */
export function discretionaryOptions(opts: {
  stalledAccounts: number;
  quickWins: number;
  tomorrowQueued: number;
}): DiscretionaryOption[] {
  const out: DiscretionaryOption[] = [];
  if (opts.stalledAccounts > 0)
    out.push({
      title: `Advance ${opts.stalledAccounts} stalled relationship${opts.stalledAccounts === 1 ? "" : "s"}`,
      detail: "Recorded movement has gone quiet on these accounts.",
      action: "momentum",
    });
  if (opts.quickWins > 0)
    out.push({
      title: `Clear ${opts.quickWins} quick win${opts.quickWins === 1 ? "" : "s"}`,
      detail: "Short items you can finish inside your remaining window.",
      action: "quickwins",
    });
  out.push({
    title: opts.tomorrowQueued ? "Review tomorrow's opening moves" : "Prepare tomorrow",
    detail: "Set the first moves so tomorrow is planned rather than guessed.",
    action: "tomorrow",
  });
  out.push({
    title: "Ask Yalla what would create the most value",
    detail: "Answered from your own records — no guessing.",
    action: "ask",
  });
  return out;
}
