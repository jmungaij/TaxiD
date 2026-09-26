/**
 * Phase D11.0 — Enterprise Business Readiness.
 *
 * Derived entirely from canonical governance outputs — no new engine,
 * no new KPIs. Extends the existing Production Readiness framework
 * with 10 executive-facing business readiness dimensions.
 */
import type { Workspace360GovernanceReport } from "./governance";
import type { BusinessOutcomeReport } from "./businessOutcome";
import type { RecoImpactMagnitude } from "./decisionEngine";
import { certifyLogisticsProductionReadiness } from "@/lib/logistics/readiness";

export type BusinessReadinessDimension =
  | "marketplace_health"
  | "financial_health"
  | "customer_experience"
  | "driver_ecosystem"
  | "rider_ecosystem"
  | "corporate_operations"
  | "fleet_operations"
  | "logistics_operations"
  | "compliance_health"
  | "platform_health";

export interface BusinessReadinessDimensionReport {
  dimension: BusinessReadinessDimension;
  label: string;
  score: number;             // 0-100
  passed: boolean;
  canonicalSources: string[];
  narrative: string;
  openP0: number;
  worstRisk: RecoImpactMagnitude;
}

export interface BusinessReadinessReport {
  passed: boolean;
  score: number;             // blended 0-100
  dimensions: BusinessReadinessDimensionReport[];
  failures: string[];
}

const RISK_MAG_TO_PENALTY: Record<RecoImpactMagnitude, number> = {
  low: 0, medium: 10, high: 25, critical: 40,
};

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

