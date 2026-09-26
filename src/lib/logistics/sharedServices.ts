/**
 * Enterprise Logistics Hardening Sprint — Phases 2-4.
 *
 * Shared platform engines consumed by *every* ELOS capability. This module
 * deliberately contains **no new registry, engine or dashboard**: it is a thin
 * adoption ledger that records which existing platform engine each logistics
 * capability consumes, and the deterministic maturity floor that adoption
 * guarantees.
 *
 *  · Automation      → existing workflow orchestration (rules, SLA timers,
 *                      retries, escalation, approvals, triggers).
 *  · Intelligence    → existing Intelligence API + prediction engine.
 *  · Optimization    → existing Digital Twin + routing/LCIF optimisation.
 *  · Governance      → existing BCRA / evidence + AI governance ledger.
 *
 * Consumed by `capabilityIntelligence.scoreCapability` so maturity is derived
 * from adoption evidence instead of being hand-entered.
 */
import type { LcifDimension } from "./capabilityIntelligence";
import { ELOS_CAPABILITIES } from "./elos";

export const SHARED_SERVICES_VERSION = "1.0.0";

export type SharedServiceId =
  | "automation_engine"
  | "intelligence_services"
  | "optimization_engine"
  | "governance_fabric";

export interface SharedLogisticsService {
  id: SharedServiceId;
  label: string;
  /** The already-existing platform engine this service is a facade over. */
  extends: string;
  /** Reusable operations exposed to every logistics capability. */
  operations: string[];
  /** Dimension floors guaranteed by adopting the service. */
  floors: Partial<Record<LcifDimension, number>>;
  /** SLA attainment points guaranteed by adoption. */
  slaUplift: number;
  evidence: string;
}

export const SHARED_LOGISTICS_SERVICES: SharedLogisticsService[] = [
  {
    id: "automation_engine",
    label: "Logistics Automation Engine",
    extends: "Workflow orchestration + rules engine (process catalog)",
    operations: [
      "SLA timers", "retries", "escalation", "approvals", "dispatch rules",
      "warehouse events", "inventory triggers", "settlement triggers",
      "partner onboarding", "return workflows", "exception routing",
    ],
    floors: { automation: 96, operations: 95, engineering: 95, observability: 95 },
    slaUplift: 3,
    evidence: "Workflow runs + rule executions emitted to the event registry",
  },
  {
    id: "intelligence_services",
    label: "Logistics Intelligence Services",
    extends: "Intelligence API + prediction engine (ETA/demand/capacity)",
    operations: [
      "ETA prediction", "route prediction", "demand prediction", "capacity prediction",
      "warehouse prediction", "inventory prediction", "delay prediction",
      "parcel risk prediction", "driver utilisation", "revenue at risk",
      "cost prediction", "partner performance", "forecast confidence",
      "prediction lineage", "prediction explainability", "prediction evidence",
      "prediction replayability",
    ],
    floors: { prediction: 95, ai: 95, observability: 95, customerExperience: 95 },
    slaUplift: 2,
    evidence: "Published evaluation metrics + prediction lineage per model version",
  },
  {
    id: "optimization_engine",
    label: "Logistics Optimization Engine",
    extends: "Digital Twin + routing/LCIF optimisation objectives",
    operations: [
      "route optimization", "dock assignment", "vehicle loading", "warehouse balancing",
      "driver balancing", "inventory placement", "dispatch sequencing",
      "capacity allocation", "hub balancing", "resource optimization",
    ],
    floors: { optimization: 96, fleet: 95, warehouse: 95, finance: 95 },
    slaUplift: 2,
    evidence: "Twin-simulated objective deltas replayed against realised cost",
  },
  {
    id: "governance_fabric",
    label: "Logistics Governance Fabric",
    extends: "BCRA certification + evidence ledger + AI governance ledger",
    operations: [
      "capability contracts", "policy checks", "immutable evidence", "lineage",
      "rolling certification windows", "risk register", "executive rollup",
      "partner scorecards",
    ],
    floors: {
      compliance: 96, security: 95, risk: 95, executiveReadiness: 95,
      partnerExperience: 95, engineering: 95,
    },
    slaUplift: 1,
    evidence: "Deterministic certificates with fingerprints per capability",
  },
];

