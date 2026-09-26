/**
 * Fine-grained governance access control.
 *
 * Platform admins (`admin` / `super_admin`) always pass. Everyone else needs
 * an explicit grant in `governance_access_grants`, scoped by any combination
 * of corporate account, corporate role and department — or targeted directly
 * at a single user. Evaluation is mirrored server-side by the
 * `public.has_governance_access(uuid, text, text)` SECURITY DEFINER function
 * which the RLS policies on the governance tables call, so the UI check below
 * is a convenience layer only: the database is the real boundary.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import type { CorporateRole } from "@/lib/corporateRoles";

export const GOVERNANCE_SURFACES = [
  "alert_history",
  "concierge_audit",
  "report_schedules",
  "incident_detail",
  "webhook_admin",
] as const;

export type GovernanceSurface = (typeof GOVERNANCE_SURFACES)[number];
export type GovernanceCapability = "read" | "export" | "manage";

export const SURFACE_LABEL: Record<GovernanceSurface, string> = {
  alert_history: "Alert history",
  concierge_audit: "Concierge audit trail",
  report_schedules: "Report schedules & exports",
  incident_detail: "Incident detail",
  webhook_admin: "Governance webhooks",
};

export const SURFACE_ROUTE: Record<GovernanceSurface, string> = {
  alert_history: "/dashboard/admin/executive-command-centre",
  concierge_audit: "/dashboard/admin/concierge-approval-audit",
  report_schedules: "/dashboard/admin/report-schedules",
  incident_detail: "/dashboard/admin/noc-incidents",
  webhook_admin: "/dashboard/admin/governance-webhooks",
};

export interface GovernanceGrant {
  id: string;
  surface: GovernanceSurface;
  corporate_id: string | null;
  corporate_role: CorporateRole | null;
  department_id: string | null;
  user_id: string | null;
  can_read: boolean;
  can_export: boolean;
  can_manage: boolean;
  note: string | null;
  created_at: string;
}

/** Membership facts about the person asking. */
export interface GovernanceSubject {
  userId: string;
  platformRoles: string[];
  corporateId?: string | null;
  corporateRole?: CorporateRole | null;
  departmentId?: string | null;
}

const PLATFORM_BYPASS = ["admin", "super_admin"];

function capabilityOf(grant: GovernanceGrant, capability: GovernanceCapability): boolean {
  if (capability === "export") return grant.can_export;
  if (capability === "manage") return grant.can_manage;
  return grant.can_read;
}

/**
 * Pure evaluation — mirrors `has_governance_access`. A grant matches when
 * every populated dimension matches the subject; NULL means "any".
 */
export function grantMatches(grant: GovernanceGrant, subject: GovernanceSubject): boolean {
  if (grant.user_id) return grant.user_id === subject.userId;
  if (!subject.corporateId) return false;
  if (grant.corporate_id && grant.corporate_id !== subject.corporateId) return false;
  if (grant.corporate_role && grant.corporate_role !== subject.corporateRole) return false;
  if (grant.department_id && grant.department_id !== subject.departmentId) return false;
  return true;
}

export function canAccessGovernanceSurface(
  surface: GovernanceSurface,
  capability: GovernanceCapability,
  subject: GovernanceSubject,
  grants: GovernanceGrant[],
): boolean {
  if (subject.platformRoles.some((r) => PLATFORM_BYPASS.includes(r))) return true;
  return grants.some(
    (g) => g.surface === surface && capabilityOf(g, capability) && grantMatches(g, subject),
  );
}

/** Human summary of a grant's scope, for the admin matrix. */
export function describeScope(
  grant: GovernanceGrant,
  lookup: { corporates?: Record<string, string>; departments?: Record<string, string> } = {},
): string {
  if (grant.user_id) return "Specific user";
  const bits: string[] = [];
  bits.push(
    grant.corporate_id
      ? lookup.corporates?.[grant.corporate_id] ?? "One corporate account"
      : "All corporate accounts",
  );
  if (grant.corporate_role) bits.push(grant.corporate_role.replace("corporate_", ""));
  if (grant.department_id) {
    bits.push(lookup.departments?.[grant.department_id] ?? "one department");
  }
  return bits.join(" · ");
}

/* -------------------------------------------------------------- data access */

const db = () => untypedDb;

export async function loadGovernanceGrants(): Promise<GovernanceGrant[]> {
  const { data, error } = await db()
    .from("governance_access_grants")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GovernanceGrant[];
}

export interface GrantDraft {
  surface: GovernanceSurface;
  corporate_id?: string | null;
  corporate_role?: CorporateRole | null;
  department_id?: string | null;
  user_id?: string | null;
  can_read: boolean;
  can_export: boolean;
  can_manage: boolean;
  note?: string;
}

export async function createGovernanceGrant(draft: GrantDraft): Promise<{ error?: string }> {
  if (!draft.can_read && !draft.can_export && !draft.can_manage) {
    return { error: "Select at least one capability" };
  }
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await db().from("governance_access_grants").insert({
    surface: draft.surface,
    corporate_id: draft.corporate_id || null,
    corporate_role: draft.corporate_role || null,
    department_id: draft.department_id || null,
    user_id: draft.user_id || null,
    can_read: draft.can_read,
    can_export: draft.can_export,
    can_manage: draft.can_manage,
    note: draft.note?.trim() || null,
    created_by: auth?.user?.id ?? null,
  });
  return error ? { error: error.message } : {};
}

export async function updateGovernanceGrant(
  id: string,
  patch: Partial<Pick<GovernanceGrant, "can_read" | "can_export" | "can_manage" | "note">>,
): Promise<{ error?: string }> {
  const { error } = await db().from("governance_access_grants").update(patch).eq("id", id);
  return error ? { error: error.message } : {};
}

export async function deleteGovernanceGrant(id: string): Promise<{ error?: string }> {
  const { error } = await db().from("governance_access_grants").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

/** Server-side truth for the current session (used to gate UI affordances). */
export async function checkGovernanceAccess(
  surface: GovernanceSurface,
  capability: GovernanceCapability = "read",
): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return false;
  const { data, error } = await untypedDb.rpc("has_governance_access", {
    _user_id: uid,
    _surface: surface,
    _capability: capability,
  });
  if (error) {
    console.warn("has_governance_access failed", error.message);
    return false;
  }
  return data === true;
}
