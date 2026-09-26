/**
 * Charter Business Portal role-based access control.
 *
 * Procurement officers, approving officers and platform administrators share
 * one workspace but must never share one set of controls: a procurement officer
 * prepares and submits, an approving officer authorises and releases funds, an
 * administrator governs pricing. Capabilities are derived from the signed-in
 * user's granted roles only — never from client storage.
 */

export type CharterCapability =
  | "view_portal"
  | "plan_mission"
  | "edit_procurement"
  | "submit_for_approval"
  | "approve_step"
  | "view_budget"
  | "fund_wallet"
  | "view_pricing"
  | "edit_pricing";

export type CharterPortalRole = "procurement_officer" | "approving_officer" | "charter_admin" | "viewer";

const ROLE_CAPABILITIES: Record<CharterPortalRole, CharterCapability[]> = {
  procurement_officer: ["view_portal", "plan_mission", "edit_procurement", "submit_for_approval", "view_budget"],
  approving_officer: ["view_portal", "plan_mission", "edit_procurement", "submit_for_approval", "approve_step", "view_budget", "fund_wallet", "view_pricing"],
  charter_admin: [
    "view_portal", "plan_mission", "edit_procurement", "submit_for_approval", "approve_step",
    "view_budget", "fund_wallet", "view_pricing", "edit_pricing",
  ],
  viewer: ["view_portal"],
};

export const CHARTER_ROLE_LABEL: Record<CharterPortalRole, string> = {
  procurement_officer: "Procurement officer",
  approving_officer: "Approving officer",
  charter_admin: "Charter administrator",
  viewer: "Read-only guest",
};

export const CHARTER_ROLE_SCOPE: Record<CharterPortalRole, string> = {
  procurement_officer: "Prepare missions, maintain the procurement spine and submit for authorisation.",
  approving_officer: "Authorise each approval step, release wallet funds and view governed rates.",
  charter_admin: "Full governance including operator price settings and pricing consoles.",
  viewer: "Overview only — ask an administrator for a charter role.",
};

const ADMIN_ROLES = ["admin", "super_admin", "finance_admin", "charter_admin", "ops_admin"];
const APPROVER_ROLES = ["corporate_admin", "approving_officer", "corporate_approver"];
const PROCUREMENT_ROLES = ["corporate_employee", "procurement_officer", "corporate_procurement"];

/** Highest-privilege charter portal role implied by the granted role set. */
export function charterPortalRole(roles: string[]): CharterPortalRole {
  const set = new Set(roles);
  if (ADMIN_ROLES.some((r) => set.has(r))) return "charter_admin";
  if (APPROVER_ROLES.some((r) => set.has(r))) return "approving_officer";
  if (PROCUREMENT_ROLES.some((r) => set.has(r))) return "procurement_officer";
  return "viewer";
}

export interface CharterPortalAccess {
  role: CharterPortalRole;
  label: string;
  scope: string;
  capabilities: CharterCapability[];
  can: (capability: CharterCapability) => boolean;
}

export function charterPortalAccess(roles: string[]): CharterPortalAccess {
  const role = charterPortalRole(roles);
  const capabilities = ROLE_CAPABILITIES[role];
  return {
    role,
    label: CHARTER_ROLE_LABEL[role],
    scope: CHARTER_ROLE_SCOPE[role],
    capabilities,
    can: (capability) => capabilities.includes(capability),
  };
}
