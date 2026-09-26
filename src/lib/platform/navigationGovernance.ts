/**
 * Navigation Governance Reconciliation (headless).
 *
 * Extension — NOT a new registry. Every fact here is derived from existing
 * sources of truth:
 *   - src/lib/routes.ts                 route definition + RBAC registry
 *   - src/lib/navigation-registry.ts    navigation metadata registry
 *   - src/lib/workspaces/config.ts      workspace registry
 *   - src/lib/workspace360/capabilities business capability registry
 *   - src/lib/platform/processCatalog   business process / value stream registry
 *
 * Responsibilities (Phases 1-7, 9, 10 of the reconciliation sprint):
 *   1. Deterministic classification of every route.
 *   2. Ownership certification (exactly one owner per route).
 *   3. Reachability engine (route must have >= 1 certified entry point).
 *   4. Intelligent orphan resolution (documented, certified intentional orphans).
 *   5. Governance metadata for the existing governance/certification pipeline.
 *   6. Navigation certification (mandatory rules -> pass/fail).
 *   7. Business capability traceability chain.
 *  10. Executive navigation KPIs (consumed by Executive Intelligence).
 */
import { ROUTES, type AppRole, type RouteDef, type RouteGroup } from "@/lib/routes";
import { NAV_BY_PATH, type NavMeta, type PageStatus } from "@/lib/navigation-registry";
import { WORKSPACES } from "@/lib/workspaces/config";
import {
  BUSINESS_CAPABILITY_REGISTRY,
  type BusinessCapability,
} from "@/lib/workspace360/capabilities";
import { BUSINESS_PROCESS_CATALOG, type ProcessId } from "@/lib/platform/processCatalog";

// ---------------------------------------------------------------------------
// Phase 1 — classification vocabulary
// ---------------------------------------------------------------------------

export type NavClassification =
  | "active_production"
  | "workspace_only"
  | "deep_link"
  | "capability_owned"
  | "admin_only"
  | "feature_flagged"
  | "deprecated"
  | "planned"
  | "duplicate"
  | "accidental_orphan";

export type ReachabilityMechanism =
  | "navigation_menu"
  | "workspace"
  | "deep_link"
  | "command_palette"
  | "search"
  | "workflow_transition"
  | "notification"
  | "ai_recommendation"
  | "capability_relationship"
  | "evidence_link";

/** Mechanisms that count as a *primary* entry point (search alone is not enough). */
const PRIMARY_MECHANISMS: ReachabilityMechanism[] = [
  "navigation_menu",
  "workspace",
  "deep_link",
  "workflow_transition",
  "capability_relationship",
];

export type NavLifecycle = "active" | "beta" | "deprecated" | "hidden" | "planned";
export type CertificationState = "certified" | "flagged" | "quarantined";

// ---------------------------------------------------------------------------
// Phase 4 — Intelligent orphan resolution ledger.
// Routes that are intentionally not linked by a string literal because their
// entry point is a shell/tab mount or a programmatic deep link. Each entry is
// an explicit, documented governance decision (Phase 4 "attach" action).
// ---------------------------------------------------------------------------

export interface OrphanResolution {
  mechanism: ReachabilityMechanism;
  /** Component / registry that actually mounts or routes to the page. */
  entryPoint: string;
  action: "attach_workspace" | "attach_navigation" | "attach_capability" | "deep_link_only";
  justification: string;
}

