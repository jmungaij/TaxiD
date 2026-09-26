/**
 * Phase D7.3 — Workspace 360 Operational Health & Governance.
 *
 * Pure, network-free certification layer that extends D7.2 registry
 * certification with:
 *   • per-domain tab completion (which tabs are wired vs. empty)
 *   • per-domain dependency certification (declared tables / RPCs / edge
 *     functions must exist in the schema-contract)
 *   • per-domain and platform-wide adoption %
 *
 * The declarations here are the SINGLE SOURCE OF TRUTH for what each
 * 360 workspace must expose. Adding a required tab or data source here
 * ratchets the CI gate and the Readiness dashboard immediately.
 *
 * No new tables. No new dashboards. No new edge functions.
 */
import { WORKSPACE360_DOMAINS, type Workspace360Domain } from "./domains";
import { type Workspace360Tab } from "./tabs";

export interface Workspace360DomainHealthSpec {
  /** Tabs that MUST be wired to real data for this domain to be "complete". */
  requiredTabs: Workspace360Tab[];
  /** Tabs already wired to real data (registered per adoption phase). */
  wiredTabs: Workspace360Tab[];
  /** Canonical tables the workspace reads. Must exist in schema-contract. */
  tables: string[];
  /** Canonical RPCs the workspace reads. Must exist in schema-contract. */
  rpcs: string[];
  /** Canonical edge functions the workspace invokes. */
  edgeFunctions: string[];
}

/**
 * Registry of per-domain health specs. Domains not listed are treated as
 * "no data yet, framework-only" and score 0 for completion.
 *
 * Update this when a workspace phase ships new tab wiring — the CI gate
 * and Readiness card will pick it up automatically.
 */
export const WORKSPACE360_HEALTH: Partial<
  Record<Workspace360Domain, Workspace360DomainHealthSpec>
> = {
  driver: {
    requiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    wiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    tables: [
      "drivers",
      "wallets", "wallet_transactions", "driver_payouts",
      "driver_payout_methods", "payment_attempts",
    ],
    rpcs: [
      "driver_admin_metrics", "driver_metrics", "driver_timeline",
      "certify_driver_withdrawal", "certify_driver_operational_consistency",
    ],
    edgeFunctions: ["driver-withdraw"],
  },
  rider: {
    requiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    // Phase D7.4 — all required tabs wired to existing canonical rider data.
    wiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    tables: [
      "rider_profiles",
      "wallets", "wallet_transactions", "rider_wallets", "rider_wallet_transactions",
      "trip_bookings", "rider_kyc", "rider_safety_incidents", "rider_sos_alerts",
      "rider_fraud_signals", "rider_trust_scores", "rider_behavior_scores",
      "rider_notifications",
    ],
    rpcs: [],
    edgeFunctions: [],
  },
  corporate: {
    requiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    // Phase D7.5 — all required tabs wired to canonical corporate data.
    wiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    tables: [
      "corporate_accounts", "corporate_cash_ledger", "corporate_invoices",
      "corporate_ride_approvals", "corporate_documents",
      "corporate_policy_violations", "corporate_employees",
      // Canonical shared services — proves corporate uses the same
      // financial engine as Driver / Rider (D7.5 governance check).
      "journal_lines", "ledger_accounts",
    ],
    rpcs: [],
    edgeFunctions: [],
  },
  fleet: {
    requiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    // Phase D7.6 — every required tab wired to canonical fleet + shared data.
    wiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    tables: [
      "fleet_companies", "fleet_vehicles", "fleet_drivers",
      "vehicles", "vehicle_maintenance", "vehicle_documents",
      "driver_insurance", "driver_locations",
      "fleet_performance", "fleet_compliance",
      // Canonical shared services — proves Fleet uses the same
      // financial + ledger engine as Driver / Rider / Corporate.
      "wallet_transactions", "journal_lines", "ledger_accounts",
    ],
    rpcs: [],
    edgeFunctions: [],
  },
  // Phase B1.1 — declarative adoption of the delivery-vertical domains onto
  // the existing Workspace360 shell. Each domain reuses existing pages
  // (src/pages/delivery/*) mounted at /dashboard/admin/<slug> — no new
  // dashboards, dispatchers, services, or tables were introduced.
  courier: {
    requiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    wiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    tables: [
      "delivery_orders", "delivery_onboarding", "delivery_driver_scores",
      "delivery_fraud_signals", "dispatch_assignments", "dispatch_requests",
      // Canonical shared services — courier earnings post through the same
      // wallet + ledger engine as every other domain.
      "wallets", "wallet_transactions", "journal_lines", "ledger_accounts",
    ],
    rpcs: [],
    edgeFunctions: [],
  },
  package: {
    requiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    wiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    tables: [
      "packages", "package_events", "package_tracking",
      "proof_of_delivery", "package_chain_of_custody",
      "package_tamper_alerts", "package_returns",
      // Canonical shared services — parcel COD flows through the same ledger.
      "wallet_transactions", "journal_lines", "ledger_accounts",
    ],
    rpcs: [],
    edgeFunctions: [],
  },
  logistics: {
    requiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    wiredTabs: [
      "overview", "financial", "timeline", "documents",
      "compliance", "performance", "support", "audit",
    ],
    tables: [
      "dispatch_requests", "dispatch_assignments", "dispatch_events",
      "delivery_route_segments", "delivery_eta_predictions",
      "delivery_dispatch_jobs", "dispatch_performance_metrics",
      // Canonical shared services — logistics settlements post to the same
      // ledger + journal engine.
      "wallet_transactions", "journal_lines", "ledger_accounts",
    ],
    rpcs: [],
    edgeFunctions: [],
  },
  // NOTE: `rental` intentionally remains unadopted. No public.rental_* or
  // vehicle_bookings tables exist yet; adopting it would require introducing
  // a rental data model, which violates the Phase B1.1 "no new tables"
  // scope. Tracked in docs/phase-b1.1/adoption-report.md.
};