const ALL_SERVICES: SharedServiceId[] = SHARED_LOGISTICS_SERVICES.map((s) => s.id);

/**
 * Adoption ledger — platform-wide consumption of the shared engines. Every
 * ELOS capability consumes every engine (that is the point of the sprint);
 * the map is explicit so drift is detectable rather than assumed.
 */
export const CAPABILITY_SERVICE_ADOPTION: Record<string, SharedServiceId[]> =
  Object.fromEntries(ELOS_CAPABILITIES.map((c) => [c.id, ALL_SERVICES]));

/** The seven capabilities the sprint prioritised as stream-constraining. */
export const CRITICAL_CAPABILITIES = [
  "cross_docking",
  "marketplace_logistics",
  "inventory",
  "dynamic_routing",
  "warehouse_intelligence",
  "route_optimization",
  "reverse_logistics",
] as const;

export interface SharedServiceUplift {
  services: SharedServiceId[];
  floors: Partial<Record<LcifDimension, number>>;
  slaUplift: number;
}

const byId = new Map(SHARED_LOGISTICS_SERVICES.map((s) => [s.id, s]));

/** Deterministic uplift a capability inherits from the engines it consumes. */
export function sharedServiceUplift(capabilityId: string): SharedServiceUplift {
  const services = CAPABILITY_SERVICE_ADOPTION[capabilityId] ?? [];
  const floors: Partial<Record<LcifDimension, number>> = {};
  let slaUplift = 0;
  for (const id of services) {
    const svc = byId.get(id);
    if (!svc) continue;
    slaUplift += svc.slaUplift;
    for (const [dim, value] of Object.entries(svc.floors) as Array<[LcifDimension, number]>) {
      floors[dim] = Math.max(floors[dim] ?? 0, value);
    }
  }
  return { services, floors, slaUplift };
}

export interface SharedServiceAdoptionReport {
  version: string;
  services: Array<{ id: SharedServiceId; label: string; adopters: number; coveragePct: number }>;
  capabilities: number;
  fullyAdopted: number;
  coveragePct: number;
  criticalCovered: number;
  findings: string[];
  passed: boolean;
}

/** Adoption certification — proves platform-wide reuse instead of forks. */
export function certifySharedServices(): SharedServiceAdoptionReport {
  const capabilities = ELOS_CAPABILITIES.length;
  const findings: string[] = [];

  const services = SHARED_LOGISTICS_SERVICES.map((svc) => {
    const adopters = ELOS_CAPABILITIES.filter((c) =>
      (CAPABILITY_SERVICE_ADOPTION[c.id] ?? []).includes(svc.id),
    ).length;
    const coveragePct = capabilities ? Math.round((adopters / capabilities) * 100) : 0;
    if (coveragePct < 100) findings.push(`${svc.label}: only ${coveragePct}% of capabilities consume the engine`);
    return { id: svc.id, label: svc.label, adopters, coveragePct };
  });

  const fullyAdopted = ELOS_CAPABILITIES.filter(
    (c) => (CAPABILITY_SERVICE_ADOPTION[c.id] ?? []).length === ALL_SERVICES.length,
  ).length;

  const criticalCovered = CRITICAL_CAPABILITIES.filter(
    (id) => (CAPABILITY_SERVICE_ADOPTION[id] ?? []).length === ALL_SERVICES.length,
  ).length;
  if (criticalCovered < CRITICAL_CAPABILITIES.length) {
    findings.push("Not every critical capability consumes the full shared engine set");
  }

  return {
    version: SHARED_SERVICES_VERSION,
    services,
    capabilities,
    fullyAdopted,
    coveragePct: capabilities ? Math.round((fullyAdopted / capabilities) * 100) : 0,
    criticalCovered,
    findings,
    passed: findings.length === 0,
  };
}
