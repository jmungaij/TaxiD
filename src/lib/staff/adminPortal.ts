/**
 * ADMIN PORTAL — access administration data layer.
 *
 * Three things are administered here and nothing is invented in the browser:
 *   ROLES         — platform roles held per person. Every grant/revoke goes
 *                   through the governed `admin_assign_role` /
 *                   `admin_revoke_role` functions (super_admin only, audited).
 *   DEPARTMENTS   — the organisation units of record (`org_units`), reused from
 *                   the organisation API so one structure serves every surface.
 *   ACCESS LEVELS — `staff_role_permissions`: which staff permission keys each
 *                   platform role carries. Row-level security restricts writes
 *                   to super admins; every change is written to
 *                   `permission_change_log` for the audit trail.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

const db = untypedDb;

/* ------------------------------------------------------------------ */
/* Platform roles                                                      */
/* ------------------------------------------------------------------ */

/** Platform roles that may be administered from this portal, grouped. */
export const ADMINISTRABLE_ROLES = [
  { role: "super_admin", label: "Super administrator", group: "Administration", note: "Full control, including who else may administer access." },
  { role: "admin", label: "Administrator", group: "Administration", note: "Runs the platform day to day." },
  { role: "director", label: "Director", group: "Leadership", note: "Board-level oversight of the whole business." },
  { role: "general_manager", label: "General manager", group: "Leadership", note: "Runs the business across every department." },
  { role: "finance_admin", label: "Finance lead", group: "Functional", note: "Money, invoices, settlements and payouts." },
  { role: "compliance_admin", label: "Compliance lead", group: "Functional", note: "Legal, documents and regulatory control." },
  { role: "operations_admin", label: "Operations lead", group: "Functional", note: "Service delivery and the operations board." },
  { role: "operations_manager", label: "Operations manager", group: "Functional", note: "Day-to-day operational supervision." },
  { role: "dispatch_manager", label: "Dispatch manager", group: "Functional", note: "Trip and delivery dispatch." },
  { role: "pricing_manager", label: "Pricing manager", group: "Functional", note: "Rate cards and commercial pricing." },
  { role: "fleet_owner", label: "Fleet owner", group: "Partner", note: "Partner fleet owner portal." },
  { role: "corporate_admin", label: "Corporate administrator", group: "Customer", note: "Administers a corporate customer account." },
  { role: "corporate_manager", label: "Corporate manager", group: "Customer", note: "Approves trips inside a corporate account." },
  { role: "corporate_employee", label: "Corporate employee", group: "Customer", note: "Books within a corporate account." },
  { role: "driver", label: "Driver", group: "Supply", note: "Driver app and earnings." },
  { role: "rider", label: "Rider", group: "Customer", note: "Personal rider account." },
] as const;

export type AdministrableRole = (typeof ADMINISTRABLE_ROLES)[number]["role"];

export const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ADMINISTRABLE_ROLES.map((r) => [r.role, r.label]),
);

export const ROLE_GROUPS = [...new Set(ADMINISTRABLE_ROLES.map((r) => r.group))];

/** Roles that grant entry into the internal staff portal. */
export const STAFF_PORTAL_GRANTING_ROLES: string[] = [
  "admin", "super_admin", "director", "general_manager", "finance_admin",
  "compliance_admin", "operations_admin", "operations_manager",
  "pricing_manager", "dispatch_manager",
];

export interface PortalPerson {
  staffId: string | null;
  userId: string | null;
  fullName: string;
  workEmail: string | null;
  unitId: string | null;
  positionId: string | null;
  employmentStatus: string | null;
  roles: string[];
}

/**
 * Every person in the staff register, with the platform roles they hold.
 * People without a login are listed too — their access can only be granted
 * once a login exists, and the portal says so rather than hiding them.
 */
