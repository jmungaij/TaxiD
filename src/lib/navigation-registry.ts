/**
 * Navigation Registry — Single source of truth for governance metadata.
 *
 * Extends src/lib/routes.ts (which stays the authoritative route table) with
 * discoverability, search, ownership, analytics, and status fields. The
 * Navigation Integrity Service, the Admin Command Center, Cmd+K search, and
 * the database table `app_pages` all read from this file.
 */
import { ROUTES, type RouteDef, type AppRole, type RouteGroup } from "./routes";

export type PageStatus = "active" | "beta" | "deprecated" | "hidden";
export type PageCriticality = "critical" | "high" | "normal" | "low";

export type AdminSection =
  | "operations"
  | "finance"
  | "compliance"
  | "security"
  | "analytics"
  | "users"
  | "integrations"
  | "platform";

export interface NavMeta {
  /** Route path (matches RouteDef.path) */
  path: string;
  /** Human-readable title */
  title: string;
  /** Source group from routes.ts */
  group: RouteGroup;
  /** Icon name (lucide) */
  icon?: string;
  /** Parent route — used to build breadcrumbs and the nav graph */
  parent?: string;
  /** Admin sub-section (only meaningful for admin group) */
  section?: AdminSection;
  /** Allowed roles (empty = public) */
  roles: AppRole[];
  /** Show in sidebar */
  showInSidebar: boolean;
  /** Should the page appear in Cmd+K results / search indexes */
  searchable: boolean;
  /** Should the page be linked from menus, command centers, sitemaps */
  discoverable: boolean;
  /** Team or individual responsible */
  owner: string;
  /** Lifecycle status */
  status: PageStatus;
  /** Business criticality */
  criticality: PageCriticality;
  /** Stable analytics key used by CTA + page-view tracking */
  analyticsKey: string;
  /** Short description shown in search & command center */
  description?: string;
  /** Free-form tags to broaden search */
  keywords?: string[];
}

// --- Per-route overrides for fields that aren't in ROUTES ---
// Keep this terse: only set what differs from the defaults below.
const OVERRIDES: Record<string, Partial<NavMeta>> = {
  // ---- Marketing CTAs ----
  "/": { criticality: "critical", owner: "growth", description: "Public marketing home", keywords: ["landing", "home"] },
  "/drivers": { owner: "growth", criticality: "high", keywords: ["earn", "drive", "partner"] },
  "/driver/apply": { owner: "growth", criticality: "critical", analyticsKey: "driver_application_started", keywords: ["apply", "signup"] },
  "/corporates": { owner: "growth", criticality: "high", keywords: ["business", "fleet"] },
  "/contact": { owner: "growth", criticality: "high", analyticsKey: "contact_cta" },
  "/pricing": { owner: "growth", criticality: "high" },

  // ---- Admin Command Center sections ----
  "/dashboard/admin": { section: "platform", owner: "platform", criticality: "critical", parent: "/dashboard" },
  "/dashboard/admin/users": { section: "users", owner: "platform", criticality: "critical", parent: "/dashboard/admin" },
  "/dashboard/admin/roles": { section: "users", owner: "platform", criticality: "critical", parent: "/dashboard/admin" },
  "/dashboard/admin/contact-submissions": { section: "operations", owner: "growth", parent: "/dashboard/admin" },
  "/dashboard/admin/settings": { section: "platform", owner: "platform", criticality: "high", parent: "/dashboard/admin" },
  "/dashboard/admin/navigation-health": { section: "platform", owner: "platform", criticality: "high", parent: "/dashboard/admin" },
  "/dashboard/admin/integrity-report":  { section: "platform", owner: "platform", criticality: "high", parent: "/dashboard/admin", keywords: ["integrity","nav","audit","report"] },
  "/dashboard/admin/integrity-gates":   { section: "platform", owner: "platform", criticality: "high", parent: "/dashboard/admin", keywords: ["gates","thresholds","ci"] },
  "/dashboard/admin/production-readiness": { section: "platform", owner: "platform", criticality: "high", parent: "/dashboard/admin", keywords: ["go","no-go","readiness","certification","audit"] },
  "/dashboard/admin/cta-analytics":     { section: "analytics", owner: "growth",   criticality: "high", parent: "/dashboard/admin", keywords: ["cta","conversion","clicks","funnel"] },
  "/dashboard/admin/integrity-audit":   { section: "platform", owner: "platform", criticality: "high", parent: "/dashboard/admin", keywords: ["audit","threshold","history","governance"] },


  "/dashboard/admin/mpesa": { section: "finance", owner: "finance", criticality: "critical", parent: "/dashboard/admin" },
  "/dashboard/admin/wallets": { section: "finance", owner: "finance", criticality: "critical", parent: "/dashboard/admin" },
  "/dashboard/admin/payments": { section: "finance", owner: "finance", criticality: "critical", parent: "/dashboard/admin" },
  "/dashboard/admin/tax": { section: "finance", owner: "finance", criticality: "high", parent: "/dashboard/admin" },
  "/dashboard/admin/analytics-export": { section: "analytics", owner: "data", parent: "/dashboard/admin" },
  "/dashboard/admin/fos": { section: "operations", owner: "ops", criticality: "high", parent: "/dashboard/admin" },

  "/dashboard/admin/compliance": { section: "compliance", owner: "compliance", criticality: "critical", parent: "/dashboard/admin" },
  "/dashboard/admin/compliance-alerts": { section: "compliance", owner: "compliance", criticality: "critical", parent: "/dashboard/admin" },
  "/dashboard/admin/kyc-types": { section: "compliance", owner: "compliance", parent: "/dashboard/admin" },
  "/dashboard/admin/governance": { section: "compliance", owner: "compliance", parent: "/dashboard/admin" },

  "/dashboard/admin/trust-center": { section: "security", owner: "trust-safety", criticality: "critical", parent: "/dashboard/admin" },
  "/dashboard/admin/fraud-center": { section: "security", owner: "trust-safety", criticality: "critical", parent: "/dashboard/admin" },
  "/dashboard/admin/identity-assurance": { section: "security", owner: "trust-safety", parent: "/dashboard/admin" },
  "/dashboard/admin/delivery-fraud": { section: "security", owner: "trust-safety", parent: "/dashboard/admin" },
  "/dashboard/admin/noc": { section: "operations", owner: "ops", criticality: "high", parent: "/dashboard/admin" },

  "/dashboard/admin/dispatch": { section: "operations", owner: "dispatch", criticality: "critical", parent: "/dashboard/admin" },
  "/dashboard/admin/dispatch/sim": { section: "operations", owner: "dispatch", parent: "/dashboard/admin/dispatch" },
  "/dashboard/admin/outbox": { section: "integrations", owner: "platform", parent: "/dashboard/admin" },
  "/dashboard/admin/academy": { section: "operations", owner: "training", parent: "/dashboard/admin" },
  "/dashboard/admin/lifecycle": { section: "operations", owner: "driver-ops", parent: "/dashboard/admin" },
  "/dashboard/admin/digital-twin": { section: "operations", owner: "driver-ops", parent: "/dashboard/admin" },

  // ---- Legacy ----
  "/app": { status: "deprecated", owner: "platform" },
  "/app/riders": { status: "deprecated", owner: "platform" },
  "/app/drivers": { status: "deprecated", owner: "platform" },
  "/app/trips": { status: "deprecated", owner: "platform" },
  "/app/schedule": { status: "deprecated", owner: "platform" },
};

