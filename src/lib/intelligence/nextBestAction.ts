/**
 * NEXT BEST ACTION ENGINE.
 *
 * One ordered queue of the commercial actions worth doing next, derived from
 * what is already recorded — the persisted signal register and the pipeline
 * inspection readings. It creates no records of its own and changes nothing:
 * it recommends, a person confirms, the existing engines execute.
 *
 * Every recommendation answers five questions, in this order:
 *   ACTION   — what to do
 *   REASON   — why it is worth doing now
 *   EVIDENCE — the recorded facts that produced it
 *   IMPACT   — what is commercially at stake, or that it is not stated
 *   TIMING   — when it should happen, and why that window
 *
 * Laws:
 *  1. No evidence, no recommendation.
 *  2. A missing figure is reported as not stated — never as zero.
 *  3. The order is explainable: each entry carries the factors that ranked it.
 */
import { moneyFromCents } from "@/lib/workspace/commercialBook";
import { INDICATOR_LABEL } from "./movement";
import { openRows, type InspectionRow } from "./pipelineInspection";
import {
  signalPriority,
  whyThisIsPriority,
  type CommercialSignal,
  type SignalEvidence,
  type SignalUrgency,
} from "./signals";

export const ACTION_TIMINGS = ["now", "today", "this_week", "whenever"] as const;
export type ActionTiming = (typeof ACTION_TIMINGS)[number];

export const TIMING_LABEL: Record<ActionTiming, string> = {
  now: "Do now",
  today: "Do today",
  this_week: "Do this week",
  whenever: "When there is room",
};

/** One named input into the rank, with the record it was read from. */
export interface ActionFactor {
  label: string;
  points: number;
  evidence: string;
}

export interface NextBestAction {
  key: string;
  /** What to do, phrased as an instruction. */
  action: string;
  /** Why it is worth doing, in one line. */
  reason: string;
  evidence: SignalEvidence[];
  /** Commercial impact in words; states plainly when no value is recorded. */
  impactLine: string;
  impactCents: number | null;
  timing: ActionTiming;
  timingReason: string;
  score: number;
  factors: ActionFactor[];
  customer: string | null;
  entityType: string;
  entityId: string | null;
  /** Where the work is actually done — an existing surface, never a new one. */
  link: string;
  /** Present when the recommendation came from a persisted signal. */
  signalId: string | null;
  source: "signal_register" | "pipeline_inspection";
}

const TIMING_OF_URGENCY: Record<SignalUrgency, ActionTiming> = {
  now: "now",
  today: "today",
  normal: "this_week",
  whenever: "whenever",
};

const TIMING_WEIGHT: Record<ActionTiming, number> = { now: 40, today: 28, this_week: 12, whenever: 0 };

const impactOf = (cents: number | null | undefined, currency = "KES"): { line: string; cents: number | null } =>
  cents == null || cents === 0
    ? { line: "Commercial value is not stated on the record, so the size of this is unknown.", cents: null }
    : { line: `${moneyFromCents(cents, currency)} is riding on it.`, cents };

const linkFor = (entityType: string, entityId: string | null): string => {
  switch (entityType) {
    case "opportunity":
      return "/staff/workspace/pipeline";
    case "quotation":
      return "/staff/workspace/quotes";
    case "contract":
      return "/staff/workspace/contracts";
    case "account":
      return entityId ? `/staff/workspace/accounts/${entityId}` : "/staff/workspace/accounts";
    case "lead":
      return "/staff/sales/pipeline";
    default:
      return "/staff/workspace/book";
  }
};

/* ------------------------------------------------- from the signal register */

