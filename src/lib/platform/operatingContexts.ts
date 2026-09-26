/**
 * Operating contexts — ONE Yalla identity, one canonical platform, multiple
 * authorized operating contexts.
 *
 * A context is never selected through public navigation. It is derived from the
 * authenticated identity's roles (sourced from `user_roles` and enforced by RLS
 * plus route-level `RequireRole`). This module only decides what the internal
 * chrome is allowed to OFFER; the server remains the authority.
 */

export type OperatingContextKey = "staff_operations" | "super_admin";

export interface OperatingContext {
  key: OperatingContextKey;
  label: string;
  description: string;
  /** Entry route for the context. */
  to: string;
  /** Roles that grant the context. */
  roles: readonly string[];
}

/** Roles carrying platform-control (Super Admin) authority. */
export const SUPER_ADMIN_ROLES = ["admin", "super_admin"] as const;

const STAFF_OPERATIONS_ROLES = [
  "admin",
  "super_admin",
  "finance_admin",
  "compliance_admin",
  "operations_admin",
  "operations_manager",
  "pricing_manager",
  "fleet_manager",
] as const;

export const OPERATING_CONTEXTS: OperatingContext[] = [
  {
    key: "staff_operations",
    label: "Staff Operations",
    description: "Human execution — work, cases, interventions",
    to: "/staff/workspace",
    roles: STAFF_OPERATIONS_ROLES,
  },
  {
    key: "super_admin",
    label: "Super Admin Control Center",
    description: "Platform administration, configuration and master control",
    to: "/dashboard/admin",
    roles: SUPER_ADMIN_ROLES,
  },
];

/** Contexts the held roles authorise, in presentation order. */
export function operatingContextsFor(roles: readonly string[]): OperatingContext[] {
  return OPERATING_CONTEXTS.filter((c) => c.roles.some((r) => roles.includes(r)));
}

export function hasSuperAdminAuthority(roles: readonly string[]): boolean {
  return SUPER_ADMIN_ROLES.some((r) => roles.includes(r));
}

/** True only when the identity may operate in more than one context. */
export function canSwitchOperatingContext(roles: readonly string[]): boolean {
  return operatingContextsFor(roles).length > 1;
}

/** Context implied by the current path, for active-state rendering. */
export function activeOperatingContext(pathname: string): OperatingContextKey | null {
  if (pathname.startsWith("/dashboard/admin")) return "super_admin";
  if (pathname.startsWith("/staff")) return "staff_operations";
  return null;
}