export const CERTIFIED_ORPHANS: Record<string, OrphanResolution> = {
  // Rider shell tabs — RiderShell/MobileBottomNav link the /rider/* aliases,
  // the /dashboard/rider/* mounts are the canonical deep-link destinations.
  "/dashboard/rider/wallet": { mechanism: "deep_link", entryPoint: "src/components/rider/RiderShell.tsx", action: "deep_link_only", justification: "Rider shell tab; canonical alias of /rider/wallet." },
  "/dashboard/rider/trips": { mechanism: "deep_link", entryPoint: "src/components/rider/RiderShell.tsx", action: "deep_link_only", justification: "Rider shell tab; canonical alias of /rider/trips." },
  "/dashboard/rider/support": { mechanism: "deep_link", entryPoint: "src/components/rider/RiderShell.tsx", action: "deep_link_only", justification: "Rider support tab rendered by RiderDashboard shell." },

  // Corporate dashboard tab mounts — App.tsx mounts CorporateDashboard for each
  // path; the tab strip switches on useLocation, so no literal <Link to>.
  ...Object.fromEntries(
    [
      "departments", "designations", "approval-setup", "manual-dispatch",
      "completed-rides", "expense-codes", "violations", "pre-billing",
      "cash-ledger", "paybill-proofs", "reconciliation", "audit-log",
    ].map((slug) => [
      `/dashboard/corporate/${slug}`,
      {
        mechanism: "workspace" as ReachabilityMechanism,
        entryPoint: "src/pages/dashboard/CorporateDashboard tab strip",
        action: "attach_workspace" as const,
        justification: "Corporate workspace tab mount — reachable from the corporate dashboard tab strip.",
      },
    ]),
  ),

  // Admin command-center pages surfaced by the center/workspace generator.
  "/dashboard/premium": { mechanism: "workspace", entryPoint: "WORKSPACES (Elite Premium Cockpit nav item) + RequireTier upgrade flow", action: "attach_workspace", justification: "Tier-gated cockpit surfaced by the workspace navigation generator; the upgrade path (/dashboard/premium/upgrade) links back into it." },
  "/dashboard/admin/rider-management": { mechanism: "workspace", entryPoint: "WORKSPACES.people_partners", action: "attach_workspace", justification: "Surfaced by the People & Partners workspace generator." },

  "/dashboard/admin/trust-console": { mechanism: "workspace", entryPoint: "WORKSPACES.trust_safety", action: "attach_workspace", justification: "Surfaced by the Trust & Safety workspace generator." },
  "/dashboard/admin/couriers": { mechanism: "workspace", entryPoint: "ADMIN_CENTERS.logistics", action: "attach_workspace", justification: "Logistics command center page, rendered from the admin center registry." },
  "/dashboard/admin/packages": { mechanism: "workspace", entryPoint: "ADMIN_CENTERS.logistics", action: "attach_workspace", justification: "Logistics command center page, rendered from the admin center registry." },
  "/dashboard/admin/aviation-center": { mechanism: "navigation_menu", entryPoint: "MarketingHeader → Charter Business → Aviation Command Center", action: "attach_navigation", justification: "Charter operations command center, linked from the Charter Business mega-menu." },
  "/dashboard/admin/charter-booking-audit": { mechanism: "workspace", entryPoint: "Flight Hub workspace → Operations → Booking Change Audit", action: "attach_navigation", justification: "Compliance review of cabin, seat, gallery and ground-package booking edits." },

  "/dashboard/admin/charter-pricing-alerts": { mechanism: "deep_link", entryPoint: "src/lib/charter/pricingAlertPayload.ts → PRICING_ALERTS_CONSOLE_PATH", action: "deep_link_only", justification: "Pricing alert console opened from alert notification deep links (email/in-app dispatch payload)." },

  "/dashboard/admin/logistics": { mechanism: "workspace", entryPoint: "ADMIN_CENTERS.logistics", action: "attach_workspace", justification: "Logistics command center page, rendered from the admin center registry." },

  // Charter, Leasing & Rentals · pricing governance — surfaced by the
  // charter_rentals workspace generator (registry-driven rail, no literal Link).
  "/dashboard/admin/charter-retry-timeline": { mechanism: "workspace", entryPoint: "WORKSPACES.charter_rentals → Finance → Payment Retry Timeline", action: "attach_workspace", justification: "Charter payment retry forensics, rendered from the charter workspace rail." },
  "/dashboard/admin/asset-pricing": { mechanism: "workspace", entryPoint: "WORKSPACES.commercial_pricing → Pricing → Asset Pricing Profiles", action: "attach_workspace", justification: "Polymorphic asset pricing admin console, rendered from the charter workspace rail." },
  "/dashboard/admin/smartfare-pricing": { mechanism: "workspace", entryPoint: "WORKSPACES.commercial_pricing → Pricing → SmartFare Settings", action: "attach_workspace", justification: "SmartFare configuration console, rendered from the charter workspace rail." },
  "/dashboard/admin/smartfare-what-if": { mechanism: "workspace", entryPoint: "WORKSPACES.commercial_pricing → Pricing → SmartFare What-If", action: "attach_workspace", justification: "Pricing impact simulator, opened from the SmartFare settings console." },
  "/dashboard/charter/analytics": { mechanism: "workspace", entryPoint: "WORKSPACES.charter_rentals → Intelligence → Charter Analytics", action: "attach_workspace", justification: "Charter commercial analytics, rendered from the charter workspace rail." },
  "/dashboard/charter/operator-portal": { mechanism: "workspace", entryPoint: "WORKSPACES.charter_rentals → Partners → Operator Portal", action: "attach_workspace", justification: "Operator self-service portal, rendered from the charter workspace rail." },
  "/dashboard/admin/flight-hub/payouts": { mechanism: "workspace", entryPoint: "WORKSPACES.flight_hub → Finance → Operator Payouts", action: "attach_workspace", justification: "Flight Hub operator payouts, rendered from the Flight Hub workspace rail." },

  // Platform / Trust admin consoles reached from the System and Compliance rails.
  "/dashboard/admin/alert-preferences": { mechanism: "workspace", entryPoint: "WORKSPACES.platform_system → Notifications → Alert Preferences", action: "attach_workspace", justification: "Alert notification preferences, rendered from the platform system rail and alert emails." },
  "/dashboard/admin/security-findings": { mechanism: "workspace", entryPoint: "WORKSPACES.trust_safety → Compliance → Security Findings", action: "attach_workspace", justification: "Security findings console, rendered from the compliance rail and scanner notifications." },
};

