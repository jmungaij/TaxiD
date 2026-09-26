/**
 * PREPARE TOMORROW — deterministic carry-forward of unfinished work.
 *
 * Nothing is invented: every carried item is an open work record the employee
 * still owns, and every "still open" line states the recorded reason it did not
 * close today. The engine is pure so the same inputs always produce the same
 * tomorrow plan, and the UI writes the carry-forward to the canonical work item.
 */
import { isOpen } from "@/lib/orchestration/workLifecycle";
import type { DecoratedWork } from "@/lib/orchestration/api";
import type { PersonalCommitment, ScoredPersonalWork } from "./personalOs";

export type OpenCategory =
  | "awaiting_approval"
  | "waiting_external"
  | "breached"
  | "in_progress"
  | "no_next_action"
  | "not_started";

export interface CarryForwardItem {
  workId: string;
  title: string;
  /** Recorded justification for carrying this item, in the employee's language. */
  why: string;
  effortMinutes: number;
  /** True when the work item already carries tomorrow's date. */
  alreadyScheduled: boolean;
  /** True when carrying forward is the employee's own decision to make. */
  actionable: boolean;
}

export interface OpenReasonItem {
  workId: string;
  title: string;
  category: OpenCategory;
  reason: string;
}

export interface TomorrowPrep {
  /** Tomorrow's date (ISO yyyy-mm-dd) the carry-forward writes to. */
  date: string;
  carry: CarryForwardItem[];
  openReasons: OpenReasonItem[];
  promisesDueTomorrow: { id: string; commitment: string; account: string | null }[];
  /** Total recorded effort estimate of the carried items. */
  plannedMinutes: number;
  note: string;
}

const CATEGORY_LABEL: Record<OpenCategory, string> = {
  awaiting_approval: "Held for an approval decision — not yours to clear",
  waiting_external: "Parked on an external response",
  breached: "SLA already breached and still open",
  in_progress: "Started but not finished today",
  no_next_action: "No next action recorded — ownership of the next step is unclear",
  not_started: "Assigned but not started today",
};

function categorise(w: DecoratedWork): OpenCategory {
  if (w.needs_approval && w.approval_state === "pending") return "awaiting_approval";
  if (w.lifecycle_state === "waiting") return "waiting_external";
  if (w.sla.status === "breached") return "breached";
  if (w.lifecycle_state === "in_progress") return "in_progress";
  if (!w.required_action) return "no_next_action";
  return "not_started";
}

/**
 * Builds the carry-forward plan. Ordering follows the priority score already
 * computed by the personal engine, so tomorrow opens with the same reasoning
 * today closed with.
 */
export function prepareTomorrow(
  work: DecoratedWork[],
  scored: ScoredPersonalWork[],
  commitments: PersonalCommitment[],
  now = new Date(),
): TomorrowPrep {
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const open = work.filter((w) => isOpen(w.lifecycle_state));
  const openIds = new Set(open.map((w) => w.id));

  const ordered = [
    ...scored.filter((s) => openIds.has(s.work.id)),
    ...open
      .filter((w) => !scored.some((s) => s.work.id === w.id))
      .map((w) => ({ work: w, score: 0, reasons: [], effortMinutes: 20 } as unknown as ScoredPersonalWork)),
  ];

  const carry: CarryForwardItem[] = ordered.map((s) => {
    const category = categorise(s.work);
    const dueField = (s.work as unknown as { next_action_due?: string | null }).next_action_due ?? null;
    return {
      workId: s.work.id,
      title: s.work.title,
      why: s.reasons?.[0] ?? CATEGORY_LABEL[category],
      effortMinutes: s.effortMinutes ?? 20,
      alreadyScheduled: (dueField ?? "").slice(0, 10) === tomorrow,
      actionable: category !== "awaiting_approval",
    };
  });

  const openReasons: OpenReasonItem[] = open.map((w) => {
    const category = categorise(w);
    return { workId: w.id, title: w.title, category, reason: CATEGORY_LABEL[category] };
  });

  const promisesDueTomorrow = commitments
    .filter(
      (c) =>
        (c.status === "open" || c.status === "in_progress") && (c.due_at ?? "").slice(0, 10) === tomorrow,
    )
    .map((c) => ({ id: c.id, commitment: c.commitment, account: c.account_name ?? null }));

  const plannedMinutes = carry.reduce((t, c) => t + c.effortMinutes, 0);
  const note =
    carry.length === 0
      ? "Nothing is unfinished — tomorrow starts clear."
      : `${carry.length} open item${carry.length === 1 ? "" : "s"} carry into tomorrow (~${Math.round(
          plannedMinutes / 60,
        )} h of recorded effort). ${
          carry.filter((c) => !c.actionable).length
        } of them are held by other people.`;

  return { date: tomorrow, carry, openReasons, promisesDueTomorrow, plannedMinutes, note };
}

/** Groups the "why it is still open" lines for the Day Close narrative. */
export function openReasonGroups(prep: TomorrowPrep): { category: OpenCategory; reason: string; items: OpenReasonItem[] }[] {
  const map = new Map<OpenCategory, OpenReasonItem[]>();
  for (const r of prep.openReasons) {
    const list = map.get(r.category) ?? [];
    list.push(r);
    map.set(r.category, list);
  }
  return [...map.entries()].map(([category, items]) => ({
    category,
    reason: CATEGORY_LABEL[category],
    items,
  }));
}
