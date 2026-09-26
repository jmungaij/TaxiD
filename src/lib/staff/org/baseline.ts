/**
 * Sales productivity baseline.
 *
 * Every figure here is computed from authoritative records only:
 *   - `commercial_opportunities` — the Sales OS pipeline (stage truth)
 *   - `commercial_transactions`  — the money truth
 *   - `staff_work_items`         — the orchestration record (assignment, cycle, SLA)
 *   - `staff_work_reviews`       — documented manager decisions
 *   - `staff_corrective_actions` — evidenced rework / blocked causes and impact
 *   - `org_objectives`           — declared outcomes
 *
 * A measure with no underlying record is reported as unavailable rather than
 * shown as zero, because zero would read as performance.
 */
import type {
  CorrectiveAction, OrgObjective, StaffWorkItem, StaffWorkReview,
} from "./types";

export interface Period {
  start: string; // ISO date, inclusive
  end: string;   // ISO date, inclusive
  label: string;
}

/** Calendar month containing `ref` — the reporting period Staff 360 uses. */
export function currentPeriod(ref = new Date()): Period {
  const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: start.toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

const inPeriod = (iso: string | null | undefined, p: Period) => {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= p.start && d <= p.end;
};

/** Stable identifiers so a KPI card can open the exact records behind it. */
export type DrillKey =
  | "scope" | "completed" | "cycle_median" | "cycle_p90" | "sla"
  | "returned" | "flagged" | "corrective" | "impact_days" | "impact_value";

export interface Measure {
  /** Drilldown key — links the card to the underlying records. */
  key: DrillKey;
  label: string;
  /** Null means DATA NOT AVAILABLE — never render this as zero. */
  value: number | null;
  unit: "count" | "days" | "percent" | "cents";
  source: string;
  note: string;
}

/** One underlying MY WORK item behind a KPI, with why it counted. */
export interface DrillRow {
  item: StaffWorkItem;
  /** Contribution of this item to the measure, in the measure's unit. */
  contribution: number | null;
  /** Plain-English reason this item is counted in the measure. */
  reason: string;
  /** Corrective actions raised against this item inside the period. */
  corrective: CorrectiveAction[];
  /** Documented review decisions on this item inside the period. */
  reviews: StaffWorkReview[];
}

export interface DrillSet {
  key: DrillKey;
  label: string;
  /** The authoritative tables the rows are read from. */
  source: string;
  rows: DrillRow[];
}

export interface BaselineInput {
  period: Period;
  workItems: StaffWorkItem[];
  reviews: StaffWorkReview[];
  corrective: CorrectiveAction[];
  objectives: OrgObjective[];
}

export interface SalesBaseline {
  period: Period;
  /** Sales work items assigned or completed inside the period. */
  scope: StaffWorkItem[];
  measures: Measure[];
  cycle: { median: number | null; p90: number | null; sample: number };
  sla: { committed: number; met: number; breached: number; compliancePct: number | null };
  rework: { returned: number; flagged: number; corrective: number; impactDays: number | null; impactCents: number | null };
  attribution: ObjectiveAttribution[];
  /** Records behind each KPI, keyed by measure. */
  drill: Record<DrillKey, DrillSet>;
}

export interface ObjectiveAttribution {
  objective: OrgObjective;
  linkedWork: number;
  completedWork: number;
  approvedWork: number;
  reworkedWork: number;
  /** Recorded result on the objective — never inferred from work counts. */
  actual: number | null;
  target: number;
  variance: number | null;
  evidenced: boolean;
  /** The work items attributed to this objective in the period. */
  items: StaffWorkItem[];
}

const quantile = (sorted: number[], q: number) => {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const v = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  return Number(v.toFixed(1));
};

/** Build the baseline for sales work in the given period. */
export function salesBaseline({ period, workItems, reviews, corrective, objectives }: BaselineInput): SalesBaseline {
  const scope = workItems.filter(
    (w) => w.work_kind === "sales_opportunity" &&
      (inPeriod(w.assigned_at, period) || inPeriod(w.completed_at, period)),
  );
  const ids = new Set(scope.map((w) => w.id));
  const periodReviews = reviews.filter((r) => ids.has(r.work_item_id));
  const periodCorrective = corrective.filter((c) => (c.work_item_id ? ids.has(c.work_item_id) : false));

  const completed = scope.filter((w) => w.status === "done" && inPeriod(w.completed_at, period));
  const cycles = completed
    .map((w) => (w.completed_at && w.assigned_at
      ? (new Date(w.completed_at).getTime() - new Date(w.assigned_at).getTime()) / 86_400_000
      : null))
    .filter((n): n is number => n !== null && n >= 0)
    .sort((a, b) => a - b);

  const committedItems = scope.filter((w) => !!w.sla_due_at);
  const breached = committedItems.filter((w) => {
    const due = new Date(w.sla_due_at as string).getTime();
    const settled = w.completed_at ? new Date(w.completed_at).getTime() : Date.now();
    return settled > due;
  });
  const met = committedItems.length - breached.length;

  const returned = periodReviews.filter((r) => r.decision === "returned" || r.decision === "changes_requested").length;
  const flagged = scope.filter((w) => w.quality_flag === "rework" || w.quality_flag === "escalated").length;
  const impactDaysVals = periodCorrective.map((c) => (c.impact_days === null ? null : Number(c.impact_days))).filter((n): n is number => n !== null);
  const impactCentsVals = periodCorrective.map((c) => (c.impact_value_cents === null ? null : Number(c.impact_value_cents))).filter((n): n is number => n !== null);

  const attribution: ObjectiveAttribution[] = objectives
    .filter((o) => o.level === "employee" || o.level === "team" || o.level === "department")
    .map((o) => {
      const linked = scope.filter((w) => w.objective_id === o.id);
      const approvedIds = new Set(
        periodReviews.filter((r) => r.decision === "approved").map((r) => r.work_item_id),
      );
      return {
        objective: o,
        linkedWork: linked.length,
        completedWork: linked.filter((w) => w.status === "done").length,
        approvedWork: linked.filter((w) => approvedIds.has(w.id)).length,
        reworkedWork: linked.filter((w) => w.quality_flag === "rework").length,
        actual: o.actual === null || o.actual === undefined ? null : Number(o.actual),
        target: Number(o.target),
        variance: o.actual === null || o.actual === undefined ? null : Number(o.actual) - Number(o.target),
        evidenced: Object.keys((o.evidence ?? {}) as Record<string, unknown>).length > 0,
        items: linked,
      };
    })
    .filter((a) => a.linkedWork > 0 || a.actual !== null);

  const measures: Measure[] = [
    {
      key: "scope",
      label: "Sales work in period",
      value: scope.length,
      unit: "count",
      source: "staff_work_items · commercial_opportunities",
      note: "Assigned or completed inside the reporting period.",
    },
    {
      key: "completed",
      label: "Completed",
      value: scope.length === 0 ? null : completed.length,
      unit: "count",
      source: "staff_work_items.completed_at",
      note: scope.length === 0 ? "No sales work recorded in the period." : "Work closed within the period.",
    },
    {
      key: "cycle_median",
      label: "Median cycle time",
      value: quantile(cycles, 0.5),
      unit: "days",
      source: "staff_work_items assigned_at → completed_at",
      note: cycles.length === 0 ? "No completed sales work to measure." : `From ${cycles.length} completed item(s).`,
    },
    {
      key: "cycle_p90",
      label: "90th percentile cycle",
      value: quantile(cycles, 0.9),
      unit: "days",
      source: "staff_work_items assigned_at → completed_at",
      note: cycles.length < 2 ? "Needs at least two completed items." : "Worst-case experience, not the average.",
    },
    {
      key: "sla",
      label: "SLA compliance",
      value: committedItems.length === 0 ? null : Number(((met / committedItems.length) * 100).toFixed(1)),
      unit: "percent",
      source: "staff_work_items.sla_due_at",
      note: committedItems.length === 0 ? "No SLA committed on sales work in the period." : `${met} met of ${committedItems.length} committed.`,
    },
    {
      key: "returned",
      label: "Returned on review",
      value: periodReviews.length === 0 ? null : returned,
      unit: "count",
      source: "staff_work_reviews",
      note: periodReviews.length === 0 ? "No manager reviews recorded in the period." : "Manager returned the work with a documented reason.",
    },
    {
      key: "flagged",
      label: "Rework / escalation flags",
      value: scope.length === 0 ? null : flagged,
      unit: "count",
      source: "staff_work_items.quality_flag",
      note: "Quality failed at least once on these items.",
    },
    {
      key: "corrective",
      label: "Corrective actions open",
      value: periodCorrective.length === 0 ? null : periodCorrective.filter((c) => c.status === "open" || c.status === "in_progress").length,
      unit: "count",
      source: "staff_corrective_actions",
      note: periodCorrective.length === 0 ? "No rework or blocked work reported against sales work." : "Causes still being worked.",
    },
    {
      key: "impact_days",
      label: "Productivity days lost",
      value: impactDaysVals.length === 0 ? null : Number(impactDaysVals.reduce((a, b) => a + b, 0).toFixed(1)),
      unit: "days",
      source: "staff_corrective_actions.impact_days",
      note: impactDaysVals.length === 0 ? "No impact recorded on corrective actions." : "Reported by the employees who lost the time.",
    },
    {
      key: "impact_value",
      label: "Value at risk from rework",
      value: impactCentsVals.length === 0 ? null : impactCentsVals.reduce((a, b) => a + b, 0),
      unit: "cents",
      source: "staff_corrective_actions.impact_value_cents",
      note: impactCentsVals.length === 0 ? "No monetary impact recorded." : "Employee-reported exposure, not a forecast.",
    },
  ];

  const cycleOf = (w: StaffWorkItem) =>
    w.completed_at && w.assigned_at
      ? Number(((new Date(w.completed_at).getTime() - new Date(w.assigned_at).getTime()) / 86_400_000).toFixed(1))
      : null;
  const row = (w: StaffWorkItem, contribution: number | null, reason: string): DrillRow => ({
    item: w,
    contribution,
    reason,
    corrective: periodCorrective.filter((c) => c.work_item_id === w.id),
    reviews: periodReviews.filter((r) => r.work_item_id === w.id),
  });
  const byId = new Map(scope.map((w) => [w.id, w]));
  const fromIds = (idList: string[], contribution: (w: StaffWorkItem) => number | null, reason: string) =>
    Array.from(new Set(idList))
      .map((id) => byId.get(id))
      .filter((w): w is StaffWorkItem => !!w)
      .map((w) => row(w, contribution(w), reason));

  const cycleRows = completed
    .filter((w) => cycleOf(w) !== null && (cycleOf(w) as number) >= 0)
    .sort((a, b) => (cycleOf(a) as number) - (cycleOf(b) as number))
    .map((w) => row(w, cycleOf(w), "Completed inside the period with a measurable assigned → completed span."));

  const drill: Record<DrillKey, DrillSet> = {
    scope: { key: "scope", label: "Sales work in period", source: "staff_work_items", rows: scope.map((w) => row(w, 1, "Assigned or completed inside the reporting period.")) },
    completed: { key: "completed", label: "Completed", source: "staff_work_items.completed_at", rows: completed.map((w) => row(w, 1, "Closed inside the reporting period.")) },
    cycle_median: { key: "cycle_median", label: "Median cycle time", source: "staff_work_items assigned_at → completed_at", rows: cycleRows },
    cycle_p90: {
      key: "cycle_p90",
      label: "90th percentile cycle",
      source: "staff_work_items assigned_at → completed_at",
      // The slowest decile is what the P90 figure actually describes.
      rows: cycleRows.slice(Math.floor(cycleRows.length * 0.9)).map((r) => ({ ...r, reason: "In the slowest decile of completed sales work." })),
    },
    sla: {
      key: "sla",
      label: "SLA compliance",
      source: "staff_work_items.sla_due_at",
      rows: committedItems.map((w) => {
        const isBreached = breached.some((b) => b.id === w.id);
        return row(w, isBreached ? 0 : 1, isBreached ? "SLA breached — settled after the committed due time." : "SLA met.");
      }),
    },
    returned: {
      key: "returned",
      label: "Returned on review",
      source: "staff_work_reviews",
      rows: fromIds(
        periodReviews.filter((r) => r.decision === "returned" || r.decision === "changes_requested").map((r) => r.work_item_id),
        () => 1,
        "A manager returned this work with a documented reason.",
      ),
    },
    flagged: {
      key: "flagged",
      label: "Rework / escalation flags",
      source: "staff_work_items.quality_flag",
      rows: scope.filter((w) => w.quality_flag === "rework" || w.quality_flag === "escalated")
        .map((w) => row(w, 1, `Quality flag: ${w.quality_flag}.`)),
    },
    corrective: {
      key: "corrective",
      label: "Corrective actions",
      source: "staff_corrective_actions",
      rows: fromIds(
        periodCorrective.map((c) => c.work_item_id as string).filter(Boolean),
        (w) => periodCorrective.filter((c) => c.work_item_id === w.id).length,
        "Rework or blocked work reported with a cause and evidence.",
      ),
    },
    impact_days: {
      key: "impact_days",
      label: "Productivity days lost",
      source: "staff_corrective_actions.impact_days",
      rows: fromIds(
        periodCorrective.filter((c) => c.impact_days !== null && c.work_item_id).map((c) => c.work_item_id as string),
        (w) => periodCorrective.filter((c) => c.work_item_id === w.id).reduce((a, c) => a + Number(c.impact_days ?? 0), 0),
        "Employee-reported time lost on this item.",
      ),
    },
    impact_value: {
      key: "impact_value",
      label: "Value at risk from rework",
      source: "staff_corrective_actions.impact_value_cents",
      rows: fromIds(
        periodCorrective.filter((c) => c.impact_value_cents !== null && c.work_item_id).map((c) => c.work_item_id as string),
        (w) => periodCorrective.filter((c) => c.work_item_id === w.id).reduce((a, c) => a + Number(c.impact_value_cents ?? 0), 0),
        "Employee-reported exposure on this item.",
      ),
    },
  };

  return {
    period,
    scope,
    measures,
    cycle: { median: quantile(cycles, 0.5), p90: quantile(cycles, 0.9), sample: cycles.length },
    sla: {
      committed: committedItems.length,
      met,
      breached: breached.length,
      compliancePct: committedItems.length === 0 ? null : Number(((met / committedItems.length) * 100).toFixed(1)),
    },
    rework: {
      returned,
      flagged,
      corrective: periodCorrective.length,
      impactDays: impactDaysVals.length === 0 ? null : Number(impactDaysVals.reduce((a, b) => a + b, 0).toFixed(1)),
      impactCents: impactCentsVals.length === 0 ? null : impactCentsVals.reduce((a, b) => a + b, 0),
    },
    attribution,
    drill,
  };
}

export const formatMeasure = (m: Measure): string => {
  if (m.value === null) return "DATA NOT AVAILABLE";
  if (m.unit === "percent") return `${m.value}%`;
  if (m.unit === "days") return `${m.value} d`;
  if (m.unit === "cents") {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(m.value / 100);
  }
  return String(m.value);
};