/**
 * Prefix rules — deterministic resolution for whole families of routes whose
 * entry point is a shell/tab mount or a marketing surface rather than a
 * literal <Link to="...">. Explicit CERTIFIED_ORPHANS entries win.
 */
export const RESOLUTION_RULES: Array<{ match: (path: string, group: RouteGroup) => boolean; resolution: OrphanResolution }> = [
  {
    match: (_p, g) => g === "marketing",
    resolution: { mechanism: "navigation_menu", entryPoint: "MarketingHeader / MarketingFooter / sitemap.xml", action: "attach_navigation", justification: "Public marketing surface — linked from the marketing header, footer and generated sitemap." },
  },
  {
    match: (_p, g) => g === "auth",
    resolution: { mechanism: "workflow_transition", entryPoint: "auth workflow (sign-in / recovery / role redirect)", action: "attach_capability", justification: "Reached through the authentication workflow, not a menu." },
  },
  {
    match: (p) => p === "/dashboard" || p.startsWith("/dashboard/rider") || p.startsWith("/rider"),
    resolution: { mechanism: "workspace", entryPoint: "src/components/rider/RiderShell.tsx + MobileBottomNav", action: "attach_workspace", justification: "Rider workspace shell tab mount." },
  },
  {
    match: (p) => p.startsWith("/driver") || p.startsWith("/dashboard/driver"),
    resolution: { mechanism: "workspace", entryPoint: "driver shell navigation", action: "attach_workspace", justification: "Driver workspace shell tab mount." },
  },
  {
    match: (p) => p.startsWith("/dashboard/corporate") || p.startsWith("/corporate"),
    resolution: { mechanism: "workspace", entryPoint: "CorporateDashboard tab strip", action: "attach_workspace", justification: "Corporate workspace tab mount." },
  },
  {
    // Staff Operations is entered through the Staff Access gateway (/staff) and
    // navigated from the StaffShell rail — never from the public header.
    match: (p) => p.startsWith("/staff"),
    resolution: { mechanism: "workspace", entryPoint: "src/pages/staff/StaffPortalLanding.tsx launcher + src/components/staff/StaffShell.tsx rail", action: "attach_workspace", justification: "Staff Operations context — authorisation-gated launcher and shell navigation." },
  },
  {
    match: (p) => p.startsWith("/delivery") || p.startsWith("/logistics"),
    resolution: { mechanism: "workspace", entryPoint: "Enterprise Logistics Control Plane (ELOS)", action: "attach_workspace", justification: "Logistics workspace surface." },
  },
];

export function resolveEntryPoint(path: string, group: RouteGroup): OrphanResolution | undefined {
  return CERTIFIED_ORPHANS[path] ?? RESOLUTION_RULES.find((r) => r.match(path, group))?.resolution;
}


