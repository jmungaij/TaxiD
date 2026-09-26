/**
 * Navigation registry SNAPSHOT + VALIDATION (browser-safe).
 *
 * A "navigation registry version" is a deterministic snapshot of everything the
 * platform promises through navigation:
 *   - the canonical public registry (header mega-panels + featured CTAs)
 *   - the footer projection of that registry
 *   - the protected portal surface (business domains → YEOS workspaces)
 *   - the route classification + capability binding of every destination
 *
 * The same audit functions the CI crawler runs (`auditSurface`,
 * `auditProtectedSurface`) produce the validation report here, so a version can
 * never be approved in the UI on weaker rules than the build gate applies.
 */
import {
  buildPrimaryNav,
  buildFooterColumns,
  navHref,
  navPathname,
  SIGN_IN_ITEMS,
  GET_STARTED,
  STAFF_PORTAL_SECTIONS,
  type NavChild,
  type NavItem,
} from "./primaryNav";
import { appLink } from "@/lib/appLinks";
import {
  auditSurface,
  auditProtectedSurface,
  capabilityIdFor,
  type NavContractRecord,
  type NavDestinationInput,
  type ProtectedNavRecord,
} from "./navigationContract";
import { classifyRoute, REDIRECT_ALIASES } from "./routeClassification";
import { discoverProtectedNav, ANY_AUTHENTICATED } from "./protectedNavSource";

export interface SnapshotDestination {
  to: string;
  path: string;
  label: string;
  surface: string;
  requiresAuth: boolean;
  external: boolean;
  href: string;
  routeClass: string;
  capabilityId?: string;
}

export interface NavRegistrySnapshot {
  /** Bumped whenever the snapshot SHAPE changes, so old versions stay readable. */
  schemaVersion: 1;
  generatedAt: string;
  categories: { label: string; itemCount: number }[];
  public: SnapshotDestination[];
  footer: { column: string; items: { label: string; to: string }[] }[];
  protectedSurface: {
    path: string;
    label: string;
    surface: string;
    surfaceRoles: string[];
  }[];
  counts: {
    categories: number;
    publicDestinations: number;
    footerLinks: number;
    protectedEntries: number;
  };
}

export interface NavValidationGate {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
  /** Human-readable failures, capped so the report stays storable. */
  failures: string[];
}

export interface NavValidationReport {
  passed: boolean;
  ranAt: string;
  snapshotHash: string;
  gates: NavValidationGate[];
  totals: { publicViolations: number; protectedViolations: number };
}

const APP_LINKS = {
  riderAndroid: appLink({ audience: "rider", platform: "android", placement: "nav-registry" }),
  riderIos: appLink({ audience: "rider", platform: "ios", placement: "nav-registry" }),
  driverAndroid: appLink({ audience: "driver", platform: "android", placement: "nav-registry" }),
  driverIos: appLink({ audience: "driver", platform: "ios", placement: "nav-registry" }),
};

function childrenOf(nav: NavItem[]): { child: NavChild; surface: string }[] {
  const out: { child: NavChild; surface: string }[] = [];
  for (const item of nav) {
    if (item.featured) out.push({ child: item.featured as NavChild, surface: `header:${item.label}:featured` });
    for (const group of item.groups ?? []) {
      for (const child of group.items) {
        out.push({ child, surface: `header:${item.label}${group.heading ? `:${group.heading}` : ""}` });
      }
    }
  }
  for (const child of SIGN_IN_ITEMS) out.push({ child, surface: "header:sign-in" });
  out.push({ child: GET_STARTED, surface: "header:get-started" });
  for (const section of STAFF_PORTAL_SECTIONS) {
    for (const child of section.items) {
      out.push({ child, surface: `staff-portal${section.heading ? `:${section.heading}` : ""}` });
    }
  }
  return out;
}