export function buildBusinessReadiness(
  gov: Workspace360GovernanceReport,
  outcome: BusinessOutcomeReport,
): BusinessReadinessReport {
  const dom = (d: string) => gov.domains.find((x) => x.domain === d);
  const domScore = (d: string) => {
    const rec = dom(d);
    return rec ? (rec.adopted ? rec.healthScore : 0) : 0;
  };
  const logisticsCert = certifyLogisticsProductionReadiness();
  const objScore = (o: string) =>
    outcome.objectiveHealth.find((x) => x.objective === o)?.healthScore ?? 100;

  const dimensions: BusinessReadinessDimensionReport[] = [
    {
      dimension: "marketplace_health",
      label: "Marketplace Health",
      score: clamp((gov.workflows.score + objScore("marketplace_liquidity")) / 2),
      canonicalSources: ["certifyCrossDomainWorkflows", "objectiveHealth.marketplace_liquidity"],
      narrative: "Aggregate of workflow determinism and marketplace liquidity risk.",
      openP0: 0, worstRisk: "low", passed: false,
    },
    {
      dimension: "financial_health",
      label: "Financial Health",
      score: clamp((gov.consistency.score + gov.dataContract.score) / 2),
      canonicalSources: ["certifyBusinessConsistency", "certifyDataContract"],
      narrative: "Wallet→Ledger→Journal consistency and data-contract integrity.",
      openP0: 0, worstRisk: "low", passed: false,
    },
    {
      dimension: "customer_experience",
      label: "Customer Experience",
      score: clamp(outcome.customerExperienceIndex),
      canonicalSources: ["objectiveHealth.customer_experience"],
      narrative: "Blended rider/corporate satisfaction and open customer-impact recos.",
      openP0: 0, worstRisk: "low", passed: false,
    },
    {
      dimension: "driver_ecosystem",
      label: "Driver Ecosystem",
      score: clamp((domScore("driver") + objScore("driver_ecosystem")) / 2),
      canonicalSources: ["Workspace360.driver.health", "objectiveHealth.driver_ecosystem"],
      narrative: "Driver 360 health + open exposure to driver retention/earnings.",
      openP0: 0, worstRisk: "low", passed: false,
    },
    {
      dimension: "rider_ecosystem",
      label: "Rider Ecosystem",
      score: clamp((domScore("rider") + objScore("customer_experience")) / 2),
      canonicalSources: ["Workspace360.rider.health"],
      narrative: "Rider 360 health + rider-facing exposure.",
      openP0: 0, worstRisk: "low", passed: false,
    },
    {
      dimension: "corporate_operations",
      label: "Corporate Operations",
      score: clamp((domScore("corporate") + objScore("corporate_growth")) / 2),
      canonicalSources: ["Workspace360.corporate.health", "objectiveHealth.corporate_growth"],
      narrative: "Corporate 360 health, KYB, billing and settlement exposure.",
      openP0: 0, worstRisk: "low", passed: false,
    },
    {
      dimension: "fleet_operations",
      label: "Fleet Operations",
      score: clamp(domScore("fleet")),
      canonicalSources: ["Workspace360.fleet.health"],
      narrative: "Fleet 360 adoption and operational health.",
      openP0: 0, worstRisk: "low", passed: false,
    },
    {
      dimension: "logistics_operations",
      label: "Logistics Operations",
      // Readiness is the evidenced production-certification score from the
      // logistics control plane — never domain-adoption alone (which reads 0
      // for a fully built subsystem) and never engineering maturity (which
      // would imply an uncertified courier operation is production ready).
      score: clamp(logisticsCert.scores.productionReadiness),
      canonicalSources: ["certifyLogisticsProductionReadiness"],
      narrative: `Production certification ${logisticsCert.productionStatus} (${logisticsCert.certificateState.replace(/_/g, " ")}); engineering maturity ${logisticsCert.scores.engineeringMaturity}/100 with ${logisticsCert.blockers.length} mandatory control(s) outstanding.`,
      openP0: 0, worstRisk: "low", passed: false,
    },
    {
      dimension: "compliance_health",
      label: "Compliance Health",
      score: clamp((gov.freeze.score + gov.convergence.score) / 2),
      canonicalSources: ["certifyFreezeAudit", "certifyDomainConvergence"],
      narrative: "Governance freeze audit + domain convergence certification.",
      openP0: 0, worstRisk: "low", passed: false,
    },
    {
      dimension: "platform_health",
      label: "Platform Health",
      score: clamp((gov.operations.score + gov.certification.score) / 2),
      canonicalSources: ["certifyOperationalQualification", "certifyWorkspace360"],
      narrative: "Load/resilience/observability + registry certification.",
      openP0: 0, worstRisk: "low", passed: false,
    },
  ];

  // Apply penalties from open P0 recos per objective/domain.
  for (const dim of dimensions) {
    const relatedObjectives = (() => {
      switch (dim.dimension) {
        case "marketplace_health":  return ["marketplace_liquidity"];
        case "financial_health":    return ["revenue_growth"];
        case "customer_experience": return ["customer_experience"];
        case "driver_ecosystem":    return ["driver_ecosystem"];
        case "corporate_operations":return ["corporate_growth"];
        case "compliance_health":   return ["compliance_and_regulation"];
        case "platform_health":     return ["platform_reliability"];
        default: return [];
      }
    })();
    const openP0 = relatedObjectives.reduce((sum, o) =>
      sum + (outcome.objectiveHealth.find((x) => x.objective === o)?.openP0 ?? 0), 0);
    dim.openP0 = openP0;
    dim.worstRisk = relatedObjectives.reduce<RecoImpactMagnitude>((m, o) => {
      const r = outcome.objectiveHealth.find((x) => x.objective === o)?.revenueRisk ?? "low";
      const order: RecoImpactMagnitude[] = ["low", "medium", "high", "critical"];
      return order.indexOf(r) > order.indexOf(m) ? r : m;
    }, "low");
    dim.score = clamp(dim.score - RISK_MAG_TO_PENALTY[dim.worstRisk] - openP0 * 5);
    dim.passed = dim.score >= 90;
  }

  const failures: string[] = dimensions.filter((d) => !d.passed)
    .map((d) => `${d.label} readiness ${d.score}/100 (worstRisk=${d.worstRisk}, openP0=${d.openP0})`);
  const passed = failures.length === 0;
  const score = clamp(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);

  return { passed, score, dimensions, failures };
}
