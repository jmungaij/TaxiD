/**
 * INTERNS 360 — cockpit entitlements and audit trail.
 *
 * The server is the authority: `intern_cockpit_access` resolves what the
 * signed-in identity may see and do from their platform role and from whether
 * they mentor or supervise an intern. The cockpit renders nothing it has not
 * been granted, and every consequential action is written to the append-only
 * intern audit trail before the UI reports success.
 */
import { supabase } from "@/integrations/supabase/client";

export interface CockpitAccess {
  authenticated: boolean;
  role_label: string;
  is_super_admin: boolean;
  is_executive: boolean;
  is_manager: boolean;
  is_recruiter: boolean;
  is_supervisor: boolean;
  is_mentor: boolean;
  view_kpis: boolean;
  view_activity: boolean;
  view_work_queue: boolean;
  view_evidence: boolean;
  view_learning: boolean;
  view_performance: boolean;
  view_commercial: boolean;
  view_talent: boolean;
  view_integrity: boolean;
  view_calendar: boolean;
  view_cohort_health: boolean;
  assign_work: boolean;
  review_evidence: boolean;
  schedule_checkin: boolean;
  classify_talent: boolean;
  recompute_scores: boolean;
}

/** Deny-by-default shape used while loading and for unauthorised identities. */
export const NO_ACCESS: CockpitAccess = {
  authenticated: false,
  role_label: "Resolving access…",
  is_super_admin: false,
  is_executive: false,
  is_manager: false,
  is_recruiter: false,
  is_supervisor: false,
  is_mentor: false,
  view_kpis: false,
  view_activity: false,
  view_work_queue: false,
  view_evidence: false,
  view_learning: false,
  view_performance: false,
  view_commercial: false,
  view_talent: false,
  view_integrity: false,
  view_calendar: false,
  view_cohort_health: false,
  assign_work: false,
  review_evidence: false,
  schedule_checkin: false,
  classify_talent: false,
  recompute_scores: false,
};

export async function fetchCockpitAccess(): Promise<CockpitAccess> {
  const { data, error } = await supabase.rpc("intern_cockpit_access");
  if (error) throw new Error(error.message);
  return { ...NO_ACCESS, ...((data ?? {}) as Partial<CockpitAccess>) };
}

/** Cockpit actions recorded in the audit trail. */
export type CockpitAction =
  | "WORK_ASSIGNED"
  | "CHECKIN_SCHEDULED"
  | "EVIDENCE_REVIEWED"
  | "TALENT_CLASSIFIED"
  | "PERFORMANCE_RECOMPUTED";

/**
 * Record a cockpit action. Server-side authorisation applies; failures are
 * surfaced to the caller so an action is never reported as audited when it
 * was not.
 */
export async function auditCockpitAction(input: {
  action: CockpitAction;
  entity: string;
  internId?: string | null;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase.rpc("intern_audit_action", {
    p_action: input.action,
    p_entity: input.entity,
    p_intern: input.internId ?? null,
    p_entity_id: input.entityId ?? null,
    p_detail: (input.detail ?? {}) as never,
  });
  if (error) throw new Error(error.message);
  return data as unknown as string;
}