function defaultOwner(group: RouteGroup): string {
  switch (group) {
    case "marketing": return "growth";
    case "auth": return "platform";
    case "rider": return "rider-experience";
    case "driver": return "driver-experience";
    case "corporate": return "corporate";
    case "admin": return "platform";
    case "legacy": return "platform";
  }
}

function buildMeta(r: RouteDef): NavMeta {
  const o = OVERRIDES[r.path] ?? {};
  const isParam = r.path.includes(":");
  return {
    path: r.path,
    title: r.title,
    group: r.group,
    icon: r.icon,
    parent: o.parent,
    section: o.section,
    roles: r.rolesAllowed,
    showInSidebar: r.showInSidebar ?? false,
    searchable: o.searchable ?? !isParam,
    discoverable: o.discoverable ?? (r.group !== "legacy" && !isParam),
    owner: o.owner ?? defaultOwner(r.group),
    status: o.status ?? "active",
    criticality: o.criticality ?? (r.showInSidebar ? "high" : "normal"),
    analyticsKey: o.analyticsKey ?? `page_${r.path.replace(/[/:]/g, "_").replace(/^_/, "")}`,
    description: o.description,
    keywords: o.keywords,
  };
}

export const NAV_REGISTRY: NavMeta[] = ROUTES.map(buildMeta);

export const NAV_BY_PATH = new Map(NAV_REGISTRY.map(n => [n.path, n]));

export function navMetaFor(path: string): NavMeta | undefined {
  return NAV_BY_PATH.get(path);
}

export function searchableEntries(): NavMeta[] {
  return NAV_REGISTRY.filter(n => n.searchable && n.status !== "deprecated" && n.status !== "hidden");
}

export function adminSectionEntries(): Record<AdminSection, NavMeta[]> {
  const out = {
    operations: [], finance: [], compliance: [], security: [],
    analytics: [], users: [], integrations: [], platform: [],
  } as Record<AdminSection, NavMeta[]>;
  for (const n of NAV_REGISTRY) {
    if (n.group !== "admin" || !n.section) continue;
    if (n.status === "hidden") continue;
    out[n.section].push(n);
  }
  return out;
}

export function buildPageGraph(): Array<{ from: string; to: string }> {
  return NAV_REGISTRY
    .filter(n => n.parent)
    .map(n => ({ from: n.parent!, to: n.path }));
}
