/**
 * Canonical route classification — the layer the whole navigation integrity
 * contract is built on:
 *
 *   NAVIGATION DOMAIN MODEL → HEADER/FOOTER/SITEMAP → CANONICAL ROUTES →
 *   PAGE MODEL → CAPABILITY MODEL → AUTHORIZATION → BACKEND SERVICES
 *
 * Every route the platform exposes falls into exactly one class. Build-time
 * scripts (sitemap, SEO, orphan report, crawler) and the Playwright permission
 * matrix all read these classes so a route can never be indexed, linked or
 * gated inconsistently across surfaces.
 */
import { ROUTES, type AppRole } from "@/lib/routes";
import { LEGACY_PRICING_ROUTES, PRICING_360_CANONICAL } from "@/lib/pricing360/legacyRoutes";

export type RouteClass =
  /** Reachable and indexable by anyone. */
  | "PUBLIC"
  /** Reachable by anyone, deliberately NOT indexable (auth + transaction state). */
  | "PUBLIC_UNINDEXED"
  /** Requires a session, any role. */
  | "AUTHENTICATED"
  /** Requires a session AND one of an explicit role set. */
  | "ROLE_PROTECTED"
  /** Only resolves to another canonical route. */
  | "REDIRECT"
  /** Internal operating surface — never part of public navigation or SEO. */
  | "INTERNAL";

/**
 * Routes that src/lib/routes.ts declares role-free, but whose page component is
 * wrapped in a SESSION guard (RiderShell / RouteGuard / DashboardLayout) and so
 * redirects a signed-out visitor to a login gateway at runtime.
 *
 * Declaring them here is what stops the platform from promising a guest a
 * surface it will immediately refuse, and from indexing it for search.
 */
export const SESSION_GATED = new Set<string>([
  "/rider",
  "/rider/airport",
  "/rider/safety",
  "/rider/schedule",
  "/rider/trips",
  "/rider/wallet",
  "/rider/favorites",
  "/rider/rewards",
  "/dashboard/my-account",
  "/dashboard/service-requests",
]);

/**
 * Auth / transactional-state surfaces: publicly reachable, deliberately NOT
 * indexable and deliberately NOT sitemap members.
 */
export const NON_INDEXABLE_PUBLIC = new Set<string>([
  ...SESSION_GATED,
  "/auth",
  "/reset-password",
  "/verify",
  "/verify-document",
  "/unauthorized",
  "/unsubscribe",
  "/corporate/login",
  "/clients/login",
  "/corporate/access-required",
  "/charter/login",
  // Token-credentialled client surface: reachable without a session, never indexed.
  "/contract-portal",
  "/charter/booking-status",
  "/delivery/portal",
  "/staff",
  "/inspect",
  "/health",
  "/deploy-smoke",
  "/design/status-tokens",
  "/rider/trips",
  "/rider/wallet",
  "/rider/favorites",
  "/rider/rewards",
  "/rider/schedule",
  "/driver/dashboard",
  "/driver/earnings",
  "/driver/onboarding",
  "/driver/start",
]);

/**
 * Canonical → redirected variants. Every alias here is intentionally excluded
 * from the sitemap because it resolves to the canonical entry; the SEO check
 * asserts the canonical target IS present so an alias never hides a page.
 */
export const REDIRECT_ALIASES: Record<string, string> = {
  ...Object.fromEntries(
    Object.keys(LEGACY_PRICING_ROUTES).map((p) => [p, PRICING_360_CANONICAL] as const),
  ),
  // Aliases below MUST be declared in src/App.tsx as <Navigate> routes; the
  // crawler fails when a declared alias is not actually implemented.
  // `/corporate` is now a real public page (the company profile), not an alias.
  "/charter/bus": "/charter/bus-charter",
  "/logistics/courier": "/delivery/courier",
  "/logistics/package": "/delivery/package",
  "/delivery/track": "/track",
  "/staff/interns/programmes/new": "/staff/recruitment/internships/new",
  "/carrier-applications": "/partner/fleet-owner/apply",
};

const INTERNAL_PREFIXES = ["/staff", "/inspect", "/deploy-smoke", "/design/"];

const byPath = new Map(ROUTES.map((r) => [r.path, r] as const));

export interface RouteClassification {
  path: string;
  routeClass: RouteClass;
  rolesAllowed: AppRole[];
  /** Canonical target when the route is a redirect alias. */
  canonical?: string;
  /** Whether the route belongs in the sitemap. */
  indexable: boolean;
  /** True when the route is not present in src/lib/routes.ts at all. */
  unregistered: boolean;
}

export function classifyRoute(path: string): RouteClassification {
  const canonical = REDIRECT_ALIASES[path];
  const route = byPath.get(path);
  const rolesAllowed = (route?.rolesAllowed ?? []) as AppRole[];

  let routeClass: RouteClass;
  if (canonical) routeClass = "REDIRECT";
  else if (INTERNAL_PREFIXES.some((p) => path === p || path.startsWith(p))) routeClass = "INTERNAL";
  else if (rolesAllowed.length > 1) routeClass = "ROLE_PROTECTED";
  else if (rolesAllowed.length === 1) routeClass = "ROLE_PROTECTED";
  else if (SESSION_GATED.has(path)) routeClass = "AUTHENTICATED";
  else if (NON_INDEXABLE_PUBLIC.has(path)) routeClass = "PUBLIC_UNINDEXED";
  else routeClass = "PUBLIC";

  return {
    path,
    routeClass,
    rolesAllowed,
    canonical,
    indexable: routeClass === "PUBLIC",
    unregistered: !route && !canonical,
  };
}

/** Classifications for every registered route plus every redirect alias. */
export function classifyAllRoutes(): RouteClassification[] {
  const paths = new Set<string>([...ROUTES.map((r) => r.path), ...Object.keys(REDIRECT_ALIASES)]);
  return [...paths].sort().map(classifyRoute);
}

/** Resolves an alias chain to its terminal canonical path (loop-safe). */
export function resolveCanonical(path: string): { target: string; chain: string[]; loop: boolean } {
  const chain: string[] = [path];
  let current = path;
  const seen = new Set([path]);
  while (REDIRECT_ALIASES[current]) {
    current = REDIRECT_ALIASES[current];
    if (seen.has(current)) return { target: current, chain: [...chain, current], loop: true };
    seen.add(current);
    chain.push(current);
  }
  return { target: current, chain, loop: false };
}
