/**
 * STAGE 5 — AI BRIEF (passive intelligence).
 *
 * The brief answers ONE question per work item: "what should happen next?"
 * It is derived deterministically from the canonical work model, so every
 * sentence is traceable to a recorded fact. Nothing here invents a number, a
 * customer sentiment or a probability — if the source record did not state it,
 * the brief does not claim it.
 *
 * Pure functions only.
 */
import type { SignalKind, WorkloadSummary, WorkspaceItem } from "./intelligence";

export interface ItemBrief {
  /** The single recommended next move, phrased as an instruction. */
  recommendation: string;
  /** Why it is recommended, from recorded evidence. */
  because: string;
  /** What happens if it is not done. */
  ifIgnored: string;
  /** Ordered concrete steps — never more than three. */
  steps: string[];
  /** Confidence in the recommendation, 0-100, from evidence completeness. */
  confidence: number;
  /** Where the reasoning came from, for auditability. */
  basedOn: string[];
}

const RECOMMENDATION: Record<SignalKind, string> = {
  overdue: "Close the gap with the customer today and re-date the promise.",
  decision_required: "Record your decision so the blocked work can move.",
  sla_risk: "Finish this before the committed time expires.",
  expiring: "Confirm the price with the customer or reissue before it lapses.",
  stalled: "Re-engage the buyer with a specific next step and a date.",
  no_next_action: "Set the next commercial step and put a date on it.",
  awaiting_customer: "Chase the response you are waiting for, with a deadline.",
  awaiting_approval: "Give the approver what they need to decide.",
  unowned: "Take ownership so this stops ageing unassigned.",
  scheduled: "Do the planned work in the time you reserved.",
  healthy: "No action required.",
};

const STEPS: Record<SignalKind, string[]> = {
  overdue: [
    "Call or email the customer and acknowledge the delay",
    "Agree a new date you can hold",
    "Record the outcome against the promise",
  ],
  decision_required: ["Read the recorded request", "Decide approve or decline", "Record the decision with a reason"],
  sla_risk: ["Do the required action now", "Record the result", "Escalate only if you cannot finish in time"],
  expiring: ["Check whether pricing still holds", "Ask the customer to confirm or decline", "Reissue or close the quote"],
  stalled: [
    "Review the last recorded contact",
    "Send a follow-up naming the next step",
    "Book the next interaction in your calendar",
  ],
  no_next_action: ["Decide the next commercial step", "Raise it as work with a date", "Tell the customer what happens next"],
  awaiting_customer: ["Follow up on the open request", "State a decision deadline", "Log the chase on the record"],
  awaiting_approval: ["Confirm the approver has the full pack", "Chase the decision", "Tell the customer the revised timing"],
  unowned: ["Open the record", "Assign it to yourself", "Set the first action and a date"],
  scheduled: ["Prepare from the account record", "Execute the planned action", "Record what happened"],
  healthy: [],
};

const SOURCE_LABEL: Record<WorkspaceItem["source"], string> = {
  assigned_work: "the work spine",
  available_work: "unowned recorded work",
  opportunity: "the opportunity record",
  quote: "the quotation record",
  contract: "the contract record",
  approval: "the commercial approval register",
  commitment: "the customer promise register",

};

/** Confidence rises with evidence and a stated deadline; never fabricated. */
function confidenceOf(item: WorkspaceItem): number {
  let score = 55;
  score += Math.min(25, item.evidence.length * 8);
  if (item.dueAt) score += 10;
  if (item.impact) score += 5;
  if (item.signal === "no_next_action") score -= 10;
  return Math.max(30, Math.min(95, score));
}

export function briefFor(item: WorkspaceItem): ItemBrief {
  const who = item.subject ? ` with ${item.subject}` : "";
  const recommendation =
    item.signal === "stalled"
      ? `Re-engage${who} with a specific next step and a date.`
      : RECOMMENDATION[item.signal];

  const ifIgnored =
    item.consequence ??
    (item.dueAt
      ? "The recorded date passes and the commitment becomes a breach."
      : "The record keeps ageing with no owner action, which reduces the chance of conversion.");

  return {
    recommendation,
    because: item.why,
    ifIgnored,
    steps: STEPS[item.signal],
    confidence: confidenceOf(item),
    basedOn: [
      `Read from ${SOURCE_LABEL[item.source]}`,
      ...item.evidence.slice(0, 3).map((e) => `${e.fact} (${e.from})`),
    ],
  };
}

export interface DailyBrief {
  headline: string;
  /** Two to four lines: the shape of the day, from real counts and minutes. */
  lines: string[];
  /** The one thing to do first, and why it leads. */
  leadWith: string | null;
}

export function dailyBrief(items: WorkspaceItem[], workload: WorkloadSummary, now: Date = new Date()): DailyBrief {
  const nowItems = items.filter((i) => i.lane === "now");
  const waiting = items.filter((i) => i.lane === "waiting");
  const lead = nowItems[0] ?? null;
  const hours = Math.round((workload.minutes / 60) * 10) / 10;
  const greetingHour = now.getHours();
  const part = greetingHour < 12 ? "this morning" : greetingHour < 17 ? "this afternoon" : "this evening";

  if (nowItems.length === 0) {
    return {
      headline: `Nothing needs your action ${part}.`,
      lines: [
        waiting.length > 0
          ? `${waiting.length} item(s) are progressing with someone else — see Waiting for who holds them.`
          : "No record in your book is overdue, stalled, expiring or unsigned.",
      ],
      leadWith: null,
    };
  }

  const lines = [
    `${workload.actionable} action(s) need you, about ${hours} hour(s) of work — a ${workload.level} load.`,
    workload.groups
      .slice(0, 3)
      .map((g) => `${g.count} ${g.label.toLowerCase()}`)
      .join(", ") + ".",
  ];
  if (waiting.length > 0) lines.push(`${waiting.length} item(s) sit with a customer or approver — chase, do not redo.`);

  return {
    headline: `${workload.actionable} action(s) for you ${part}.`,
    lines,
    leadWith: lead
      ? `Start with ${lead.title}${lead.subject ? ` (${lead.subject})` : ""} — ${lead.why.toLowerCase()}`
      : null,
  };
}
