/**
 * Staff 360 access governance.
 *
 * An employee never sees data merely because it exists. Access is the
 * intersection of platform role, department scope and data-sensitivity class.
 * Server-side RLS remains the enforcement boundary — this module governs what
 * the internal UI offers, so no surface implies access it cannot obtain.
 */

/** Platform roles that may enter the staff portal at all. */
export const STAFF_ROLES = [
  "admin",
  "super_admin",
  "director",
  "general_manager",
  "finance_admin",
  "compliance_admin",
  "operations_admin",
  "operations_manager",
  "pricing_manager",
  "fleet_manager",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/** Data-sensitivity classes controlling module visibility. */
export type StaffScope =
  | "self"
  | "team"
  | "department"
  | "enterprise"
  | "commercial"
  | "financial"
  | "people_sensitive";

const SCOPE_BY_ROLE: Record<StaffRole, StaffScope[]> = {
  super_admin: [
    "self",
    "team",
    "department",
    "enterprise",
    "commercial",
    "financial",
    "people_sensitive",
  ],
  // `admin` runs the staff-identity repair flows (/staff/org/links), so it holds
  // people_sensitive. RLS remains the enforcement boundary for the data itself.
  admin: ["self", "team", "department", "enterprise", "commercial", "people_sensitive"],
  // Board-level oversight: sees the enterprise, commercial and financial picture.
  director: ["self", "team", "department", "enterprise", "commercial", "financial"],
  // Runs the business day to day across every department.
  general_manager: ["self", "team", "department", "enterprise", "commercial", "financial"],
  finance_admin: ["self", "team", "department", "commercial", "financial"],
  compliance_admin: ["self", "team", "department", "enterprise"],
  operations_admin: ["self", "team", "department", "enterprise"],
  operations_manager: ["self", "team", "department"],
  pricing_manager: ["self", "team", "department", "commercial"],
  fleet_manager: ["self", "team", "department"],
};

export function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/** True when any held role grants staff-portal entry. */
export function canEnterStaffPortal(roles: readonly string[]): boolean {
  return roles.some(isStaffRole);
}

/** Union of scopes granted by the roles held. */
export function scopesForRoles(roles: readonly string[]): Set<StaffScope> {
  const out = new Set<StaffScope>();
  for (const r of roles) {
    if (!isStaffRole(r)) continue;
    for (const s of SCOPE_BY_ROLE[r]) out.add(s);
  }
  return out;
}

export function hasScope(roles: readonly string[], scope: StaffScope): boolean {
  return scopesForRoles(roles).has(scope);
}

/** Governance controls advertised on the portal's governance surface. */
export const GOVERNANCE_CONTROLS = [
  "Role-based access control",
  "Department-based access",
  "Position-based authority",
  "Approval limits",
  "Data scope",
  "Geographic scope",
  "Audit trails",
  "AI audit",
  "Sensitive HR data controls",
  "Commercial data controls",
  "Financial controls",
] as const;

/** Entity classes reachable through Yalla Universal Search, subject to scope. */
export const UNIVERSAL_SEARCH_ENTITIES = [
  { label: "Employees", scope: "department" satisfies StaffScope },
  { label: "Departments", scope: "department" satisfies StaffScope },
  { label: "Customers", scope: "commercial" satisfies StaffScope },
  { label: "Leads", scope: "commercial" satisfies StaffScope },
  { label: "Opportunities", scope: "commercial" satisfies StaffScope },
  { label: "Contracts", scope: "commercial" satisfies StaffScope },
  { label: "Bookings", scope: "department" satisfies StaffScope },
  { label: "Orders", scope: "department" satisfies StaffScope },
  { label: "Transactions", scope: "financial" satisfies StaffScope },
  { label: "Marketplace partners", scope: "department" satisfies StaffScope },
  { label: "Operators", scope: "department" satisfies StaffScope },
  { label: "Documents", scope: "department" satisfies StaffScope },
  { label: "Tasks", scope: "self" satisfies StaffScope },
  { label: "Projects", scope: "team" satisfies StaffScope },
  { label: "Policies", scope: "self" satisfies StaffScope },
  { label: "Knowledge", scope: "self" satisfies StaffScope },
];