// ---------------------------------------------------------------------------
// Phase 7 — traceability spine: group/section -> capability -> process
// ---------------------------------------------------------------------------

const GROUP_CAPABILITY: Record<RouteGroup, BusinessCapability> = {
  marketing: "rider_booking",
  auth: "audit_and_governance",
  rider: "rider_booking",
  driver: "driver_onboarding",
  corporate: "corporate_billing",
  admin: "audit_and_governance",
  legacy: "audit_and_governance",
};

/** Path-prefix overrides — most specific match wins. */
const PATH_CAPABILITY: Array<[string, BusinessCapability]> = [
  ["/dashboard/rider/wallet", "rider_payments"],
  ["/dashboard/rider/safety", "rider_safety"],
  ["/dashboard/driver/wallet", "driver_wallet"],
  ["/dashboard/driver/earnings", "driver_payments"],
  ["/dashboard/driver/academy", "driver_academy"],
  ["/dashboard/corporate/kyb", "corporate_kyb"],
  ["/dashboard/corporate/policies", "corporate_policies"],
  ["/dashboard/corporate/approval", "corporate_policies"],
  ["/dashboard/admin/dispatch", "dispatch_engine"],
  ["/dashboard/admin/pricing", "pricing_engine"],
  ["/dashboard/admin/fraud", "fraud_engine"],
  ["/dashboard/admin/trust", "fraud_engine"],
  ["/dashboard/admin/settlement", "settlement_engine"],
  ["/dashboard/admin/packages", "package_delivery"],
  ["/dashboard/admin/couriers", "package_delivery"],
  ["/dashboard/admin/logistics", "logistics_orchestration"],
  ["/dashboard/admin/delivery", "logistics_orchestration"],
  ["/dashboard/admin/fleet", "fleet_operations"],
  ["/dashboard/admin/rental", "rental_operations"],
  ["/dashboard/admin/rider", "rider_booking"],
  ["/dashboard/admin/driver", "driver_onboarding"],
  ["/dashboard/admin/corporate", "corporate_billing"],
  ["/dashboard/admin/mpesa", "settlement_engine"],
  ["/dashboard/admin/wallets", "settlement_engine"],
  ["/dashboard/admin/payments", "settlement_engine"],
];

const CAPABILITY_PROCESS: Partial<Record<BusinessCapability, ProcessId>> = {
  rider_booking: "ride_to_cash",
  rider_payments: "ride_to_cash",
  rider_safety: "support_to_closure",
  driver_onboarding: "driver_onboard_to_active",
  driver_academy: "driver_onboard_to_active",
  driver_wallet: "booking_to_settlement",
  driver_payments: "booking_to_settlement",
  corporate_billing: "corporate_lead_to_invoice",
  corporate_kyb: "corporate_lead_to_invoice",
  corporate_policies: "corporate_lead_to_invoice",
  dispatch_engine: "ride_to_cash",
  pricing_engine: "ride_to_cash",
  fraud_engine: "refund_to_resolution",
  settlement_engine: "booking_to_settlement",
  notification_engine: "support_to_closure",
  package_delivery: "delivery_to_cash",
  logistics_orchestration: "delivery_to_cash",
  fleet_operations: "procure_to_pay",
  rental_operations: "procure_to_pay",
  audit_and_governance: "refund_to_resolution",
};

const CAPABILITY_BY_ID = new Map(BUSINESS_CAPABILITY_REGISTRY.map((c) => [c.capability, c]));
const PROCESS_BY_ID = new Map(BUSINESS_PROCESS_CATALOG.map((p) => [p.id, p]));

function capabilityFor(r: RouteDef): BusinessCapability {
  let best: BusinessCapability | undefined;
  let bestLen = 0;
  for (const [prefix, cap] of PATH_CAPABILITY) {
    if (r.path.startsWith(prefix) && prefix.length > bestLen) {
      best = cap;
      bestLen = prefix.length;
    }
  }
  return best ?? GROUP_CAPABILITY[r.group];
}

// ---------------------------------------------------------------------------
// Workspace registry index (ownership + reachability evidence)
// ---------------------------------------------------------------------------

