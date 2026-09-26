/**
 * Phase D11.0 — Business Outcome Engine.
 *
 * Pure deterministic layer that decorates Decision Engine recommendations
 * with business-language context (capabilities, executive objectives,
 * quantified business impact) and certifies mapping completeness for CI.
 *
 * No new data models, no new services. Consumes the existing
 * `DecisionEngineReport` and the `BUSINESS_CAPABILITY_REGISTRY` config.
 */
import type {
  DecisionEngineReport,
  Recommendation,
  RecoImpactAxis,
  RecoImpactMagnitude,
} from "./decisionEngine";
import {
  BUSINESS_CAPABILITY_REGISTRY,
  getBusinessCapability,
  inferCapabilities,
  type BusinessCapability,
  type BusinessGoal,
  type ExecutiveObjective,
} from "./capabilities";

/** Quantified business impact translated from RecoImpactAxis. */
export interface BusinessImpact {
  revenueRisk: RecoImpactMagnitude;
  customerRisk: RecoImpactMagnitude;
  driverRisk: RecoImpactMagnitude;
  riderRisk: RecoImpactMagnitude;
  corporateRisk: RecoImpactMagnitude;
  operationalRisk: RecoImpactMagnitude;
  slaRisk: RecoImpactMagnitude;
  complianceRisk: RecoImpactMagnitude;
  marketplaceRisk: RecoImpactMagnitude;
  /** 0-100 blended business risk score. Higher = worse. */
  businessImpactScore: number;
}

export interface RecommendationBusinessContext {
  capabilities: BusinessCapability[];
  goals: BusinessGoal[];
  objectives: ExecutiveObjective[];
  impact: BusinessImpact;
  /** Weighted executive priority score used for exec ranking. */
  executivePriorityScore: number;
  /** One-line executive-language explanation of "why it matters". */
  executiveNarrative: string;
}

export interface BusinessOutcomeReport {
  passed: boolean;
  score: number;                    // mapping-completeness score (0-100)
  failures: string[];
  contexts: Record<string, RecommendationBusinessContext>; // reco.id → context
  objectiveHealth: Array<{
    objective: ExecutiveObjective;
    label: string;
    healthScore: number;            // 0-100, 100 = no open exposure
    openP0: number;
    openP1: number;
    revenueRisk: RecoImpactMagnitude;
  }>;
  capabilityHealth: Array<{
    capability: BusinessCapability;
    label: string;
    healthScore: number;
    openRecos: number;
    executiveWeight: number;
  }>;
  topRevenueRisks: Recommendation[];
  executiveConfidenceIndex: number; // 0-100
  marketplaceStabilityIndex: number;
  customerExperienceIndex: number;
}

const MAG_ORDER: RecoImpactMagnitude[] = ["low", "medium", "high", "critical"];
const MAG_SCORE: Record<RecoImpactMagnitude, number> = {
  low: 25, medium: 50, high: 75, critical: 100,
};
function maxMag(a: RecoImpactMagnitude, b: RecoImpactMagnitude): RecoImpactMagnitude {
  return MAG_ORDER.indexOf(a) >= MAG_ORDER.indexOf(b) ? a : b;
}
function magFromScore(score: number): RecoImpactMagnitude {
  if (score >= 900) return "critical";
  if (score >= 500) return "high";
  if (score >= 200) return "medium";
  return "low";
}

/** Deterministic axis → business-risk fanout. */
const AXIS_TO_RISK: Record<RecoImpactAxis, Partial<BusinessImpact>> = {
  revenue:            { revenueRisk: "high", corporateRisk: "medium" },
  customer:           { customerRisk: "high", riderRisk: "medium" },
  operations:         { operationalRisk: "high", slaRisk: "medium", marketplaceRisk: "medium" },
  driver_utilization: { driverRisk: "high", marketplaceRisk: "high" },
  fleet_utilization:  { operationalRisk: "medium", marketplaceRisk: "medium" },
  corporate_sla:      { corporateRisk: "high", slaRisk: "high" },
  risk:               { complianceRisk: "high", customerRisk: "medium" },
  platform_health:    { operationalRisk: "high", slaRisk: "medium" },
  certification:      { complianceRisk: "medium", operationalRisk: "medium" },
};

