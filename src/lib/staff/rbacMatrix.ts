/**
 * Staff RBAC matrix — the presentation-side contract between a granted staff
 * role, the permissions it carries, and the dashboards it may open.
 *
 * Built from the existing sources of truth:
 *  • `STAFF_ROLES` / `SCOPE_BY_ROLE` in `@/lib/staff/access` (data sensitivity)
 *  • the route registry in `@/lib/routes` (which paths exist)
 *
 * This matrix decides what the Staff Access gateway OFFERS. It never grants:
 * `RequireStaffPortal` re-checks identity, and RLS + SECURITY DEFINER RPCs
 * re-check the caller server-side on every read and write.
 */

import { STAFF_ROLES, type StaffRole, type StaffScope, scopesForRoles } from "@/lib/staff/access";

/** Coarse-grained permissions used for the access matrix and its UI. */
export type StaffPermission =
  | "work.execute"
  | "ops.command"
  | "commercial.manage"
  | "pricing.govern"
  | "finance.close"
  | "compliance.audit"
  | "people.manage"
  | "fleet.manage"
  | "platform.administer";

export const PERMISSION_LABEL: Record<StaffPermission, string> = {
  "work.execute": "Execute assigned work",
  "ops.command": "Operate the command board",
  "commercial.manage": "Manage commercial pipeline",
  "pricing.govern": "Govern pricing & fares",
  "finance.close": "Close the financial period",
  "compliance.audit": "Audit & compliance review",
  "people.manage": "Manage people records",
  "fleet.manage": "Manage fleet & assets",
  "platform.administer": "Administer the platform",
};

export interface StaffWorkspaceLink {
  to: string;
  label: string;
  desc: string;
}

export interface StaffRoleDefinition {
  role: StaffRole;
  label: string;
  mandate: string;
  /** Where this role lands immediately after authentication. */
  home: string;
  permissions: StaffPermission[];
  /** Dashboards offered to this role on the access gateway. */
  workspaces: StaffWorkspaceLink[];
}

const W = {
  workspace: { to: "/staff/workspace", label: "My Workspace", desc: "Personal cockpit: focus, promises, day plan" },
  board: { to: "/staff/board", label: "Operations Command Board", desc: "Live operational state and interventions" },
  operations: { to: "/staff/operations", label: "Operations Command", desc: "Dispatch, supply and service execution" },
  staff360: { to: "/staff/360", label: "Staff 360", desc: "Organisation, people and performance model" },
  customers: { to: "/staff/customers", label: "Customer 360", desc: "Accounts, commitments and journeys" },
  commercial: { to: "/staff/commercial/charter", label: "Commercial Desk", desc: "Charter quotations and contracts" },
  commerce: { to: "/staff/commerce-os", label: "Commerce OS", desc: "Rate cards, fares and commercial terms" },
  closure: { to: "/staff/closure", label: "Economic Closure", desc: "Revenue, tax and settlement closure" },
  revenue: { to: "/staff/revenue", label: "Revenue Intelligence", desc: "Revenue quality and leakage signals" },
  governance: { to: "/staff/governance", label: "Staff Governance", desc: "Controls, audit trails and assurance" },
  forensics: { to: "/staff/forensics", label: "Operational Forensics", desc: "Evidence, lineage and reconstruction" },
  people: { to: "/staff/people", label: "People & Capability", desc: "Capability, ramp and readiness" },
  recruitment: { to: "/staff/recruitment", label: "Recruitment 360", desc: "Vacancies, pipeline and offers" },
  controlTower: { to: "/staff/control-tower", label: "Control Tower", desc: "Cross-domain mission control" },
  intelligence: { to: "/staff/intelligence", label: "Enterprise Intelligence", desc: "Enterprise-wide analytics" },
  admin: { to: "/dashboard/admin", label: "Super Admin Control Centre", desc: "Platform configuration and master control" },
} satisfies Record<string, StaffWorkspaceLink>;

