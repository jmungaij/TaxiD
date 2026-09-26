/**
 * Workforce activation engine — turns a role blueprint plus a named employee
 * into an executable Day-1 plan: objectives with KPIs, a 30/60/90 ramp,
 * scheduled standard work, and a capacity commitment.
 *
 * Pure and deterministic: the same blueprint and start date always produce the
 * same plan, so activation can be previewed, reviewed and audited before any
 * row is written.
 */
import {
  auditBlueprint,
  type BlueprintKpi,
  type BlueprintTask,
  type RampPhase,
  type RoleBlueprint,
  type TaskPriority,
} from "./roleBlueprints";

const PRIORITY_WEIGHT: Record<TaskPriority, number> = { P0: 100, P1: 80, P2: 60, P3: 35, P4: 15 };

const LEVER_WEIGHT: Record<string, number> = {
  revenue: 1, gmv: 0.95, customer_acquisition: 0.9, customer_retention: 0.85,
  risk: 0.85, compliance: 0.8, service_quality: 0.75, operational_efficiency: 0.7,
  cost: 0.65, strategic_capability: 0.5,
};

export const RAMP_PHASES: { phase: RampPhase; label: string; dayFrom: number; dayTo: number; intent: string }[] = [
  { phase: "learn", label: "Days 1–30 · Learn", dayFrom: 1, dayTo: 30, intent: "Capability, systems and standard work under supervision" },
  { phase: "execute", label: "Days 31–60 · Execute", dayFrom: 31, dayTo: 60, intent: "Deliver standard work to target with review" },
  { phase: "own", label: "Days 61–90 · Own", dayFrom: 61, dayTo: 90, intent: "Own outcomes, authority applied, results measured" },
];

const PHASE_TARGET_PCT: Record<RampPhase, number> = { learn: 40, execute: 75, own: 100 };
const OCCURRENCES_PER_MONTH: Record<BlueprintTask["cadence"], number> = { daily: 21, weekly: 4, monthly: 1, once: 1 };

export interface PlannedObjective {
  key: string;
  title: string;
  kpiLabel: string;
  unit: string;
  target: number;
  weightPct: number;
  period: BlueprintKpi["period"];
  periodStart: string;
  periodEnd: string;
  lever: BlueprintKpi["lever"];
  attribution: BlueprintKpi["attribution"];
  evidence: BlueprintKpi["evidence"];
}

export interface PlannedTask {
  key: string;
  title: string;
  kpiKey: string;
  kpiLabel: string;
  priority: TaskPriority;
  /** 0–100 business-value score used for ordering the work queue. */
  valueScore: number;
  phase: RampPhase;
  cadence: BlueprintTask["cadence"];
  effortMinutes: number;
  monthlyMinutes: number;
  dueDate: string;
  slaMinutes: number | null;
  requiresApproval: boolean;
  evidence: BlueprintTask["evidence"];
}

export interface RampMilestone {
  phase: RampPhase;
  label: string;
  intent: string;
  startDate: string;
  endDate: string;
  /** Percentage of the role target expected by the end of the phase. */
  targetPct: number;
  focus: string[];
  gate: string;
}

export interface CapacityCommitment {
  dailyCapacityMinutes: number;
  monthlyCapacityMinutes: number;
  committedMinutes: number;
  utilisationPct: number;
  /** True when standard work already exceeds contracted capacity. */
  overloaded: boolean;
  headroomMinutes: number;
}

