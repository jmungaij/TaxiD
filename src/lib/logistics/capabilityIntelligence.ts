/**
 * Phase 1 — Logistics Capability Intelligence Framework (LCIF).
 *
 * Replaces the opaque single ELOS score ("78/100") with a transparent,
 * capability-level maturity model. Every ELOS capability is scored across
 * sixteen enterprise dimensions; pillar and platform scores are *derived*
 * from those dimensions, never entered manually.
 *
 * Pure, deterministic configuration + computation. No schema changes, no new
 * design primitives, no runtime dependencies.
 */
import { ELOS_CAPABILITIES, ELOS_PILLARS, type ElosCapability, type ElosPillar, type ElosStage } from "./elos";
import { sharedServiceUplift } from "./sharedServices";

export const LCIF_VERSION = "1.0.0";

/** The sixteen dimensions every logistics capability is measured against. */
export const LCIF_DIMENSIONS = [
  "engineering",
  "operations",
  "finance",
  "warehouse",
  "fleet",
  "security",
  "compliance",
  "risk",
  "automation",
  "ai",
  "optimization",
  "prediction",
  "observability",
  "customerExperience",
  "partnerExperience",
  "executiveReadiness",
] as const;

export type LcifDimension = (typeof LCIF_DIMENSIONS)[number];

export const LCIF_DIMENSION_LABEL: Record<LcifDimension, string> = {
  engineering: "Engineering",
  operations: "Operations",
  finance: "Finance",
  warehouse: "Warehouse",
  fleet: "Fleet",
  security: "Security",
  compliance: "Compliance",
  risk: "Risk",
  automation: "Automation",
  ai: "AI",
  optimization: "Optimization",
  prediction: "Prediction",
  observability: "Observability",
  customerExperience: "Customer Experience",
  partnerExperience: "Partner Experience",
  executiveReadiness: "Executive Readiness",
};

/**
 * Dimension weights — operational and financial dimensions carry more weight
 * than aspirational ones so a capability cannot certify on AI alone.
 */
export const LCIF_WEIGHTS: Record<LcifDimension, number> = {
  engineering: 1.0,
  operations: 1.5,
  finance: 1.2,
  warehouse: 0.8,
  fleet: 0.8,
  security: 1.0,
  compliance: 1.2,
  risk: 1.0,
  automation: 1.1,
  ai: 0.7,
  optimization: 0.9,
  prediction: 0.7,
  observability: 1.1,
  customerExperience: 1.0,
  partnerExperience: 0.7,
  executiveReadiness: 0.8,
};

/** Stage baselines — the floor a capability inherits from the platform. */
const STAGE_BASELINE: Record<ElosStage, Record<LcifDimension, number>> = {
  operating: {
    engineering: 92, operations: 90, finance: 84, warehouse: 80, fleet: 80,
    security: 90, compliance: 88, risk: 82, automation: 74, ai: 45,
    optimization: 70, prediction: 45, observability: 88, customerExperience: 82,
    partnerExperience: 76, executiveReadiness: 86,
  },
  piloting: {
    engineering: 74, operations: 66, finance: 58, warehouse: 60, fleet: 60,
    security: 78, compliance: 70, risk: 62, automation: 48, ai: 34,
    optimization: 52, prediction: 36, observability: 66, customerExperience: 60,
    partnerExperience: 54, executiveReadiness: 62,
  },
  designing: {
    engineering: 42, operations: 30, finance: 26, warehouse: 32, fleet: 28,
    security: 52, compliance: 44, risk: 34, automation: 18, ai: 12,
    optimization: 20, prediction: 10, observability: 30, customerExperience: 26,
    partnerExperience: 22, executiveReadiness: 28,
  },
};

/** Per-capability deltas against the stage baseline, with a stated evidence source. */
export interface LcifSignal {
  /** Explicit dimension scores that override the stage baseline. */
  overrides: Partial<Record<LcifDimension, number>>;
  /** Where the score is evidenced from — kept short, executive-readable. */
  evidence: string;
  /** Monthly revenue exposure attached to the capability, in KES. */
  revenueExposureKes: number;
  /** Contractual SLA target for the capability's primary KPI, percent. */
  slaTarget: number;
  /** Observed SLA attainment, percent. */
  slaAttainment: number;
}

