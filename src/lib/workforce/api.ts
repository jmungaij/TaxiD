/**
 * Workforce activation persistence.
 *
 * Activation writes into the EXISTING organisation spine — `staff_members`,
 * `org_objectives` and `staff_work_items`. No new shadow entities: the work
 * items produced here are the same rows the operational spine, SLA sweeper and
 * review workflow already govern.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ActivationPlan } from "./activation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const WORKFORCE_BATCH = "workforce-launchpad-v1";

export interface ActivationTarget {
  staffId: string;
  orgId: string;
  unitId: string | null;
  fullName: string;
}

export interface ActivationResult {
  objectivesCreated: number;
  tasksCreated: number;
}

/**
 * Blueprint units are written for humans ("KES", "%", "clients"). The
 * organisation spine only accepts the canonical set enforced by
 * `org_objectives_kpi_unit_check`, so translate here instead of storing a
 * free-text unit the database will reject.
 */
export function canonicalObjectiveUnit(unit: string): {
  kpi_unit: "count" | "percent" | "currency" | "ratio" | "days" | "hours" | "score";
  currency: string | null;
  /** The original blueprint wording, preserved for the objective description. */
  stated: string;
} {
  const u = unit.trim();
  const lower = u.toLowerCase();
  if (u === "%" || lower === "percent" || lower === "percentage")
    return { kpi_unit: "percent", currency: null, stated: u };
  if (/^[A-Z]{3}$/.test(u)) return { kpi_unit: "currency", currency: u, stated: u };
  if (lower === "currency") return { kpi_unit: "currency", currency: "KES", stated: u };
  if (lower === "days" || lower === "day") return { kpi_unit: "days", currency: null, stated: u };
  if (lower === "hours" || lower === "hour" || lower === "hrs")
    return { kpi_unit: "hours", currency: null, stated: u };
  if (lower === "ratio") return { kpi_unit: "ratio", currency: null, stated: u };
  if (lower === "score" || lower === "points" || lower === "nps")
    return { kpi_unit: "score", currency: null, stated: u };
  return { kpi_unit: "count", currency: null, stated: u };
}

/** Persists a previewed plan for a named employee. Idempotent per seed batch. */
export async function activateWorkforcePlan(
  plan: ActivationPlan,
  target: ActivationTarget,
): Promise<ActivationResult> {
  if (!plan.activatable) throw new Error("Blueprint has structural defects — resolve them before activation.");

  const objectiveRows = plan.objectives.map((o) => {
    const unit = canonicalObjectiveUnit(o.unit);
    return {
      org_id: target.orgId,
      unit_id: target.unitId,
      staff_id: target.staffId,
      owner_staff_id: target.staffId,
      level: "employee",
      title: `${o.title} — ${target.fullName}`,
      description: `Role blueprint ${plan.blueprintKey}. Value lever: ${o.lever}. Attribution: ${o.attribution}. Evidence: ${o.evidence}. Measured in ${unit.stated}.`,
      kpi_label: o.kpiLabel,
      kpi_unit: unit.kpi_unit,
      currency: unit.currency,
      target: o.target,
      weight_pct: o.weightPct,
      measurement_frequency: o.period,
      period_start: o.periodStart,
      period_end: o.periodEnd,
      deadline: o.periodEnd,
      status: "active",
      source_type: "verified_manual",
      provenance: "LIVE",
      seed_batch: WORKFORCE_BATCH,
    };
  });


  // `org_objectives` carries a unique index on (seed_batch, title): re-activating
  // the same employee/blueprint must reuse the existing objectives instead of
  // failing with a duplicate-key error.
  const titles = objectiveRows.map((r) => r.title);
  const { data: existingObjectives, error: existingErr } = await db
    .from("org_objectives")
    .select("id,kpi_label,title")
    .eq("seed_batch", WORKFORCE_BATCH)
    .in("title", titles);
  if (existingErr) throw new Error(existingErr.message);

  const existingTitles = new Set<string>((existingObjectives ?? []).map((r: { title: string }) => r.title));
  const newObjectiveRows = objectiveRows.filter((r) => !existingTitles.has(r.title));

  let insertedObjectives: { id: string; kpi_label: string }[] = [];
  if (newObjectiveRows.length) {
    const { data, error: objErr } = await db
      .from("org_objectives")
      .insert(newObjectiveRows)
      .select("id,kpi_label");
    if (objErr) throw new Error(objErr.message);
    insertedObjectives = data ?? [];
  }

  const objectiveByKpi = new Map<string, string>(
    [...(existingObjectives ?? []), ...insertedObjectives].map(
      (r: { id: string; kpi_label: string }) => [r.kpi_label, r.id],
    ),
  );

  const allTaskRows = plan.tasks.map((t) => ({
    staff_id: target.staffId,
    unit_id: target.unitId,
    objective_id: objectiveByKpi.get(t.kpiLabel) ?? null,
    work_kind: "operations_task",
    title: t.title,
    description: `Standard work from role blueprint ${plan.blueprintKey}. Evidence required: ${t.evidence}.`,
    priority: t.priority === "P0" || t.priority === "P1" ? "high" : t.priority === "P2" ? "medium" : "low",
    status: "open",
    lifecycle_state: "new",
    next_action: t.title,
    next_action_due: t.dueDate,
    required_action: t.title,
    sla_minutes: t.slaMinutes,
    needs_approval: t.requiresApproval,
    service_line: plan.department,
    source_table: "role_blueprint",
    // `source_id` is a uuid column, so the blueprint reference is carried in the
    // text entity ref instead of being coerced into an identifier it is not.
    entity_type: "role_blueprint_standard_work",
    entity_ref: `${plan.blueprintKey}:${t.key}`,
    seed_batch: WORKFORCE_BATCH,

  }));

  // Same idempotency rule for standard work: one row per blueprint task and
  // employee, so a repeated activation does not duplicate the work queue.
  const refs = allTaskRows.map((r) => r.entity_ref);
  const { data: existingTasks, error: existingTaskErr } = await db
    .from("staff_work_items")
    .select("entity_ref")
    .eq("seed_batch", WORKFORCE_BATCH)
    .eq("staff_id", target.staffId)
    .in("entity_ref", refs);
  if (existingTaskErr) throw new Error(existingTaskErr.message);

  const seenRefs = new Set<string>((existingTasks ?? []).map((r: { entity_ref: string }) => r.entity_ref));
  const taskRows = allTaskRows.filter((r) => !seenRefs.has(r.entity_ref));

  let tasks: { id: string }[] = [];
  if (taskRows.length) {
    const { data, error: taskErr } = await db.from("staff_work_items").insert(taskRows).select("id");
    if (taskErr) throw new Error(taskErr.message);
    tasks = data ?? [];
  }

  return { objectivesCreated: insertedObjectives.length, tasksCreated: tasks.length };
}