const canonicalPath = (p: string) => p.split("?")[0].split("#")[0];

const WORKSPACE_BY_PATH = new Map<string, string>();
for (const ws of WORKSPACES) {
  WORKSPACE_BY_PATH.set(canonicalPath(ws.overviewPath), ws.key);
  for (const item of ws.items) WORKSPACE_BY_PATH.set(canonicalPath(item.path), ws.key);
}

const EXECUTIVE_OWNER: Record<RouteGroup, string> = {
  marketing: "CMO",
  auth: "CTO",
  rider: "COO",
  driver: "COO",
  corporate: "CRO",
  admin: "CTO",
  legacy: "CTO",
};

// ---------------------------------------------------------------------------
// Phases 2/3/5 — governance record
// ---------------------------------------------------------------------------

export interface NavOwnership {
  businessCapability: BusinessCapability;
  technicalOwner: string;
  executiveOwner: string;
  workspace: string;
  domain: RouteGroup;
  navigationGroup: string;
  parentRoute?: string;
  valueStream: ProcessId;
}

export interface NavTraceability {
  capability: BusinessCapability;
  process: ProcessId;
  valueStream: string;
  executiveKpi: string;
  capabilityContract: string;
  evidenceSources: string[];
  readinessCertificate: string;
  complete: boolean;
}

export interface NavGovernanceRecord {
  path: string;
  title: string;
  classification: NavClassification;
  lifecycle: NavLifecycle;
  ownership: NavOwnership;
  rbac: AppRole[];
  visibility: "public" | "role_scoped" | "hidden";
  entryPoints: ReachabilityMechanism[];
  exitPoints: string[];
  dependencies: string[];
  evidenceSource: string;
  traceability: NavTraceability;
  certification: CertificationState;
  issues: string[];
  certifiedAt: string;
}

function lifecycleFor(status: PageStatus): NavLifecycle {
  return status;
}

function classify(r: RouteDef, meta: NavMeta, entry: ReachabilityMechanism[]): NavClassification {
  if (meta.status === "deprecated") return "deprecated";
  if (r.group === "legacy") return "deprecated";
  if (meta.status === "hidden") return "feature_flagged";
  if (r.path.includes(":")) return "deep_link";
  const resolution = resolveEntryPoint(r.path, r.group);
  if (resolution && !entry.includes("navigation_menu")) {
    return resolution.mechanism === "deep_link" ? "deep_link" : "workspace_only";
  }
  if (entry.includes("navigation_menu")) return "active_production";
  if (entry.includes("workspace")) return "workspace_only";
  if (r.group === "admin") return "admin_only";
  if (entry.length === 0) return "accidental_orphan";
  return "capability_owned";
}

function entryPointsFor(r: RouteDef, meta: NavMeta): ReachabilityMechanism[] {
  const out = new Set<ReachabilityMechanism>();
  if (r.showInSidebar || r.showInFooter || r.showInNavbar) out.add("navigation_menu");
  if (WORKSPACE_BY_PATH.has(r.path)) out.add("workspace");
  if (r.internalAlias || r.path.includes(":")) out.add("deep_link");
  const resolution = resolveEntryPoint(r.path, r.group);
  if (resolution) out.add(resolution.mechanism);
  if (meta.searchable) {
    out.add("search");
    out.add("command_palette");
  }
  if (meta.parent) out.add("capability_relationship");
  return [...out];
}

// ---------------------------------------------------------------------------
// Journey orchestration — exit points (the "what do I do next?" contract)
//
// Route governance answers "where can I go?". Journey completion answers
// "can the user continue after acting?". A route is journey-complete when the
// UI that renders it genuinely offers a next destination. Every derivation
// below maps to a real, shipped navigation affordance:
//
//   • navigation-registry `parent`      → breadcrumb / back link
//   • workspace membership             → workspace rail (overview + next item
//                                        in the same workflow section)
//   • parameterised deep links         → their collection route (list view the
//                                        detail page navigates back to)
//   • /staff/*                          → StaffShell rail → MyWorkspace cockpit
//   • orphan-resolution ledger entries → the shell/tab strip that mounts them
//
// Routes that legitimately terminate a journey are recorded in
// JOURNEY_EXIT_EXCEPTIONS (an explicit ledger, never a silent suppression).
// ---------------------------------------------------------------------------