/** Stable, order-independent 64-bit FNV-1a hash of the snapshot content. */
export function hashSnapshot(snapshot: NavRegistrySnapshot): string {
  const stable = JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    public: snapshot.public
      .map((d) => `${d.surface}|${d.to}|${d.label}|${d.requiresAuth ? 1 : 0}`)
      .sort(),
    footer: snapshot.footer.flatMap((c) => c.items.map((i) => `${c.column}|${i.to}|${i.label}`)).sort(),
    protectedSurface: snapshot.protectedSurface
      .map((p) => `${p.surface}|${p.path}|${p.surfaceRoles.slice().sort().join(",")}`)
      .sort(),
  });
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < stable.length; i++) {
    h1 ^= stable.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 ^ stable.charCodeAt(stable.length - 1 - i), 0x85ebca6b) + i) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export function buildNavRegistrySnapshot(): NavRegistrySnapshot {
  const nav = buildPrimaryNav(APP_LINKS);
  const children = childrenOf(nav);

  const publicDestinations: SnapshotDestination[] = children.map(({ child, surface }) => {
    const path = navPathname(child.to);
    return {
      to: child.to,
      path,
      label: child.label,
      surface,
      requiresAuth: Boolean(child.requiresAuth),
      external: Boolean(child.external),
      href: child.external ? child.to : navHref(child),
      routeClass: child.external ? "EXTERNAL" : classifyRoute(path).routeClass,
      capabilityId: child.external ? undefined : capabilityIdFor(path),
    };
  });

  const footer = buildFooterColumns(nav).map((col) => ({
    column: col.title,
    items: col.links.map((i) => ({ label: i.label, to: i.to })),
  }));

  const protectedSurface = discoverProtectedNav().map((p) => ({
    path: p.path,
    label: p.label,
    surface: p.surface,
    surfaceRoles: p.surfaceRoles,
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    categories: nav.map((n) => ({
      label: n.label,
      itemCount: (n.groups ?? []).reduce((sum, g) => sum + g.items.length, 0) + (n.featured ? 1 : 0),
    })),
    public: publicDestinations,
    footer,
    protectedSurface,
    counts: {
      categories: nav.length,
      publicDestinations: publicDestinations.length,
      footerLinks: footer.reduce((n, c) => n + c.items.length, 0),
      protectedEntries: protectedSurface.length,
    },
  };
}

const CAP = 25;
const gate = (key: string, label: string, failures: string[], detail: string): NavValidationGate => ({
  key,
  label,
  passed: failures.length === 0,
  detail,
  failures: failures.slice(0, CAP),
});

/**
 * Runs every integrity gate that guards production navigation. This is the
 * VALIDATE step of the governed lifecycle — a draft that fails here can never
 * be submitted for review, approved, or published (also enforced server-side).
 */
export function validateNavRegistrySnapshot(snapshot: NavRegistrySnapshot): NavValidationReport {
  const publicInputs: NavDestinationInput[] = snapshot.public.map((d) => ({
    path: d.path,
    label: d.label,
    surface: d.surface,
    requiresAuth: d.requiresAuth,
    external: d.external,
    href: d.href,
  }));
  const publicRecords: NavContractRecord[] = auditSurface(publicInputs);
  const publicViolations = publicRecords.filter((r) => r.violations.length > 0);

  const protectedRecords: ProtectedNavRecord[] = auditProtectedSurface(
    snapshot.protectedSurface.map((p) => ({
      path: p.path,
      label: p.label,
      surface: p.surface,
      surfaceRoles: p.surfaceRoles,
    })),
  );
  const protectedViolations = protectedRecords.filter((r) => r.violations.length > 0);

  const flat = (records: { path: string; surface?: string; violations: string[] }[]) =>
    records.flatMap((r) => r.violations.map((v) => `${r.path}${r.surface ? ` (${r.surface})` : ""} — ${v}`));

  const schemaFailures: string[] = [];
  if (snapshot.schemaVersion !== 1) schemaFailures.push(`unsupported schemaVersion ${snapshot.schemaVersion}`);
  if (snapshot.counts.categories === 0) schemaFailures.push("no navigation categories in snapshot");
  for (const d of snapshot.public) {
    if (!d.label?.trim()) schemaFailures.push(`destination ${d.to} has no label`);
    if (!d.to?.trim()) schemaFailures.push(`destination "${d.label}" has no target`);
  }

  const aliasFailures = snapshot.public
    .filter((d) => !d.external && REDIRECT_ALIASES[d.path])
    .map((d) => `${d.path} is a redirect alias — link to ${REDIRECT_ALIASES[d.path]}`);

  const routeFailures = snapshot.public
    .filter((d) => !d.external && classifyRoute(d.path).unregistered)
    .map((d) => `${d.path} ("${d.label}") is not a declared route`);

  const capabilityFailures = [
    ...snapshot.public.filter((d) => !d.external && !capabilityIdFor(d.path)).map((d) => `${d.path} has no capability binding`),
    ...protectedRecords.filter((r) => !r.capabilityId).map((r) => `${r.path} (${r.surface}) has no capability binding`),
  ];

  const rbacFailures = protectedRecords
    .filter((r) => r.violations.some((v) => v.startsWith("dead entry")))
    .map((r) => `${r.path} (${r.surface}) is visible to no role the guard admits`);

  const wideOpen = snapshot.protectedSurface.filter((p) => p.surfaceRoles.includes(ANY_AUTHENTICATED)).length;

  const gates: NavValidationGate[] = [
    gate("schema", "Snapshot schema", schemaFailures, `${snapshot.counts.publicDestinations} public destinations, ${snapshot.counts.protectedEntries} protected entries`),
    gate("routes", "Canonical route resolution", routeFailures, "every destination resolves to a declared route"),
    gate("aliases", "No links to redirect aliases", aliasFailures, `${Object.keys(REDIRECT_ALIASES).length} aliases known`),
    gate("capabilities", "Backend capability binding", capabilityFailures, "each destination maps to a real backend capability"),
    gate("rbac", "RBAC envelope", rbacFailures, `${wideOpen} entries open to any authenticated user`),
    gate("publicContract", "Public navigation contract", flat(publicViolations), `${publicRecords.length} destinations audited`),
    gate("protectedContract", "Protected portal contract", flat(protectedViolations), `${protectedRecords.length} portal entries audited`),
  ];

  return {
    passed: gates.every((g) => g.passed),
    ranAt: new Date().toISOString(),
    snapshotHash: hashSnapshot(snapshot),
    gates,
    totals: {
      publicViolations: publicViolations.reduce((n, r) => n + r.violations.length, 0),
      protectedViolations: protectedViolations.reduce((n, r) => n + r.violations.length, 0),
    },
  };
}
