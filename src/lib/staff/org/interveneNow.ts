/**
 * INTERVENE NOW — the manager's short list of situations that will not resolve
 * themselves.
 *
 * Built ONLY from records that already exist: the reporting-line overview, the
 * team's own work items (effort, SLA, approval and next-action state) and the
 * authoritative commercial pipeline. Every case names the person or record it
 * came from, so a manager can act on it immediately and challenge it later.
 *
 * PURE. No thresholds are invented beyond the ones declared here, and a case is
 * never raised from an absence of data.
 */
import { businessMinutesBetween, NAIROBI_BUSINESS_CALENDAR } from "@/lib/work/businessTime";
import type { OpportunitySignal } from "@/lib/workspace/commercialReplan";
import type { TeamMemberOverview } from "@/lib/staff/team";

/** One open work item belonging to somebody in the manager's line. */
export interface TeamWorkLoadItem {
  id: string;
  staffId: string | null;
  title: string;
  priorityBand: string;
  effortMinutes: number | null;
  valueScore: number | null;
  slaDueAt: string | null;
  slaBreachedAt: string | null;
  nextAction: string | null;
  approvalState: string;
  approvalRequestedAt: string | null;
  lifecycleState: string;
  escalationLevel: number;
}

export type InterventionKind =
  | "capacity_overload"
  | "breached_commitment"
  | "no_next_action"
  | "approval_stuck"
  | "stalled_deal"
  | "person_inactive";

export type InterventionSeverity = "critical" | "high" | "moderate";

export interface InterventionCase {
  id: string;
  kind: InterventionKind;
  severity: InterventionSeverity;
  /** Who or what the manager is intervening on. */
  subject: string;
  headline: string;
  detail: string;
  /** The record and field this was read from. */
  evidence: string;
  /** What the manager should actually do. */
  action: string;
  /** Recorded value at stake, when the record carries one. */
  valueKes: number | null;
  staffId: string | null;
}

/** A deal with no recorded movement for this many working days is stalled. */
export const STALLED_WORKING_DAYS = 10;
/** An approval waiting longer than this many working hours is stuck. */
export const APPROVAL_STUCK_HOURS = 8;
/** Working days of silence before a person with open work is flagged. */
export const INACTIVE_WORKING_DAYS = 3;
/** Recorded value that makes a single case a manager's problem, not a nudge. */
export const MATERIAL_VALUE_KES = 500_000;

const CLOSED_STAGES = new Set(["won", "lost"]);
const SEVERITY_RANK: Record<InterventionSeverity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
};

const workingHours = (from: string, now: Date) =>
  businessMinutesBetween(new Date(from), now, NAIROBI_BUSINESS_CALENDAR) / 60;

const money = (kes: number) => `KSh ${Math.round(kes).toLocaleString("en-KE")}`;

export interface InterveneInput {
  team: TeamMemberOverview[];
  work: TeamWorkLoadItem[];
  opportunities: OpportunitySignal[];
  /** Productive minutes per person per day, from the recorded capacity profile. */
  productiveMinutesPerDay: number | null;
  now?: Date;
  /** Cases returned; the list is a short list on purpose. */
  limit?: number;
}

/**
 * Produces the ranked intervention list. Cases are ordered by severity, then by
 * recorded value at stake, so the first row is the one worth a manager's next
 * ten minutes.
 */
