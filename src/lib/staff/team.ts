/**
 * Manager team view — the signed-in manager's reporting line.
 *
 * The reporting line is resolved SERVER-SIDE by `staff_my_team_overview()`,
 * which walks `staff_members.manager_staff_id` from the caller's own staff
 * record. The client never supplies a staff id, so a manager can only ever
 * receive the people who genuinely report to them, directly or indirectly.
 */
import { supabase } from "@/integrations/supabase/client";

// The RPC is newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

import type { TeamWorkLoadItem } from "./org/interveneNow";
import type { OpportunitySignal } from "@/lib/workspace/commercialReplan";

export interface TeamMemberOverview {
  staffId: string;
  fullName: string;
  workEmail: string | null;
  positionTitle: string | null;
  unitName: string | null;
  employmentStatus: string | null;
  hasLogin: boolean;
  reportsTo: string | null;
  depth: number;
  openWork: number;
  overdueWork: number;
  completedWork: number;
  lastActivity: string | null;
}

export async function fetchMyTeam(): Promise<TeamMemberOverview[]> {
  const { data, error } = await db.rpc("staff_my_team_overview");
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    staffId: r.staff_id,
    fullName: r.full_name ?? "Unnamed employee",
    workEmail: r.work_email ?? null,
    positionTitle: r.position_title ?? null,
    unitName: r.unit_name ?? null,
    employmentStatus: r.employment_status ?? null,
    hasLogin: !!r.has_login,
    reportsTo: r.reports_to ?? null,
    depth: r.depth ?? 1,
    openWork: r.open_work ?? 0,
    overdueWork: r.overdue_work ?? 0,
    completedWork: r.completed_work ?? 0,
    lastActivity: r.last_activity ?? null,
  }));
}

/* ------------------------------------------------- intervention inputs */

/**
 * Open work belonging to the manager's line, read for intervention analysis.
 * RLS decides what a given manager may see; an empty result means "nothing
 * visible", never "nothing wrong", and callers say so.
 */
export async function fetchTeamWorkLoad(staffIds: string[]): Promise<TeamWorkLoadItem[]> {
  const ids = [...new Set(staffIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("staff_work_items")
    .select(
      "id, staff_id, title, priority_band, effort_minutes, value_score, sla_due_at, sla_breached_at, next_action, approval_state, approval_requested_at, lifecycle_state, escalation_level",
    )
    .in("staff_id", ids)
    .not("status", "in", "(completed,closed,cancelled)")
    .limit(1000);
  if (error) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id,
    staffId: r.staff_id ?? null,
    title: r.title,
    priorityBand: r.priority_band ?? "P4",
    effortMinutes: r.effort_minutes ?? null,
    valueScore: r.value_score ?? null,
    slaDueAt: r.sla_due_at ?? null,
    slaBreachedAt: r.sla_breached_at ?? null,
    nextAction: r.next_action ?? null,
    approvalState: r.approval_state ?? "none",
    approvalRequestedAt: r.approval_requested_at ?? null,
    lifecycleState: r.lifecycle_state ?? "assigned",
    escalationLevel: r.escalation_level ?? 0,
  }));
}

/**
 * Open pipeline rows visible to the manager, used to surface material deals
 * that have stopped moving.
 */
export async function fetchTeamOpportunities(): Promise<OpportunitySignal[]> {
  const { data, error } = await db
    .from("commercial_opportunities")
    .select("id, opportunity_ref, stage, probability_pct, expected_value_cents, updated_at")
    .not("stage", "in", "(won,lost)")
    .order("expected_value_cents", { ascending: false })
    .limit(200);
  if (error) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id,
    ref: r.opportunity_ref ?? null,
    stage: r.stage,
    probabilityPct: r.probability_pct ?? null,
    valueKes: r.expected_value_cents === null ? null : r.expected_value_cents / 100,
    updatedAt: r.updated_at ?? null,
  }));
}