export interface ActivationPlan {
  blueprintKey: string;
  roleTitle: string;
  department: string;
  startDate: string;
  objectives: PlannedObjective[];
  tasks: PlannedTask[];
  ramp: RampMilestone[];
  capacity: CapacityCommitment;
  requiredTraining: string[];
  valuePath: string[];
  /** Structural defects that must be fixed before activation. */
  defects: { rule: string; detail: string }[];
  activatable: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function addDays(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** Weighted 0–100 score: priority, business lever and attribution strength. */
export function taskValueScore(task: BlueprintTask, kpi: BlueprintKpi | undefined): number {
  const priority = PRIORITY_WEIGHT[task.priority];
  const lever = kpi ? (LEVER_WEIGHT[kpi.lever] ?? 0.6) : 0.6;
  const attribution = kpi?.attribution === "direct" ? 1 : kpi?.attribution === "protected" ? 0.9 : kpi?.attribution === "influenced" ? 0.8 : 0.7;
  const weight = kpi ? Math.min(kpi.weightPct, 40) / 40 : 0.5;
  const raw = priority * lever * attribution * (0.6 + 0.4 * weight);
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export function capacityFor(bp: RoleBlueprint): CapacityCommitment {
  const monthlyCapacityMinutes = bp.dailyCapacityMinutes * 21;
  const committedMinutes = bp.standardWork.reduce(
    (s, t) => s + t.effortMinutes * OCCURRENCES_PER_MONTH[t.cadence],
    0,
  );
  const utilisationPct = Math.round((committedMinutes / monthlyCapacityMinutes) * 100);
  return {
    dailyCapacityMinutes: bp.dailyCapacityMinutes,
    monthlyCapacityMinutes,
    committedMinutes,
    utilisationPct,
    overloaded: committedMinutes > monthlyCapacityMinutes,
    headroomMinutes: monthlyCapacityMinutes - committedMinutes,
  };
}

/** Builds the full Day-1 activation plan for a blueprint. */
export function buildActivationPlan(bp: RoleBlueprint, startDate: string): ActivationPlan {
  const defects = auditBlueprint(bp);

  const objectives: PlannedObjective[] = bp.kpis.map((k) => ({
    key: k.key,
    title: k.objective,
    kpiLabel: k.kpiLabel,
    unit: k.unit,
    target: k.target,
    weightPct: k.weightPct,
    period: k.period,
    periodStart: startDate,
    periodEnd: addDays(startDate, k.period === "monthly" ? 30 : 90),
    lever: k.lever,
    attribution: k.attribution,
    evidence: k.evidence,
  }));

  const tasks: PlannedTask[] = bp.standardWork
    .map((t) => {
      const kpi = bp.kpis.find((k) => k.key === t.kpiKey);
      const phaseStartDay = RAMP_PHASES.find((p) => p.phase === t.phase)?.dayFrom ?? 1;
      const lead = t.cadence === "daily" ? 0 : t.cadence === "weekly" ? 6 : 20;
      return {
        key: t.key,
        title: t.title,
        kpiKey: t.kpiKey,
        kpiLabel: kpi?.kpiLabel ?? t.kpiKey,
        priority: t.priority,
        valueScore: taskValueScore(t, kpi),
        phase: t.phase,
        cadence: t.cadence,
        effortMinutes: t.effortMinutes,
        monthlyMinutes: t.effortMinutes * OCCURRENCES_PER_MONTH[t.cadence],
        dueDate: addDays(startDate, phaseStartDay - 1 + lead),
        slaMinutes: t.slaMinutes ?? null,
        requiresApproval: t.requiresApproval === true,
        evidence: t.evidence,
      };
    })
    .sort((a, b) => b.valueScore - a.valueScore || a.dueDate.localeCompare(b.dueDate));

  const ramp: RampMilestone[] = RAMP_PHASES.map((p) => ({
    phase: p.phase,
    label: p.label,
    intent: p.intent,
    startDate: addDays(startDate, p.dayFrom - 1),
    endDate: addDays(startDate, p.dayTo - 1),
    targetPct: PHASE_TARGET_PCT[p.phase],
    focus: bp.standardWork.filter((t) => t.phase === p.phase).map((t) => t.title),
    gate:
      p.phase === "learn"
        ? `Training complete: ${bp.requiredTraining.join(", ")}`
        : p.phase === "execute"
          ? `Standard work delivered at ${PHASE_TARGET_PCT.execute}% of target with manager review`
          : `Full target ownership with authority applied: ${bp.authority[0] ?? "role authority"}`,
  }));

  return {
    blueprintKey: bp.key,
    roleTitle: bp.title,
    department: bp.department,
    startDate,
    objectives,
    tasks,
    ramp,
    capacity: capacityFor(bp),
    requiredTraining: bp.requiredTraining,
    valuePath: bp.valuePath,
    defects,
    activatable: defects.length === 0,
  };
}

export const minutesToHours = (m: number) => Math.round((m / 60) * 10) / 10;
