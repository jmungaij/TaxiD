/**
 * Corporate role helpers.
 *
 * The database stores only three canonical values for `corporate_employees.role`:
 *   - corporate_admin
 *   - corporate_manager
 *   - corporate_employee
 *
 * Historically the app (and some seed data) used shorter tokens like
 * "admin", "owner", "manager", "member", "employee", "user". This module
 * translates any legacy value into the canonical enum so every write to
 * `corporate_employees.role` is safe.
 */

export const CORPORATE_ROLES = [
  "corporate_admin",
  "corporate_manager",
  "corporate_employee",
] as const;

export type CorporateRole = (typeof CORPORATE_ROLES)[number];

/** Columns the AdminsPanel selects from `corporate_employees`. Keep in sync
 *  with `src/integrations/supabase/types.ts` — the unit tests assert this. */
export const CORPORATE_EMPLOYEE_SELECT_FIELDS = [
  "id",
  "full_name",
  "email",
  "created_at",
  "role",
] as const;

const LEGACY_ROLE_MAP: Record<string, CorporateRole> = {
  admin: "corporate_admin",
  owner: "corporate_admin",
  super_admin: "corporate_admin",
  superadmin: "corporate_admin",
  corporate_admin: "corporate_admin",

  manager: "corporate_manager",
  supervisor: "corporate_manager",
  team_lead: "corporate_manager",
  corporate_manager: "corporate_manager",

  employee: "corporate_employee",
  member: "corporate_employee",
  staff: "corporate_employee",
  user: "corporate_employee",
  corporate_employee: "corporate_employee",
};

/** Normalize any legacy role token to the canonical corporate role. */
export function normalizeCorporateRole(input: string | null | undefined): CorporateRole {
  if (!input) return "corporate_employee";
  const key = String(input).trim().toLowerCase();
  return LEGACY_ROLE_MAP[key] ?? "corporate_employee";
}

/** Human-friendly label for display. */
export function corporateRoleLabel(role: CorporateRole): string {
  switch (role) {
    case "corporate_admin":    return "Admin";
    case "corporate_manager":  return "Manager";
    case "corporate_employee": return "Employee";
  }
}

/** Type guard. */
export function isCorporateRole(v: unknown): v is CorporateRole {
  return typeof v === "string" && (CORPORATE_ROLES as readonly string[]).includes(v);
}
