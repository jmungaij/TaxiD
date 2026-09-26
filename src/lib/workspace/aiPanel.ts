/**
 * STAGE 6 — THE AI PANEL (full recommendations over the canonical work model).
 *
 * Stage 5 answered "what should happen next?" for ONE item. Stage 6 answers it
 * for the whole book: an ordered plan that fits the real hours available, the
 * patterns behind the load, the risks that will bite if nothing changes, and
 * what the employee must ask of other people.
 *
 * Every sentence is derived from recorded facts already carried on the work
 * items. No sentiment, probability, revenue figure or customer opinion is
 * invented here — if the source record did not state it, the panel stays silent
 * and says so.
 *
 * Pure functions only.
 */
import type { SignalKind, WorkloadSummary, WorkspaceItem } from "./intelligence";
import { briefFor, type ItemBrief } from "./aiBrief";

/** A single recommended move inside the plan. */
export interface PlannedMove {
  key: string;
  /** Order within the plan, 1-based. */
  position: number;
  title: string;
  subject: string | null;
  /** The instruction to carry out. */
  recommendation: string;
  /** Why it is placed here, from recorded evidence. */
  because: string;
  ifIgnored: string;
  steps: string[];
  confidence: number;
  minutes: number;
  /** Cumulative minutes once this move is done. */
  cumulativeMinutes: number;
  /** Falls outside the hours available today. */
  beyondCapacity: boolean;
  action: { label: string; to: string };
  evidence: string[];
}

export interface AiPattern {
  /** Short label, e.g. "5 deals with no next step". */
  label: string;
  /** What the pattern means for the employee. */
  meaning: string;
  /** What to do about the pattern as a whole. */
  fix: string;
  count: number;
}

export interface AiRisk {
  key: string;
  title: string;
  subject: string | null;
  /** The consequence, as recorded. */
  consequence: string;
  dueLabel: string | null;
  severity: "critical" | "high";
  to: string;
}

export interface AiAsk {
  waitingOn: string;
  count: number;
  /** What to ask them for. */
  ask: string;
  oldestDueLabel: string | null;
}

export interface AiPanelModel {
  /** One-line read of the day. */
  headline: string;
  /** Two to four supporting lines, all from counts and minutes. */
  narrative: string[];
  /** Hours of work the plan assumes are available. */
  capacityMinutes: number;
  plannedMinutes: number;
  /** Ordered recommendations — never more than six. */
  plan: PlannedMove[];
  patterns: AiPattern[];
  risks: AiRisk[];
  asks: AiAsk[];
  /** Present when there is nothing to recommend, explaining why. */
  quietReason: string | null;
  /** Domains withheld by access control, declared not estimated. */
  blindSpots: string[];
}

/** A realistic focused working day; the plan never pretends to exceed it. */
export const DEFAULT_CAPACITY_MINUTES = 360;

const PATTERN_MEANING: Partial<Record<SignalKind, { meaning: string; fix: string }>> = {
  overdue: {
    meaning: "Promises you made to customers have passed their date.",
    fix: "Clear them in one block: acknowledge, re-date, record — oldest first.",
  },
  no_next_action: {
    meaning: "Deals are sitting in your book with no agreed next step.",
    fix: "Set one next step and a date on each, in a single pass, before opening anything new.",
  },
  stalled: {
    meaning: "Buyers have gone quiet and nothing has been recorded since.",
    fix: "Run one re-engagement pass, each with a named next step and a date.",
  },
  expiring: {
    meaning: "Prices you issued are about to lapse.",
    fix: "Confirm, reissue or close each quote before the validity date passes.",
  },
  decision_required: {
    meaning: "Other people are blocked waiting for your decision.",
    fix: "Decide these first — each one unblocks somebody else's work.",
  },
  sla_risk: {
    meaning: "Time commitments are close to breach.",
    fix: "Finish these inside the committed window, then record the result.",
  },
  awaiting_customer: {
    meaning: "You are waiting on customer replies.",
    fix: "Chase with a stated decision deadline instead of re-doing the work.",
  },
  awaiting_approval: {
    meaning: "Approvals are pending internally.",
    fix: "Make sure the approver has the full pack, then chase the decision.",
  },
  unowned: {
    meaning: "Recorded work is ageing with no owner.",
    fix: "Take what belongs to your accounts so it stops ageing unassigned.",
  },
};

const ASK_BY_SIGNAL: Partial<Record<SignalKind, string>> = {
  awaiting_customer: "a decision or the outstanding information, with a date",
  awaiting_approval: "the approval decision, or what is missing from the pack",
  decision_required: "the decision that is holding the work",
};

const dueLabel = (iso: string | null): string | null => {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
};

const hoursOf = (minutes: number): number => Math.round((minutes / 60) * 10) / 10;

function moveFrom(item: WorkspaceItem, brief: ItemBrief, position: number, cumulative: number, capacity: number): PlannedMove {
  return {
    key: item.key,
    position,
    title: item.title,
    subject: item.subject,
    recommendation: brief.recommendation,
    because: brief.because,
    ifIgnored: brief.ifIgnored,
    steps: brief.steps,
    confidence: brief.confidence,
    minutes: item.minutes,
    cumulativeMinutes: cumulative,
    beyondCapacity: cumulative > capacity,
    action: item.primaryAction,
    evidence: brief.basedOn,
  };
}