function computeBusinessImpact(reco: Recommendation): BusinessImpact {
  const base: BusinessImpact = {
    revenueRisk: "low", customerRisk: "low", driverRisk: "low", riderRisk: "low",
    corporateRisk: "low", operationalRisk: "low", slaRisk: "low",
    complianceRisk: "low", marketplaceRisk: "low", businessImpactScore: 0,
  };
  const severityMag = magFromScore(reco.score);
  for (const axis of reco.impactAxes) {
    const fan = AXIS_TO_RISK[axis] ?? {};
    for (const [k, v] of Object.entries(fan)) {
      if (v == null || k === "businessImpactScore") continue;
      const key = k as keyof BusinessImpact;
      const cur = base[key] as RecoImpactMagnitude;
      // Amplify by reco severity — a "high" axis on a P0 becomes "critical".
      const amplified = MAG_ORDER.indexOf(severityMag) > MAG_ORDER.indexOf(v as RecoImpactMagnitude)
        ? maxMag(v as RecoImpactMagnitude, severityMag) : (v as RecoImpactMagnitude);
      (base[key] as RecoImpactMagnitude) = maxMag(cur, amplified);
    }
  }
  // Confidence-weighted blended score.
  const scores = [
    MAG_SCORE[base.revenueRisk], MAG_SCORE[base.customerRisk],
    MAG_SCORE[base.driverRisk], MAG_SCORE[base.riderRisk],
    MAG_SCORE[base.corporateRisk], MAG_SCORE[base.operationalRisk],
    MAG_SCORE[base.slaRisk], MAG_SCORE[base.complianceRisk],
    MAG_SCORE[base.marketplaceRisk],
  ];
  const raw = scores.reduce((a, b) => a + b, 0) / scores.length;
  base.businessImpactScore = Math.max(0, Math.min(100, Math.round(raw * reco.confidence)));
  return base;
}

function narrative(reco: Recommendation, capabilities: BusinessCapability[]): string {
  const capLabels = capabilities.slice(0, 2)
    .map((c) => getBusinessCapability(c).label)
    .join(" & ");
  const axis = reco.impactAxes[0]?.replace(/_/g, " ") ?? "operations";
  return `Threatens ${capLabels || "core operations"} — ${axis} exposure driven by ${reco.canonicalSources[0] ?? "governance"}.`;
}

function priorityWeight(p: Recommendation["priority"]): number {
  return p === "P0" ? 1000 : p === "P1" ? 500 : p === "P2" ? 200 : 50;
}

/**
 * Main D11 entry — decorate a Decision Engine report and produce the
 * Business Outcome Report consumed by Executive Intelligence.
 */
export function buildBusinessOutcomeReport(
  decision: DecisionEngineReport,
): BusinessOutcomeReport {
  const contexts: Record<string, RecommendationBusinessContext> = {};
  const failures: string[] = [];

  for (const reco of decision.recommendations) {
    const capabilities = inferCapabilities(reco.domain, reco.canonicalSources);
    const goals = Array.from(new Set(
      capabilities.flatMap((c) => getBusinessCapability(c).supportsGoals),
    )).sort() as BusinessGoal[];
    const objectives = Array.from(new Set(
      capabilities.flatMap((c) => getBusinessCapability(c).objectives),
    )).sort() as ExecutiveObjective[];
    const impact = computeBusinessImpact(reco);
    const executiveWeight = capabilities.reduce(
      (m, c) => Math.max(m, getBusinessCapability(c).executiveWeight), 0,
    );
    const executivePriorityScore = Math.round(
      priorityWeight(reco.priority) * 0.5 +
      impact.businessImpactScore * 3 +
      executiveWeight * 200 +
      reco.confidence * 100,
    );

    contexts[reco.id] = {
      capabilities,
      goals,
      objectives,
      impact,
      executivePriorityScore,
      executiveNarrative: narrative(reco, capabilities),
    };

    // Traceability: every reco must map to at least one capability + objective.
    if (capabilities.length === 0) failures.push(`${reco.id}: no business capability`);
    if (objectives.length === 0) failures.push(`${reco.id}: no executive objective`);
    if (goals.length === 0) failures.push(`${reco.id}: no business goal`);
  }

  const OBJECTIVE_LABELS: Record<ExecutiveObjective, string> = {
    marketplace_liquidity: "Marketplace Liquidity",
    revenue_growth: "Revenue Growth",
    customer_experience: "Customer Experience",
    driver_ecosystem: "Driver Ecosystem",
    corporate_growth: "Corporate Growth",
    trust_and_safety: "Trust & Safety",
    compliance_and_regulation: "Compliance & Regulation",
    platform_reliability: "Platform Reliability",
  };

  const objectiveHealth = (Object.keys(OBJECTIVE_LABELS) as ExecutiveObjective[]).map((obj) => {
    const touching = decision.recommendations.filter((r) => contexts[r.id]?.objectives.includes(obj));
    const openP0 = touching.filter((r) => r.priority === "P0" && r.execution.status !== "completed").length;
    const openP1 = touching.filter((r) => r.priority === "P1" && r.execution.status !== "completed").length;
    const revenueRisk = touching.reduce<RecoImpactMagnitude>(
      (m, r) => maxMag(m, contexts[r.id].impact.revenueRisk), "low",
    );
    const penalty = Math.min(100, openP0 * 30 + openP1 * 10);
    return {
      objective: obj,
      label: OBJECTIVE_LABELS[obj],
      healthScore: Math.max(0, 100 - penalty),
      openP0,
      openP1,
      revenueRisk,
    };
  });

  const capabilityHealth = BUSINESS_CAPABILITY_REGISTRY.map((spec) => {
    const open = decision.recommendations.filter(
      (r) => contexts[r.id]?.capabilities.includes(spec.capability) &&
        r.execution.status !== "completed" && r.execution.status !== "rejected",
    );
    const penalty = Math.min(
      100,
      open.reduce((n, r) => n + (r.priority === "P0" ? 30 : r.priority === "P1" ? 15 : 5), 0),
    );
    return {
      capability: spec.capability,
      label: spec.label,
      healthScore: Math.max(0, 100 - penalty),
      openRecos: open.length,
      executiveWeight: spec.executiveWeight,
    };
  }).sort((a, b) => a.healthScore - b.healthScore);

  const topRevenueRisks = [...decision.recommendations]
    .filter((r) => contexts[r.id]?.impact.revenueRisk !== "low")
    .sort((a, b) => (contexts[b.id].impact.businessImpactScore -
                     contexts[a.id].impact.businessImpactScore))
    .slice(0, 5);

  const marketplaceStabilityIndex = objectiveHealth.find((o) => o.objective === "marketplace_liquidity")?.healthScore ?? 100;
  const customerExperienceIndex = objectiveHealth.find((o) => o.objective === "customer_experience")?.healthScore ?? 100;
  const executiveConfidenceIndex = Math.round(
    objectiveHealth.reduce((s, o) => s + o.healthScore, 0) / (objectiveHealth.length || 1),
  );

  const total = decision.recommendations.length;
  const bad = failures.length;
  const score = total === 0 ? 100 : Math.max(0, Math.round(((total - bad) / total) * 100));

  return {
    passed: failures.length === 0,
    score,
    failures,
    contexts,
    objectiveHealth,
    capabilityHealth,
    topRevenueRisks,
    executiveConfidenceIndex,
    marketplaceStabilityIndex,
    customerExperienceIndex,
  };
}

