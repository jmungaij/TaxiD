/**
 * Granular super-admin capability matrix for the corporate control tower.
 *
 * Capability grants live in `corporate_admin_permission_grants` (role ×
 * capability × allowed) and are editable only by super admins. This module
 * holds the canonical catalog plus the pure merge/derivation logic so the UI
 * and tests share one definition.
 *
 * Grants are advisory *inside the admin console UI* — the edge function still
 * enforces role checks server-side, so a grant can never widen access beyond
 * what the role already permits.
 */

export const ADMIN_CAPABILITIES = [
  { key: "corporates.view", label: "View corporate portfolio", group: "Corporates" },
  { key: "corporates.bulk_action", label: "Run bulk account actions", group: "Corporates" },
  { key: "corporates.manage_as", label: "Start manage-as sessions", group: "Corporates" },
  { key: "approvals.view", label: "View approvals inbox", group: "Approvals" },
  { key: "approvals.decide", label: "Approve / reject trips", group: "Approvals" },
  { key: "bookings.view_queue", label: "View booking operations queue", group: "Bookings" },
  { key: "bookings.intervene", label: "Intervene & escalate bookings", group: "Bookings" },
  { key: "bookings.assisted", label: "Use assisted booking desk", group: "Bookings" },
  { key: "tickets.view", label: "View support ticket desk", group: "Support" },
  { key: "tickets.manage", label: "Create, note and resolve tickets", group: "Support" },
  { key: "alerts.manage_rules", label: "Manage alert rules", group: "Alerting" },
  { key: "audit.view", label: "View admin audit log", group: "Governance" },
  { key: "audit.export", label: "Export audit log", group: "Governance" },
  { key: "permissions.manage", label: "Edit the permissions matrix", group: "Governance" },
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number]["key"];

export const MATRIX_ROLES = [
  "super_admin",
  "admin",
  "finance_admin",
  "compliance_admin",
  "operations_admin",
] as const;

export type MatrixRole = (typeof MATRIX_ROLES)[number];

export const ROLE_LABEL: Record<MatrixRole, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  finance_admin: "Finance admin",
  compliance_admin: "Compliance admin",
  operations_admin: "Operations admin",
};

/** Baseline used when no explicit grant row exists yet. */
const DEFAULTS: Record<MatrixRole, AdminCapability[] | "all"> = {
  super_admin: "all",
  admin: [
    "corporates.view", "corporates.bulk_action", "corporates.manage_as",
    "approvals.view", "approvals.decide",
    "bookings.view_queue", "bookings.intervene", "bookings.assisted",
    "tickets.view", "tickets.manage", "alerts.manage_rules",
    "audit.view", "audit.export",
  ],
  finance_admin: [
    "corporates.view", "approvals.view", "approvals.decide",
    "bookings.view_queue", "tickets.view", "audit.view", "audit.export",
  ],
  compliance_admin: ["corporates.view", "bookings.view_queue", "tickets.view", "audit.view", "audit.export"],
  operations_admin: ["corporates.view", "bookings.view_queue", "bookings.intervene", "tickets.view", "tickets.manage"],
};

export function defaultAllowed(role: MatrixRole, capability: AdminCapability): boolean {
  const spec = DEFAULTS[role];
  if (spec === "all") return true;
  return spec.includes(capability);
}

export interface PermissionGrant {
  role: string;
  capability: string;
  allowed: boolean;
  updated_at?: string | null;
}

export type PermissionMatrix = Record<MatrixRole, Record<AdminCapability, boolean>>;

/** Merge stored grants over the baseline defaults into a dense matrix. */
export function buildMatrix(grants: PermissionGrant[]): PermissionMatrix {
  const stored = new Map(grants.map((g) => [`${g.role}::${g.capability}`, g.allowed]));
  const matrix = {} as PermissionMatrix;
  for (const role of MATRIX_ROLES) {
    matrix[role] = {} as Record<AdminCapability, boolean>;
    for (const cap of ADMIN_CAPABILITIES) {
      const explicit = stored.get(`${role}::${cap.key}`);
      matrix[role][cap.key] = explicit ?? defaultAllowed(role, cap.key);
    }
  }
  // Super admin retains every capability — the matrix cannot lock out governance.
  for (const cap of ADMIN_CAPABILITIES) matrix.super_admin[cap.key] = true;
  return matrix;
}

/** Capabilities available to a user holding the given platform roles. */
export function capabilitiesForRoles(matrix: PermissionMatrix, roles: readonly string[]): Set<AdminCapability> {
  const out = new Set<AdminCapability>();
  for (const role of roles) {
    if (!(MATRIX_ROLES as readonly string[]).includes(role)) continue;
    const row = matrix[role as MatrixRole];
    for (const cap of ADMIN_CAPABILITIES) if (row[cap.key]) out.add(cap.key);
  }
  return out;
}

export const CAPABILITY_GROUPS = [...new Set(ADMIN_CAPABILITIES.map((c) => c.group))];