function fromSignal(signal: CommercialSignal): NextBestAction {
  const priority = signalPriority(signal);
  const impact = impactOf(signal.commercialImpactCents);
  const timing = TIMING_OF_URGENCY[signal.urgency];
  return {
    key: `signal:${signal.id}`,
    action: signal.recommendedAction?.trim() || `Deal with: ${signal.headline}`,
    reason: whyThisIsPriority(signal),
    evidence: signal.evidence,
    impactLine: impact.line,
    impactCents: impact.cents,
    timing,
    timingReason:
      timing === "now"
        ? "Recorded as needing attention immediately."
        : timing === "today"
          ? "Recorded as due today on the signal."
          : timing === "this_week"
            ? "No deadline is recorded, so it belongs in this week's work."
            : "Nothing is waiting on it — pick it up when there is room.",
    score: priority + TIMING_WEIGHT[timing],
    factors: [
      { label: `Signal severity: ${signal.severity}`, points: priority, evidence: `Raised by ${signal.source}.` },
      { label: `Timing: ${TIMING_LABEL[timing]}`, points: TIMING_WEIGHT[timing], evidence: `Urgency recorded as ${signal.urgency}.` },
      ...(impact.cents != null
        ? [{ label: "Commercial value recorded", points: 0, evidence: impact.line }]
        : [{ label: "No value recorded", points: 0, evidence: "The size of this cannot be read from the record." }]),
    ],
    customer: signal.customerLabel ?? null,
    entityType: signal.entityType,
    entityId: signal.entityId,
    link: linkFor(signal.entityType, signal.entityId),
    signalId: signal.id,
    source: "signal_register",
  };
}

/* ------------------------------------------- from the pipeline inspection */

function fromRow(row: InspectionRow): NextBestAction[] {
  const o = row.opportunity;
  const impact = impactOf(o.expected_value_cents, o.currency ?? "KES");
  const out: NextBestAction[] = [];

  const base = {
    evidence: [] as SignalEvidence[],
    impactLine: impact.line,
    impactCents: impact.cents,
    customer: o.customer_label ?? null,
    entityType: "opportunity",
    entityId: o.id,
    link: "/staff/workspace/pipeline",
    signalId: null,
    source: "pipeline_inspection" as const,
  };

  if (row.momentum.idle || row.momentum.band === "stalled") {
    const stalled = row.momentum.band === "stalled";
    const timing: ActionTiming = stalled ? "today" : "this_week";
    const points = stalled ? 60 : 40;
    out.push({
      ...base,
      key: `idle:${o.id}`,
      action: `Contact ${o.customer_label ?? "the customer"} about ${o.title} and record what they say.`,
      reason: row.momentum.headline,
      evidence: [
        {
          label: "Quiet for",
          value: `${row.momentum.idleDays ?? "unknown"} day(s) against a ${row.momentum.idleThresholdDays}-day allowance at this stage`,
        },
        { label: "Stage", value: o.stage },
        ...row.movement.lines.slice(0, 2).map((l) => ({ label: "Recent change", value: l })),
      ],
      timing,
      timingReason: stalled
        ? "It has been quiet past the allowance for its stage and value, so every further day reduces the chance of a decision."
        : "It is drifting but not yet stalled — a contact this week keeps it alive.",
      score: points + TIMING_WEIGHT[timing],
      factors: [
        { label: "Deal has gone quiet", points, evidence: row.momentum.headline },
        { label: `Timing: ${TIMING_LABEL[timing]}`, points: TIMING_WEIGHT[timing], evidence: `Momentum reads ${row.momentum.band}.` },
      ],
    });
  }

  if (row.readiness && !row.readiness.ready) {
    const missing = row.readiness.missing;
    const timing: ActionTiming = "this_week";
    out.push({
      ...base,
      key: `readiness:${o.id}:${row.readiness.stage}`,
      action: `Establish ${missing.map((m) => m.label.toLowerCase()).join(", ")} before moving ${o.title} to ${row.readiness.stage}.`,
      reason: row.readiness.headline,
      evidence: missing.map((m) => ({ label: m.label, value: m.why })),
      timing,
      timingReason: "Moving the stage without these leaves the deal reported as further on than it is.",
      score: 34 + TIMING_WEIGHT[timing] + Math.min(12, missing.length * 4),
      factors: [
        { label: "Not ready for its next stage", points: 34, evidence: `${missing.length} condition(s) not met.` },
        { label: `Timing: ${TIMING_LABEL[timing]}`, points: TIMING_WEIGHT[timing], evidence: "No deadline is recorded against the gap." },
      ],
    });
  }

  if (o.expected_value_cents == null || o.expected_value_cents === 0) {
    out.push({
      ...base,
      key: `value:${o.id}`,
      action: `Record the expected value of ${o.title}.`,
      reason: "With no value recorded this deal cannot count towards your target or the forecast.",
      evidence: [
        { label: "Expected value", value: "not stated on the record" },
        { label: "Stage", value: o.stage },
      ],
      timing: "this_week",
      timingReason: "Forecast and target reporting read this field, so the gap shows up every close.",
      score: 22 + TIMING_WEIGHT.this_week,
      factors: [
        { label: "Value missing", points: 22, evidence: "expected_value_cents is blank on the opportunity." },
        { label: "Timing: Do this week", points: TIMING_WEIGHT.this_week, evidence: "Needed before the next close." },
      ],
    });
  }

  if (!row.hasProposal && ["qualified", "proposal"].includes(o.stage.toLowerCase())) {
    out.push({
      ...base,
      key: `proposal:${o.id}`,
      action: `Build and send a priced proposal for ${o.title}.`,
      reason: "The deal has been qualified but no priced proposal exists against it.",
      evidence: [
        { label: "Proposals recorded", value: "none" },
        { label: "Stage", value: o.stage },
      ],
      timing: "this_week",
      timingReason: "Nothing can be decided by the customer until a price is in their hands.",
      score: 38 + TIMING_WEIGHT.this_week,
      factors: [
        { label: "No priced proposal", points: 38, evidence: "No quotation is linked to this opportunity." },
        { label: "Timing: Do this week", points: TIMING_WEIGHT.this_week, evidence: "The customer is waiting on a price." },
      ],
    });
  }

  if (row.movement.indicators.includes("value_down")) {
    out.push({
      ...base,
      key: `value_down:${o.id}`,
      action: `Confirm what ${o.customer_label ?? "the customer"} removed from the scope of ${o.title}.`,
      reason: "The recorded value fell, which changes both the forecast and the case for the deal.",
      evidence: row.movement.lines.map((l) => ({ label: INDICATOR_LABEL.value_down, value: l })),
      timing: "today",
      timingReason: "A reduction is usually a signal of a live objection that is still fixable.",
      score: 48 + TIMING_WEIGHT.today,
      factors: [
        { label: "Value reduced", points: 48, evidence: row.movement.lines[0] ?? "Recorded in the change log." },
        { label: "Timing: Do today", points: TIMING_WEIGHT.today, evidence: "Recent change in the last 7 days." },
      ],
    });
  }

  return out;
}