export interface Workspace360HealthContract {
  tables: string[];
  columns: Array<{ table: string; column: string }>;
  rpcs: string[];
  edge_functions: string[];
}

export interface Workspace360DomainHealth {
  domain: Workspace360Domain;
  adopted: boolean;
  requiredTabs: number;
  wiredTabs: number;
  completionScore: number;      // 0-100, tabs wired ÷ tabs required
  dependencyScore: number;      // 0-100, deps found in contract ÷ deps declared
  overallScore: number;         // 0-100, weighted blend (completion 60 / deps 40)
  missingTables: string[];
  missingRpcs: string[];
  missingEdgeFunctions: string[];
  missingTabs: Workspace360Tab[];
}

export interface Workspace360HealthReport {
  passed: boolean;
  adoptionPct: number;          // adopted ÷ total canonical domains
  platformScore: number;        // avg overallScore across adopted domains
  domains: Workspace360DomainHealth[];
}

function scorePct(numerator: number, denominator: number): number {
  if (denominator === 0) return 100;
  return Math.round((numerator / denominator) * 100);
}

export function certifyDomainHealth(
  domain: Workspace360Domain,
  adopted: boolean,
  contract: Workspace360HealthContract,
): Workspace360DomainHealth {
  const spec = WORKSPACE360_HEALTH[domain];

  if (!spec) {
    return {
      domain, adopted,
      requiredTabs: 0, wiredTabs: 0,
      completionScore: adopted ? 0 : 100,
      dependencyScore: 100,
      overallScore: adopted ? 0 : 100,
      missingTables: [], missingRpcs: [], missingEdgeFunctions: [],
      missingTabs: [],
    };
  }

  const wired = new Set(spec.wiredTabs);
  const missingTabs = spec.requiredTabs.filter((t) => !wired.has(t));
  const completionScore = scorePct(spec.requiredTabs.length - missingTabs.length, spec.requiredTabs.length);

  const contractTables = new Set(contract.tables ?? []);
  const contractRpcs = new Set(contract.rpcs ?? []);
  const contractEdgeFns = new Set(contract.edge_functions ?? []);

  const missingTables = spec.tables.filter((t) => !contractTables.has(t));
  const missingRpcs = spec.rpcs.filter((r) => !contractRpcs.has(r));
  const missingEdgeFunctions = spec.edgeFunctions.filter((f) => !contractEdgeFns.has(f));

  const declaredDeps = spec.tables.length + spec.rpcs.length + spec.edgeFunctions.length;
  const foundDeps = declaredDeps
    - missingTables.length - missingRpcs.length - missingEdgeFunctions.length;
  const dependencyScore = scorePct(foundDeps, declaredDeps);

  const overallScore = Math.round(completionScore * 0.6 + dependencyScore * 0.4);

  return {
    domain, adopted,
    requiredTabs: spec.requiredTabs.length,
    wiredTabs: spec.requiredTabs.length - missingTabs.length,
    completionScore, dependencyScore, overallScore,
    missingTables, missingRpcs, missingEdgeFunctions, missingTabs,
  };
}