const SIGNALS: Record<string, LcifSignal> = {
  national_hub_network: {
    overrides: { optimization: 78, prediction: 52, ai: 40 },
    evidence: "Hub topology + linehaul lanes in control plane",
    revenueExposureKes: 4_200_000, slaTarget: 95, slaAttainment: 96,
  },
  warehouses: {
    overrides: { warehouse: 96, operations: 94, automation: 82, observability: 92 },
    evidence: "Dock scheduling, putaway/pick workflows, scan telemetry",
    revenueExposureKes: 3_100_000, slaTarget: 95, slaAttainment: 96,
  },
  distribution_centers: {
    overrides: { warehouse: 90, operations: 88, optimization: 74 },
    evidence: "Wave planning + outbound cut-off tracking",
    revenueExposureKes: 2_600_000, slaTarget: 94, slaAttainment: 93,
  },
  inventory: {
    overrides: { compliance: 82, observability: 74, risk: 70, finance: 66 },
    evidence: "Cycle-count evidence + shrinkage controls",
    revenueExposureKes: 1_900_000, slaTarget: 98, slaAttainment: 91,
  },
  cross_docking: {
    overrides: { operations: 74, optimization: 66, automation: 56 },
    evidence: "Dwell caps enforced; flow-through routing promoted to operating",
    revenueExposureKes: 1_400_000, slaTarget: 92, slaAttainment: 88,
  },
  courier_network: {
    overrides: { partnerExperience: 90, operations: 92, risk: 86 },
    evidence: "Courier compliance state + zone coverage registry",
    revenueExposureKes: 5_800_000, slaTarget: 95, slaAttainment: 94,
  },
  fleet_dispatch: {
    overrides: { operations: 97, automation: 94, optimization: 88, ai: 62, observability: 95 },
    evidence: "Assignment engine, ranked candidates, dispatch approvals",
    revenueExposureKes: 7_400_000, slaTarget: 97, slaAttainment: 98,
  },
  dynamic_routing: {
    overrides: { optimization: 74, automation: 62, prediction: 58, ai: 48 },
    evidence: "Live re-sequencing on traffic + exception signals",
    revenueExposureKes: 2_800_000, slaTarget: 90, slaAttainment: 86,
  },
  parcel_tracking: {
    overrides: { observability: 96, compliance: 95, customerExperience: 92 },
    evidence: "Immutable chain of custody + scan completeness",
    revenueExposureKes: 3_600_000, slaTarget: 99, slaAttainment: 99,
  },
  eta_prediction: {
    // Phase 3 shipped: prediction service wired into routing/dispatch with
    // published evaluation metrics.
    overrides: { prediction: 88, ai: 76, optimization: 74, observability: 84, operations: 82, engineering: 88 },
    evidence: "ETA prediction service + published evaluation metrics (MAE/p90)",
    revenueExposureKes: 2_300_000, slaTarget: 90, slaAttainment: 89,
  },
  cold_chain: {
    // Phase 4 shipped: temperature logging, excursion handling, audit trail.
    overrides: {
      engineering: 88, operations: 84, compliance: 94, risk: 82, observability: 88,
      automation: 72, warehouse: 82, customerExperience: 78, executiveReadiness: 80,
    },
    evidence: "Temperature log, excursion exceptions, disposal audit trail",
    revenueExposureKes: 1_200_000, slaTarget: 99, slaAttainment: 97,
  },
  reverse_logistics: {
    overrides: { operations: 88, finance: 84, customerExperience: 86 },
    evidence: "RTO handling + restock disposition linked to refunds",
    revenueExposureKes: 1_700_000, slaTarget: 90, slaAttainment: 91,
  },
  corporate_logistics: {
    overrides: { finance: 94, compliance: 92, customerExperience: 90, executiveReadiness: 92 },
    evidence: "Cost centers, budgets, invoice-grade evidence",
    revenueExposureKes: 9_100_000, slaTarget: 97, slaAttainment: 96,
  },
  marketplace_logistics: {
    overrides: { partnerExperience: 76, operations: 72, optimization: 62 },
    evidence: "Merchant pickups + multi-seller consolidation",
    revenueExposureKes: 2_100_000, slaTarget: 93, slaAttainment: 88,
  },
  driver_logistics: {
    overrides: { operations: 92, risk: 88, partnerExperience: 88 },
    evidence: "Shift supply, task load, fatigue guardrails",
    revenueExposureKes: 4_400_000, slaTarget: 95, slaAttainment: 95,
  },
  vehicle_capacity: {
    overrides: { fleet: 94, optimization: 82, finance: 86 },
    evidence: "Volumetric/weight modelling per vehicle class",
    revenueExposureKes: 3_300_000, slaTarget: 92, slaAttainment: 93,
  },
  route_optimization: {
    overrides: { optimization: 78, prediction: 62, finance: 72, ai: 52 },
    evidence: "Batch route construction under capacity constraints",
    revenueExposureKes: 2_900_000, slaTarget: 90, slaAttainment: 87,
  },
  warehouse_intelligence: {
    overrides: { prediction: 66, ai: 58, warehouse: 76, observability: 74 },
    evidence: "Backlog forecasting + bottleneck detection",
    revenueExposureKes: 1_500_000, slaTarget: 90, slaAttainment: 85,
  },
  ai_logistics_copilot: {
    // Phase 5 shipped: governed orchestrator with traceable responses.
    overrides: {
      engineering: 88, ai: 86, automation: 78, optimization: 80, prediction: 74,
      observability: 86, security: 90, compliance: 88, operations: 80, executiveReadiness: 86,
    },
    evidence: "Governed copilot: commands, simulations, traceable decisions",
    revenueExposureKes: 1_800_000, slaTarget: 90, slaAttainment: 92,
  },
  executive_logistics_intelligence: {
    overrides: { executiveReadiness: 96, finance: 92, observability: 90 },
    evidence: "Network KPI briefing + corrective-action tracking",
    revenueExposureKes: 6_000_000, slaTarget: 95, slaAttainment: 95,
  },
};

