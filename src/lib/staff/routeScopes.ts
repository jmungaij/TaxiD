/**
 * Route-level authorization map for the staff portal.
 *
 * Every operational module declares the minimum data scope required to render
 * it. The shell uses this on EVERY navigation (including a pasted deep link) so
 * an out-of-scope URL always resolves to an explicit in-scope error state
 * instead of a partially rendered page. RLS remains the real boundary.
 */
import type { StaffScope } from "./access";

/** Longest matching prefix wins, so specific paths may tighten a section. */
export const STAFF_ROUTE_SCOPE: { prefix: string; scope: StaffScope }[] = [
  // Personal execution — available to any resolved employee.
  { prefix: "/staff/workspace", scope: "self" },
  { prefix: "/staff/communications", scope: "self" },
  { prefix: "/staff/onboarding", scope: "people_sensitive" },
  { prefix: "/staff", scope: "self" },

  // Daily operations
  { prefix: "/staff/board", scope: "department" },
  { prefix: "/staff/stream", scope: "department" },
  { prefix: "/staff/search", scope: "department" },

  // Yalla 360
  { prefix: "/staff/360", scope: "department" },
  { prefix: "/staff/customers", scope: "commercial" },
  { prefix: "/staff/marketplace", scope: "department" },
  { prefix: "/staff/revenue", scope: "commercial" },
  { prefix: "/staff/intelligence", scope: "department" },
  // A sales specialist works their OWN pipeline: personal scope, and row-level
  // security still limits the rows to the leads they own.
  { prefix: "/staff/sales", scope: "self" },

  // Organisation & people
  { prefix: "/staff/team", scope: "team" },
  { prefix: "/staff/dashboard", scope: "self" },
  { prefix: "/staff/org", scope: "department" },
  { prefix: "/staff/org/links", scope: "people_sensitive" },
  { prefix: "/staff/org/audit", scope: "enterprise" },
  { prefix: "/staff/organisation", scope: "department" },
  { prefix: "/staff/departments", scope: "department" },
  { prefix: "/staff/people", scope: "department" },
  { prefix: "/staff/workforce", scope: "department" },
  { prefix: "/staff/recruitment", scope: "department" },

  // Provider supply governance
  { prefix: "/staff/providers", scope: "department" },

  // Yalla Partners Operations System
  { prefix: "/staff/partners", scope: "commercial" },

  // Commercial engines
  { prefix: "/staff/commercial", scope: "commercial" },
  // Any employee may raise a proforma for their own deal; the database limits
  // the rows to the ones they own unless they hold wider commercial access.
  { prefix: "/staff/commercial/proforma", scope: "self" },
  { prefix: "/staff/commercial/invoices", scope: "self" },
  { prefix: "/staff/commercial/collections", scope: "self" },
  { prefix: "/staff/commercial/rate-cards", scope: "commercial" },
  { prefix: "/staff/commerce-os", scope: "commercial" },
  { prefix: "/staff/closure", scope: "financial" },
  { prefix: "/staff/control-tower", scope: "commercial" },
  { prefix: "/staff/ask-yalla", scope: "self" },
  { prefix: "/staff/orchestration", scope: "commercial" },
  { prefix: "/staff/adaptive-marketplace", scope: "commercial" },
  { prefix: "/staff/expansion", scope: "commercial" },

  // Automation & analysis
  { prefix: "/staff/operations", scope: "department" },
  { prefix: "/staff/workflow", scope: "department" },
  { prefix: "/staff/agentic", scope: "department" },
  { prefix: "/staff/adaptive", scope: "department" },
  { prefix: "/staff/value", scope: "department" },
  { prefix: "/staff/knowledge", scope: "self" },
  { prefix: "/staff/innovation", scope: "self" },

  // Governance & audit
  { prefix: "/staff/governance", scope: "enterprise" },
  { prefix: "/staff/forensics", scope: "enterprise" },
];

/** Minimum scope required to render the given staff path. */
export function requiredScopeForPath(pathname: string): StaffScope {
  let best: { prefix: string; scope: StaffScope } | null = null;
  for (const entry of STAFF_ROUTE_SCOPE) {
    const matches = pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`);
    if (!matches) continue;
    if (!best || entry.prefix.length > best.prefix.length) best = entry;
  }
  return best?.scope ?? "enterprise";
}

/** True when the held scopes satisfy the route's requirement. */
export function canOpenStaffPath(pathname: string, scopes: ReadonlySet<StaffScope>): boolean {
  return scopes.has(requiredScopeForPath(pathname));
}