export function buildInterventions(input: InterveneInput): InterventionCase[] {
  const now = input.now ?? new Date();
  const cases: InterventionCase[] = [];
  const nameOf = (staffId: string | null) =>
    input.team.find((m) => m.staffId === staffId)?.fullName ?? "Unassigned work";

  /* ---- capacity: recorded effort against recorded capacity, per person ---- */
  if (input.productiveMinutesPerDay && input.productiveMinutesPerDay > 0) {
    const byPerson = new Map<string, number>();
    for (const w of input.work) {
      if (!w.staffId || w.effortMinutes === null) continue;
      byPerson.set(w.staffId, (byPerson.get(w.staffId) ?? 0) + w.effortMinutes);
    }
    for (const [staffId, minutes] of byPerson) {
      const days = minutes / input.productiveMinutesPerDay;
      if (days < 2) continue;
      cases.push({
        id: `capacity:${staffId}`,
        kind: "capacity_overload",
        severity: days >= 4 ? "critical" : "high",
        subject: nameOf(staffId),
        headline: `${Math.round(days * 10) / 10} days of work queued`,
        detail: `${Math.round(minutes / 60)} recorded hours of open work against ${
          Math.round((input.productiveMinutesPerDay / 60) * 10) / 10
        } productive hours a day. This will not clear by working harder.`,
        evidence: "staff_work_items.effort_minutes vs work_capacity_profiles.productive_minutes",
        action: "Reassign, defer or close work with them before it silently slips.",
        valueKes: null,
        staffId,
      });
    }
  }

  /* ---- breached commitments on material value ---- */
  for (const w of input.work) {
    const breached = w.slaBreachedAt ?? (w.slaDueAt && new Date(w.slaDueAt) < now ? w.slaDueAt : null);
    if (!breached) continue;
    const value = w.valueScore ?? null;
    if ((value ?? 0) < MATERIAL_VALUE_KES && w.escalationLevel === 0) continue;
    cases.push({
      id: `sla:${w.id}`,
      kind: "breached_commitment",
      severity: (value ?? 0) >= MATERIAL_VALUE_KES ? "critical" : "high",
      subject: nameOf(w.staffId),
      headline: `Commitment missed on ${w.title}`,
      detail: `Due ${new Date(breached).toLocaleString("en-KE")} in working hours${
        value ? ` on ${money(value)} of recorded value` : ""
      }. Escalation level ${w.escalationLevel}.`,
      evidence: "staff_work_items.sla_due_at / sla_breached_at",
      action: "Take the recovery call yourself or reassign it today.",
      valueKes: value,
      staffId: w.staffId,
    });
  }

  /* ---- material work carrying no next action ---- */
  for (const w of input.work) {
    if (w.nextAction) continue;
    if ((w.valueScore ?? 0) < MATERIAL_VALUE_KES) continue;
    cases.push({
      id: `nextaction:${w.id}`,
      kind: "no_next_action",
      severity: "high",
      subject: nameOf(w.staffId),
      headline: `No next step recorded on ${w.title}`,
      detail: `${money(w.valueScore ?? 0)} of recorded value with nothing planned against it.`,
      evidence: "staff_work_items.next_action is null",
      action: "Agree the next step and date with them now.",
      valueKes: w.valueScore ?? null,
      staffId: w.staffId,
    });
  }

  /* ---- approvals the team cannot clear themselves ---- */
  for (const w of input.work) {
    if (w.approvalState !== "pending" || !w.approvalRequestedAt) continue;
    const hours = workingHours(w.approvalRequestedAt, now);
    if (hours < APPROVAL_STUCK_HOURS) continue;
    cases.push({
      id: `approval:${w.id}`,
      kind: "approval_stuck",
      severity: hours >= APPROVAL_STUCK_HOURS * 3 ? "high" : "moderate",
      subject: nameOf(w.staffId),
      headline: `Waiting ${Math.round(hours)} working hours for a decision`,
      detail: `${w.title} is blocked on an approval nobody in the team can grant.`,
      evidence: "staff_work_items.approval_state = pending",
      action: "Decide it, or name who will.",
      valueKes: w.valueScore ?? null,
      staffId: w.staffId,
    });
  }

  /* ---- material deals with no recorded movement ---- */
  for (const o of input.opportunities) {
    if (CLOSED_STAGES.has(o.stage) || !o.updatedAt) continue;
    if ((o.valueKes ?? 0) < MATERIAL_VALUE_KES) continue;
    const days = Math.floor(workingHours(o.updatedAt, now) / 8);
    if (days < STALLED_WORKING_DAYS) continue;
    cases.push({
      id: `deal:${o.id}`,
      kind: "stalled_deal",
      severity: days >= STALLED_WORKING_DAYS * 2 ? "high" : "moderate",
      subject: o.ref ?? "Opportunity",
      headline: `${money(o.valueKes ?? 0)} untouched for ${days} working days`,
      detail: `Still at ${o.stage} with ${o.probabilityPct ?? 0}% recorded probability.`,
      evidence: "commercial_opportunities.updated_at",
      action: "Join the next conversation or reassign the deal.",
      valueKes: o.valueKes ?? null,
      staffId: null,
    });
  }

  /* ---- people with open work and no recorded activity ---- */
  for (const m of input.team) {
    if (m.openWork === 0 || !m.lastActivity) continue;
    const days = Math.floor(workingHours(m.lastActivity, now) / 8);
    if (days < INACTIVE_WORKING_DAYS) continue;
    cases.push({
      id: `inactive:${m.staffId}`,
      kind: "person_inactive",
      severity: days >= INACTIVE_WORKING_DAYS * 2 ? "high" : "moderate",
      subject: m.fullName,
      headline: `No recorded activity for ${days} working days`,
      detail: `${m.openWork} open item(s), ${m.overdueWork} overdue, and nothing recorded since ${new Date(
        m.lastActivity,
      ).toLocaleDateString("en-KE")}.`,
      evidence: "staff_my_team_overview.last_activity",
      action: "Check in before the queue becomes a backlog.",
      valueKes: null,
      staffId: m.staffId,
    });
  }

  return cases
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        (b.valueKes ?? 0) - (a.valueKes ?? 0),
    )
    .slice(0, input.limit ?? 8);
}