const DEFAULT_SIGNAL: LcifSignal = {
  overrides: {},
  evidence: "Stage baseline only — no capability-specific evidence registered",
  revenueExposureKes: 0,
  slaTarget: 90,
  slaAttainment: 90,
};

export type LcifBand = "leading" | "operational" | "developing" | "critical";

export interface LcifDimensionScore {
  dimension: LcifDimension;
  label: string;
  score: number;
  weight: number;
  /** Points lost against a perfect score, weighted — drives the gap ranking. */
  weightedGap: number;
}

export interface LcifCapabilityScore {
  id: string;
  label: string;
  pillar: ElosPillar;
  pillarLabel: string;
  stage: ElosStage;
  owner: string;
  kpi: string;
  surface: string;
  evidence: string;
  dimensions: LcifDimensionScore[];
  /** Weighted 0-100 maturity across all sixteen dimensions. */
  score: number;
  band: LcifBand;
  slaTarget: number;
  slaAttainment: number;
  slaMet: boolean;
  revenueExposureKes: number;
  /** Revenue exposed by the maturity shortfall — ranks investment. */
  revenueAtRiskKes: number;
  riskLevel: "low" | "medium" | "high";
  dependencies: string[];
  /** The three weakest weighted dimensions. */
  limitingDimensions: LcifDimension[];
}

export interface LcifPillarScore {
  pillar: ElosPillar;
  label: string;
  score: number;
  band: LcifBand;
  capabilities: number;
  weakest: string | null;
  strongest: string | null;
  revenueAtRiskKes: number;
}

export interface LcifGap {
  capabilityId: string;
  capabilityLabel: string;
  dimension: LcifDimension;
  dimensionLabel: string;
  score: number;
  weightedGap: number;
  revenueAtRiskKes: number;
  /** Deterministic investment priority — higher means fund first. */
  priority: number;
  recommendation: string;
}

export interface LcifReport {
  version: string;
  /** Derived platform-level logistics maturity — never entered by hand. */
  score: number;
  band: LcifBand;
  capabilities: LcifCapabilityScore[];
  pillars: LcifPillarScore[];
  dimensionAverages: Array<{ dimension: LcifDimension; label: string; score: number }>;
  gaps: LcifGap[];
  totalRevenueAtRiskKes: number;
  slaBreaches: string[];
  /** Plain-English explanation of what is holding the score down. */
  explanation: string[];
}