export function certifyWorkspace360Health(
  adoptedDomains: string[],
  contract: Workspace360HealthContract,
): Workspace360HealthReport {
  const adoptedSet = new Set(adoptedDomains);
  const domains = WORKSPACE360_DOMAINS.map((d) =>
    certifyDomainHealth(d, adoptedSet.has(d), contract));

  const adoptedList = domains.filter((d) => d.adopted);
  const platformScore = adoptedList.length === 0
    ? 0
    : Math.round(adoptedList.reduce((a, d) => a + d.overallScore, 0) / adoptedList.length);
  const adoptionPct = scorePct(adoptedList.length, WORKSPACE360_DOMAINS.length);

  const passed = adoptedList.every((d) => d.overallScore === 100);
  return { passed, adoptionPct, platformScore, domains };
}

/** Flattened list of every dependency declared across all specs — for CI. */
export function workspace360DeclaredDependencies(): {
  tables: string[]; rpcs: string[]; edgeFunctions: string[];
} {
  const t = new Set<string>(), r = new Set<string>(), f = new Set<string>();
  for (const spec of Object.values(WORKSPACE360_HEALTH)) {
    if (!spec) continue;
    spec.tables.forEach((x) => t.add(x));
    spec.rpcs.forEach((x) => r.add(x));
    spec.edgeFunctions.forEach((x) => f.add(x));
  }
  return { tables: [...t].sort(), rpcs: [...r].sort(), edgeFunctions: [...f].sort() };
}

/** Tabs still missing wiring across the platform — governance signal. */
export function unwiredTabCount(report: Workspace360HealthReport): number {
  return report.domains
    .filter((d) => d.adopted)
    .reduce((a, d) => a + d.missingTabs.length, 0);
}

/**
 * Phase D7.5 — Cross-domain governance check.
 *
 * Ensures every adopted 360 workspace consumes the same canonical shared
 * services (wallets, wallet_transactions, journal_lines, ledger_accounts,
 * payment_attempts, mpesa_transactions) rather than forking its own
 * financial engine. Domain-specific extensions are welcome, but a
 * workspace declaring zero shared canonical tables is a divergence
 * signal and must be flagged.
 */
export const WORKSPACE360_CANONICAL_SERVICES = [
  "wallets",
  "wallet_transactions",
  "journal_lines",
  "ledger_accounts",
  "payment_attempts",
  "mpesa_transactions",
] as const;

export interface Workspace360CanonicalReport {
  passed: boolean;
  divergentDomains: Array<{ domain: Workspace360Domain; sharedCount: number }>;
}

export function certifyWorkspace360CanonicalServices(
  adoptedDomains: string[],
): Workspace360CanonicalReport {
  const adoptedSet = new Set(adoptedDomains);
  const canonical = new Set<string>(WORKSPACE360_CANONICAL_SERVICES);
  const divergentDomains: Array<{ domain: Workspace360Domain; sharedCount: number }> = [];
  for (const domain of WORKSPACE360_DOMAINS) {
    if (!adoptedSet.has(domain)) continue;
    const spec = WORKSPACE360_HEALTH[domain];
    const sharedCount = (spec?.tables ?? []).filter((t) => canonical.has(t)).length;
    if (sharedCount === 0) divergentDomains.push({ domain, sharedCount });
  }
  return { passed: divergentDomains.length === 0, divergentDomains };
}