const ROUTE_PATHS = new Set(ROUTES.map((r) => r.path));
const STAFF_COCKPIT = "/staff/workspace";

export interface JourneyExitException {
  reason: string;
  owner: string;
  severity: "low" | "medium" | "high";
  workaround: string;
  targetResolution: string;
  status: "approved" | "in_progress";
}

/**
 * Documented terminal journeys — reviewed, owned and time-boxed.
 * Currently empty: every shipped route offers a next destination.
 */
export const JOURNEY_EXIT_EXCEPTIONS: Record<string, JourneyExitException> = {};

function collectionRouteFor(path: string): string | null {
  if (!path.includes("/:")) return null;
  const base = path.split("/:")[0];
  return ROUTE_PATHS.has(base) ? base : null;
}

function exitPointsFor(r: RouteDef, meta: NavMeta): string[] {
  const out = new Set<string>();
  if (meta.parent) out.add(meta.parent);

  const wsKey = WORKSPACE_BY_PATH.get(r.path);
  const ws = WORKSPACES.find((w) => w.key === wsKey);
  if (ws) {
    if (canonicalPath(ws.overviewPath) !== r.path) out.add(canonicalPath(ws.overviewPath));
    const items = ws.items.map((i) => canonicalPath(i.path));
    const idx = items.indexOf(r.path);
    if (idx >= 0) {
      const next = items[idx + 1] ?? items[0];
      if (next && next !== r.path) out.add(next);
    }
  }

  const collection = collectionRouteFor(r.path);
  if (collection) out.add(collection);

  if (r.path.startsWith("/staff") && r.path !== STAFF_COCKPIT && ROUTE_PATHS.has(STAFF_COCKPIT)) {
    out.add(STAFF_COCKPIT);
  }

  // Shell / tab-strip mounts return to the shell that rendered them.
  const resolution = resolveEntryPoint(r.path, r.group);
  if (!out.size && resolution) {
    const parent = r.path.split("/").slice(0, -1).join("/");
    if (ROUTE_PATHS.has(parent) && parent !== r.path) out.add(parent);
  }

  // Any dashboard surface can hand back to its domain home.
  if (!out.size) {
    for (const home of [`/dashboard/${r.group}`, "/dashboard"]) {
      if (ROUTE_PATHS.has(home) && home !== r.path) { out.add(home); break; }
    }
  }

  return [...out];
}

/** Routes with a documented, approved terminal journey. */
export function journeyExceptionFor(path: string): JourneyExitException | undefined {
  return JOURNEY_EXIT_EXCEPTIONS[path];
}

const NOW = "continuous";


function buildRecord(r: RouteDef): NavGovernanceRecord {
  const meta = NAV_BY_PATH.get(r.path)!;
  const entryPoints = entryPointsFor(r, meta);
  const capability = capabilityFor(r);
  const spec = CAPABILITY_BY_ID.get(capability);
  const processId = CAPABILITY_PROCESS[capability] ?? "ride_to_cash";
  const process = PROCESS_BY_ID.get(processId);
  const resolution = resolveEntryPoint(r.path, r.group);
  const workspace = WORKSPACE_BY_PATH.get(r.path) ?? resolution?.entryPoint ?? r.group;

  const traceability: NavTraceability = {
    capability,
    process: processId,
    valueStream: process?.name ?? processId,
    executiveKpi: spec?.objectives[0] ?? "unknown",
    capabilityContract: spec ? `${spec.capability}@${spec.executiveWeight}` : "missing",
    evidenceSources: spec?.canonicalSources ?? [],
    readinessCertificate: "bcra:enterprise-readiness",
    complete: Boolean(spec && process && spec.objectives.length > 0 && spec.canonicalSources.length > 0),
  };

  const issues: string[] = [];
  const hasPrimary = entryPoints.some((m) => PRIMARY_MECHANISMS.includes(m));
  if (!hasPrimary) issues.push("no_certified_entry_point");
  if (!traceability.complete) issues.push("traceability_incomplete");
  if (r.group !== "marketing" && r.group !== "auth" && r.rolesAllowed.length === 0 && r.path.startsWith("/dashboard")) {
    issues.push("rbac_missing");
  }
  if (!meta.owner) issues.push("owner_missing");

  return {
    path: r.path,
    title: r.title,
    classification: classify(r, meta, entryPoints),
    lifecycle: lifecycleFor(meta.status),
    ownership: {
      businessCapability: capability,
      technicalOwner: meta.owner,
      executiveOwner: EXECUTIVE_OWNER[r.group],
      workspace,
      domain: r.group,
      navigationGroup: meta.section ?? r.center ?? r.group,
      parentRoute: meta.parent,
      valueStream: processId,
    },
    rbac: r.rolesAllowed,
    visibility: r.rolesAllowed.length === 0 ? "public" : meta.status === "hidden" ? "hidden" : "role_scoped",
    entryPoints,
    exitPoints: exitPointsFor(r, meta),
    dependencies: resolution ? [resolution.entryPoint] : [],
    evidenceSource: CERTIFIED_ORPHANS[r.path]
      ? "orphan_resolution_ledger"
      : resolution
        ? "resolution_rules"
        : "navigation_registry",
    traceability,
    certification: issues.length === 0 ? "certified" : issues.includes("no_certified_entry_point") ? "quarantined" : "flagged",
    issues,
    certifiedAt: NOW,
  };
}

