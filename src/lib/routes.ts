// Single source of truth for every route in the app.
// Sidebars, route guards, and the navigation audit all read from here.
//
// IMPORTANT: keep this in sync with the <Route> table in src/App.tsx and the
// `app_pages` table in the database. The audit script (scripts/navigation-integrity.ts)
// cross-checks all three.

export type AppRole =
  | "rider"
  | "driver"
  | "corporate_admin"
  | "corporate_employee"
  | "admin"
  | "super_admin"
  | "director"
  | "general_manager"
  | "finance_admin"
  | "compliance_admin"
  // Commercial/operational roles used by charter, rental and logistics surfaces.
  | "operations_admin"
  | "operations_manager"
  | "charter_operator"
  | "fleet_manager"
  | "pricing_manager"
  // Corporate governance roles used by the Corporate Charter Business hub.
  | "corporate_finance"
  | "corporate_approver"
  | "corporate_manager"
  | "approving_officer"
  | "operator";


export type RouteGroup =
  | "marketing"
  | "auth"
  | "rider"
  | "driver"
  | "corporate"
  | "admin"
  | "legacy";

export type AdminCenter =
  | "home"
  | "executive"
  | "operations"
  | "drivers"
  | "riders"
  | "corporate"
  | "logistics"
  | "fleet"
  | "marketplace"
  | "flight_hub"
  | "finance"
  | "fraud"
  | "compliance"
  | "intelligence"
  | "system"
  | "super_admin";

export const ADMIN_CENTERS: { key: AdminCenter; label: string; order: number }[] = [
  { key: "home",         label: "Home",                   order: 0 },
  { key: "executive",    label: "Corporate Dashboard",    order: 1 },
  { key: "operations",   label: "Administration",         order: 2 },
  { key: "drivers",      label: "Driver Dashboard",       order: 3 },
  { key: "riders",       label: "Rider Dashboard",        order: 4 },
  { key: "corporate",    label: "Corporate Dashboard",    order: 5 },
  { key: "logistics",    label: "Delivery Dashboard",     order: 6 },
  { key: "fleet",        label: "Fleet Dashboard",        order: 7 },
  { key: "marketplace",  label: "Marketplace",            order: 8 },
  { key: "flight_hub",   label: "TaxiD Air · Flight Hub", order: 8.5 },
  { key: "finance",      label: "Finance Dashboard",      order: 9 },
  { key: "fraud",        label: "Trust & Safety",         order: 10 },
  { key: "compliance",   label: "Compliance & Audit",     order: 11 },
  { key: "intelligence", label: "Intelligence",           order: 12 },
  { key: "system",       label: "Platform",               order: 13 },
  { key: "super_admin",  label: "Super Admin",            order: 14 },
];

export interface RouteDef {
  path: string;
  title: string;
  group: RouteGroup;
  icon?: string;
  /** Empty array = public. Otherwise user must have at least one of these. */
  rolesAllowed: AppRole[];
  /** Show in sidebar for matching role? */
  showInSidebar?: boolean;
  /** Surface this route in the marketing footer. */
  showInFooter?: boolean;
  /** Surface this route in the marketing primary navbar. */
  showInNavbar?: boolean;
  sortOrder?: number;
  /** Admin command center this route belongs to (admin group only). */
  center?: AdminCenter;
  /** Hide from sitemap.xml (auth/private routes). */
  hideFromSitemap?: boolean;
  /** Internal alias / legacy route — excluded from navigation audit orphan list. */
  internalAlias?: boolean;
}

/**
 * Compile-time exhaustiveness helper. Use inside a switch's `default` branch
 * to force TypeScript to prove every union variant has been handled — a new
 * `AdminCenter` / `AppRole` value will surface as a type error at the call
 * site instead of a silent runtime miss. See Phase 1 of `.lovable/plan.md`.
 */
export function assertExhaustive(x: never, message = "Unhandled variant"): never {
  throw new Error(`${message}: ${JSON.stringify(x)}`);
}

/**
 * Brand a `RouteDef[]` so callers cannot smuggle in a bare object literal
 * without going through this module. Keeps the registry as the sole source
 * of truth even when other files import `RouteDef` directly.
 */
export type RouteRegistry = ReadonlyArray<RouteDef> & { readonly __brand: "RouteRegistry" };
function defineRoutes(routes: RouteDef[]): RouteRegistry {
  // Fail-fast duplicate-path guard — runs once at module load.
  const seen = new Set<string>();
  for (const r of routes) {
    if (seen.has(r.path)) throw new Error(`Duplicate route path in registry: ${r.path}`);
    seen.add(r.path);
  }
  return routes as unknown as RouteRegistry;
}



/**
 * Canonical role set for the TaxiD Staff Portal (/staff/*). Route-level entry is
 * additionally gated server-side by the staff identity guard (RequireStaffPortal).
 */
export const STAFF_PORTAL_ROLES: AppRole[] = [
  "admin",
  "super_admin",
  "finance_admin",
  "compliance_admin",
  "operations_admin",
  "operations_manager",
  "pricing_manager",
  "fleet_manager",
];