export async function listPortalPeople(): Promise<PortalPerson[]> {
  const [{ data: staff, error: staffErr }, { data: grants, error: grantErr }] = await Promise.all([
    db.from("staff_members")
      .select("id, user_id, full_name, work_email, unit_id, position_id, employment_status")
      .order("full_name", { ascending: true }),
    db.from("user_roles").select("user_id, role"),
  ]);
  if (staffErr) throw new Error(staffErr.message);
  if (grantErr) throw new Error(grantErr.message);

  const byUser = new Map<string, string[]>();
  for (const g of (grants ?? []) as { user_id: string; role: string }[]) {
    const list = byUser.get(g.user_id) ?? [];
    list.push(g.role);
    byUser.set(g.user_id, list);
  }

  return ((staff ?? []) as Record<string, string | null>[]).map((s) => ({
    staffId: s.id ?? null,
    userId: s.user_id ?? null,
    fullName: s.full_name ?? "Unnamed",
    workEmail: s.work_email ?? null,
    unitId: s.unit_id ?? null,
    positionId: s.position_id ?? null,
    employmentStatus: s.employment_status ?? null,
    roles: (s.user_id ? byUser.get(s.user_id) ?? [] : []).sort(),
  }));
}

/* ------------------------------------------------------------------ */
/* Access levels — role × permission                                   */
/* ------------------------------------------------------------------ */

export interface PermissionDefinition {
  key: string;
  domain: string;
  action: string;
  description: string | null;
}

export interface RolePermissionRow {
  role: string;
  permission_key: string;
}

export async function listPermissionCatalog(): Promise<PermissionDefinition[]> {
  const { data, error } = await db
    .from("staff_permissions")
    .select("key, domain, action, description")
    .order("domain", { ascending: true })
    .order("action", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PermissionDefinition[];
}

export async function listRolePermissions(): Promise<RolePermissionRow[]> {
  const { data, error } = await db.from("staff_role_permissions").select("role, permission_key");
  if (error) throw new Error(error.message);
  return (data ?? []) as RolePermissionRow[];
}

/** Dense lookup: `role::permission_key` → granted. */
export function permissionMatrix(rows: readonly RolePermissionRow[]): Set<string> {
  return new Set(rows.map((r) => `${r.role}::${r.permission_key}`));
}

export interface PermissionMutationResult {
  ok: boolean;
  reason?: string;
  denied?: boolean;
}

const denied = (message: string) =>
  /forbidden|row-level security|permission denied|42501/i.test(message);

/**
 * Grant or withdraw one permission for one role. The database is the
 * enforcement point: only a super admin's write survives row-level security.
 */
export async function setRolePermission(
  role: string,
  permissionKey: string,
  allowed: boolean,
): Promise<PermissionMutationResult> {
  const table = db.from("staff_role_permissions");
  const { error } = allowed
    ? await table.upsert({ role, permission_key: permissionKey }, { onConflict: "role,permission_key" })
    : await table.delete().eq("role", role).eq("permission_key", permissionKey);

  if (error) {
    console.error(
      `[staff_role_permissions] ${allowed ? "grant" : "withdraw"} rejected — role=${role} permission=${permissionKey} reason=${error.message}`,
    );
    return { ok: false, reason: error.message, denied: denied(error.message) };
  }

  // Audit trail. A failure to log is reported but does not undo the change,
  // which the database has already accepted.
  const { data: me } = await supabase.auth.getUser();
  await db.from("permission_change_log").insert({
    actor_id: me.user?.id ?? null,
    capability_key: permissionKey,
    action: allowed ? "grant" : "revoke",
    new_state: { role, permission_key: permissionKey, allowed },
    reason: `Access level ${allowed ? "granted to" : "withdrawn from"} ${role} in the admin portal`,
  });

  return { ok: true };
}

export interface PermissionChangeRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  capability_key: string | null;
  action: string | null;
  reason: string | null;
  new_state: Record<string, unknown> | null;
}

export async function listPermissionChanges(limit = 50): Promise<PermissionChangeRow[]> {
  const { data, error } = await db
    .from("permission_change_log")
    .select("id, created_at, actor_id, capability_key, action, reason, new_state")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PermissionChangeRow[];
}

/** Permission keys grouped by domain, for a readable matrix. */
export function groupPermissions(defs: readonly PermissionDefinition[]) {
  const map = new Map<string, PermissionDefinition[]>();
  for (const d of defs) {
    const list = map.get(d.domain) ?? [];
    list.push(d);
    map.set(d.domain, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export const humanise = (s: string) =>
  s.replace(/[_.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
