/**
 * Workspace 360 domain registry (Phase D7.0).
 * Canonical list of every 360 workspace the platform exposes.
 * Adding a domain here + a corresponding config unlocks the shared shell,
 * deep-link helper, analytics, and certification pipeline.
 */
export const WORKSPACE360_DOMAINS = [
  "driver",
  "rider",
  "corporate",
  "courier",
  "package",
  "fleet",
  "logistics",
  "rental",
] as const;

export type Workspace360Domain = (typeof WORKSPACE360_DOMAINS)[number];

/**
 * Phase 1 (Enterprise Stabilization) — Deferred Adoption Registry.
 *
 * A registered domain that has NOT been adopted onto Workspace360Shell is a P0
 * convergence failure by default. A domain may only be excluded from that gate
 * when the reason is explicit, evidence-backed and architectural (i.e. adoption
 * would require a new route/page/table, which the design + backend freeze
 * forbids). Deferrals are reported — never silently dropped — and every deferred
 * domain still certifies on data-model, canonical-service and duplication axes.
 */
export const WORKSPACE360_DEFERRED_ADOPTIONS: Readonly<
  Partial<Record<Workspace360Domain, { reason: string; evidence: string }>>
> = {
  courier: {
    reason:
      "Couriers are operated through the ELOS Delivery Ops surfaces and the shared driver workspace; a dedicated /dashboard/admin/couriers 360 route would be a new route under the design freeze.",
    evidence: "src/pages/delivery/ops/OpsHub.tsx, /dashboard/admin/drivers/:driverId",
  },
  package: {
    reason:
      "Package operations are surfaced by the ELOS Ops package directory/detail pages rather than a /dashboard/admin/packages 360 workspace; the health spec still declares tables absent from the schema contract.",
    evidence: "/delivery/ops/packages, /delivery/ops/packages/:id",
  },
  logistics: {
    reason:
      "Logistics runs on the Logistics Hub + Dispatch surfaces; a per-job 360 workspace route does not exist and cannot be added under the freeze.",
    evidence: "/dashboard/admin/logistics-center, /delivery/ops/dispatch",
  },
  rental: {
    reason:
      "No public.rental_* data model exists; adoption would require new tables, which the Phase B1.1 no-new-tables constraint forbids.",
    evidence: "src/lib/workspace360/health.ts (rental intentionally unadopted)",
  },
};

/** True when a registered domain has a documented, evidence-backed adoption deferral. */
export function isDeferredWorkspace360Domain(domain: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORKSPACE360_DEFERRED_ADOPTIONS, domain);
}

const DOMAIN_SET: ReadonlySet<string> = new Set(WORKSPACE360_DOMAINS);


export function isWorkspace360Domain(value: unknown): value is Workspace360Domain {
  return typeof value === "string" && DOMAIN_SET.has(value);
}

/** Base admin path for a domain workspace. */
export function workspace360BasePath(domain: Workspace360Domain): string {
  const slug: Record<Workspace360Domain, string> = {
    driver: "drivers",
    rider: "riders",
    corporate: "corporates",
    courier: "couriers",
    package: "packages",
    fleet: "fleet",
    logistics: "logistics",
    rental: "rentals",
  };
  return `/dashboard/admin/${slug[domain]}`;
}
