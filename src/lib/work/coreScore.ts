/**
 * CANONICAL WORK SCORING CORE.
 *
 * There is exactly ONE place in this codebase where a piece of staff work is
 * scored, sized and banded: this module. Every surface (personal cockpit, work
 * queue, manager views) adapts its own row shape into `WorkScoringFacts` and
 * reads the result — no surface may re-implement weights, effort estimates or
 * bands, because two engines mean the same item can be "top priority" in one
 * screen and mid-list in another.
 *
 * Everything here is PURE and derives only from facts recorded on the
 * authoritative work record. Priority weight, effort and SLA norms are decided
 * in the database (`work_triage_bands`, `work_triage_norms`) and arrive on the
 * work row; this module never invents a duration or a deadline.
 */

/* --------------------------------------------------------------- band model */

export const PRIORITY_BANDS = ["P1", "P2", "P3", "P4", "P5"] as const;
export type PriorityBand = (typeof PRIORITY_BANDS)[number];

export const BAND_LABEL: Record<PriorityBand, string> = {
  P1: "Immediate commercial risk",
  P2: "High value",
  P3: "Active",
  P4: "Routine",
  P5: "Nurture",
};

/** Declared priority → band, used only when a row predates triage. */
export const PRIORITY_TO_BAND: Record<string, PriorityBand> = {
  critical: "P1",
  high: "P2",
  medium: "P3",
  low: "P4",
};

export function normaliseBand(value: string | null | undefined, priority?: string | null): PriorityBand {
  if (value && (PRIORITY_BANDS as readonly string[]).includes(value)) return value as PriorityBand;
  return PRIORITY_TO_BAND[priority ?? ""] ?? "P3";
}

/* -------------------------------------------------------------------- facts */

export type SlaStatus = "breached" | "at_risk" | "on_track" | "none";

/** The minimal, surface-independent view of a work item this engine needs. */
export interface WorkScoringFacts {
  id: string;
  title: string;
  workKind: string;
  priority: string;
  /** Persisted triage band, when the record has been triaged. */
  band?: string | null;
  /** Persisted effort estimate in minutes, from the triage norms. */
  effortMinutes?: number | null;
  /** How the effort estimate was reached, for display honesty. */
  effortBasis?: string | null;
  /** Recorded commercial value in KES, when the source record carries one. */
  valueKes?: number | null;
  slaStatus: SlaStatus;
  /** Minutes remaining against the SLA; negative when breached. */
  slaRemainingMinutes?: number | null;
  slaDueAt?: string | null;
  lifecycleState?: string | null;
  needsApproval?: boolean | null;
  approvalState?: string | null;
  escalationLevel?: number | null;
  qualityFlag?: string | null;
  reviewState?: string | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
  objectiveId?: string | null;
  /** Open customer promises linked to this item. */
  openPromises?: number;
  /** Human evidence for those promises, shown in the reason list. */
  promiseEvidence?: string;
}

export type ScoreFactor =
  | "declared_priority"
  | "sla"
  | "next_action_due"
  | "escalation"
  | "rework"
  | "blocks_decision"
  | "revenue"
  | "value_density"
  | "customer_impact"
  | "customer_promise"
  | "objective"
  | "missing_next_action";

export interface ScoreContribution {
  factor: ScoreFactor;
  label: string;
  points: number;
  /** Names the exact recorded field the points came from. */
  evidence: string;
}

export interface ScoredWorkFacts {
  score: number;
  contributions: ScoreContribution[];
  reasons: string[];
  effortMinutes: number;
  effortBasis: string;
  band: PriorityBand;
  revenueBearing: boolean;
  customerFacing: boolean;
  /** Expected value moved per minute of effort, when a value is recorded. */
  valuePerMinute: number | null;
}

/* ------------------------------------------------------------------ weights */

const PRIORITY_WEIGHT: Record<string, number> = { critical: 40, high: 28, medium: 14, low: 6 };
const PRIORITY_WEIGHT_FALLBACK = 10;

