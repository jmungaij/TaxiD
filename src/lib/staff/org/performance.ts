/**
 * Staff 360 — performance measurement layer.
 *
 * There is exactly one calculation of achievement, expected progress, variance,
 * weighted score, rating and status: the database view `v_objective_performance`.
 * This module reads that view and formats it. It never recomputes a number the
 * database has already decided, and it never turns a missing actual into zero —
 * an objective with no recorded actual reads as NOT RECORDED.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

 
const db = () => untypedDb;

export type ObjectiveStatus =
  | "not_started" | "on_track" | "at_risk" | "off_track"
  | "achieved" | "exceeded" | "overdue" | "awaiting_actual"
  | "active" | "draft" | "cancelled";

export type PerformanceRating =
  | "exceptional" | "excellent" | "effective" | "developing" | "below_standard" | "unsatisfactory";

export type SourceType =
  | "authoritative_system" | "verified_manual" | "imported" | "calculated" | "not_available";

export interface ObjectivePerformance {
  id: string;
  title: string;
  description: string | null;
  level: string;
  unit_id: string | null;
  unit_name: string | null;
  staff_id: string | null;
  owner_staff_id: string | null;
  owner_name: string | null;
  owner_position: string | null;
  kpi_label: string | null;
  kpi_unit: string | null;
  currency: string | null;
  formula: string | null;
  baseline: number | null;
  target: number | null;
  actual: number | null;
  actual_recorded_at: string | null;
  period_start: string | null;
  period_end: string | null;
  deadline: string | null;
  weight_pct: number | null;
  is_critical: boolean;
  critical_min_pct: number | null;
  measurement_frequency: string | null;
  review_frequency: string | null;
  data_source: string | null;
  source_type: SourceType;
  is_historical: boolean;
  cross_functional: boolean;
  provenance: string;
  seed_batch: string | null;
  status: string;
  /** Authoritative derived fields — all computed in the database. */
  achievement_pct: number | null;
  expected_pct: number | null;
  variance_pp: number | null;
  weighted_score: number | null;
  computed_status: ObjectiveStatus;
  rating: PerformanceRating | null;
  critical_breach: boolean | null;
}

export const NOT_RECORDED = "NOT RECORDED";

export const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  achieved: "Achieved",
  exceeded: "Exceeded",
  overdue: "Overdue",
  awaiting_actual: "Awaiting actual",
  active: "Active",
  draft: "Draft",
  cancelled: "Cancelled",
};

export const RATING_LABEL: Record<PerformanceRating, string> = {
  exceptional: "Exceptional",
  excellent: "Excellent",
  effective: "Effective",
  developing: "Developing",
  below_standard: "Below standard",
  unsatisfactory: "Unsatisfactory",
};

export const SOURCE_LABEL: Record<SourceType, string> = {
  authoritative_system: "Authoritative system",
  verified_manual: "Verified manual entry",
  imported: "Imported",
  calculated: "Calculated",
  not_available: "No data source",
};

export async function listObjectivePerformance(filter?: {
  unitId?: string; staffId?: string; seedBatch?: string | null;
}): Promise<ObjectivePerformance[]> {
  let q = db().from("v_objective_performance").select("*");
  if (filter?.unitId) q = q.eq("unit_id", filter.unitId);
  if (filter?.staffId) q = q.eq("owner_staff_id", filter.staffId);
  if (filter?.seedBatch) q = q.eq("seed_batch", filter.seedBatch);
  const { data, error } = await q.order("title");
  if (error) throw new Error(error.message);
  return (data ?? []) as ObjectivePerformance[];
}

export interface KpiActual {
  id: string;
  objective_id: string;
  period_start: string;
  period_end: string;
  value: number;
  unit: string;
  source_type: string;
  source_ref: string | null;
  note: string | null;
  created_at: string;
}