function band(score: number): LcifBand {
  if (score >= 90) return "leading";
  if (score >= 75) return "operational";
  if (score >= 50) return "developing";
  return "critical";
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function recommendationFor(dimension: LcifDimension, capability: string): string {
  const map: Partial<Record<LcifDimension, string>> = {
    ai: `Ground an AI service against ${capability} evidence before promoting autonomy`,
    prediction: `Publish a forecast model with an evaluation harness for ${capability}`,
    automation: `Convert the manual ${capability} steps into rules-engine decisions`,
    optimization: `Add a cost/constraint objective to ${capability} planning`,
    observability: `Emit lifecycle telemetry for ${capability} into the event registry`,
    compliance: `Attach immutable evidence to every ${capability} state transition`,
    risk: `Register failure modes and mitigations for ${capability}`,
    finance: `Attribute unit cost and margin to ${capability}`,
    operations: `Codify the ${capability} runbook into the process catalog`,
    customerExperience: `Expose ${capability} status to the customer-facing surface`,
    partnerExperience: `Publish ${capability} performance back to partners`,
    executiveReadiness: `Roll ${capability} KPIs into the executive briefing`,
    security: `Apply zero-trust controls to ${capability} actions`,
    engineering: `Close the implementation gaps and test coverage for ${capability}`,
    warehouse: `Instrument warehouse-side steps of ${capability}`,
    fleet: `Model fleet capacity constraints inside ${capability}`,
  };
  return map[dimension] ?? `Improve ${dimension} for ${capability}`;
}

export function scoreCapability(capability: ElosCapability): LcifCapabilityScore {
  const signal = SIGNALS[capability.id] ?? DEFAULT_SIGNAL;
  const baseline = STAGE_BASELINE[capability.stage];
  // Hardening sprint: maturity floors inherited from the shared platform
  // engines the capability consumes (automation / intelligence / optimization
  // / governance). Adoption evidence, never hand-entered scores.
  const uplift = sharedServiceUplift(capability.id);

  const dimensions: LcifDimensionScore[] = LCIF_DIMENSIONS.map((dimension) => {
    const declared = signal.overrides[dimension] ?? baseline[dimension];
    const score = clamp(Math.max(declared, uplift.floors[dimension] ?? 0));

    const weight = LCIF_WEIGHTS[dimension];
    return {
      dimension,
      label: LCIF_DIMENSION_LABEL[dimension],
      score,
      weight,
      weightedGap: Math.round((100 - score) * weight),
    };
  });

  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const score = clamp(dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight);

  const limiting = [...dimensions].sort((a, b) => b.weightedGap - a.weightedGap).slice(0, 3);
  const shortfall = (100 - score) / 100;
  const revenueAtRiskKes = Math.round(signal.revenueExposureKes * shortfall);
  const slaAttainment = Math.min(100, signal.slaAttainment + uplift.slaUplift);
  const slaMet = slaAttainment >= signal.slaTarget;

  return {
    id: capability.id,
    label: capability.label,
    pillar: capability.pillar,
    pillarLabel: ELOS_PILLARS[capability.pillar].label,
    stage: capability.stage,
    owner: capability.owner,
    kpi: capability.kpi,
    surface: capability.surface,
    evidence: signal.evidence,
    dimensions,
    score,
    band: band(score),
    slaTarget: signal.slaTarget,
    slaAttainment,
    slaMet,
    revenueExposureKes: signal.revenueExposureKes,
    revenueAtRiskKes,
    riskLevel: score >= 85 && slaMet ? "low" : score >= 65 ? "medium" : "high",
    dependencies: capability.inherits,
    limitingDimensions: limiting.map((d) => d.dimension),
  };
}

/** Full LCIF report — the executive decision layer for Module 3. */
export function runCapabilityIntelligence(
  capabilities: ElosCapability[] = ELOS_CAPABILITIES,
): LcifReport {
  const scored = capabilities.map(scoreCapability);

  const pillars: LcifPillarScore[] = (Object.keys(ELOS_PILLARS) as ElosPillar[]).map((pillar) => {
    const caps = scored.filter((c) => c.pillar === pillar);
    const avg = caps.length ? clamp(caps.reduce((s, c) => s + c.score, 0) / caps.length) : 0;
    const sorted = [...caps].sort((a, b) => a.score - b.score);
    return {
      pillar,
      label: ELOS_PILLARS[pillar].label,
      score: avg,
      band: band(avg),
      capabilities: caps.length,
      weakest: sorted[0]?.label ?? null,
      strongest: sorted[sorted.length - 1]?.label ?? null,
      revenueAtRiskKes: caps.reduce((s, c) => s + c.revenueAtRiskKes, 0),
    };
  });

  const dimensionAverages = LCIF_DIMENSIONS.map((dimension) => {
    const values = scored.map((c) => c.dimensions.find((d) => d.dimension === dimension)!.score);
    return {
      dimension,
      label: LCIF_DIMENSION_LABEL[dimension],
      score: values.length ? clamp(values.reduce((a, b) => a + b, 0) / values.length) : 0,
    };
  });

  const gaps: LcifGap[] = scored
    .flatMap((cap) =>
      cap.dimensions
        .filter((d) => d.score < 75)
        .map((d) => ({
          capabilityId: cap.id,
          capabilityLabel: cap.label,
          dimension: d.dimension,
          dimensionLabel: d.label,
          score: d.score,
          weightedGap: d.weightedGap,
          revenueAtRiskKes: cap.revenueAtRiskKes,
          priority: Math.round(d.weightedGap * (1 + cap.revenueExposureKes / 10_000_000)),
          recommendation: recommendationFor(d.dimension, cap.label),
        })),
    )
    .sort((a, b) => b.priority - a.priority);

  const score = scored.length
    ? clamp(scored.reduce((s, c) => s + c.score, 0) / scored.length)
    : 0;

  const slaBreaches = scored.filter((c) => !c.slaMet).map((c) => c.label);

  const laggards = [...scored].sort((a, b) => a.score - b.score).slice(0, 3);
  const weakDims = [...dimensionAverages].sort((a, b) => a.score - b.score).slice(0, 3);
  const explanation = [
    `Logistics maturity ${score}/100 is the weighted average of ${scored.length} capabilities across ${pillars.length} pillars.`,
    `Lowest capabilities: ${laggards.map((c) => `${c.label} (${c.score})`).join(", ")}.`,
    `Weakest dimensions platform-wide: ${weakDims.map((d) => `${d.label} (${d.score})`).join(", ")}.`,
    slaBreaches.length
      ? `SLA attainment below target for: ${slaBreaches.join(", ")}.`
      : "All capabilities are meeting their contractual SLA targets.",
  ];

  return {
    version: LCIF_VERSION,
    score,
    band: band(score),
    capabilities: scored,
    pillars,
    dimensionAverages,
    gaps,
    totalRevenueAtRiskKes: scored.reduce((s, c) => s + c.revenueAtRiskKes, 0),
    slaBreaches,
    explanation,
  };
}

/** Top investment recommendations, deduplicated per capability. */
export function investmentPriorities(report: LcifReport = runCapabilityIntelligence(), limit = 8): LcifGap[] {
  const seen = new Set<string>();
  const out: LcifGap[] = [];
  for (const gap of report.gaps) {
    if (seen.has(gap.capabilityId)) continue;
    seen.add(gap.capabilityId);
    out.push(gap);
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Enterprise Hardening WS8 — Continuous Improvement Intelligence.
 *
 * Extends LCIF rather than duplicating it: every field below is computed
 * from the existing capability scores, weights and revenue exposure.
 * ------------------------------------------------------------------ */

export interface LcifImprovementPlan {
  capabilityId: string;
  capabilityLabel: string;
  currentScore: number;
  targetScore: number;
  delta: number;
  limitingDimensions: LcifDimension[];
  recommendedInvestmentKes: number;
  expectedRoi: number;
  expectedMaturityGain: number;
  expectedRevenueGainKes: number;
  expectedCostReductionKes: number;
  expectedSlaImprovementPct: number;
  implementationPriority: number;
}

/** Target maturity by band — leading capabilities still ratchet upward. */
function targetFor(score: number): number {
  if (score >= 90) return 95;
  if (score >= 80) return 90;
  if (score >= 65) return 85;
  return 80;
}

export function capabilityImprovementPlans(
  report: LcifReport = runCapabilityIntelligence(),
): LcifImprovementPlan[] {
  return report.capabilities
    .map((c) => {
      const target = targetFor(c.score);
      const delta = Math.max(0, target - c.score);
      // Investment scales with the maturity gap against the revenue exposed.
      const investment = Math.round(c.revenueExposureKes * (delta / 100) * 0.35);
      const revenueGain = Math.round(c.revenueAtRiskKes * (delta / Math.max(1, 100 - c.score)));
      const costReduction = Math.round(investment * 0.4);
      const roi = investment === 0 ? 0 : Math.round(((revenueGain + costReduction - investment) / investment) * 100);
      return {
        capabilityId: c.id,
        capabilityLabel: c.label,
        currentScore: c.score,
        targetScore: target,
        delta,
        limitingDimensions: c.limitingDimensions,
        recommendedInvestmentKes: investment,
        expectedRoi: roi,
        expectedMaturityGain: delta,
        expectedRevenueGainKes: revenueGain,
        expectedCostReductionKes: costReduction,
        expectedSlaImprovementPct: Math.max(0, Math.round(c.slaTarget - c.slaAttainment)),
        implementationPriority: Math.round(delta * 2 + (c.slaMet ? 0 : 15) + c.revenueAtRiskKes / 100_000),
      };
    })
    .sort((a, b) => b.implementationPriority - a.implementationPriority || a.capabilityId.localeCompare(b.capabilityId));
}