/** Used only when a record carries no persisted estimate. */
export const FALLBACK_EFFORT_MINUTES = 20;

const REVENUE_KINDS = new Set(["sales_opportunity", "quotation", "contract", "pricing_request"]);
const CUSTOMER_KINDS = new Set(["customer_case", "sales_opportunity", "onboarding", "incident"]);
const CONTROL_KINDS = new Set(["reconciliation", "compliance_review"]);

const daysUntil = (iso: string | null | undefined, now: Date): number | null =>
  !iso ? null : Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);

/** Effort in minutes: the persisted norm-derived estimate, or a labelled fallback. */
export function resolveEffort(facts: WorkScoringFacts): { minutes: number; basis: string } {
  if (typeof facts.effortMinutes === "number" && facts.effortMinutes > 0) {
    return { minutes: facts.effortMinutes, basis: facts.effortBasis ?? "recorded estimate" };
  }
  return { minutes: FALLBACK_EFFORT_MINUTES, basis: "no estimate recorded — default applied" };
}

/* ------------------------------------------------------------------- score */

export function scoreWorkFacts(facts: WorkScoringFacts, now = new Date()): ScoredWorkFacts {
  const contributions: ScoreContribution[] = [];
  const add = (c: ScoreContribution) => contributions.push(c);

  const weight = PRIORITY_WEIGHT[facts.priority] ?? PRIORITY_WEIGHT_FALLBACK;
  add({
    factor: "declared_priority",
    label: `Declared priority ${facts.priority}`,
    points: weight,
    evidence: `staff_work_items.priority = ${facts.priority}`,
  });

  const slaEvidence = `sla_due_at = ${facts.slaDueAt ?? "unset"}`;
  if (facts.slaStatus === "breached") {
    const late = Math.abs(facts.slaRemainingMinutes ?? 0);
    add({ factor: "sla", label: `SLA breached by ${late} min`, points: 36, evidence: slaEvidence });
  } else if (facts.slaStatus === "at_risk") {
    add({
      factor: "sla",
      label: `SLA at risk — ${facts.slaRemainingMinutes ?? 0} min left`,
      points: 22,
      evidence: slaEvidence,
    });
  } else if (facts.slaStatus === "on_track") {
    add({ factor: "sla", label: "SLA committed and on track", points: 5, evidence: slaEvidence });
  }

  const dueIn = daysUntil(facts.nextActionDue, now);
  if (dueIn !== null) {
    if (dueIn < 0) {
      add({
        factor: "next_action_due",
        label: `Next action overdue by ${Math.abs(dueIn)} d`,
        points: 20,
        evidence: `next_action_due = ${facts.nextActionDue}`,
      });
    } else if (dueIn <= 2) {
      add({
        factor: "next_action_due",
        label: "Next action due within 2 days",
        points: 12,
        evidence: `next_action_due = ${facts.nextActionDue}`,
      });
    }
  }

  if (facts.lifecycleState === "escalated" || facts.qualityFlag === "escalated") {
    add({
      factor: "escalation",
      label: "Escalated — someone is already waiting",
      points: 18,
      evidence: `lifecycle_state = ${facts.lifecycleState ?? "?"}, escalation_level = ${facts.escalationLevel ?? 0}`,
    });
  }
  if (facts.qualityFlag === "rework" || facts.reviewState === "returned") {
    add({
      factor: "rework",
      label: "Returned for rework — quality already failed once",
      points: 16,
      evidence: `quality_flag = ${facts.qualityFlag ?? "none"}, review_state = ${facts.reviewState ?? "none"}`,
    });
  }
  if (facts.needsApproval && facts.approvalState === "pending") {
    add({
      factor: "blocks_decision",
      label: "Blocks another person's decision",
      points: 12,
      evidence: "approval_state = pending",
    });
  }
  if (facts.workKind === "approval") {
    add({
      factor: "blocks_decision",
      label: "Blocks another person's work",
      points: 8,
      evidence: `work_kind = ${facts.workKind}`,
    });
  }

  const revenueBearing = REVENUE_KINDS.has(facts.workKind);
  if (revenueBearing) {
    add({
      factor: "revenue",
      label: "Revenue-bearing commercial work",
      points: 12,
      evidence: `work_kind = ${facts.workKind}`,
    });
  }
  if (CONTROL_KINDS.has(facts.workKind)) {
    add({
      factor: "revenue",
      label: "Financial or compliance control work",
      points: 8,
      evidence: `work_kind = ${facts.workKind}`,
    });
  }
  const customerFacing = CUSTOMER_KINDS.has(facts.workKind);
  if (customerFacing) {
    add({
      factor: "customer_impact",
      label: "Customer feels this directly",
      points: 8,
      evidence: `work_kind = ${facts.workKind}`,
    });
  }

  const { minutes: effortMinutes, basis: effortBasis } = resolveEffort(facts);
  const value = typeof facts.valueKes === "number" && facts.valueKes > 0 ? facts.valueKes : null;
  const valuePerMinute = value === null ? null : Math.round(value / effortMinutes);
  if (valuePerMinute !== null) {
    // Value density is ONE input, never the only one: cheap high-value work
    // should surface, but it can never outrank a breached commitment alone.
    const points = valuePerMinute >= 20_000 ? 14 : valuePerMinute >= 5_000 ? 9 : valuePerMinute >= 1_000 ? 5 : 2;
    add({
      factor: "value_density",
      label: `KSh ${valuePerMinute.toLocaleString()} of recorded value per minute of effort`,
      points,
      evidence: `value_score = ${value}, effort_minutes = ${effortMinutes}`,
    });
  }

  if (facts.openPromises && facts.openPromises > 0) {
    add({
      factor: "customer_promise",
      label: `Carries ${facts.openPromises} open customer promise(s)`,
      points: 15,
      evidence: facts.promiseEvidence ?? "crm_customer_commitments linked to this work item",
    });
  }

  if (facts.objectiveId) {
    add({
      factor: "objective",
      label: "Linked to a cascaded objective",
      points: 7,
      evidence: `objective_id = ${facts.objectiveId}`,
    });
  }

  if (!facts.nextAction) {
    add({
      factor: "missing_next_action",
      label: "No next action recorded — clarify ownership before starting",
      points: 0,
      evidence: "next_action IS NULL",
    });
  }

  const score = contributions.reduce((t, c) => t + c.points, 0);
  return {
    score,
    contributions,
    reasons: contributions.map((c) => (c.points > 0 ? `${c.label} (+${c.points})` : c.label)),
    effortMinutes,
    effortBasis,
    band: normaliseBand(facts.band, facts.priority),
    revenueBearing,
    customerFacing,
    valuePerMinute,
  };
}

/* -------------------------------------------------------- relative banding */

/**
 * Bands are RELATIVE to the queue in front of one person, so "everything is
 * high" is arithmetically impossible. A breached commitment is always P1;
 * everything else is banded by its rank within the queue.
 */
export function assignRelativeBands<T>(
  rows: T[],
  read: (row: T) => { score: number; slaStatus: SlaStatus },
): Map<T, PriorityBand> {
  const out = new Map<T, PriorityBand>();
  if (rows.length === 0) return out;

  const ordered = [...rows].sort((a, b) => read(b).score - read(a).score);
  const n = ordered.length;
  const cut = (ratio: number) => Math.max(1, Math.round(n * ratio));
  const p1End = cut(0.1);
  const p2End = p1End + cut(0.2);
  const p3End = p2End + cut(0.3);
  const p4End = p3End + cut(0.2);

  ordered.forEach((row, index) => {
    const { slaStatus } = read(row);
    if (slaStatus === "breached") {
      out.set(row, "P1");
      return;
    }
    const band: PriorityBand =
      index < p1End ? "P1" : index < p2End ? "P2" : index < p3End ? "P3" : index < p4End ? "P4" : "P5";
    out.set(row, band);
  });
  return out;
}