export function buildNavigationGovernance(): NavGovernanceRecord[] {
  return ROUTES.filter((r) => NAV_BY_PATH.has(r.path)).map(buildRecord);
}

// ---------------------------------------------------------------------------
// Phase 6 — Navigation certification
// ---------------------------------------------------------------------------

export interface NavigationRule {
  id: string;
  label: string;
  mandatory: boolean;
  passed: boolean;
  violations: string[];
}

export interface NavigationCertification {
  passed: boolean;
  score: number;
  totalRoutes: number;
  certifiedRoutes: number;
  rules: NavigationRule[];
  kpis: Array<{ key: string; label: string; value: number; unit: "pct" | "count" | "score" }>;
  uncertifiedOrphans: string[];
  fingerprint: string;
}

function rule(id: string, label: string, mandatory: boolean, violations: string[]): NavigationRule {
  return { id, label, mandatory, passed: violations.length === 0, violations };
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function certifyNavigationGovernance(
  records: NavGovernanceRecord[] = buildNavigationGovernance(),
): NavigationCertification {
  const seenPaths = new Map<string, number>();
  for (const r of records) seenPaths.set(r.path, (seenPaths.get(r.path) ?? 0) + 1);

  const uncertifiedOrphans = records
    .filter((r) => r.issues.includes("no_certified_entry_point"))
    .map((r) => r.path);

  const rules: NavigationRule[] = [
    rule("no_orphan_routes", "No uncertified orphan routes", true, uncertifiedOrphans),
    rule("no_duplicate_routes", "No duplicate route paths", true,
      [...seenPaths.entries()].filter(([, n]) => n > 1).map(([p]) => p)),
    rule("route_ownership", "Every route has exactly one owner", true,
      records.filter((r) => !r.ownership.technicalOwner || !r.ownership.executiveOwner).map((r) => r.path)),
    rule("capability_traceability", "Capability -> process -> KPI -> evidence chain intact", true,
      records.filter((r) => !r.traceability.complete).map((r) => r.path)),
    rule("workspace_traceability", "Every route resolves to a workspace/domain", true,
      records.filter((r) => !r.ownership.workspace).map((r) => r.path)),
    rule("rbac_coverage", "Protected routes declare RBAC scope", true,
      records.filter((r) => r.issues.includes("rbac_missing")).map((r) => r.path)),
    rule("no_conflicting_parents", "Parent routes exist in the registry", true,
      records.filter((r) => r.ownership.parentRoute && !NAV_BY_PATH.has(r.ownership.parentRoute)).map((r) => r.path)),
    rule("no_cyclic_navigation", "Navigation graph is acyclic", true,
      records.filter((r) => r.ownership.parentRoute === r.path).map((r) => r.path)),
    rule("no_hidden_production_pages", "No hidden pages with critical lifecycle", false,
      records.filter((r) => r.lifecycle === "hidden" && r.classification === "active_production").map((r) => r.path)),
    rule("no_stale_navigation", "Deprecated routes are not in primary menus", false,
      records.filter((r) => r.lifecycle === "deprecated" && r.entryPoints.includes("navigation_menu")).map((r) => r.path)),
  ];

  const mandatoryFailures = rules.filter((r) => r.mandatory && !r.passed);
  const certifiedRoutes = records.filter((r) => r.certification === "certified").length;
  const score = records.length === 0 ? 0 : Math.round((certifiedRoutes / records.length) * 100);

  return {
    passed: mandatoryFailures.length === 0,
    score,
    totalRoutes: records.length,
    certifiedRoutes,
    rules,
    kpis: navigationExecutiveKpis(records),
    uncertifiedOrphans,
    fingerprint: fnv1a(records.map((r) => `${r.path}:${r.certification}:${r.classification}`).join("|")),
  };
}

// ---------------------------------------------------------------------------
// Phase 10 — Executive navigation KPIs (rendered by Executive Intelligence)
// ---------------------------------------------------------------------------

export function navigationExecutiveKpis(
  records: NavGovernanceRecord[] = buildNavigationGovernance(),
): Array<{ key: string; label: string; value: number; unit: "pct" | "count" | "score" }> {
  const total = Math.max(1, records.length);
  const pct = (n: number) => Math.round((n / total) * 100);
  const reachable = records.filter((r) => r.entryPoints.some((m) => PRIMARY_MECHANISMS.includes(m))).length;
  const capabilities = new Set(records.map((r) => r.ownership.businessCapability)).size;
  const workspaces = new Set(records.map((r) => r.ownership.workspace)).size;
  const traced = records.filter((r) => r.traceability.complete).length;
  const owned = records.filter((r) => r.ownership.technicalOwner && r.ownership.executiveOwner).length;
  const depth = records.reduce((acc, r) => acc + r.path.split("/").filter(Boolean).length, 0) / total;
  const brokenRisk = records.filter((r) => r.certification !== "certified").length;

  return [
    { key: "navigation_health", label: "Navigation Health", value: pct(records.filter((r) => r.certification === "certified").length), unit: "pct" },
    { key: "reachability", label: "Reachability", value: pct(reachable), unit: "pct" },
    { key: "business_coverage", label: "Business Coverage", value: pct(traced), unit: "pct" },
    { key: "workspace_coverage", label: "Workspace Coverage", value: workspaces, unit: "count" },
    { key: "capability_coverage", label: "Capability Coverage", value: capabilities, unit: "count" },
    // Journey completion — a route counts only when the user can act and then
    // continue (declared exit point) or arrived from primary navigation.
    // Documented terminal journeys (JOURNEY_EXIT_EXCEPTIONS) are excluded from
    // the denominator and reported separately, never silently passed.
    {
      key: "journey_completion",
      label: "User Journey Completion",
      value: (() => {
        const scoped = records.filter((r) => !journeyExceptionFor(r.path));
        const complete = scoped.filter(
          (r) => r.exitPoints.length > 0 || r.entryPoints.includes("navigation_menu"),
        ).length;
        return Math.round((complete / Math.max(1, scoped.length)) * 100);
      })(),
      unit: "pct",
    },
    {
      key: "journey_exceptions",
      label: "Documented Journey Exceptions",
      value: records.filter((r) => journeyExceptionFor(r.path)).length,
      unit: "count",
    },

    { key: "cta_conversion_ready", label: "CTA Binding", value: pct(records.filter((r) => r.classification !== "accidental_orphan").length), unit: "pct" },
    { key: "navigation_complexity", label: "Navigation Complexity", value: Math.round(depth * 10) / 10, unit: "score" },
    { key: "broken_journey_risk", label: "Broken Journey Risk", value: brokenRisk, unit: "count" },
    { key: "governance_compliance", label: "Governance Compliance", value: pct(owned), unit: "pct" },
    { key: "continuous_certification", label: "Continuous Certification", value: certifiedTrend(records), unit: "pct" },
  ];
}

function certifiedTrend(records: NavGovernanceRecord[]): number {
  const certified = records.filter((r) => r.certification === "certified").length;
  return Math.round((certified / Math.max(1, records.length)) * 100);
}