export const ROUTES: RouteRegistry = defineRoutes([

  // ---------- Marketing ----------
  { path: "/",           title: "Home",       group: "marketing", icon: "Home",        rolesAllowed: [], sortOrder: 10 },
  { path: "/about",      title: "About",      group: "marketing", icon: "Info",        rolesAllowed: [], showInFooter: true, sortOrder: 20 },
  { path: "/riders",     title: "Riders",     group: "marketing", icon: "User",        rolesAllowed: [], showInFooter: true, sortOrder: 30 },
  { path: "/drivers",    title: "Drivers",    group: "marketing", icon: "Car",         rolesAllowed: [], showInFooter: true, sortOrder: 40 },
  { path: "/corporates", title: "Corporates", group: "marketing", icon: "Building",    rolesAllowed: [], showInFooter: true, sortOrder: 50 },
  { path: "/business/portal", title: "Power Business Portal", group: "marketing", icon: "Building", rolesAllowed: [], sortOrder: 51, hideFromSitemap: true },
  { path: "/delivery",   title: "Delivery",   group: "marketing", icon: "Package",     rolesAllowed: [], showInFooter: true, sortOrder: 60 },
  { path: "/rentals",    title: "Rentals",    group: "marketing", icon: "Key",         rolesAllowed: [], showInFooter: true, sortOrder: 70 },
  { path: "/staff",       title: "Staff Access", group: "marketing", icon: "Users", rolesAllowed: [], showInFooter: true, sortOrder: 72 },
  { path: "/staff/access", title: "Staff Operations Secure Access", group: "marketing", icon: "ShieldCheck", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 73 },
  { path: "/staff/workspace", title: "My Workspace", group: "admin", rolesAllowed: ["admin","super_admin","director","general_manager","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 71 },
  { path: "/staff/workspace/work-queue",    title: "Work Queue",              group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.1, hideFromSitemap: true },
  { path: "/staff/workspace/exceptions",    title: "Exception Centre",        group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.2, hideFromSitemap: true },
  { path: "/staff/workspace/meetings",      title: "Meeting Intelligence",    group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.3, hideFromSitemap: true },
  { path: "/staff/workspace/inbox",         title: "Workspace Inbox",         group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.4, hideFromSitemap: true },
  { path: "/staff/workspace/book",          title: "Commercial Book",         group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.5, hideFromSitemap: true },
  { path: "/staff/workspace/approvals",     title: "Commercial Approvals",    group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.6, hideFromSitemap: true },
  { path: "/staff/workspace/accounts",      title: "My Accounts",             group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.7, hideFromSitemap: true },
  // Client contract portal: the link token is the credential, so the surface is
  // publicly reachable but never indexed and never linked from navigation.
  { path: "/contract-portal",               title: "Client Contract Portal",  group: "auth", rolesAllowed: [], sortOrder: 99, hideFromSitemap: true },
  { path: "/staff/workspace/opportunities", title: "My Opportunities",        group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.8, hideFromSitemap: true },
  { path: "/staff/workspace/pipeline",      title: "Pipeline Inspection",     group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.85, hideFromSitemap: true },
  { path: "/staff/workspace/field",         title: "Field Mode",              group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.86, hideFromSitemap: true },
  { path: "/staff/workspace/quotes",        title: "My Quotes & Proposals",   group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 71.9, hideFromSitemap: true },
  { path: "/staff/workspace/contracts",     title: "My Contracts",            group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72.0, hideFromSitemap: true },
  { path: "/staff/workspace/activation",    title: "Activation Plan",         group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72.1, hideFromSitemap: true },
  { path: "/staff/sales/manager-desk",      title: "Sales Manager Desk",      group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72.15, hideFromSitemap: true },
  { path: "/staff/dashboard", title: "Role Dashboard", group: "admin", rolesAllowed: ["admin","super_admin","director","general_manager","finance_admin","operations_admin","operations_manager","fleet_manager"], sortOrder: 70 },
  { path: "/staff/calendar", title: "Calendar", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 70.5, hideFromSitemap: true },
  { path: "/staff/admin", title: "Admin Portal", group: "admin", rolesAllowed: ["admin","super_admin"], sortOrder: 70.6, hideFromSitemap: true },
  { path: "/staff/onboarding", title: "Staff Onboarding", group: "admin", rolesAllowed: ["admin","super_admin"], sortOrder: 71 },
  { path: "/staff/communications", title: "Communication Centre", group: "admin", rolesAllowed: ["admin","super_admin","director","general_manager","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 71 },
  { path: "/staff/team", title: "My Team", group: "admin", rolesAllowed: ["admin","super_admin","director","general_manager","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 71 },
  { path: "/staff/board", title: "Operations Command Board", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 71 },
  { path: "/staff/stream", title: "Orchestration Stream", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 71 },
  { path: "/staff/360", title: "Staff 360", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },

  { path: "/staff/workforce/blueprints", title: "Role Blueprints", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/workforce/launchpad", title: "Workforce Launchpad", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/partners", title: "TaxiD Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/apply", title: "Become a TaxiD Partner", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  /* Partner segment landing pages — one per entry in the Partner Capability
     Registry (src/lib/partners/taxonomy.ts), all served by /partners/:segment. */
  { path: "/partners/travel-tourism", title: "Travel & Tourism Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/hospitality", title: "Hospitality Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/corporate", title: "Corporate & Institutional Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/commerce-retail", title: "Commerce & Retail Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/events-destinations", title: "Events & Destination Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/referral-distribution", title: "Referral & Distribution Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/drivers", title: "Driver Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/fleet-operators", title: "Fleet Operators", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/charter-operators", title: "Charter Operators", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/logistics-carriers", title: "Logistics & Carrier Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/rental-leasing", title: "Rental & Leasing Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/api", title: "API Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/white-label", title: "White-Label Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/technology", title: "Technology & Platform Partners", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/partners/api/console", title: "API Developer Console", group: "marketing", rolesAllowed: [], sortOrder: 74, hideFromSitemap: true },
  { path: "/partners/white-label/workspace", title: "White-Label Tenant Workspace", group: "marketing", rolesAllowed: [], sortOrder: 74, hideFromSitemap: true },
  { path: "/partner/workspace", title: "Partner Workspace", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/provider/capacity", title: "Provider Capacity", group: "marketing", rolesAllowed: [], sortOrder: 74 },
  { path: "/operator", title: "Operator Portal", group: "marketing", rolesAllowed: [], sortOrder: 75 },
  { path: "/staff/providers", title: "Provider Supply Review", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 73 },
  { path: "/partner/fleet-owner", title: "Fleet Owner Portal", group: "marketing", rolesAllowed: [], sortOrder: 74.05, hideFromSitemap: true },
  { path: "/partner/fleet-owner/apply", title: "Become a Fleet Owner", group: "marketing", rolesAllowed: [], sortOrder: 74.1 },
  { path: "/partner/fleet-owner/onboarding", title: "Fleet Owner Onboarding", group: "marketing", rolesAllowed: [], sortOrder: 74.2 },
  { path: "/partner/fleet-owner/delivery-evidence", title: "Fleet Owner Delivery Evidence", group: "marketing", rolesAllowed: [], sortOrder: 74.3 },
  { path: "/partner/freight", title: "Carrier Freight Workspace", group: "marketing", rolesAllowed: [], sortOrder: 74.5 },
  { path: "/staff/partners", title: "TaxiD Partners Operations", group: "admin", icon: "Handshake", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72 },
  { path: "/staff/partners/:partnerId", title: "TaxiD Partners 360", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72 },
  { path: "/staff/interns", title: "Interns 360", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin"], sortOrder: 72 },
  { path: "/staff/interns/cohorts", title: "Intern Cohorts", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin"], sortOrder: 72 },
  { path: "/staff/interns/register", title: "Intern Register", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin"], sortOrder: 72 },
  { path: "/staff/interns/talent", title: "Talent Discovery", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin"], sortOrder: 72 },
  { path: "/staff/interns/governance", title: "Intern Integrity & Audit", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin"], sortOrder: 72 },
  { path: "/staff/organisation", title: "Organisation", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/departments", title: "Departments", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/revenue", title: "Revenue Intelligence", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/marketplace", title: "Marketplace 360", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/customers", title: "Customer 360", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/customers/accounts", title: "Account 360", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/people", title: "People & Capability", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/knowledge", title: "TaxiD Knowledge", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/innovation", title: "Innovation Lab", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/intelligence", title: "Enterprise Intelligence", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/operations", title: "Operations Command", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/agentic", title: "Agentic TaxiD", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/staff/governance", title: "Staff Governance", group: "admin", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin","operations_manager","pricing_manager","fleet_manager"], sortOrder: 72 },
  { path: "/charter",    title: "Charter Business", group: "marketing", icon: "Plane", rolesAllowed: [], showInFooter: true, sortOrder: 71 },
  { path: "/charter/aircraft-charter",        title: "Private Aircraft Charter",   group: "marketing", rolesAllowed: [], sortOrder: 711 },
  { path: "/charter/helicopter-charter",      title: "Helicopter Charter",         group: "marketing", rolesAllowed: [], sortOrder: 712 },
  { path: "/charter/bus-charter",             title: "Bus, Van & Coach Charter",   group: "marketing", rolesAllowed: [], sortOrder: 713 },
  { path: "/charter/marine-charter",          title: "Boat & Ship Charter",        group: "marketing", rolesAllowed: [], sortOrder: 714 },

  { path: "/charter/aircraft-leasing",        title: "Aircraft Leasing",           group: "marketing", rolesAllowed: [], sortOrder: 714 },
  { path: "/charter/heavy-machinery-leasing", title: "Heavy Machinery Leasing",    group: "marketing", rolesAllowed: [], sortOrder: 715 },
  { path: "/charter/truck-hauler-leasing",    title: "Truck, Lorry & Hauler Leasing", group: "marketing", rolesAllowed: [], sortOrder: 716 },
  { path: "/charter/car-rentals",             title: "Car Rentals",                group: "marketing", rolesAllowed: [], sortOrder: 717 },
  { path: "/charter/equipment-rentals",       title: "Equipment Rentals",          group: "marketing", rolesAllowed: [], sortOrder: 718 },
  { path: "/charter/event-rentals",           title: "Event Rentals",              group: "marketing", rolesAllowed: [], sortOrder: 719 },
  { path: "/charter/booking-status",          title: "Charter Booking Status",     group: "marketing", rolesAllowed: [], sortOrder: 720 },
  { path: "/charter/:slug/book",              title: "Charter Booking",            group: "marketing", rolesAllowed: [], sortOrder: 720 },
  { path: "/verify",                          title: "Document Verification",      group: "marketing", rolesAllowed: [], sortOrder: 721 },
  { path: "/charter/search",                  title: "Charter Search",             group: "marketing", rolesAllowed: [], sortOrder: 722 },
  { path: "/marketplace",                     title: "Marketplace Search",         group: "marketing", icon: "Search", rolesAllowed: [], showInFooter: true, sortOrder: 76 },
  { path: "/charter/smartfare",               title: "SmartFare Pricing Explorer", group: "marketing", rolesAllowed: [], sortOrder: 723 },
  { path: "/charter/login",                   title: "Charter Partner Sign In",    group: "marketing", rolesAllowed: [], sortOrder: 724, hideFromSitemap: true, internalAlias: true },
  // Canonical redirect aliases (implemented as <Navigate> in App.tsx). Declared so
  // the registry and the router agree, and excluded from the sitemap.
  { path: "/charter/bus",                     title: "Bus Charter (redirect)",     group: "marketing", rolesAllowed: [], sortOrder: 724.2, hideFromSitemap: true, internalAlias: true },
  { path: "/delivery/track",                  title: "Track a Parcel (redirect)",  group: "marketing", rolesAllowed: [], sortOrder: 724.3, hideFromSitemap: true, internalAlias: true },
  { path: "/carrier-applications",            title: "Carrier Applications (redirect)", group: "marketing", rolesAllowed: [], sortOrder: 724.4, hideFromSitemap: true, internalAlias: true },
  { path: "/inspect",                         title: "Ticket Inspector",           group: "marketing", rolesAllowed: [], sortOrder: 725, hideFromSitemap: true, internalAlias: true },
  { path: "/health",                          title: "Deployment Health",          group: "marketing", rolesAllowed: [], sortOrder: 726, hideFromSitemap: true, internalAlias: true },
  { path: "/design/status-tokens",             title: "Status Token Gallery",       group: "marketing", rolesAllowed: [], sortOrder: 728, hideFromSitemap: true, internalAlias: true },
  { path: "/deploy-smoke",                    title: "Post-Deploy Smoke Test",     group: "marketing", rolesAllowed: [], sortOrder: 727, hideFromSitemap: true, internalAlias: true },
  { path: "/dashboard/admin/aviation-center", title: "Aviation & Charter Center", group: "admin", icon: "Plane", rolesAllowed: ["admin","super_admin"], center: "flight_hub", sortOrder: 730 },
  { path: "/dashboard/admin/charter-booking-audit", title: "Charter Booking Change Audit", group: "admin", icon: "FileSearch", rolesAllowed: ["admin","super_admin","compliance_admin"], center: "flight_hub", sortOrder: 731 },
  { path: "/dashboard/admin/charter-pricing-alerts", title: "Charter Pricing Alerts", group: "admin", icon: "AlertTriangle", rolesAllowed: ["admin","super_admin","finance_admin"], center: "flight_hub", sortOrder: 732 },
  { path: "/dashboard/admin/charter-retry-timeline", title: "Charter Payment Retry Timeline", group: "admin", icon: "History", rolesAllowed: ["admin","super_admin","finance_admin"], center: "flight_hub", sortOrder: 733 },
  { path: "/dashboard/admin/road-approval-queue", title: "Road Charter Approval Queue", group: "admin", icon: "BusFront", rolesAllowed: ["admin","super_admin","finance_admin","operations_admin"], center: "flight_hub", sortOrder: 734 },

  // ---------- Charter, Leasing & Rentals · pricing governance ----------
  { path: "/dashboard/admin/rental-fleet",       title: "Rental Fleet",             group: "admin", icon: "CarFront",         rolesAllowed: ["admin","super_admin","finance_admin","pricing_manager"], center: "marketplace", sortOrder: 738.5 },
  { path: "/dashboard/admin/rental-operations",  title: "Rental Operations",        group: "admin", icon: "ShieldCheck",      rolesAllowed: ["admin","super_admin","finance_admin","pricing_manager"], center: "marketplace", sortOrder: 738.6 },
  { path: "/dashboard/admin/pricing-360",        title: "Pricing 360",              group: "admin", icon: "Coins",            rolesAllowed: ["admin","super_admin","finance_admin","pricing_manager"], center: "marketplace", sortOrder: 739 },
  { path: "/dashboard/admin/pricing-audit-log",  title: "Pricing Audit Log",        group: "admin", icon: "ScrollText",       rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin"], center: "marketplace", sortOrder: 739.5 },
  { path: "/dashboard/admin/identity-trust", title: "Identity & Trust Plane", group: "admin", icon: "ShieldCheck", rolesAllowed: ["admin","super_admin","compliance_admin"], center: "system", sortOrder: 838 },
  { path: "/dashboard/admin/social-distribution", title: "Social Distribution",     group: "admin", icon: "Share2",           rolesAllowed: ["admin","super_admin"], center: "marketplace", sortOrder: 739.7 },
  { path: "/dashboard/admin/role-grant-governance", title: "Role Grant Governance", group: "admin", icon: "ShieldCheck",      rolesAllowed: ["admin","super_admin"], center: "executive", sortOrder: 739.8 },
  { path: "/dashboard/admin/email-delivery",      title: "Email Delivery Operations", group: "admin", icon: "Mail",           rolesAllowed: ["admin","super_admin","operations_admin","compliance_admin"], center: "operations", sortOrder: 739.9 },
  { path: "/dashboard/admin/asset-pricing",      title: "Asset Pricing Profiles",   group: "admin", icon: "SlidersHorizontal", rolesAllowed: ["admin","super_admin","finance_admin","pricing_manager"], center: "marketplace", sortOrder: 740, internalAlias: true },
  { path: "/dashboard/admin/smartfare-pricing",  title: "SmartFare Settings",       group: "admin", icon: "Calculator",       rolesAllowed: ["admin","super_admin","finance_admin"], center: "marketplace", sortOrder: 741 },
  { path: "/dashboard/admin/smartfare-versions", title: "SmartFare Version Diff",   group: "admin", icon: "GitBranch",        rolesAllowed: ["admin","super_admin","finance_admin"], center: "marketplace", sortOrder: 742 },
  { path: "/dashboard/admin/smartfare-what-if",  title: "SmartFare What-If",        group: "admin", icon: "Brain",            rolesAllowed: ["admin","super_admin","finance_admin"], center: "marketplace", sortOrder: 743 },
  { path: "/dashboard/charter/analytics",        title: "Charter Analytics",        group: "admin", icon: "BarChart3",        rolesAllowed: ["admin","super_admin","operations_admin","operations_manager","charter_operator","fleet_manager"], center: "marketplace", sortOrder: 744 },
  { path: "/dashboard/charter/operator-portal",  title: "Charter Operator Portal",  group: "admin", icon: "Building",         rolesAllowed: ["admin","super_admin","operations_admin","driver","operator"], center: "marketplace", sortOrder: 745 },
  { path: "/dashboard/charter/portal",           title: "Charter Business Portal",  group: "admin", icon: "Briefcase",        rolesAllowed: ["admin","super_admin","finance_admin","operations_admin","corporate_admin","charter_operator"], center: "marketplace", sortOrder: 739 },

  // ---------- Corporate Charter Business (merged flagship hub) ----------
  { path: "/dashboard/corporate-charter",        title: "Corporate Charter Business", group: "admin", icon: "Building2",      rolesAllowed: ["admin","super_admin","finance_admin","operations_admin","operations_manager","corporate_admin","corporate_finance","corporate_approver","corporate_manager","charter_operator","fleet_manager","approving_officer","pricing_manager"], center: "marketplace", sortOrder: 735 },
  { path: "/dashboard/admin/ccb-operations",     title: "CCB Operations Centre",      group: "admin", icon: "Radar",          rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","corporate_admin"], center: "marketplace", sortOrder: 736 },
  { path: "/dashboard/premium",                  title: "Elite Premium Cockpit",      group: "admin", icon: "Crown",          rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","corporate_admin"], center: "marketplace", sortOrder: 737 },
  // Signed-in explainer surface for tier-blocked users — never public.
  { path: "/dashboard/premium/upgrade",          title: "Premium Access Required",    group: "admin", icon: "Lock",           rolesAllowed: ["rider","driver","corporate_employee","corporate_manager","corporate_approver","corporate_finance","corporate_admin","operations_admin","operations_manager","charter_operator","fleet_manager","pricing_manager","approving_officer","operator","finance_admin","compliance_admin","admin","super_admin"], center: "marketplace", sortOrder: 738, internalAlias: true },



  // ---------- Platform / Trust additions ----------
  { path: "/dashboard/admin/alert-preferences",  title: "Alert Notification Preferences", group: "admin", icon: "Mail",       rolesAllowed: ["admin","super_admin"], center: "system", sortOrder: 746 },
  { path: "/dashboard/admin/security-findings",  title: "Security Findings",        group: "admin", icon: "ShieldAlert",      rolesAllowed: ["admin","super_admin"], center: "compliance", sortOrder: 747 },



  // ---------- TaxiD Air · Flight Hub ----------
  { path: "/dashboard/admin/flight-hub",           title: "Flight Hub",                  group: "admin", icon: "PlaneTakeoff", rolesAllowed: ["admin","super_admin"], center: "flight_hub", showInSidebar: true, sortOrder: 700 },
  { path: "/dashboard/admin/flight-hub/console",   title: "Flights Console",             group: "admin", icon: "Radar",        rolesAllowed: ["admin","super_admin"], center: "flight_hub", sortOrder: 701 },
  { path: "/dashboard/admin/flight-hub/partners",  title: "Flight Partner Onboarding",   group: "admin", icon: "Handshake",    rolesAllowed: ["admin","super_admin"], center: "flight_hub", sortOrder: 702 },
  { path: "/dashboard/admin/flight-hub/lifecycle", title: "Flight Lifecycle",            group: "admin", icon: "GitBranch",    rolesAllowed: ["admin","super_admin"], center: "flight_hub", sortOrder: 703 },
  { path: "/dashboard/admin/flight-hub/payments",  title: "Aviation Payment System",     group: "admin", icon: "Wallet",       rolesAllowed: ["admin","super_admin","finance_admin"], center: "flight_hub", sortOrder: 704 },
  { path: "/dashboard/admin/flight-hub/pricing",   title: "Dynamic Pricing Control",     group: "admin", icon: "Calculator",   rolesAllowed: ["admin","super_admin","finance_admin"], center: "flight_hub", sortOrder: 704.5 },
  { path: "/dashboard/admin/flight-hub/payouts",   title: "Operator Payout Breakdown",   group: "admin", icon: "Receipt",      rolesAllowed: ["admin","super_admin","finance_admin"], center: "flight_hub", sortOrder: 704.7 },
  { path: "/dashboard/admin/flight-hub/compliance",title: "Aviation Compliance",         group: "admin", icon: "ShieldCheck",  rolesAllowed: ["admin","super_admin","compliance_admin"], center: "flight_hub", sortOrder: 705 },
  { path: "/dashboard/admin/flight-hub/relations", title: "Customer Operations & Relations", group: "admin", icon: "Users",    rolesAllowed: ["admin","super_admin"], center: "flight_hub", sortOrder: 706 },
  { path: "/dashboard/admin/flight-hub/operations", title: "Aviation Operations Center", group: "admin", icon: "Headset",   rolesAllowed: ["admin","super_admin"], center: "flight_hub", sortOrder: 706.5 },
  { path: "/dashboard/admin/flight-hub/support",   title: "Aviation Support Desk",       group: "admin", icon: "LifeBuoy",     rolesAllowed: ["admin","super_admin"], center: "flight_hub", sortOrder: 707 },


  { path: "/pricing",    title: "Pricing",    group: "marketing", icon: "Tag",         rolesAllowed: [], showInFooter: true, sortOrder: 80 },
  { path: "/faq",        title: "FAQ",        group: "marketing", icon: "HelpCircle",  rolesAllowed: [], showInFooter: true, sortOrder: 90 },
  { path: "/news",       title: "News",       group: "marketing", icon: "Newspaper",   rolesAllowed: [], showInFooter: true, sortOrder: 100 },
  { path: "/careers",    title: "Careers",    group: "marketing", icon: "Briefcase",   rolesAllowed: [], showInFooter: true, sortOrder: 110 },
  { path: "/careers/:slug",       title: "Vacancy detail",     group: "marketing", icon: "Briefcase", rolesAllowed: [], showInFooter: false, sortOrder: 111 },
  { path: "/careers/:slug/apply", title: "Apply for vacancy",  group: "marketing", icon: "Briefcase", rolesAllowed: [], showInFooter: false, sortOrder: 112 },
  { path: "/careers/continue",    title: "Continue application", group: "marketing", icon: "Briefcase", rolesAllowed: [], showInFooter: false, sortOrder: 113 },
  { path: "/contact",    title: "Contact",    group: "marketing", icon: "Mail",        rolesAllowed: [], showInFooter: true, sortOrder: 120 },

  // Value detail pages
  { path: "/safety",        title: "Safety",        group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 130 },
  { path: "/reliability",   title: "Reliability",   group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 131 },
  { path: "/transparency",  title: "Transparency",  group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 132 },
  { path: "/innovation",    title: "Innovation",    group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 133 },
  { path: "/compliance",    title: "Compliance",    group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 134 },

  // Trust
  { path: "/security",           title: "Security",            group: "marketing", rolesAllowed: [], sortOrder: 140 },
  { path: "/privacy",            title: "Privacy",             group: "marketing", rolesAllowed: [], sortOrder: 141 },
  { path: "/compliance-center",  title: "Compliance Center",   group: "marketing", rolesAllowed: [], sortOrder: 142 },

  // Company
  { path: "/leadership",     title: "Leadership",     group: "marketing", rolesAllowed: [], sortOrder: 150 },
  { path: "/governance",     title: "Governance",     group: "marketing", rolesAllowed: [], sortOrder: 151 },
  { path: "/investors",      title: "Investors",      group: "marketing", rolesAllowed: [], sortOrder: 152 },
  { path: "/sustainability", title: "Sustainability", group: "marketing", rolesAllowed: [], sortOrder: 153 },

  // Developers
  { path: "/developers", title: "Developers", group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 160 },
  { path: "/developers/ai-assistants", title: "Connect AI Assistants", group: "marketing", rolesAllowed: [], showInFooter: false, sortOrder: 162 },
  { path: "/api-docs",   title: "API Documentation", group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 161 },

  // Legal
  { path: "/legal",                 title: "Legal Library",          group: "marketing", rolesAllowed: [], showInFooter: false, sortOrder: 169 },
  { path: "/legal/privacy",         title: "Privacy Policy",         group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 170 },
  { path: "/legal/terms",           title: "Terms of Service",       group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 171 },
  { path: "/legal/cookies",         title: "Cookie Policy",          group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 172 },
  { path: "/legal/data-protection", title: "Data Protection",        group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 173 },
  { path: "/legal/compliance",      title: "Regulatory Compliance",  group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 174 },
  { path: "/legal/community",       title: "Community Guidelines",   group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 175 },
  { path: "/legal/accessibility",   title: "Accessibility",          group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 176 },

  // Driver platform (public marketing + intake)
  { path: "/driver",            title: "Driver hub",      group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 180 },
  { path: "/driver/apply",      title: "Driver apply",    group: "marketing", rolesAllowed: [], sortOrder: 181 },
  { path: "/driver/onboarding", title: "Driver onboarding", group: "marketing", rolesAllowed: [], sortOrder: 182 },
  { path: "/driver/start",      title: "Driver sign-up", group: "marketing", rolesAllowed: [], sortOrder: 182.5 },
  { path: "/driver/earnings",   title: "Driver earnings", group: "marketing", rolesAllowed: [], sortOrder: 183 },
  { path: "/driver/benefits",   title: "Driver benefits", group: "marketing", rolesAllowed: [], sortOrder: 184 },
  { path: "/driver/training",   title: "Driver academy", group: "marketing", rolesAllowed: [], sortOrder: 185 },
  { path: "/driver/academy/:slug", title: "Academy course", group: "marketing", rolesAllowed: [], sortOrder: 185 },
  { path: "/driver/safety",     title: "Driver safety",   group: "marketing", rolesAllowed: [], showInFooter: true, sortOrder: 186 },
  { path: "/driver/support",    title: "Driver support",  group: "marketing", rolesAllowed: [], sortOrder: 187 },
  { path: "/driver/dashboard",  title: "Driver dashboard intro", group: "marketing", rolesAllowed: [], sortOrder: 188 },
  { path: "/driver/portal",  title: "Driver portal", group: "marketing", rolesAllowed: [], sortOrder: 188.5 },

  { path: "/driver/wealth",     title: "Driver wealth", group: "marketing", rolesAllowed: [], sortOrder: 189 },

  // Audience splits + verticals (mirrors App.tsx)
  { path: "/riders/individual",     title: "Individual Riders",   group: "marketing", rolesAllowed: [], sortOrder: 190 },
  { path: "/riders/corporate",      title: "Corporate Riders",    group: "marketing", rolesAllowed: [], sortOrder: 191 },
  { path: "/corporate-travel-management", title: "Corporate Travel Management", group: "marketing", rolesAllowed: [], sortOrder: 191.5 },
  { path: "/logistics",             title: "Logistics & Delivery", group: "marketing", rolesAllowed: [], sortOrder: 192 },
  { path: "/logistics/package",     title: "Package Delivery",    group: "marketing", rolesAllowed: [], sortOrder: 193 },
  { path: "/logistics/courier",     title: "Courier Delivery",    group: "marketing", rolesAllowed: [], sortOrder: 194 },
  { path: "/logistics/solutions",   title: "Logistics Solutions", group: "marketing", rolesAllowed: [], sortOrder: 195 },
  // Business logistics quote — entered from the Logistics Solutions hero CTA.
  { path: "/logistics/quote",        title: "Business Logistics Quote", group: "marketing", rolesAllowed: [], showInSidebar: false, sortOrder: 195.5 },
  { path: "/rentals/self-drive",    title: "Self-drive Rentals",  group: "marketing", rolesAllowed: [], sortOrder: 196 },
  { path: "/rentals/chauffeur",     title: "Chauffeur Services",  group: "marketing", rolesAllowed: [], sortOrder: 197 },
  // Private quotation copy — reached only by the link issued with the quote.
  { path: "/rentals/quote/:token",   title: "Rental Quotation", group: "marketing", rolesAllowed: [], showInSidebar: false, sortOrder: 197.5 },
  { path: "/rentals/bus-coach",     title: "Bus & Coach",         group: "marketing", rolesAllowed: [], sortOrder: 198 },
  { path: "/rentals/corporate-leasing", title: "Corporate Fleet Leasing", group: "marketing", rolesAllowed: [], sortOrder: 199 },
  { path: "/rentals/marketplace",   title: "Fleet Marketplace",   group: "marketing", rolesAllowed: [], sortOrder: 200 },
  { path: "/enterprise",            title: "Enterprise",          group: "marketing", rolesAllowed: [], sortOrder: 201 },
  { path: "/enterprise/demo",       title: "Enterprise Walkthrough", group: "marketing", rolesAllowed: [], sortOrder: 201.5 },
  { path: "/corporate",             title: "Company Profile",     group: "marketing", rolesAllowed: [], sortOrder: 201.7 },
  { path: "/support",               title: "Support",             group: "marketing", rolesAllowed: [], sortOrder: 202 },
  { path: "/security-center",       title: "Security Center",     group: "marketing", rolesAllowed: [], sortOrder: 203 },
  { path: "/blog/corporate-travel-management-guide", title: "Corporate Travel Guide", group: "marketing", rolesAllowed: [], sortOrder: 204 },

  // Delivery service pages — public marketing surfaces (mirrors App.tsx, which
  // renders them without RequireRole); operations live under /delivery/ops.
  { path: "/delivery/package",       title: "Parcel & Express Delivery", group: "marketing", rolesAllowed: [], sortOrder: 220 },
  { path: "/delivery/courier",       title: "Courier Delivery", group: "marketing", rolesAllowed: [], sortOrder: 221 },
  { path: "/delivery/fleet",         title: "Truck Dispatch & Fleet", group: "marketing", rolesAllowed: [], sortOrder: 222 },
  { path: "/delivery/logistics",     title: "Freight & Cargo", group: "marketing", rolesAllowed: [], sortOrder: 223 },
  { path: "/delivery/portal",        title: "Delivery & Logistics Partner Portal", group: "marketing", icon: "Package", rolesAllowed: [], sortOrder: 223.5 },
  { path: "/delivery/book",          title: "Book a Parcel Delivery", group: "marketing", rolesAllowed: [], sortOrder: 223.6 },
  { path: "/delivery/enquiry",       title: "Freight & Logistics Enquiry", group: "marketing", rolesAllowed: [], sortOrder: 223.7 },
  { path: "/track",                  title: "Track a Parcel", group: "marketing", rolesAllowed: [], sortOrder: 223.8 },
  // Surfaced exclusively inside the Enterprise Logistics Operating System
  // workspace group (src/lib/workspaces/config.ts) — not as a loose Menu item.
  { path: "/delivery/ops",           title: "Delivery Ops Hub",   group: "marketing", icon: "Activity", rolesAllowed: ["driver","admin","super_admin"], showInSidebar: false, sortOrder: 224, center: "logistics" },
  { path: "/delivery/ops/packages",  title: "Ops — Packages",     group: "marketing", rolesAllowed: ["driver","admin","super_admin"], sortOrder: 225 },
  { path: "/delivery/ops/packages/:id", title: "Ops — Package detail", group: "marketing", rolesAllowed: ["driver","admin","super_admin"], sortOrder: 226 },
  { path: "/delivery/ops/pod",       title: "Ops — POD",          group: "marketing", rolesAllowed: ["driver","admin","super_admin"], sortOrder: 227 },
  { path: "/delivery/ops/pod/:packageId", title: "Ops — POD capture", group: "marketing", rolesAllowed: ["driver","admin","super_admin"], sortOrder: 228 },
  { path: "/delivery/ops/dispatch",  title: "Ops — Dispatch",     group: "marketing", rolesAllowed: ["driver","admin","super_admin"], sortOrder: 229 },
  { path: "/delivery/ops/routes",    title: "Ops — Routes",       group: "marketing", rolesAllowed: ["driver","admin","super_admin"], sortOrder: 230 },

  // ---------- Auth ----------
  { path: "/auth",            title: "Sign In",        group: "auth", icon: "LogIn", rolesAllowed: [], sortOrder: 200 },
  { path: "/reset-password",  title: "Reset Password", group: "auth", icon: "Key",   rolesAllowed: [], sortOrder: 210 },

  // ---------- Rider ----------
  { path: "/dashboard",                 title: "Dashboard", group: "rider", rolesAllowed: ["rider","driver","corporate_admin","corporate_employee","admin","super_admin","finance_admin"], sortOrder: 290 },
  // Customer portal surfaces — reachable by any signed-in user; the page components enforce session.
  { path: "/dashboard/my-account",      title: "My Account",          group: "rider", icon: "User",  rolesAllowed: ["rider","driver","corporate_admin","corporate_employee","admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 291, hideFromSitemap: true },
  { path: "/dashboard/service-requests", title: "My Service Requests", group: "rider", icon: "Inbox", rolesAllowed: ["rider","driver","corporate_admin","corporate_employee","admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 292, hideFromSitemap: true },
  { path: "/dashboard/rider",           title: "Overview", group: "rider", icon: "LayoutDashboard", rolesAllowed: ["rider"], showInSidebar: false, sortOrder: 300 },
  { path: "/dashboard/rider/wallet",    title: "Wallet",   group: "rider", icon: "Wallet",          rolesAllowed: ["rider"], showInSidebar: false, sortOrder: 310 , internalAlias: true },
  { path: "/dashboard/rider/trips",     title: "Trips",    group: "rider", icon: "MapPin",          rolesAllowed: ["rider"], showInSidebar: false, sortOrder: 320 , internalAlias: true },
  { path: "/dashboard/rider/support",   title: "Support",  group: "rider", icon: "HeadphonesIcon",  rolesAllowed: ["rider"], showInSidebar: false, sortOrder: 330 , internalAlias: true },

  // Rider app (booking, trips, wallet, safety)
  { path: "/rider",            title: "Book a ride",   group: "rider", rolesAllowed: [], sortOrder: 340 },
  { path: "/rider/trips",      title: "My trips",      group: "rider", rolesAllowed: [], sortOrder: 341 },
  { path: "/rider/trips/:id",  title: "Trip detail",   group: "rider", rolesAllowed: [], sortOrder: 342 },
  { path: "/rider/schedule",   title: "Scheduled rides", group: "rider", rolesAllowed: [], sortOrder: 343 },
  { path: "/rider/airport",    title: "Airport transfer", group: "rider", rolesAllowed: [], sortOrder: 344 },
  { path: "/rider/wallet",     title: "Rider wallet",  group: "rider", rolesAllowed: [], sortOrder: 345 },
  { path: "/rider/rentals",    title: "My rentals",    group: "rider", rolesAllowed: [], sortOrder: 345.5 },
  { path: "/rider/favorites",  title: "Favorite places", group: "rider", rolesAllowed: [], sortOrder: 346 },
  { path: "/rider/safety",     title: "Safety center", group: "rider", rolesAllowed: [], sortOrder: 347 },
  { path: "/rider/rewards",    title: "Rewards",       group: "rider", rolesAllowed: [], sortOrder: 348 },
  { path: "/t/:token",         title: "Trip share",    group: "rider", rolesAllowed: [], sortOrder: 349 },

  // ---------- Driver ----------
  { path: "/dashboard/driver",          title: "Overview",          group: "driver", icon: "LayoutDashboard", rolesAllowed: ["driver"], showInSidebar: true, sortOrder: 400 },
  { path: "/dashboard/driver/profile",  title: "Profile",           group: "driver", icon: "User",            rolesAllowed: ["driver"], showInSidebar: true, sortOrder: 405 },
  { path: "/dashboard/driver/wallet",   title: "Wallet & Earnings", group: "driver", icon: "Wallet",          rolesAllowed: ["driver"], showInSidebar: true, sortOrder: 410 },
  { path: "/dashboard/driver/payouts",  title: "Payouts",           group: "driver", icon: "PiggyBank",       rolesAllowed: ["driver"], showInSidebar: true, sortOrder: 412 },
  { path: "/dashboard/driver/documents",title: "Documents",         group: "driver", icon: "FileCheck",       rolesAllowed: ["driver"], showInSidebar: true, sortOrder: 415 },
  { path: "/dashboard/driver/trips",    title: "Trips",             group: "driver", icon: "MapPin",          rolesAllowed: ["driver"], showInSidebar: true, sortOrder: 420 },
  { path: "/dashboard/driver/tax",      title: "Tax & Payouts",     group: "driver", icon: "Receipt",         rolesAllowed: ["driver"], showInSidebar: true, sortOrder: 430 },
  { path: "/dashboard/driver/support",  title: "Support",           group: "driver", icon: "HeadphonesIcon",  rolesAllowed: ["driver"], showInSidebar: true, sortOrder: 440 },

  // ---------- Corporate onboarding (public wizard + status) ----------
  { path: "/corporate/login",                 title: "Corporate Sign In",          group: "auth",      rolesAllowed: [], sortOrder: 480, hideFromSitemap: true },
  { path: "/clients/login",                   title: "Client Sign In",             group: "auth",      rolesAllowed: [], sortOrder: 481, hideFromSitemap: true },
  { path: "/corporate/register",              title: "Corporate Registration",     group: "corporate", rolesAllowed: [], sortOrder: 481, hideFromSitemap: true },
  { path: "/corporate/register/personal",     title: "Registration — Personal",    group: "corporate", rolesAllowed: [], sortOrder: 482, hideFromSitemap: true, internalAlias: true },
  { path: "/corporate/register/business",     title: "Registration — Business",    group: "corporate", rolesAllowed: [], sortOrder: 483, hideFromSitemap: true, internalAlias: true },
  { path: "/corporate/register/verification", title: "Registration — Verification", group: "corporate", rolesAllowed: [], sortOrder: 484, hideFromSitemap: true, internalAlias: true },
  { path: "/corporate/register/documents",    title: "Registration — Documents",   group: "corporate", rolesAllowed: [], sortOrder: 485, hideFromSitemap: true, internalAlias: true },
  { path: "/corporate/register/review",       title: "Registration — Review",      group: "corporate", rolesAllowed: [], sortOrder: 486, hideFromSitemap: true, internalAlias: true },
  { path: "/corporate/register/status",       title: "Registration Status",        group: "corporate", rolesAllowed: [], sortOrder: 487, hideFromSitemap: true, internalAlias: true },

  // ---------- Corporate dashboard · Administration ----------
  { path: "/dashboard/corporate",                  title: "Corporate Dashboard", group: "corporate", icon: "LayoutDashboard", rolesAllowed: ["corporate_admin","corporate_employee"], showInSidebar: false, sortOrder: 500 },
  { path: "/dashboard/corporate/departments",      title: "Departments",         group: "corporate", icon: "Building",        rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 502 , internalAlias: true },
  { path: "/dashboard/corporate/designations",     title: "Designations",        group: "corporate", icon: "Award",           rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 504 , internalAlias: true },
  { path: "/dashboard/corporate/approval-setup",   title: "User Approval Setup", group: "corporate", icon: "UserCheck",       rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 506 },
  { path: "/dashboard/corporate/employees",        title: "Employees",           group: "corporate", icon: "Users",           rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 508 },

  // ---------- Corporate dashboard · Operations (hidden — surfaced via top tabs) ----------
  { path: "/dashboard/corporate/manual-dispatch",  title: "Manual Dispatch",     group: "corporate", icon: "Radio",           rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 520 , internalAlias: true },
  { path: "/dashboard/corporate/approvals",        title: "Approve Bookings",    group: "corporate", icon: "CheckCircle2",    rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 522 },
  { path: "/dashboard/corporate/trips/request",    title: "Request a Ride",      group: "corporate", icon: "Send",            rolesAllowed: ["corporate_admin","corporate_employee"], showInSidebar: false, sortOrder: 523 },
  { path: "/dashboard/corporate/completed-rides",  title: "Completed Rides",     group: "corporate", icon: "CheckCircle2",    rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 524 },
  { path: "/dashboard/corporate/spend",            title: "Ride Statistics",     group: "corporate", icon: "BarChart3",       rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 526 },
  { path: "/dashboard/corporate/invoicing",        title: "Corporate Invoicing", group: "corporate", icon: "FileText",        rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 528 },

  // ---------- Corporate dashboard · Governance & Finance (hidden — surfaced via top tabs) ----------
  { path: "/dashboard/corporate/wallet",           title: "Wallet",              group: "corporate", icon: "Wallet",          rolesAllowed: ["corporate_admin","corporate_employee"], showInSidebar: false, sortOrder: 540 },
  { path: "/dashboard/corporate/policies",         title: "Policies",            group: "corporate", icon: "Shield",          rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 542 },
  { path: "/dashboard/corporate/expense-codes",    title: "Expense Codes",       group: "corporate", icon: "Receipt",         rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 544 , internalAlias: true },
  { path: "/dashboard/corporate/violations",       title: "Violations",          group: "corporate", icon: "AlertTriangle",   rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 546 , internalAlias: true },
  { path: "/dashboard/corporate/pre-billing",      title: "Pre-billing",         group: "corporate", icon: "Receipt",         rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 548 },
  { path: "/dashboard/corporate/cash-ledger",      title: "Cash Ledger",         group: "corporate", icon: "BookOpen",        rolesAllowed: ["corporate_admin","corporate_employee"], showInSidebar: false, sortOrder: 550 },
  { path: "/dashboard/corporate/paybill-proofs",   title: "Paybill Proofs",      group: "corporate", icon: "Receipt",         rolesAllowed: ["corporate_admin","corporate_employee"], showInSidebar: false, sortOrder: 552 , internalAlias: true },
  { path: "/dashboard/corporate/reconciliation",   title: "Reconciliation",      group: "corporate", icon: "BarChart3",       rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 554 },
  { path: "/dashboard/corporate/audit-log",        title: "Audit Log",           group: "corporate", icon: "History",         rolesAllowed: ["corporate_admin"], showInSidebar: false, sortOrder: 556 },

  // ---------- Admin · Executive Command Center ----------
  { path: "/dashboard/admin/home",              title: "Home",                   group: "admin", icon: "Home",            rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin"], showInSidebar: true, sortOrder: 590, center: "home" },
  { path: "/dashboard/admin",                   title: "Admin Overview",         group: "admin", icon: "LayoutDashboard", rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 600, center: "executive" },
  { path: "/dashboard/admin/executive",         title: "Executive Cockpit",      group: "admin", icon: "Crown",           rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 601, center: "executive" },
  { path: "/dashboard/admin/executive-intelligence", title: "Executive Intelligence", group: "admin", icon: "Brain",       rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 602, center: "executive" },
  { path: "/dashboard/admin/command-center",    title: "Command Center",         group: "admin", icon: "LayoutGrid",      rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 605, center: "executive" },

  // ---------- Admin · Operations ----------
  { path: "/dashboard/admin/operations",        title: "Operations Hub",         group: "admin", icon: "Radar",           rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 660, center: "operations" },
  { path: "/dashboard/admin/ops-center",        title: "Operations Center",      group: "admin", icon: "Radar",           rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 659, center: "operations" },
  { path: "/dashboard/admin/dispatch",          title: "Dispatch Ops",           group: "admin", icon: "Activity",        rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 661, center: "operations" },
  { path: "/dashboard/admin/dispatch/sim",      title: "Dispatch Simulator",     group: "admin", icon: "Activity",        rolesAllowed: ["admin","super_admin"], showInSidebar: false, sortOrder: 662, center: "operations" },
  { path: "/dashboard/admin/fos",               title: "FOS Control Center",     group: "admin", icon: "BarChart3",       rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 663, center: "operations" },
  { path: "/dashboard/admin/noc",               title: "NOC Console",            group: "admin", icon: "Activity",        rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 664, center: "operations" },
  { path: "/dashboard/admin/outbox",            title: "Outbox Monitor",         group: "admin", icon: "Database",        rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 665, center: "operations" },

  // ---------- Admin · Drivers ----------
  { path: "/dashboard/admin/drivers",           title: "Driver Administration",  group: "admin", icon: "UserCog",         rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 700, center: "drivers" },
  { path: "/dashboard/admin/drivers/:driverId", title: "Driver 360",             group: "admin",                          rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: false, sortOrder: 700 },
  { path: "/dashboard/admin/document-queue",    title: "Compliance Operations",  group: "admin", icon: "FileCheck",       rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 701, center: "drivers" },
  { path: "/dashboard/admin/lifecycle",         title: "Driver Lifecycle",       group: "admin", icon: "GitBranch",       rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 702, center: "drivers" },
  { path: "/dashboard/admin/academy",           title: "Driver Academy",         group: "admin", icon: "GraduationCap",   rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 703, center: "drivers" },
  { path: "/dashboard/admin/digital-twin",      title: "Digital Twin",           group: "admin", icon: "UserCog",         rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 704, center: "drivers" },

  // ---------- Admin · People & Partners ----------
  { path: "/dashboard/admin/people-partners",   title: "People & Partners",      group: "admin", icon: "Users",           rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 748, center: "riders" },
  { path: "/dashboard/admin/people-console",    title: "People Console",         group: "admin", icon: "UserCog",         rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 748.1, center: "riders" },
  { path: "/dashboard/admin/partner-invite",    title: "Partner Onboarding",     group: "admin", icon: "Building2",       rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 748.2, center: "riders" },
  // ---------- Admin · Riders ----------
  { path: "/dashboard/admin/rider-management",  title: "Rider Dashboard",        group: "admin", icon: "Sparkles",        rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: false, sortOrder: 749, center: "riders" },
  { path: "/dashboard/admin/riders-center",     title: "Riders Center",          group: "admin", icon: "Users",           rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 750, center: "riders" },
  { path: "/dashboard/admin/riders",            title: "Rider Directory",        group: "admin", icon: "Users",           rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 751, center: "riders" },
  { path: "/dashboard/admin/riders/:riderId",   title: "Rider 360",              group: "admin", icon: "User",            rolesAllowed: ["admin","super_admin","compliance_admin"], sortOrder: 752, center: "riders", internalAlias: true },

  // ---------- Admin · Corporate ----------
  { path: "/dashboard/admin/corporate-center",  title: "Corporate Panel",        group: "admin", icon: "Building",        rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 760, center: "corporate" },
  { path: "/dashboard/admin/corporates",        title: "Corporate Directory",    group: "admin", icon: "Building2",       rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 761, center: "corporate" },
  { path: "/dashboard/admin/corporates/:corporateId", title: "Corporate 360",   group: "admin", icon: "Building2",       rolesAllowed: ["admin","super_admin","compliance_admin"], sortOrder: 762, center: "corporate", internalAlias: true },
  { path: "/dashboard/admin/corporates/:corporateId/command-centre", title: "Corporate Account Command Centre", group: "admin", rolesAllowed: ["admin","super_admin","compliance_admin","finance_admin"], sortOrder: 762.1, hideFromSitemap: true },
  { path: "/dashboard/admin/trips/:tripId", title: "Trip Record", group: "admin", rolesAllowed: ["admin","super_admin"], sortOrder: 762.1, hideFromSitemap: true },
  { path: "/dashboard/admin/trip-share/:tripId", title: "Trip Share Administration", group: "admin", rolesAllowed: ["admin","super_admin"], sortOrder: 762.2, hideFromSitemap: true },
  { path: "/dashboard/admin/couriers/:courierId", title: "Courier Detail", group: "admin", rolesAllowed: ["admin","super_admin","compliance_admin"], sortOrder: 762.3, hideFromSitemap: true },
  { path: "/dashboard/admin/packages/:packageId", title: "Package Detail", group: "admin", rolesAllowed: ["admin","super_admin","compliance_admin"], sortOrder: 762.4, hideFromSitemap: true },
  { path: "/dashboard/admin/logistics/:jobId", title: "Logistics Job Detail", group: "admin", rolesAllowed: ["admin","super_admin","compliance_admin"], sortOrder: 762.5, hideFromSitemap: true },
  { path: "/dashboard/admin/contact-submissions", title: "Contact Submissions",  group: "admin", icon: "Mail",            rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 763, center: "corporate" },
  { path: "/dashboard/admin/sales-leads",       title: "Sales Leads",            group: "admin", icon: "Sparkles",        rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 764, center: "corporate" },
  { path: "/dashboard/admin/customer-operations", title: "Customer Operations",  group: "admin", icon: "Headset",         rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 764, center: "corporate" },

  // ---------- Admin · Logistics ----------
  { path: "/dashboard/admin/delivery-operations", title: "Delivery Operations Control Tower", group: "admin", icon: "Radar", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 769, center: "logistics" },
  { path: "/dashboard/admin/logistics-center",  title: "Logistics Hub",          group: "admin", icon: "Package",         rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 770, center: "logistics" },
  { path: "/dashboard/admin/logistics-orders",  title: "Dispatch Orders Console", group: "admin", icon: "ListChecks",     rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.5, center: "logistics" },
  { path: "/dashboard/admin/logistics-exceptions", title: "Exception Control Centre", group: "admin", icon: "ShieldAlert", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.6, center: "logistics" },
  { path: "/dashboard/admin/logistics-manifests", title: "Manifests & Hub Custody", group: "admin", icon: "Boxes", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.7, center: "logistics" },
  { path: "/dashboard/admin/logistics-hubs", title: "Hub Administration", group: "admin", icon: "Building2", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.8, center: "logistics" },
  { path: "/dashboard/admin/logistics-routes", title: "Route Control Centre", group: "admin", icon: "Route", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.85, center: "logistics" },
  { path: "/dashboard/admin/logistics-delivery", title: "Final-Mile Delivery", group: "admin", icon: "PackageCheck", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.87, center: "logistics" },
  { path: "/dashboard/admin/logistics-integrations", title: "API & Webhooks", group: "admin", icon: "Plug", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.88, center: "logistics" },
  { path: "/dashboard/admin/logistics-warehouse", title: "Warehouse & Fulfilment", group: "admin", icon: "Warehouse", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.89, center: "logistics" },
  { path: "/dashboard/admin/logistics-sync", title: "Offline Execution & Sync", group: "admin", icon: "RefreshCw", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.893, center: "logistics" },
  { path: "/dashboard/admin/logistics-control-tower", title: "Logistics Control Tower", group: "admin", icon: "Radar", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.88, center: "logistics" },
  { path: "/dashboard/admin/freight-procurement", title: "Freight Procurement", group: "admin", icon: "Gavel", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.89, center: "logistics" },
  { path: "/dashboard/admin/freight-audit", title: "Freight Audit & Reconciliation", group: "admin", icon: "Scale", rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 770.895, center: "logistics" },
  { path: "/dashboard/admin/logistics-service-activation", title: "Service Activation", group: "admin", icon: "Power", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.9, center: "logistics" },
  { path: "/dashboard/admin/carrier-applications", title: "Fleet Owner Applications", group: "admin", icon: "ClipboardCheck", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.91, center: "logistics" },
  { path: "/dashboard/admin/driver-applications", title: "Driver Applications", group: "admin", icon: "UserCheck", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.915, center: "logistics" },
  { path: "/dashboard/admin/payout-console", title: "Payout Console", group: "admin", icon: "Wallet", rolesAllowed: ["admin","super_admin","finance_admin","operations_admin"], showInSidebar: true, sortOrder: 770.916, center: "logistics" },

  { path: "/dashboard/admin/fleet-owner-compliance", title: "Fleet Owner Compliance", group: "admin", icon: "ShieldCheck", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.92, center: "logistics" },
  { path: "/dashboard/admin/fleet-owner-documents", title: "Fleet Owner Documents", group: "admin", icon: "FileCheck", rolesAllowed: ["admin","super_admin","operations_admin"], sortOrder: 770.921, center: "logistics", hideFromSitemap: true },
  { path: "/dashboard/admin/fleet-owner-claims", title: "Fleet Owner Claims", group: "admin", icon: "ReceiptText", rolesAllowed: ["admin","super_admin","finance_admin"], sortOrder: 770.922, center: "logistics", hideFromSitemap: true },
  { path: "/dashboard/admin/carrier-pod-review", title: "Delivery Evidence Review", group: "admin", icon: "FileCheck", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.93, center: "logistics" },
  { path: "/dashboard/admin/ai-control-tower", title: "AI Control Tower", group: "admin", icon: "Brain", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 770.94, center: "logistics" },
  { path: "/dashboard/admin/logistics-df10",    title: "DF-10 Validation",       group: "admin", icon: "ShieldAlert",     rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 771, center: "logistics" },
  { path: "/dashboard/admin/production-command-center", title: "Production Command Center", group: "admin", icon: "ShieldCheck", rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 772, center: "logistics" },
  { path: "/dashboard/admin/infrastructure-di00", title: "DI-00 Infrastructure", group: "admin", icon: "DatabaseZap", rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 772.5, center: "logistics" },
  { path: "/dashboard/admin/legal", title: "Legal & Compliance Centre", group: "admin", icon: "Gavel", rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 773, center: "logistics" },
  { path: "/dashboard/admin/runtime-diagnostics", title: "Runtime Diagnostics", group: "admin", icon: "Activity", rolesAllowed: ["admin","super_admin","operations_admin"], showInSidebar: true, sortOrder: 773, center: "logistics" },
  { path: "/dashboard/admin/logistics-onboarding", title: "Onboarding Approvals", group: "admin", icon: "ClipboardCheck",  rolesAllowed: ["admin","super_admin"], sortOrder: 771, center: "logistics" },
  { path: "/dashboard/admin/logistics-capabilities", title: "Capability Registry", group: "admin", icon: "LayoutGrid",    rolesAllowed: ["admin","super_admin"], sortOrder: 772, center: "logistics" },

  { path: "/dashboard/admin/couriers",          title: "Courier Directory",      group: "admin", icon: "Truck",           rolesAllowed: ["admin","super_admin","compliance_admin"], sortOrder: 773, center: "logistics" },
  { path: "/dashboard/admin/packages",          title: "Package Operations",     group: "admin", icon: "Package",         rolesAllowed: ["admin","super_admin","compliance_admin"], sortOrder: 774, center: "logistics" },
  { path: "/dashboard/admin/logistics",         title: "Logistics Directory",    group: "admin", icon: "Package",         rolesAllowed: ["admin","super_admin","compliance_admin"], sortOrder: 775, center: "logistics" },

  // ---------- Admin · Fleet ----------
  { path: "/dashboard/admin/fleet-center",      title: "Fleet Hub",              group: "admin", icon: "Car",             rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 780, center: "fleet" },
  { path: "/dashboard/admin/fleet",             title: "Fleet Directory",        group: "admin", icon: "Truck",           rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 781, center: "fleet" },
  { path: "/dashboard/admin/fleet/:fleetId",    title: "Fleet 360",              group: "admin", icon: "Truck",           rolesAllowed: ["admin","super_admin","compliance_admin"], sortOrder: 782, center: "fleet", internalAlias: true },

  // ---------- Admin · Finance & Treasury ----------
  { path: "/dashboard/admin/finance-center",    title: "Finance Hub",            group: "admin", icon: "Wallet",          rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 790, center: "finance" },
  { path: "/dashboard/admin/mpesa",             title: "M-Pesa",                 group: "admin", icon: "CreditCard",      rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 791, center: "finance" },
  { path: "/dashboard/admin/rename-backfill-monitor", title: "Rename & Backfill Monitor", group: "admin", icon: "Activity", rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 792, center: "system", hideFromSitemap: true },
  { path: "/dashboard/admin/wallets",           title: "Wallets",                group: "admin", icon: "Wallet",          rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 792, center: "finance" },
  { path: "/dashboard/admin/payments",          title: "Payments Ops",           group: "admin", icon: "CreditCard",      rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 793, center: "finance" },
  { path: "/dashboard/admin/refunds",           title: "Refunds & Disputes",     group: "admin", icon: "Wallet",          rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 793.5, center: "finance" },
  { path: "/dashboard/admin/tax",               title: "Tax Command Center",     group: "admin", icon: "Receipt",         rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 794, center: "finance" },
  { path: "/dashboard/admin/reconciliation",    title: "Reconciliation",         group: "admin", icon: "BarChart3",       rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 795, center: "finance" },

  // ---------- Admin · Fraud & Security ----------
  { path: "/dashboard/admin/fraud-center",      title: "Fraud Center",           group: "admin", icon: "ShieldAlert",     rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 800, center: "fraud" },
  { path: "/dashboard/admin/trust-center",      title: "Trust & Safety",         group: "admin", icon: "Shield",          rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 801, center: "fraud" },
  { path: "/dashboard/admin/trust-console",     title: "Trust Console",          group: "admin", icon: "Shield",          rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: false, sortOrder: 801.5, center: "fraud" },
  { path: "/dashboard/admin/identity-assurance",title: "Identity Assurance",     group: "admin", icon: "ShieldCheck",     rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 802, center: "fraud" },
  { path: "/dashboard/admin/delivery-fraud",    title: "Delivery Fraud",         group: "admin", icon: "ShieldAlert",     rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 803, center: "fraud" },
  { path: "/dashboard/admin/access-denials",    title: "Access Denials",         group: "admin", icon: "Lock",            rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 804, center: "fraud" },

  // ---------- Admin · Compliance & Audit ----------
  { path: "/dashboard/admin/compliance",        title: "Compliance Center",      group: "admin", icon: "ShieldCheck",     rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 810, center: "compliance" },
  { path: "/dashboard/admin/compliance-alerts", title: "Compliance Alerts",      group: "admin", icon: "AlertTriangle",   rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 811, center: "compliance" },
  { path: "/dashboard/admin/kyc-types",         title: "KYC Requirements",       group: "admin", icon: "FileCheck",       rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 812, center: "compliance" },
  { path: "/dashboard/admin/governance",        title: "Governance Console",     group: "admin", icon: "Gavel",           rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 813, center: "compliance" },
  { path: "/dashboard/admin/audit-log",         title: "Admin Audit Log",        group: "admin", icon: "History",         rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 814, center: "compliance" },
  { path: "/dashboard/admin/audit-schedules",   title: "Audit Report Schedules", group: "admin", icon: "CalendarClock",   rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 814.5, center: "compliance" },
  { path: "/dashboard/admin/alerts",            title: "Executive Alerts",       group: "admin", icon: "Bell",            rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 818, center: "compliance" },
  { path: "/dashboard/admin/alert-rules",       title: "Alert Rules",            group: "admin", icon: "Bell",            rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 819, center: "compliance" },
  { path: "/dashboard/admin/sla-grace",         title: "SLA Grace Periods",      group: "admin", icon: "Timer",           rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 819.5, center: "compliance" },
  { path: "/dashboard/admin/integrity-report",  title: "Integrity Report",       group: "admin", icon: "ShieldCheck",     rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 815, center: "compliance" },
  { path: "/dashboard/admin/integrity-gates",   title: "Integrity Gates",        group: "admin", icon: "SlidersHorizontal", rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 816, center: "compliance" },
  { path: "/dashboard/admin/production-readiness", title: "Production Readiness", group: "admin", icon: "ShieldCheck", rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 817, center: "compliance" },
  { path: "/dashboard/admin/integrity-audit",   title: "Threshold Audit",        group: "admin", icon: "History",         rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 817, center: "compliance" },
  { path: "/dashboard/admin/privileged-updates", title: "Privileged Updates Audit", group: "admin", icon: "Lock",           rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 819.7, center: "compliance" },

  // ---------- Admin · Platform Intelligence ----------
  { path: "/dashboard/admin/intelligence",      title: "Intelligence Hub",       group: "admin", icon: "Brain",           rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 820, center: "intelligence" },
  { path: "/dashboard/admin/cta-analytics",     title: "CTA Analytics",          group: "admin", icon: "MousePointerClick", rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 821, center: "intelligence" },
  { path: "/dashboard/admin/mobility-analytics", title: "Mobility Analytics",     group: "admin", icon: "ChartNoAxesCombined", rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 823, center: "intelligence" },
  { path: "/dashboard/admin/corporate-os",      title: "Corporate Operating System", group: "admin", icon: "Building2", rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 823.5, center: "intelligence" },
  { path: "/dashboard/admin/executive-command-centre", title: "Executive Command Centre", group: "admin", icon: "Gauge", rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 819, center: "intelligence" },
  { path: "/dashboard/admin/report-schedules",  title: "Scheduled Report Exports", group: "admin", icon: "CalendarClock", rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 823.6, center: "intelligence" },
  { path: "/dashboard/admin/concierge-approval-audit", title: "Concierge Approval Audit", group: "admin", icon: "FileLock2", rolesAllowed: ["admin","super_admin","compliance_admin"], showInSidebar: true, sortOrder: 819.8, center: "compliance" },
  { path: "/dashboard/admin/governance-access", title: "Governance Access Matrix", group: "admin", icon: "KeyRound", rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 819.9, center: "compliance" },
  { path: "/dashboard/admin/export-jobs", title: "Export Job History", group: "admin", icon: "FileClock", rolesAllowed: ["admin","super_admin","finance_admin"], showInSidebar: true, sortOrder: 823.7, center: "intelligence" },
  { path: "/dashboard/admin/incidents/:alertId", title: "Incident Detail", group: "admin", icon: "ShieldAlert", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin"], sortOrder: 823.8, center: "intelligence" },
  { path: "/dashboard/admin/my-alert-preferences", title: "My Alert Preferences", group: "admin", icon: "BellRing", rolesAllowed: ["admin","super_admin","finance_admin","compliance_admin","operations_admin"], showInSidebar: true, sortOrder: 831.5, center: "system" },
  { path: "/dashboard/admin/analytics-export",  title: "Analytics Export",       group: "admin", icon: "Database",        rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 822, center: "intelligence" },

  // ---------- Admin · System Administration ----------
  { path: "/dashboard/admin/system",            title: "System Hub",             group: "admin", icon: "Settings",        rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 830, center: "system" },
  { path: "/dashboard/admin/backend",           title: "Backend Operations",     group: "admin", icon: "Database",        rolesAllowed: ["super_admin"], showInSidebar: true, sortOrder: 830.5, center: "super_admin", hideFromSitemap: true },
  { path: "/dashboard/admin/business-operations", title: "Business Operations", group: "admin", icon: "Building2", rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 830.7, center: "system", hideFromSitemap: true },
  { path: "/dashboard/admin/staff",             title: "Staff & Roles",          group: "admin", icon: "Shield",          rolesAllowed: ["super_admin"], showInSidebar: true, sortOrder: 831, center: "system" },
  { path: "/dashboard/admin/users",             title: "Users",                  group: "admin", icon: "Users",           rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 832, center: "system" },
  { path: "/dashboard/admin/roles",             title: "Roles (Legacy)",         group: "admin", icon: "Shield",          rolesAllowed: ["super_admin"], sortOrder: 833, center: "system", internalAlias: true },
  { path: "/dashboard/admin/settings",          title: "Platform Settings",      group: "admin", icon: "Settings",        rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 834, center: "system" },
  { path: "/dashboard/admin/navigation-health", title: "Navigation Health",      group: "admin", icon: "Activity",        rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 835, center: "system" },
  { path: "/dashboard/admin/navigation-governance", title: "Navigation Governance", group: "admin", icon: "GitBranch",      rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 835.5, center: "system" },

  // Additional admin tools (mirrors App.tsx, not surfaced in default sidebar)
  { path: "/dashboard/admin/governance-legacy", title: "Governance (Legacy)",    group: "admin", rolesAllowed: ["admin","super_admin"], sortOrder: 840, center: "compliance", internalAlias: true },
  { path: "/dashboard/admin/ml-platform",        title: "ML Platform",            group: "admin", rolesAllowed: ["admin","super_admin"], sortOrder: 841, center: "intelligence", internalAlias: true },
  { path: "/dashboard/admin/noc-incidents",      title: "NOC Incidents",          group: "admin", rolesAllowed: ["admin","super_admin"], sortOrder: 842, center: "operations", internalAlias: true },

  // ---------- Admin · Marketplace ----------
  { path: "/dashboard/admin/marketplace",       title: "Marketplace Hub",        group: "admin", icon: "LayoutGrid",      rolesAllowed: ["admin","super_admin"], showInSidebar: true, sortOrder: 850, center: "marketplace" },

  // ---------- Admin · Super Admin ----------
  { path: "/dashboard/admin/super",             title: "Super Admin",            group: "admin", icon: "Crown",           rolesAllowed: ["super_admin"], showInSidebar: true, sortOrder: 860, center: "super_admin" },

  // ---------- Legacy /app/* aliases (kept for backward compatibility, not surfaced in nav) ----------
  { path: "/app",          title: "Legacy Dashboard", group: "legacy", rolesAllowed: ["admin","super_admin"], sortOrder: 900, internalAlias: true },
  { path: "/app/riders",   title: "Legacy Riders",    group: "legacy", rolesAllowed: ["admin","super_admin"], sortOrder: 910, internalAlias: true },
  { path: "/app/drivers",  title: "Legacy Drivers",   group: "legacy", rolesAllowed: ["admin","super_admin"], sortOrder: 920, internalAlias: true },
  { path: "/app/trips",    title: "Legacy Trips",     group: "legacy", rolesAllowed: ["admin","super_admin"], sortOrder: 930, internalAlias: true },
  { path: "/app/schedule", title: "Legacy Schedule",  group: "legacy", rolesAllowed: ["admin","super_admin"], sortOrder: 940, internalAlias: true },
  { path: "/app/driver/wealth", title: "Legacy Driver Wealth", group: "legacy", rolesAllowed: [], sortOrder: 950, internalAlias: true },

  // ---------- Auth / system pages (surfaced by App.tsx, kept out of nav) ----------
  { path: "/unauthorized", title: "Unauthorized", group: "auth", rolesAllowed: [], sortOrder: 990, hideFromSitemap: true, internalAlias: true },
  { path: "/unsubscribe",  title: "Unsubscribe",  group: "auth", rolesAllowed: [], sortOrder: 991, hideFromSitemap: true, internalAlias: true },
  // Reached only through the private contact link inside a sales outreach message.
  { path: "/lead/reply",   title: "Reply to TaxiD", group: "auth", rolesAllowed: [], sortOrder: 993, hideFromSitemap: true, internalAlias: true },
  { path: "/account/communication-preferences", title: "Communication Preferences", group: "auth", rolesAllowed: [], sortOrder: 992, hideFromSitemap: true, internalAlias: true },
  { path: "/account/security", title: "Security Centre", group: "auth", rolesAllowed: [], sortOrder: 994, hideFromSitemap: true, internalAlias: true },

  // ---------- Admin routes previously orphaned (now registry-tracked with RBAC) ----------
  { path: "/dashboard/admin/access-debug",              title: "Access Debug",              group: "admin", icon: "Lock",         rolesAllowed: ["admin","super_admin"],                                    sortOrder: 836, center: "system",     internalAlias: true },
  { path: "/dashboard/admin/corporates/approvals",       title: "Corporate Approvals Inbox", group: "admin", icon: "CheckCircle2", rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 760, center: "corporate",  internalAlias: true },
  { path: "/dashboard/admin/corporates/assisted-booking", title: "Assisted Booking Desk",   group: "admin", icon: "CalendarPlus", rolesAllowed: ["admin","super_admin"],                                    sortOrder: 761, center: "corporate",  internalAlias: true },
  { path: "/dashboard/admin/corporates/booking-ops",     title: "Corporate Booking Ops",     group: "admin", icon: "Route",        rolesAllowed: ["admin","super_admin","operations_admin"],                 sortOrder: 764, center: "corporate",  internalAlias: true },
  { path: "/dashboard/admin/corporates/support",         title: "Corporate Support Desk",    group: "admin", icon: "Ticket",       rolesAllowed: ["admin","super_admin","operations_admin"],                 sortOrder: 765, center: "corporate",  internalAlias: true },
  { path: "/dashboard/admin/corporates/alerts",          title: "Corporate Alerting",        group: "admin", icon: "BellRing",     rolesAllowed: ["admin","super_admin","operations_admin"],                 sortOrder: 766, center: "corporate",  internalAlias: true },
  { path: "/dashboard/admin/corporates/audit",           title: "Corporate Admin Audit Log", group: "admin", icon: "History",      rolesAllowed: ["admin","super_admin","compliance_admin","finance_admin"], sortOrder: 767, center: "corporate",  internalAlias: true },
  { path: "/dashboard/admin/corporates/permissions",     title: "Admin Permissions Matrix",  group: "admin", icon: "ShieldCheck",  rolesAllowed: ["admin","super_admin"],                                    sortOrder: 768, center: "corporate",  internalAlias: true },

  { path: "/dashboard/admin/corporate-portal",           title: "Corporate Admin Portal",    group: "admin", icon: "Building2",    rolesAllowed: ["admin","super_admin","compliance_admin"],                 sortOrder: 759, center: "corporate", showInSidebar: true },
  { path: "/dashboard/admin/corporate-kyb",             title: "Corporate KYB Queue",       group: "admin", icon: "FileCheck",    rolesAllowed: ["admin","super_admin","compliance_admin"],                 sortOrder: 762, center: "corporate",  internalAlias: true },
  { path: "/dashboard/admin/bank-guarantees",           title: "Bank Guarantees & Credit",  group: "admin", icon: "ShieldCheck",  rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 762.5, center: "corporate", internalAlias: true },
  { path: "/dashboard/admin/mpesa-payments",            title: "M-Pesa Payments",           group: "admin", icon: "Wallet",       rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 762.6, center: "corporate", internalAlias: true },
  { path: "/dashboard/admin/corporate-kyb/audit",       title: "Corporate KYB Audit Log",   group: "admin", icon: "History",      rolesAllowed: ["admin","super_admin","compliance_admin"],                 sortOrder: 763, center: "corporate",  internalAlias: true },
  { path: "/dashboard/admin/event-outbox",              title: "Event Outbox",              group: "admin", icon: "Database",     rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 666, center: "operations", internalAlias: true },
  { path: "/dashboard/admin/fraud-cases",               title: "Fraud Cases",               group: "admin", icon: "ShieldAlert",  rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 805, center: "fraud",      internalAlias: true },
  { path: "/dashboard/admin/observability",             title: "Observability",             group: "admin", icon: "Activity",     rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 667, center: "operations", internalAlias: true },
  { path: "/dashboard/admin/outbox-dlq",                title: "Outbox DLQ",                group: "admin", icon: "Database",     rolesAllowed: ["admin","super_admin"],                                    sortOrder: 668, center: "operations", internalAlias: true },
  { path: "/dashboard/admin/paybill-proofs",            title: "Paybill Proofs (Admin)",    group: "admin", icon: "Receipt",      rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 796, center: "finance",    internalAlias: true },
  { path: "/dashboard/admin/payment-dlq",               title: "Payment DLQ",               group: "admin", icon: "AlertTriangle",rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 797, center: "finance",    internalAlias: true },
  { path: "/dashboard/admin/reconciliation-mismatches", title: "Reconciliation Mismatches", group: "admin", icon: "AlertTriangle",rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 798, center: "finance",    internalAlias: true },
  { path: "/dashboard/admin/reconciliation/:id",        title: "Reconciliation Case",       group: "admin", icon: "BarChart3",    rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 799, center: "finance",    internalAlias: true },
  { path: "/dashboard/admin/tax/:tab",                  title: "Tax Command · Tab",         group: "admin", icon: "Receipt",      rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 794.5, center: "finance",  internalAlias: true },

  // ---------- Phase D12.0 — Navigation Governance Ratchet: register admin routes previously app-only ----------
  { path: "/dashboard/corporate/*",                     title: "Corporate Workspace (splat)", group: "corporate", rolesAllowed: ["corporate_admin","corporate_employee","admin","super_admin"], sortOrder: 500, internalAlias: true },
  { path: "/dashboard/admin/export-audit-trail",        title: "Export Audit Trail",        group: "admin", icon: "History",      rolesAllowed: ["admin","super_admin","compliance_admin"],                 sortOrder: 814.2, center: "compliance", internalAlias: true },
  { path: "/dashboard/admin/privileged-metrics",        title: "Privileged Metrics",        group: "admin", icon: "Lock",         rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 819.8, center: "compliance", internalAlias: true },
  { path: "/dashboard/admin/security-audit",            title: "Security Audit",            group: "admin", icon: "ShieldCheck",  rolesAllowed: ["admin","super_admin"],                                    sortOrder: 806, center: "fraud",       internalAlias: true },
  { path: "/dashboard/admin/assurance",                 title: "Assurance Dashboard",       group: "admin", icon: "ShieldCheck",  rolesAllowed: ["admin","super_admin"],                                    sortOrder: 817.5, center: "compliance", internalAlias: true },
  { path: "/dashboard/admin/security-scans",             title: "Security Scan Center",      group: "admin", icon: "ShieldCheck",  rolesAllowed: ["admin","super_admin"],                                    sortOrder: 806.1, center: "fraud",       internalAlias: true },
  { path: "/dashboard/admin/policy-assurance",          title: "Policy Assurance",          group: "admin", icon: "Gavel",        rolesAllowed: ["admin","super_admin"],                                    sortOrder: 817.6, center: "compliance", internalAlias: true },
  { path: "/dashboard/admin/policy-exceptions",         title: "Policy Exceptions",         group: "admin", icon: "AlertTriangle",rolesAllowed: ["admin","super_admin"],                                    sortOrder: 817.7, center: "compliance", internalAlias: true },
  { path: "/dashboard/admin/policy-alerts",             title: "Policy Alerts",             group: "admin", icon: "Bell",         rolesAllowed: ["admin","super_admin"],                                    sortOrder: 817.8, center: "compliance", internalAlias: true },
  { path: "/dashboard/admin/payment-journey",           title: "Payment Journey",           group: "admin", icon: "Activity",     rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 795.1, center: "finance",    internalAlias: true },
  { path: "/dashboard/admin/payment-certification",     title: "Payment Certification",     group: "admin", icon: "ShieldCheck",  rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 795.2, center: "finance",    internalAlias: true },
  { path: "/dashboard/admin/payment-ops",               title: "Payment Operations Center", group: "admin", icon: "Radar",        rolesAllowed: ["admin","super_admin","finance_admin"],                    sortOrder: 795.3, center: "finance",    internalAlias: true },

  // ---------- Staff Portal modules (declared in App.tsx under /staff/*) ----------
  // Registered here so the navigation-integrity gate, sitemap and route guards
  // all resolve the same canonical set. Access is enforced by RequireStaffPortal.
  { path: "/staff/search",               title: "Staff Search",                 group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/workflow",             title: "Workflow Studio",              group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/departments/:slug",    title: "Department Detail",            group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/org/people/:staffId",  title: "Staff Profile",                group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/partners/funnel/:sessionId", title: "Partner Journey Detail", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/assessment/:interviewId", title: "Interview Assessment", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/adaptive",             title: "Adaptive Operations",          group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/value",                title: "Value Engine",                 group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/forensics",            title: "Operational Forensics",        group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/control-tower",        title: "Control Tower",                group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/ask-yalla",            title: "Ask TaxiD",                    group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/commerce-os",          title: "Commerce OS",                  group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/commerce-os/review",   title: "Financial Capture Review",     group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true, internalAlias: true },
  { path: "/staff/closure",              title: "Economic Closure",             group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/expansion",            title: "Market Expansion",             group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/orchestration",        title: "Mission Control",              group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/adaptive-marketplace", title: "Adaptive Marketplace",         group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/readiness",            title: "Operational Readiness",        group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true, internalAlias: true },
  { path: "/staff/org",                  title: "Organisation Management",      group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/org/links",            title: "Staff Account Links",          group: "admin", rolesAllowed: ["admin","super_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/org/people",           title: "People Management",            group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/org/objectives",       title: "Objectives Management",        group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/org/work",             title: "Work Queue",                   group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/org/baseline",         title: "Sales Baseline",               group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/org/performance",      title: "Performance Scorecards",       group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/org/audit",            title: "Staff Audit Trail",            group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/customers/documents",  title: "Document OS",                  group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/commercial/charter",   title: "Corporate Charter Commercial", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/commercial/documents", title: "Commercial Document Control", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/commercial/templates", title: "Commercial Document Templates", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/commercial/proforma", title: "Proforma Invoices", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/commercial/invoices", title: "Tax Invoices", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/commercial/collections", title: "Payment Collections", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/commercial/rate-cards", title: "Rate Card Portal", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  // Amendment billing raises invoices + payment tasks against signed contracts:
  // internal staff surface, role-gated to the staff portal roles, never indexed.
  { path: "/staff/commercial/amendment-billing", title: "Contract Amendment Billing", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment", title: "Recruitment 360", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/vacancies", title: "Recruitment Vacancies", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/pipeline", title: "Applicant Pipeline", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/selection", title: "Vacancy 360 Selection Console", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/candidates", title: "Candidate Register", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/interviews", title: "Interviews & Evaluations", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/offers", title: "Offer Management", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/onboarding", title: "Onboarding Handover", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/screening", title: "Recruitment Screening", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/shortlist", title: "Recruitment Shortlisting", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/evaluations", title: "Recruitment Evaluations", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/suitability", title: "Role Suitability", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/partner-leads", title: "Partner Leads in Recruitment 360", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/role-applications", title: "Applications & Candidate CVs", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/talent-pool", title: "Talent Pool", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/communications", title: "Recruitment Communications", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/internships/new", title: "Internship Programme Builder", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/questions", title: "Assessment Question Governance", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/assessments", title: "Assessment Blueprints & Papers", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/applications/:applicationId", title: "Application Review Record", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/comparison", title: "Candidate Comparison", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/interns/recruitment", title: "Intern Recruitment Pipeline", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/interns/supply", title: "Intern Supply Command", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/interns/programmes/new", title: "Internship Programme Builder (redirect)", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin"], sortOrder: 72, hideFromSitemap: true, internalAlias: true },
  { path: "/staff/partners/work", title: "Partner Work Queues", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/partners/fleet-owner-conversion", title: "Fleet Owner Conversion", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/partners/fleet-owner-queue", title: "Fleet Owner Queue", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/sales", title: "Sales Portal", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","operations_manager"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/sales/pipeline", title: "Lead Pipeline", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","operations_manager"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/partners/supply", title: "Partner Supply Control Tower", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/partners/matching", title: "Partner Demand & Matching Desk", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/partners/risk", title: "Partner Risk Centre", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/partners/funnel", title: "Partner Funnel Analytics", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/partners/tasks", title: "Partner Lifecycle Task Queue", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/partners/white-label", title: "White-Label Operations Console", group: "admin", rolesAllowed: ["admin","super_admin","operations_admin","finance_admin","compliance_admin"], sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/marketing/social", title: "Social Publishing", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/audit", title: "Security Audit", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72.5, hideFromSitemap: true },
  { path: "/staff/documents/security", title: "Document Security Centre", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72.5, hideFromSitemap: true },
  { path: "/staff/documents/collateral", title: "Company Collateral", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72.6, hideFromSitemap: true },
  { path: "/staff/recruitment/letters", title: "Communications & Letter Centre", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/templates", title: "Recruitment Templates", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/settings", title: "Recruitment Settings", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/requirements", title: "Requirement Version History", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/analytics", title: "Recruitment Analytics", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/publication-health", title: "Publication Health", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 72, hideFromSitemap: true },
  { path: "/staff/recruitment/import", title: "Candidate Import Centre", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 73, hideFromSitemap: true },
  { path: "/staff/recruitment/import/new", title: "New Candidate Import", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 74, hideFromSitemap: true },
  { path: "/staff/recruitment/import/worker", title: "Import Worker Monitor", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 75, hideFromSitemap: true },
  { path: "/staff/recruitment/import/reconciliation", title: "Import Reconciliation", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 76, hideFromSitemap: true },
  { path: "/staff/recruitment/conflicts/:id", title: "Conflict Resolution", group: "admin", rolesAllowed: STAFF_PORTAL_ROLES, sortOrder: 77, hideFromSitemap: true },


  // ---------- Admin / corporate surfaces previously missing from the registry ----------
  { path: "/dashboard/admin/brand-governance",       title: "Brand Governance",          group: "admin", icon: "Palette",     rolesAllowed: ["admin","super_admin"],                 sortOrder: 850.1, center: "system",    internalAlias: true },
  { path: "/dashboard/admin/scheduled-job-health",   title: "Scheduled Job Health",      group: "admin", icon: "Activity",    rolesAllowed: ["admin","super_admin"],                 sortOrder: 850.2, center: "system",    internalAlias: true },
  { path: "/dashboard/admin/corporate-wallet-finance", title: "Corporate Wallet Finance", group: "admin", icon: "Wallet",     rolesAllowed: ["admin","super_admin","finance_admin"], sortOrder: 795.4, center: "finance",   internalAlias: true },
  { path: "/dashboard/corporate-charter/booking",     title: "Enterprise Booking Centre", group: "corporate", icon: "CalendarPlus", rolesAllowed: ["corporate_admin","corporate_manager","corporate_employee","corporate_finance","corporate_approver","admin","super_admin"], sortOrder: 640.1, hideFromSitemap: true },
  { path: "/dashboard/charter/book/:slug",            title: "Charter Booking",           group: "corporate", icon: "CalendarPlus", rolesAllowed: ["corporate_admin","corporate_manager","corporate_employee","corporate_finance","corporate_approver","admin","super_admin"], sortOrder: 640.2, hideFromSitemap: true },
  { path: "/dashboard/corporate-charter/wallets",     title: "Charter Wallets",           group: "corporate", icon: "Wallet",  rolesAllowed: ["corporate_admin","corporate_finance","admin","super_admin"], sortOrder: 640.2, hideFromSitemap: true },
  { path: "/dashboard/charter/business",              title: "Charter Business Portal",   group: "corporate", icon: "Building", rolesAllowed: ["charter_operator","operator","operations_admin","admin","super_admin"], sortOrder: 645, hideFromSitemap: true, internalAlias: true },
  { path: "/verify-document",                         title: "Verify Document",           group: "marketing", rolesAllowed: [], sortOrder: 721.5, internalAlias: true },
  { path: "/verify/document",                         title: "Verify Document Authenticity", group: "marketing", rolesAllowed: [], sortOrder: 721.7, internalAlias: true },
  { path: "/verify/letter",                           title: "Verify Recruitment Letter", group: "marketing", rolesAllowed: [], sortOrder: 721.6, internalAlias: true },
  { path: "/recruitment/respond",                     title: "Interview Response",        group: "marketing", rolesAllowed: [], sortOrder: 721.7, hideFromSitemap: true, internalAlias: true },
  { path: "/recruitment/assessment",                   title: "Profession Assessment",      group: "marketing", rolesAllowed: [], sortOrder: 721.9, hideFromSitemap: true, internalAlias: true },
  { path: "/recruitment/acknowledge",                 title: "Acknowledge Document",      group: "marketing", rolesAllowed: [], sortOrder: 721.8, hideFromSitemap: true, internalAlias: true },

  { path: "/corporate/access-required",               title: "Corporate Access Required", group: "auth", rolesAllowed: [], sortOrder: 999, hideFromSitemap: true, internalAlias: true },
]);




export const ROUTE_BY_PATH: Map<string, RouteDef> = new Map(ROUTES.map(r => [r.path, r]));

export function routeFor(path: string): RouteDef | undefined {
  // Exact match first, then strip dynamic tail segments
  if (ROUTE_BY_PATH.has(path)) return ROUTE_BY_PATH.get(path);
  // Match parameterized routes (e.g. /dashboard/admin/tax/:tab)
  const segments = path.split("/").filter(Boolean);
  while (segments.length > 0) {
    segments.pop();
    const candidate = "/" + segments.join("/");
    if (ROUTE_BY_PATH.has(candidate)) return ROUTE_BY_PATH.get(candidate);
  }
  return undefined;
}

export function canAccess(route: RouteDef | undefined, roles: string[]): boolean {
  if (!route) return false;
  if (route.rolesAllowed.length === 0) return true; // public
  // Super admin is the platform-wide authority and may view every surface.
  // This governs navigation only — database policies still decide what data loads.
  if (roles.includes("super_admin")) return true;
  return route.rolesAllowed.some(r => roles.includes(r));
}


export function sidebarFor(roles: string[]): RouteDef[] {
  return ROUTES
    .filter(r => r.showInSidebar)
    // Sidebar stays scoped to the roles actually granted, so it does not list
    // every surface in the platform for a super admin.
    .filter(r => r.rolesAllowed.length === 0 || r.rolesAllowed.some(x => roles.includes(x)))
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
}


/** Primary group for a user — first sidebar group they have access to. */
export function primaryGroupFor(roles: string[]): RouteGroup {
  if (roles.includes("admin") || roles.includes("super_admin")) return "admin";
  if (roles.includes("driver")) return "driver";
  if (roles.includes("corporate_admin") || roles.includes("corporate_employee")) return "corporate";
  return "rider";
}