export interface AiPanelInput {
  items: WorkspaceItem[];
  workload: WorkloadSummary;
  /** Minutes of focused time available; defaults to a full focused day. */
  capacityMinutes?: number;
  /** Number of meetings already booked today, when known from the work spine. */
  meetingMinutesToday?: number;
  /** Domains that access control withheld — declared, never estimated. */
  blindSpots?: string[];
}

export function buildAiPanel(input: AiPanelInput): AiPanelModel {
  const { items, workload } = input;
  const blindSpots = input.blindSpots ?? [];
  const meetingMinutes = Math.max(0, input.meetingMinutesToday ?? 0);
  const capacityMinutes = Math.max(60, (input.capacityMinutes ?? DEFAULT_CAPACITY_MINUTES) - meetingMinutes);

  const actionable = items.filter((i) => i.lane === "now" && i.signal !== "healthy");

  // Plan — already triaged upstream, so take the head of the ordered set.
  let cumulative = 0;
  const plan: PlannedMove[] = actionable.slice(0, 6).map((item, index) => {
    cumulative += item.minutes;
    return moveFrom(item, briefFor(item), index + 1, cumulative, capacityMinutes);
  });
  const plannedMinutes = plan.reduce((sum, m) => sum + m.minutes, 0);

  // Patterns — only where the same deviation repeats.
  const bySignal = new Map<SignalKind, number>();
  for (const item of actionable) bySignal.set(item.signal, (bySignal.get(item.signal) ?? 0) + 1);
  const patterns: AiPattern[] = [...bySignal.entries()]
    .filter(([signal, count]) => count >= 2 && PATTERN_MEANING[signal])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([signal, count]) => ({
      label: `${count} × ${signal.replace(/_/g, " ")}`,
      meaning: PATTERN_MEANING[signal]!.meaning,
      fix: PATTERN_MEANING[signal]!.fix,
      count,
    }));

  // Risks — recorded consequences on critical/high work only.
  const risks: AiRisk[] = items
    .filter((i) => (i.tier === "critical" || i.tier === "high") && i.consequence)
    .slice(0, 5)
    .map((i) => ({
      key: i.key,
      title: i.title,
      subject: i.subject,
      consequence: i.consequence!,
      dueLabel: dueLabel(i.dueAt),
      severity: i.tier === "critical" ? "critical" : "high",
      to: i.primaryAction.to,
    }));

  // Asks — grouped by who progress depends on.
  const askMap = new Map<string, { count: number; signal: SignalKind; due: string | null }>();
  for (const item of items) {
    if (!item.waitingOn) continue;
    const current = askMap.get(item.waitingOn);
    if (!current) {
      askMap.set(item.waitingOn, { count: 1, signal: item.signal, due: item.dueAt });
      continue;
    }
    current.count += 1;
    if (item.dueAt && (!current.due || item.dueAt < current.due)) current.due = item.dueAt;
  }
  const asks: AiAsk[] = [...askMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 4)
    .map(([waitingOn, v]) => ({
      waitingOn,
      count: v.count,
      ask: `Ask for ${ASK_BY_SIGNAL[v.signal] ?? "an update, with a date you can hold"}.`,
      oldestDueLabel: dueLabel(v.due),
    }));

  const waitingCount = items.filter((i) => i.lane === "waiting").length;

  if (plan.length === 0) {
    return {
      headline: "Nothing in your book needs a decision from you right now.",
      narrative: [
        waitingCount > 0
          ? `${waitingCount} item(s) are progressing with a customer or an approver — chase, do not redo.`
          : "No record you own is overdue, stalled, expiring, unsigned or awaiting your decision.",
        blindSpots.length > 0
          ? `${blindSpots.join(", ")} could not be read for your account, so nothing from there is included.`
          : "This reads every record released to your account.",
      ],
      capacityMinutes,
      plannedMinutes: 0,
      plan: [],
      patterns,
      risks,
      asks,
      quietReason:
        waitingCount > 0
          ? "Your open work sits with other people, so the recommendation is to follow up rather than start something new."
          : "There is no recorded deviation in your book to act on.",
      blindSpots,
    };
  }

  const overflow = plannedMinutes > capacityMinutes;
  const narrative = [
    `${workload.actionable} action(s) need you, about ${hoursOf(workload.minutes)} hour(s) of work — a ${workload.level} load.`,
    overflow
      ? `The plan below is ${hoursOf(plannedMinutes)} hour(s) against ${hoursOf(capacityMinutes)} available, so anything past the line will not fit today.`
      : `The plan below is ${hoursOf(plannedMinutes)} hour(s) and fits inside the ${hoursOf(capacityMinutes)} hour(s) available.`,
  ];
  if (meetingMinutes > 0) narrative.push(`${hoursOf(meetingMinutes)} hour(s) are already committed to meetings today.`);
  if (waitingCount > 0) narrative.push(`${waitingCount} item(s) are waiting on someone else — see who to ask below.`);
  if (blindSpots.length > 0)
    narrative.push(`${blindSpots.join(", ")} are not released to your account, so they are excluded rather than estimated.`);

  return {
    headline: `Do these ${plan.length} thing(s), in this order.`,
    narrative,
    capacityMinutes,
    plannedMinutes,
    plan,
    patterns,
    risks,
    asks,
    quietReason: null,
    blindSpots,
  };
}