export async function listKpiActuals(objectiveId: string): Promise<KpiActual[]> {
  const { data, error } = await db()
    .from("staff_kpi_actuals")
    .select("*")
    .eq("objective_id", objectiveId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as KpiActual[];
}

export async function recordKpiActual(input: {
  objectiveId: string;
  periodStart: string;
  periodEnd: string;
  value: number;
  unit: string;
  sourceType: Exclude<SourceType, "not_available">;
  sourceRef?: string;
  note?: string;
}): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const { error } = await db().from("staff_kpi_actuals").insert({
    objective_id: input.objectiveId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    value: input.value,
    unit: input.unit,
    source_type: input.sourceType,
    source_ref: input.sourceRef ?? null,
    note: input.note ?? null,
    recorded_by: userRes.user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}

export const SEED_BATCH = "staff360-performance-v1";

export async function runPerformanceSeed(): Promise<Record<string, unknown>> {
  const { data, error } = await db().rpc("seed_staff360_performance_v1");
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}

export async function rollbackPerformanceSeed(): Promise<Record<string, unknown>> {
  const { data, error } = await db().rpc("rollback_staff360_performance_v1");
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}
 

/* ------------------------------ formatting ------------------------------- */

export function formatKpiValue(
  value: number | null | undefined,
  unit: string | null | undefined,
  currency?: string | null,
): string {
  if (value === null || value === undefined) return NOT_RECORDED;
  switch (unit) {
    case "currency":
      return `${currency ?? "KES"} ${Math.round(value).toLocaleString("en-KE")}`;
    case "percent":
      return `${Number(value.toFixed(1))}%`;
    case "days":
      return `${Number(value.toFixed(1))} d`;
    case "hours":
      return `${Number(value.toFixed(1))} h`;
    case "ratio":
      return value.toFixed(2);
    default:
      return Math.round(value).toLocaleString("en-KE");
  }
}

export const formatAchievement = (pct: number | null | undefined) =>
  pct === null || pct === undefined ? NOT_RECORDED : `${Number(pct.toFixed(1))}%`;

export const formatVariance = (pp: number | null | undefined) =>
  pp === null || pp === undefined ? NOT_RECORDED : `${pp > 0 ? "+" : ""}${Number(pp.toFixed(1))} pp`;

/* --------------------------- scorecard rollups --------------------------- */

export interface Scorecard {
  staffId: string | null;
  name: string;
  position: string | null;
  unitName: string | null;
  objectives: ObjectivePerformance[];
  /** Total declared weight; a valid scorecard sums to 100. */
  weightTotal: number;
  weightValid: boolean;
  /** Weighted score over measured objectives only, rebased on measured weight. */
  weightedScore: number | null;
  measured: number;
  unmeasured: number;
  rating: PerformanceRating | null;
  criticalBreaches: number;
  /** Reasons the score is incomplete — shown instead of a false total. */
  caveats: string[];
}

export function ratingFor(pct: number | null): PerformanceRating | null {
  if (pct === null) return null;
  if (pct >= 95) return "exceptional";
  if (pct >= 90) return "excellent";
  if (pct >= 80) return "effective";
  if (pct >= 70) return "developing";
  if (pct >= 60) return "below_standard";
  return "unsatisfactory";
}

export function buildScorecard(rows: ObjectivePerformance[], name?: string): Scorecard {
  const weighted = rows.filter((r) => r.weight_pct !== null);
  const weightTotal = weighted.reduce((s, r) => s + Number(r.weight_pct ?? 0), 0);
  const measuredRows = weighted.filter((r) => r.achievement_pct !== null);
  const measuredWeight = measuredRows.reduce((s, r) => s + Number(r.weight_pct ?? 0), 0);
  const caveats: string[] = [];

  if (weighted.length === 0) caveats.push("No weighted objectives — a weighted score cannot be produced");
  else if (Math.round(weightTotal) !== 100) caveats.push(`Objective weights total ${Number(weightTotal.toFixed(1))}% — a valid scorecard must total 100%`);
  const unmeasured = weighted.length - measuredRows.length;
  if (unmeasured > 0) caveats.push(`${unmeasured} weighted objective${unmeasured === 1 ? "" : "s"} have no recorded actual and are excluded from the score`);

  const score = measuredWeight === 0
    ? null
    : Number((measuredRows.reduce((s, r) => s + (Number(r.achievement_pct) * Number(r.weight_pct)) / 100, 0) / (measuredWeight / 100)).toFixed(1));

  const first = rows[0];
  return {
    staffId: first?.owner_staff_id ?? first?.staff_id ?? null,
    name: name ?? first?.owner_name ?? "Unassigned",
    position: first?.owner_position ?? null,
    unitName: first?.unit_name ?? null,
    objectives: rows,
    weightTotal: Number(weightTotal.toFixed(1)),
    weightValid: weighted.length > 0 && Math.round(weightTotal) === 100,
    weightedScore: score,
    measured: measuredRows.length,
    unmeasured,
    rating: ratingFor(score),
    criticalBreaches: rows.filter((r) => r.critical_breach === true).length,
    caveats,
  };
}

export function scorecardsByOwner(rows: ObjectivePerformance[]): Scorecard[] {
  const groups = new Map<string, ObjectivePerformance[]>();
  for (const r of rows) {
    const key = r.owner_staff_id ?? r.staff_id ?? "unassigned";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .map((g) => buildScorecard(g))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface DepartmentRollup {
  unitId: string | null;
  unitName: string;
  people: number;
  objectives: number;
  measured: number;
  unmeasured: number;
  /** Average of the people scorecards that could be measured. */
  score: number | null;
  rating: PerformanceRating | null;
  atRisk: number;
  overdue: number;
  criticalBreaches: number;
}

export function departmentRollups(rows: ObjectivePerformance[]): DepartmentRollup[] {
  const groups = new Map<string, ObjectivePerformance[]>();
  for (const r of rows) {
    const key = r.unit_id ?? "unassigned";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([unitId, g]) => {
    const cards = scorecardsByOwner(g);
    const scored = cards.filter((c) => c.weightedScore !== null);
    const score = scored.length === 0
      ? null
      : Number((scored.reduce((s, c) => s + (c.weightedScore ?? 0), 0) / scored.length).toFixed(1));
    return {
      unitId: unitId === "unassigned" ? null : unitId,
      unitName: g[0]?.unit_name ?? "Unassigned",
      people: cards.length,
      objectives: g.length,
      measured: g.filter((r) => r.achievement_pct !== null).length,
      unmeasured: g.filter((r) => r.achievement_pct === null).length,
      score,
      rating: ratingFor(score),
      atRisk: g.filter((r) => r.computed_status === "at_risk" || r.computed_status === "off_track").length,
      overdue: g.filter((r) => r.computed_status === "overdue").length,
      criticalBreaches: g.filter((r) => r.critical_breach === true).length,
    };
  }).sort((a, b) => a.unitName.localeCompare(b.unitName));
}

/** Integrity findings the portal must surface rather than hide. */
export function integrityFindings(rows: ObjectivePerformance[]): string[] {
  const out: string[] = [];
  for (const card of scorecardsByOwner(rows)) {
    if (!card.weightValid && card.objectives.some((o) => o.weight_pct !== null)) {
      out.push(`${card.name}: objective weights total ${card.weightTotal}% instead of 100%`);
    }
  }
  for (const r of rows) {
    if (r.source_type === "not_available" && r.actual !== null) {
      out.push(`${r.title}: an actual is recorded without a declared data source`);
    }
    if (r.computed_status === "overdue") {
      out.push(`${r.title}: deadline passed with no recorded actual`);
    }
    if (r.critical_breach) {
      out.push(`${r.title}: critical KPI below the minimum acceptable ${r.critical_min_pct ?? 80}%`);
    }
  }
  return out;
}