// ============================================================================
// D11.8 — Executive Scenario Analysis (deterministic, no simulation engine).
// ============================================================================

export type ExecutiveScenarioKey =
  | "payment_outage"
  | "dispatch_degradation"
  | "driver_shortage"
  | "rider_demand_surge"
  | "corporate_billing_delays"
  | "settlement_failures"
  | "fraud_surge"
  | "wallet_outage"
  | "certification_failures"
  | "regional_service_disruption";

export interface ScenarioImpact {
  scenario: ExecutiveScenarioKey;
  label: string;
  tripsCompletedDeltaPct: number;
  revenueDeltaPct: number;
  marketplaceLiquidityDeltaPct: number;
  customerSatisfactionDeltaPct: number;
  driverRetentionDeltaPct: number;
  riderRetentionDeltaPct: number;
  slaComplianceDeltaPct: number;
  executiveReadinessDelta: number; // absolute points off 100
  affectedCapabilities: BusinessCapability[];
  affectedObjectives: ExecutiveObjective[];
}

const SCENARIO_TABLE: Record<ExecutiveScenarioKey, Omit<ScenarioImpact, "scenario">> = {
  payment_outage: {
    label: "Payment Outage",
    tripsCompletedDeltaPct: -35, revenueDeltaPct: -45,
    marketplaceLiquidityDeltaPct: -25, customerSatisfactionDeltaPct: -30,
    driverRetentionDeltaPct: -10, riderRetentionDeltaPct: -15,
    slaComplianceDeltaPct: -40, executiveReadinessDelta: -35,
    affectedCapabilities: ["rider_payments", "driver_wallet", "settlement_engine"],
    affectedObjectives: ["revenue_growth", "customer_experience", "platform_reliability"],
  },
  dispatch_degradation: {
    label: "Dispatch Degradation",
    tripsCompletedDeltaPct: -25, revenueDeltaPct: -20,
    marketplaceLiquidityDeltaPct: -35, customerSatisfactionDeltaPct: -25,
    driverRetentionDeltaPct: -5, riderRetentionDeltaPct: -20,
    slaComplianceDeltaPct: -30, executiveReadinessDelta: -25,
    affectedCapabilities: ["dispatch_engine", "rider_booking"],
    affectedObjectives: ["marketplace_liquidity", "customer_experience"],
  },
  driver_shortage: {
    label: "Driver Shortage",
    tripsCompletedDeltaPct: -30, revenueDeltaPct: -25,
    marketplaceLiquidityDeltaPct: -40, customerSatisfactionDeltaPct: -20,
    driverRetentionDeltaPct: 0, riderRetentionDeltaPct: -15,
    slaComplianceDeltaPct: -25, executiveReadinessDelta: -20,
    affectedCapabilities: ["driver_wallet", "driver_academy", "dispatch_engine"],
    affectedObjectives: ["marketplace_liquidity", "driver_ecosystem"],
  },
  rider_demand_surge: {
    label: "Rider Demand Surge",
    tripsCompletedDeltaPct: 15, revenueDeltaPct: 20,
    marketplaceLiquidityDeltaPct: -15, customerSatisfactionDeltaPct: -10,
    driverRetentionDeltaPct: 5, riderRetentionDeltaPct: -5,
    slaComplianceDeltaPct: -15, executiveReadinessDelta: -5,
    affectedCapabilities: ["dispatch_engine", "pricing_engine", "rider_booking"],
    affectedObjectives: ["revenue_growth", "marketplace_liquidity"],
  },
  corporate_billing_delays: {
    label: "Corporate Billing Delays",
    tripsCompletedDeltaPct: 0, revenueDeltaPct: -15,
    marketplaceLiquidityDeltaPct: 0, customerSatisfactionDeltaPct: -10,
    driverRetentionDeltaPct: 0, riderRetentionDeltaPct: 0,
    slaComplianceDeltaPct: -25, executiveReadinessDelta: -15,
    affectedCapabilities: ["corporate_billing", "settlement_engine"],
    affectedObjectives: ["corporate_growth", "revenue_growth"],
  },
  settlement_failures: {
    label: "Settlement Failures",
    tripsCompletedDeltaPct: 0, revenueDeltaPct: -20,
    marketplaceLiquidityDeltaPct: -15, customerSatisfactionDeltaPct: -5,
    driverRetentionDeltaPct: -25, riderRetentionDeltaPct: 0,
    slaComplianceDeltaPct: -30, executiveReadinessDelta: -25,
    affectedCapabilities: ["settlement_engine", "driver_wallet"],
    affectedObjectives: ["revenue_growth", "driver_ecosystem"],
  },
  fraud_surge: {
    label: "Fraud Surge",
    tripsCompletedDeltaPct: -5, revenueDeltaPct: -15,
    marketplaceLiquidityDeltaPct: -5, customerSatisfactionDeltaPct: -15,
    driverRetentionDeltaPct: -5, riderRetentionDeltaPct: -20,
    slaComplianceDeltaPct: -10, executiveReadinessDelta: -20,
    affectedCapabilities: ["fraud_engine", "rider_safety"],
    affectedObjectives: ["trust_and_safety", "platform_reliability"],
  },
  wallet_outage: {
    label: "Wallet Outage",
    tripsCompletedDeltaPct: -15, revenueDeltaPct: -25,
    marketplaceLiquidityDeltaPct: -20, customerSatisfactionDeltaPct: -25,
    driverRetentionDeltaPct: -30, riderRetentionDeltaPct: -15,
    slaComplianceDeltaPct: -25, executiveReadinessDelta: -30,
    affectedCapabilities: ["driver_wallet", "rider_payments"],
    affectedObjectives: ["driver_ecosystem", "customer_experience"],
  },
  certification_failures: {
    label: "Certification Failures",
    tripsCompletedDeltaPct: 0, revenueDeltaPct: -5,
    marketplaceLiquidityDeltaPct: 0, customerSatisfactionDeltaPct: 0,
    driverRetentionDeltaPct: 0, riderRetentionDeltaPct: 0,
    slaComplianceDeltaPct: -20, executiveReadinessDelta: -40,
    affectedCapabilities: ["audit_and_governance"],
    affectedObjectives: ["compliance_and_regulation", "platform_reliability"],
  },
  regional_service_disruption: {
    label: "Regional Service Disruption",
    tripsCompletedDeltaPct: -20, revenueDeltaPct: -20,
    marketplaceLiquidityDeltaPct: -30, customerSatisfactionDeltaPct: -20,
    driverRetentionDeltaPct: -10, riderRetentionDeltaPct: -20,
    slaComplianceDeltaPct: -25, executiveReadinessDelta: -20,
    affectedCapabilities: ["dispatch_engine", "logistics_orchestration", "fleet_operations"],
    affectedObjectives: ["marketplace_liquidity", "customer_experience"],
  },
};

export function estimateScenarioImpact(scenario: ExecutiveScenarioKey): ScenarioImpact {
  const entry = SCENARIO_TABLE[scenario];
  return { scenario, ...entry };
}

export function listExecutiveScenarios(): ScenarioImpact[] {
  return (Object.keys(SCENARIO_TABLE) as ExecutiveScenarioKey[])
    .map(estimateScenarioImpact);
}