/* ------------------------------------------------------------------- build */

export interface NextBestActionInput {
  rows: InspectionRow[];
  signals: CommercialSignal[];
  /** Cap on the queue so it stays a shortlist, not a backlog. */
  limit?: number;
}

/**
 * Builds the ordered queue. A signal already recorded against an entity wins
 * over a freshly derived reading of the same condition, so the queue never
 * shows the same thing twice.
 */
export function buildNextBestActions(input: NextBestActionInput): NextBestAction[] {
  const fromSignals = input.signals
    .filter((s) => s.status === "open" || s.status === "acknowledged")
    .map(fromSignal);

  const claimed = new Set(
    fromSignals.map((a) => `${a.entityType}:${a.entityId}:${a.action.toLowerCase().slice(0, 24)}`),
  );

  const derived = openRows(input.rows)
    .flatMap(fromRow)
    .filter((a) => !claimed.has(`${a.entityType}:${a.entityId}:${a.action.toLowerCase().slice(0, 24)}`));

  const all = [...fromSignals, ...derived].sort(
    (a, b) => b.score - a.score || (a.customer ?? "").localeCompare(b.customer ?? "") || a.key.localeCompare(b.key),
  );

  return typeof input.limit === "number" ? all.slice(0, input.limit) : all;
}

/** One-line headline for the queue, stated from what is in it. */
export function queueHeadline(actions: NextBestAction[]): string {
  if (actions.length === 0) return "Nothing in your book is asking for an action right now.";
  const now = actions.filter((a) => a.timing === "now" || a.timing === "today").length;
  const valued = actions.reduce((s, a) => s + (a.impactCents ?? 0), 0);
  return `${actions.length} recommended action(s); ${now} for today${
    valued > 0 ? `, covering ${moneyFromCents(valued)} of recorded value` : ", none with a recorded value"
  }.`;
}