/** The matrix. One entry per staff platform role. */
export const STAFF_RBAC: Record<StaffRole, StaffRoleDefinition> = {
  super_admin: {
    role: "super_admin",
    label: "Super Administrator",
    mandate: "Platform authority across every operating context.",
    home: "/staff/workspace",
    permissions: [
      "work.execute",
      "ops.command",
      "commercial.manage",
      "pricing.govern",
      "finance.close",
      "compliance.audit",
      "people.manage",
      "fleet.manage",
      "platform.administer",
    ],
    workspaces: [W.workspace, W.board, W.controlTower, W.staff360, W.customers, W.closure, W.governance, W.admin],
  },
  director: {
    role: "director",
    label: "Director",
    mandate: "Board-level oversight of enterprise performance and governance.",
    home: "/staff/intelligence",
    permissions: [
      "work.execute",
      "ops.command",
      "commercial.manage",
      "finance.close",
      "compliance.audit",
      "people.manage",
    ],
    workspaces: [W.intelligence, W.controlTower, W.closure, W.revenue, W.governance, W.customers, W.workspace],
  },
  general_manager: {
    role: "general_manager",
    label: "General Manager",
    mandate: "Runs the business day to day across every operating department.",
    home: "/staff/control-tower",
    permissions: [
      "work.execute",
      "ops.command",
      "commercial.manage",
      "people.manage",
      "fleet.manage",
    ],
    workspaces: [W.controlTower, W.board, W.operations, W.customers, W.commercial, W.people, W.workspace],
  },
  admin: {
    role: "admin",
    label: "Administrator",
    mandate: "Runs platform operations and staff identity repair.",
    home: "/staff/workspace",
    permissions: [
      "work.execute",
      "ops.command",
      "commercial.manage",
      "compliance.audit",
      "people.manage",
      "platform.administer",
    ],
    workspaces: [W.workspace, W.board, W.staff360, W.customers, W.people, W.governance, W.admin],
  },
  finance_admin: {
    role: "finance_admin",
    label: "Finance Administrator",
    mandate: "Owns revenue capture, settlement and period closure.",
    home: "/staff/closure",
    permissions: ["work.execute", "finance.close", "commercial.manage", "compliance.audit"],
    workspaces: [W.closure, W.revenue, W.commerce, W.customers, W.workspace, W.governance],
  },
  compliance_admin: {
    role: "compliance_admin",
    label: "Compliance Administrator",
    mandate: "Assurance, controls and evidence integrity.",
    home: "/staff/governance",
    permissions: ["work.execute", "compliance.audit", "ops.command"],
    workspaces: [W.governance, W.forensics, W.board, W.customers, W.workspace],
  },
  operations_admin: {
    role: "operations_admin",
    label: "Operations Administrator",
    mandate: "End-to-end service delivery across all mobility lines.",
    home: "/staff/board",
    permissions: ["work.execute", "ops.command", "fleet.manage"],
    workspaces: [W.board, W.operations, W.controlTower, W.customers, W.workspace],
  },
  operations_manager: {
    role: "operations_manager",
    label: "Operations Manager",
    mandate: "Daily execution for an assigned department or region.",
    home: "/staff/board",
    permissions: ["work.execute", "ops.command"],
    workspaces: [W.board, W.operations, W.workspace, W.customers],
  },
  pricing_manager: {
    role: "pricing_manager",
    label: "Pricing Manager",
    mandate: "Fares, rate cards and commercial pricing governance.",
    home: "/staff/commerce-os",
    permissions: ["work.execute", "pricing.govern", "commercial.manage"],
    workspaces: [W.commerce, W.commercial, W.revenue, W.workspace],
  },
  fleet_manager: {
    role: "fleet_manager",
    label: "Fleet Manager",
    mandate: "Vehicles, partners and asset readiness.",
    home: "/staff/operations",
    permissions: ["work.execute", "fleet.manage", "ops.command"],
    workspaces: [W.operations, W.board, W.workspace],
  },
};

/** Presentation order for the matrix (most authority first). */
export const STAFF_RBAC_ORDER: StaffRole[] = [
  "super_admin",
  "director",
  "general_manager",
  "admin",
  "finance_admin",
  "compliance_admin",
  "operations_admin",
  "operations_manager",
  "pricing_manager",
  "fleet_manager",
];

export function isKnownStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/** Role definitions for the roles actually held. */
export function definitionsForRoles(roles: readonly string[]): StaffRoleDefinition[] {
  return STAFF_RBAC_ORDER.filter((r) => roles.includes(r)).map((r) => STAFF_RBAC[r]);
}

/** Union of permissions carried by the roles held. */
export function permissionsForRoles(roles: readonly string[]): StaffPermission[] {
  const out = new Set<StaffPermission>();
  for (const def of definitionsForRoles(roles)) def.permissions.forEach((p) => out.add(p));
  return Array.from(out);
}

export function hasPermission(roles: readonly string[], permission: StaffPermission): boolean {
  return permissionsForRoles(roles).includes(permission);
}

/** Distinct dashboards offered to the roles held, de-duplicated by path. */
export function workspacesForRoles(roles: readonly string[]): StaffWorkspaceLink[] {
  const seen = new Map<string, StaffWorkspaceLink>();
  for (const def of definitionsForRoles(roles)) {
    for (const w of def.workspaces) if (!seen.has(w.to)) seen.set(w.to, w);
  }
  return Array.from(seen.values());
}

/** Data-sensitivity scopes the roles held unlock (from the access module). */
export function scopeSummary(roles: readonly string[]): StaffScope[] {
  return Array.from(scopesForRoles(roles));
}

/**
 * Landing route for the roles held: the highest-authority role's home.
 * Falls back to the personal cockpit for identity-only staff (no platform role).
 */
export function homeForRoles(roles: readonly string[]): string {
  const first = definitionsForRoles(roles)[0];
  return first?.home ?? "/staff/workspace";
}
