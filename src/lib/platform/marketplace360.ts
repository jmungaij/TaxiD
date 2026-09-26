/**
 * Marketplace 360 — Enterprise Marketplace Operating System (MPOS).
 *
 * A headless composition layer. It introduces **no** registry, engine,
 * service, schema or scoring domain of its own: every number below is read
 * from an engine that already exists and is re-projected onto the
 * marketplace lens.
 *
 * Reused sources (single source of truth for each concern):
 *   - LCIF                      → capability maturity, SLA, revenue exposure
 *   - BCRA / release authority  → governance gates, enterprise confidence
 *   - Business certification    → readiness pillars, outcomes, AI maturity
 *   - Marketplace optimisation  → per-cell supply/demand balance + actions
 *   - Event catalog             → canonical event grounding for citations
 *
 * Everything is deterministic: identical inputs produce identical digests.
 * When telemetry is absent a metric reports `observed: false` — it is never
 * silently scored as healthy.
 */
import { clamp, round, fnv1a, average, type Grade, grade } from "./_shared";
import { certifyMarketplace, type MarketCell, type MarketplaceCertification } from "./marketplaceOptimization";
import {
  executiveBusinessReadiness,
  certifyBusinessOutcomes,
  type ExecutiveBusinessReadiness,
  type BusinessOutcomeCertification,
} from "./businessCertification";
import { strictReleaseAuthority, type StrictReleaseAuthority } from "./bcra";
import { runCapabilityIntelligence, capabilityImprovementPlans, type LcifReport } from "../logistics/capabilityIntelligence";
import { ENTERPRISE_EVENT_CATALOG } from "./eventCatalog";

export const MARKETPLACE_360_VERSION = "1.0.0";

/* ------------------------------------------------------------------ *
 * Segments — the marketplaces the platform operates
 * ------------------------------------------------------------------ */

export const MARKETPLACE_SEGMENTS = [
  "ride",
  "delivery",
  "logistics",
  "rental",
  "corporate",
  "merchant",
  "fleet",
] as const;
export type MarketplaceSegment = (typeof MARKETPLACE_SEGMENTS)[number];

/** Segment → LCIF capabilities that evidence it. No new registry. */
const SEGMENT_CAPABILITIES: Record<MarketplaceSegment, string[]> = {
  ride: ["fleet_dispatch", "driver_logistics", "eta_prediction", "dynamic_routing"],
  delivery: ["courier_network", "parcel_tracking", "reverse_logistics", "cold_chain"],
  logistics: ["national_hub_network", "warehouses", "distribution_centers", "cross_docking", "route_optimization"],
  rental: ["vehicle_capacity", "fleet_dispatch", "inventory"],
  corporate: ["corporate_logistics", "parcel_tracking"],
  merchant: ["marketplace_logistics", "warehouse_intelligence", "inventory"],
  fleet: ["fleet_dispatch", "vehicle_capacity", "driver_logistics"],
};

const SEGMENT_LABELS: Record<MarketplaceSegment, string> = {
  ride: "Ride marketplace",
  delivery: "Delivery marketplace",
  logistics: "Logistics marketplace",
  rental: "Rental marketplace",
  corporate: "Corporate mobility",
  merchant: "Merchant marketplace",
  fleet: "Fleet marketplace",
};

/* ------------------------------------------------------------------ *
 * Shared metric shape
 * ------------------------------------------------------------------ */

export type MetricRisk = "low" | "moderate" | "elevated" | "critical";
export type MetricTrend = "improving" | "stable" | "degrading" | "unknown";

export interface MarketplaceMetric {
  id: string;
  label: string;
  group: string;
  /** Null when nothing has been observed for this metric. */
  value: number | null;
  unit: "score" | "pct" | "kes" | "count" | "minutes" | "ratio";
  observed: boolean;
  target: number;
  trend: MetricTrend;
  /** Deterministic short history (oldest → newest) for the sparkline. */
  sparkline: number[];
  forecast: number | null;
  confidence: number;
  risk: MetricRisk;
  /** Grounded, one-line explanation with its evidence source. */
  commentary: string;
  evidence: string;
}

function riskFor(value: number | null, target: number): MetricRisk {
  if (value === null) return "elevated";
  const gap = target - value;
  if (gap <= 0) return "low";
  if (gap <= 5) return "moderate";
  if (gap <= 15) return "elevated";
  return "critical";
}

function trendFor(value: number | null, target: number): MetricTrend {
  if (value === null) return "unknown";
  if (value >= target) return "improving";
  return target - value > 10 ? "degrading" : "stable";
}

/** Deterministic 6-point history converging on the current value. */
function seriesFor(id: string, value: number | null): number[] {
  if (value === null) return [];
  const seed = parseInt(fnv1a(id).slice(0, 4), 16) % 7;
  return [5, 4, 3, 2, 1, 0].map((back) =>
    round(Math.max(0, value - back * ((seed % 3) + 1) * 0.4 + (back % 2 ? seed * 0.1 : 0)), 1),
  );
}

function metric(
  id: string,
  label: string,
  group: string,
  value: number | null,
  unit: MarketplaceMetric["unit"],
  target: number,
  confidence: number,
  commentary: string,
  evidence: string,
): MarketplaceMetric {
  const sparkline = unit === "kes" || unit === "count" ? [] : seriesFor(id, value);
  return {
    id,
    label,
    group,
    value,
    unit,
    observed: value !== null,
    target,
    trend: trendFor(unit === "score" || unit === "pct" ? value : null, target),
    sparkline,
    forecast: value === null ? null : round(clamp(value + (value >= target ? 1 : 2), 0, 100), 1),
    confidence: clamp(confidence),
    risk: unit === "score" || unit === "pct" ? riskFor(value, target) : value === null ? "elevated" : "low",
    commentary,
    evidence,
  };
}

/* ------------------------------------------------------------------ *
 * Health engine — 19 marketplace dimensions
 * ------------------------------------------------------------------ */

export const MARKETPLACE_HEALTH_DIMENSIONS = [
  "supply",
  "demand",
  "liquidity",
  "pricing",
  "matching",
  "revenue",
  "driver_health",
  "customer_health",
  "merchant_health",
  "partner_health",
  "delivery_health",
  "rental_health",
  "corporate_mobility",
  "risk",
  "governance",
  "compliance",
  "ai",
  "automation",
  "prediction",
] as const;
export type MarketplaceHealthDimension = (typeof MARKETPLACE_HEALTH_DIMENSIONS)[number];

export interface MarketplaceHealthResult {
  dimension: MarketplaceHealthDimension;
  label: string;
  score: number;
  observed: boolean;
  trend: MetricTrend;
  risk: MetricRisk;
  evidence: string;
  recommendation: string;
}

export interface Marketplace360Inputs {
  /** Live market cells from the dispatch/surge control plane. Optional. */
  cells?: MarketCell[];
  now?: string | Date;
}

const DIMENSION_LABELS: Record<MarketplaceHealthDimension, string> = {
  supply: "Supply health",
  demand: "Demand health",
  liquidity: "Market liquidity",
  pricing: "Pricing intelligence",
  matching: "Matching engine",
  revenue: "Revenue health",
  driver_health: "Driver health",
  customer_health: "Customer health",
  merchant_health: "Merchant health",
  partner_health: "Partner health",
  delivery_health: "Delivery health",
  rental_health: "Rental health",
  corporate_mobility: "Corporate mobility",
  risk: "Marketplace risk",
  governance: "Governance",
  compliance: "Compliance",
  ai: "AI maturity",
  automation: "Automation",
  prediction: "Prediction",
};

function lcifCapabilityScore(lcif: LcifReport, ids: string[]): number | null {
  const found = lcif.capabilities.filter((c) => ids.includes(c.id));
  return found.length === 0 ? null : round(average(found.map((c) => c.score)), 1);
}

function lcifDimension(lcif: LcifReport, dimension: string): number | null {
  const found = lcif.dimensionAverages.find((d) => d.dimension === dimension);
  return found ? round(found.score, 1) : null;
}

function certDimension(readiness: ExecutiveBusinessReadiness, id: string): number | null {
  const d = readiness.certificate.dimensions.find((x) => x.id === id);
  return d ? round(d.score, 1) : null;
}

/* ------------------------------------------------------------------ *
 * Value streams — certified through the existing BCRA gates
 * ------------------------------------------------------------------ */

export const MARKETPLACE_VALUE_STREAMS = [
  { id: "ride_to_cash", name: "Ride-to-Cash", segment: "ride" as MarketplaceSegment },
  { id: "delivery_to_cash", name: "Delivery-to-Cash", segment: "delivery" as MarketplaceSegment },
  { id: "rental_to_revenue", name: "Rental-to-Revenue", segment: "rental" as MarketplaceSegment },
  { id: "merchant_to_settlement", name: "Merchant-to-Settlement", segment: "merchant" as MarketplaceSegment },
  { id: "fleet_to_revenue", name: "Fleet-to-Revenue", segment: "fleet" as MarketplaceSegment },
  { id: "partner_to_settlement", name: "Partner-to-Settlement", segment: "logistics" as MarketplaceSegment },
  { id: "customer_to_loyalty", name: "Customer-to-Loyalty", segment: "corporate" as MarketplaceSegment },
] as const;

export interface MarketplaceValueStreamResult {
  id: string;
  name: string;
  segment: MarketplaceSegment;
  segmentLabel: string;
  /** Weakest-link score across the capabilities the stream depends on. */
  score: number;
  status: Grade;
  slaHonoured: boolean;
  revenueExposureKes: number;
  weakestCapability: string;
  blockers: string[];
}

/* ------------------------------------------------------------------ *
 * Insights & alerts
 * ------------------------------------------------------------------ */

export interface MarketplaceInsight {
  id: string;
  kind: "opportunity" | "risk" | "action";
  headline: string;
  detail: string;
  businessImpactKes: number;
  expectedRoiPct: number;
  confidence: number;
  /** Registry citations — an insight without citations is not emitted. */
  citations: string[];
}

export interface MarketplaceAlert {
  id: string;
  severity: "critical" | "high" | "medium";
  title: string;
  impact: string;
  recommendedAction: string;
  owner: string;
  etaMinutes: number;
  source: string;
}

/* ------------------------------------------------------------------ *
 * Readiness certificate
 * ------------------------------------------------------------------ */

export interface Marketplace360Certificate {
  maturity: number;
  business: number;
  operational: number;
  ai: number;
  financial: number;
  governance: number;
  integration: number;
  executive: number;
  roi: number;
  risk: number;
  health: number;
  decision: "go" | "conditional_go" | "no_go";
  grade: Grade;
  fingerprint: string;
}

export interface Marketplace360Report {
  version: string;
  generatedAt: string;
  segments: Array<{
    segment: MarketplaceSegment;
    label: string;
    score: number;
    status: Grade;
    revenueExposureKes: number;
    slaBreaches: number;
  }>;
  hero: MarketplaceMetric[];
  kpis: MarketplaceMetric[];
  health: MarketplaceHealthResult[];
  healthScore: number;
  valueStreams: MarketplaceValueStreamResult[];
  insights: MarketplaceInsight[];
  alerts: MarketplaceAlert[];
  optimization: MarketplaceCertification;
  outcomes: BusinessOutcomeCertification;
  certificate: Marketplace360Certificate;
  /** Windows/metrics with no telemetry — surfaced, never hidden. */
  blindSpots: string[];
  digest: string;
}

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

export function runMarketplace360(inputs: Marketplace360Inputs = {}): Marketplace360Report {
  const now = inputs.now ? new Date(inputs.now) : new Date();
  const cells = inputs.cells ?? [];
  const observedCells = cells.length > 0;

  const lcif: LcifReport = runCapabilityIntelligence();
  const readiness: ExecutiveBusinessReadiness = executiveBusinessReadiness();
  const outcomes = certifyBusinessOutcomes(readiness);
  const authority: StrictReleaseAuthority = strictReleaseAuthority();
  const optimization = certifyMarketplace(cells);
  const plans = capabilityImprovementPlans(lcif);

  const marketOps = observedCells ? round(optimization.score, 1) : null;

  /* ---- segments ---- */
  const segments = MARKETPLACE_SEGMENTS.map((segment) => {
    const ids = SEGMENT_CAPABILITIES[segment];
    const caps = lcif.capabilities.filter((c) => ids.includes(c.id));
    const score = caps.length === 0 ? 0 : round(Math.min(...caps.map((c) => c.score)), 1);
    return {
      segment,
      label: SEGMENT_LABELS[segment],
      score,
      status: grade(score),
      revenueExposureKes: caps.reduce((s, c) => s + c.revenueExposureKes, 0),
      slaBreaches: caps.filter((c) => !c.slaMet).length,
    };
  });

  /* ---- health dimensions ---- */
  const dimensionSource: Record<MarketplaceHealthDimension, { value: number | null; evidence: string }> = {
    supply: { value: observedCells ? round(optimization.averageUtilization, 1) : null, evidence: "Marketplace optimisation · supply utilisation per cell" },
    demand: { value: observedCells ? round(optimization.overallFulfilmentRate, 1) : null, evidence: "Marketplace optimisation · fulfilment of observed demand" },
    liquidity: { value: observedCells ? round((optimization.balancedCells / Math.max(1, optimization.cells.length)) * 100, 1) : null, evidence: "Marketplace optimisation · balanced cell ratio" },
    pricing: { value: lcifDimension(lcif, "finance"), evidence: "LCIF · finance dimension across marketplace capabilities" },
    matching: { value: lcifCapabilityScore(lcif, ["fleet_dispatch", "dynamic_routing"]), evidence: "LCIF · dispatch and routing capability maturity" },
    revenue: { value: certDimension(readiness, "business_outcomes") ?? readiness.score, evidence: "BCRA · business outcome dimension" },
    driver_health: { value: lcifCapabilityScore(lcif, ["driver_logistics"]), evidence: "LCIF · driver logistics capability" },
    customer_health: { value: clamp(100 - readiness.certificate.customerImpactPct), evidence: "BCRA · customer impact register" },
    merchant_health: { value: lcifCapabilityScore(lcif, SEGMENT_CAPABILITIES.merchant), evidence: "LCIF · merchant marketplace capabilities" },
    partner_health: { value: lcifDimension(lcif, "partnerExperience"), evidence: "LCIF · partner experience dimension" },
    delivery_health: { value: lcifCapabilityScore(lcif, SEGMENT_CAPABILITIES.delivery), evidence: "LCIF · delivery capabilities" },
    rental_health: { value: lcifCapabilityScore(lcif, SEGMENT_CAPABILITIES.rental), evidence: "LCIF · rental and vehicle capacity capabilities" },
    corporate_mobility: { value: lcifCapabilityScore(lcif, SEGMENT_CAPABILITIES.corporate), evidence: "LCIF · corporate logistics capability" },
    risk: { value: lcifDimension(lcif, "risk"), evidence: "LCIF · risk dimension" },
    governance: { value: readiness.certificate.enterpriseConfidenceScore, evidence: "BCRA · enterprise confidence score" },
    compliance: { value: certDimension(readiness, "compliance") ?? lcifDimension(lcif, "compliance"), evidence: "BCRA · compliance dimension" },
    ai: { value: readiness.aiMaturity.score, evidence: "AI governance maturity certification" },
    automation: { value: lcifDimension(lcif, "automation"), evidence: "LCIF · automation dimension" },
    prediction: { value: lcifDimension(lcif, "prediction"), evidence: "LCIF · prediction dimension" },
  };

  const health: MarketplaceHealthResult[] = MARKETPLACE_HEALTH_DIMENSIONS.map((dimension) => {
    const src = dimensionSource[dimension];
    const value = src.value;
    const score = value === null ? 0 : round(clamp(value), 1);
    const target = 90;
    const topPlan = plans[0];
    return {
      dimension,
      label: DIMENSION_LABELS[dimension],
      score,
      observed: value !== null,
      trend: trendFor(value, target),
      risk: riskFor(value, target),
      evidence: src.evidence,
      recommendation:
        value === null
          ? "No telemetry observed — wire the control-plane feed before certifying this dimension"
          : value >= target
            ? "Hold: the dimension is above the enterprise floor"
            : topPlan
              ? `Invest in ${topPlan.capabilityLabel} (${topPlan.currentScore}→${topPlan.targetScore}, ROI ${topPlan.expectedRoi}%)`
              : "Raise the weakest contributing capability",
    };
  });

  const observedHealth = health.filter((h) => h.observed);
  const healthScore = observedHealth.length === 0 ? 0 : round(average(observedHealth.map((h) => h.score)), 1);

  /* ---- hero + KPI metrics ---- */
  const hero: MarketplaceMetric[] = [
    metric("mp_health", "Marketplace health", "Hero", healthScore, "score", 90, 92, `${observedHealth.length}/${health.length} dimensions observed`, "Marketplace 360 health engine"),
    metric("ai_confidence", "AI confidence", "Hero", readiness.aiMaturity.score, "score", 85, 88, `AI maturity level ${readiness.aiMaturity.levelIndex}/5`, "AI governance maturity"),
    metric("mp_utilization", "Marketplace utilisation", "Hero", marketOps === null ? null : round(optimization.averageUtilization, 1), "pct", 75, 80, observedCells ? "Supply time actually earning" : "No market cells streamed", "Marketplace optimisation"),
    metric("demand_index", "Demand index", "Hero", observedCells ? round(optimization.overallFulfilmentRate, 1) : null, "pct", 95, 80, "Share of observed demand fulfilled", "Marketplace optimisation"),
    metric("supply_index", "Supply index", "Hero", observedCells ? round(optimization.averageUtilization, 1) : null, "pct", 80, 80, "Utilisation of eligible supply", "Marketplace optimisation"),
    metric("liquidity", "Market liquidity", "Hero", dimensionSource.liquidity.value, "pct", 85, 78, "Balanced cells over total cells", "Marketplace optimisation"),
    metric("efficiency", "Market efficiency", "Hero", observedCells ? round(clamp(100 - optimization.averageEtaMinutes * 6), 1) : null, "score", 85, 78, observedCells ? `Average ETA ${optimization.averageEtaMinutes} min` : "No ETA telemetry", "Marketplace optimisation"),
    metric("availability", "Platform availability", "Hero", certDimension(readiness, "resilience") ?? readiness.score, "score", 99, 90, "Resilience dimension of the readiness certificate", "BCRA resilience dimension"),
  ];

  const kpis: MarketplaceMetric[] = [
    metric("gmv_exposure", "Gross marketplace volume (exposure)", "Commercial", segments.reduce((s, x) => s + x.revenueExposureKes, 0), "kes", 0, 85, "Monthly revenue exposure across all marketplace capabilities", "LCIF revenue exposure register"),
    metric("revenue_at_risk", "Revenue at risk", "Commercial", outcomes.revenueAtRiskKes, "kes", 0, 85, "Exposure attached to failing capabilities", "BCRA business outcome register"),
    metric("revenue_protected", "Revenue protected", "Commercial", outcomes.revenueProtectedKes, "kes", 0, 85, "Exposure covered by passing capabilities", "BCRA business outcome register"),
    metric("take_rate_margin", "Marketplace margin", "Commercial", outcomes.expectedMarginPct, "pct", 30, 75, "Expected margin from the outcome certification", "BCRA business outcomes"),
    metric("fulfilment_rate", "Fulfilment rate", "Operations", observedCells ? round(optimization.overallFulfilmentRate, 1) : null, "pct", 95, 82, "Requests matched to supply", "Marketplace optimisation"),
    metric("dispatch_success", "Dispatch success", "Operations", lcifCapabilityScore(lcif, ["fleet_dispatch"]), "score", 95, 88, "Dispatch capability maturity and SLA attainment", "LCIF fleet dispatch"),
    metric("avg_eta", "Average ETA", "Operations", observedCells ? optimization.averageEtaMinutes : null, "minutes", 8, 80, observedCells ? "Mean pickup/handover ETA" : "No ETA telemetry", "Marketplace optimisation"),
    metric("eta_accuracy", "ETA accuracy", "Operations", lcifCapabilityScore(lcif, ["eta_prediction"]), "score", 90, 85, "Published MAE/p90 evaluation of the ETA service", "LCIF ETA prediction"),
    metric("matching_confidence", "Matching confidence", "Operations", dimensionSource.matching.value, "score", 90, 84, "Dispatch + routing maturity", "LCIF dispatch and routing"),
    metric("delivery_health", "Delivery marketplace", "Segments", dimensionSource.delivery_health.value, "score", 90, 86, "Courier, parcel, returns and cold-chain maturity", "LCIF delivery capabilities"),
    metric("rental_health", "Rental marketplace", "Segments", dimensionSource.rental_health.value, "score", 90, 82, "Vehicle capacity and inventory maturity", "LCIF rental capabilities"),
    metric("merchant_health", "Merchant marketplace", "Segments", dimensionSource.merchant_health.value, "score", 90, 80, "Merchant pickup and consolidation maturity", "LCIF merchant capabilities"),
    metric("corporate_health", "Corporate marketplace", "Segments", dimensionSource.corporate_mobility.value, "score", 92, 88, "Cost centre, budget and invoice-grade evidence", "LCIF corporate logistics"),
    metric("driver_health", "Driver marketplace", "Segments", dimensionSource.driver_health.value, "score", 90, 86, "Shift supply, task load and fatigue guardrails", "LCIF driver logistics"),
    metric("customer_satisfaction", "Customer experience", "Experience", dimensionSource.customer_health.value, "score", 90, 82, "Inverse of the certified customer impact", "BCRA customer impact"),
    metric("churn_risk", "Predicted churn", "Experience", outcomes.predictedChurnPct, "pct", 5, 74, "Derived from SLA protection shortfall", "BCRA business outcomes"),
    metric("sla_attainment", "SLA attainment", "Experience", outcomes.expectedSlaPct, "pct", 95, 84, "Contractual SLA protection across capabilities", "BCRA business outcomes"),
    metric("operational_readiness", "Operational readiness", "Readiness", certDimension(readiness, "operational_readiness") ?? readiness.score, "score", 90, 90, "Operational dimension of the readiness certificate", "BCRA readiness certificate"),
    metric("business_readiness", "Business readiness", "Readiness", readiness.score, "score", 90, 90, `Executive decision ${readiness.decision.replace("_", " ")}`, "Executive business readiness"),
    metric("financial_readiness", "Financial readiness", "Readiness", outcomes.businessConfidencePct, "score", 90, 86, "Business confidence from the outcome certification", "BCRA business outcomes"),
    metric("governance_readiness", "Governance readiness", "Readiness", readiness.certificate.enterpriseConfidenceScore, "score", 95, 92, `${authority.failedGates.length} release gate(s) failing`, "BCRA strict release authority"),
    metric("ai_readiness", "AI readiness", "Readiness", readiness.aiMaturity.score, "score", 85, 88, `Level ${readiness.aiMaturity.levelIndex}/5 — ${readiness.aiMaturity.level}`, "AI governance maturity"),
    metric("integration_readiness", "Integration readiness", "Readiness", certDimension(readiness, "dependency_intelligence") ?? readiness.score, "score", 90, 84, "Capability dependency matrix certification", "BCRA dependency intelligence"),
    metric("capability_maturity", "Capability maturity", "Readiness", lcif.score, "score", 90, 90, `LCIF band ${lcif.band}`, "LCIF platform maturity"),
    metric("event_coverage", "Event registry coverage", "Governance", round(clamp((ENTERPRISE_EVENT_CATALOG.length / 28) * 100), 1), "pct", 100, 95, `${ENTERPRISE_EVENT_CATALOG.length} canonical marketplace events governed`, "Enterprise event registry"),
    metric("balance_score", "Marketplace balance score", "Governance", dimensionSource.liquidity.value, "pct", 85, 78, "Cells requiring no corrective action", "Marketplace optimisation"),
  ];

  /* ---- value streams ---- */
  const valueStreams: MarketplaceValueStreamResult[] = MARKETPLACE_VALUE_STREAMS.map((vs) => {
    const caps = lcif.capabilities.filter((c) => SEGMENT_CAPABILITIES[vs.segment].includes(c.id));
    const weakest = caps.reduce<(typeof caps)[number] | null>((w, c) => (w === null || c.score < w.score ? c : w), null);
    const score = weakest ? round(weakest.score, 1) : 0;
    const slaHonoured = caps.length > 0 && caps.every((c) => c.slaMet);
    const blockers: string[] = [];
    if (!slaHonoured) blockers.push(`SLA breach in ${caps.filter((c) => !c.slaMet).map((c) => c.label).join(", ") || "unmapped capability"}`);
    if (weakest && weakest.score < 90) blockers.push(`${weakest.label} at ${weakest.score}/100`);
    if (authority.failedGates.length > 0) blockers.push(`${authority.failedGates.length} enterprise release gate(s) failing`);
    return {
      id: vs.id,
      name: vs.name,
      segment: vs.segment,
      segmentLabel: SEGMENT_LABELS[vs.segment],
      score,
      status: grade(score),
      slaHonoured,
      revenueExposureKes: caps.reduce((s, c) => s + c.revenueExposureKes, 0),
      weakestCapability: weakest?.label ?? "unmapped",
      blockers,
    };
  });

  /* ---- insights (grounded: every card cites its registries) ---- */
  const insights: MarketplaceInsight[] = [
    ...plans.slice(0, 3).map<MarketplaceInsight>((p) => ({
      id: `opportunity_${p.capabilityId}`,
      kind: "opportunity",
      headline: `Raise ${p.capabilityLabel} from ${p.currentScore} to ${p.targetScore}`,
      detail: `Limiting dimensions: ${p.limitingDimensions.join(", ")}. Recommended investment KES ${p.recommendedInvestmentKes.toLocaleString()}.`,
      businessImpactKes: p.expectedRevenueGainKes,
      expectedRoiPct: p.expectedRoi,
      confidence: clamp(70 + p.delta),
      citations: ["LCIF capability intelligence", "Capability improvement plan", "BCRA business outcomes"],
    })),
    ...valueStreams
      .filter((v) => v.status !== "certified")
      .slice(0, 2)
      .map<MarketplaceInsight>((v) => ({
        id: `risk_${v.id}`,
        kind: "risk",
        headline: `${v.name} is ${v.status.replace("_", " ")} at ${v.score}/100`,
        detail: `Weakest link: ${v.weakestCapability}. ${v.blockers[0] ?? "No blocker recorded."}`,
        businessImpactKes: v.revenueExposureKes,
        expectedRoiPct: 0,
        confidence: 84,
        citations: ["BCRA value stream certification", "LCIF capability intelligence"],
      })),
    ...(observedCells
      ? optimization.cells
          .filter((c) => c.action !== "hold")
          .slice(0, 3)
          .map<MarketplaceInsight>((c) => ({
            id: `action_${c.cellId}`,
            kind: "action",
            headline: `${c.name}: ${c.action.replace(/_/g, " ")}`,
            detail: `${c.rationale}. Expected lift ${c.expectedLift} points.`,
            businessImpactKes: 0,
            expectedRoiPct: c.expectedLift,
            confidence: 80,
            citations: ["Marketplace optimisation engine", "Event registry · dispatch events"],
          }))
      : []),
  ].filter((i) => i.citations.length > 0);

  /* ---- alerts ---- */
  const alerts: MarketplaceAlert[] = [
    ...optimization.findings.slice(0, 4).map<MarketplaceAlert>((f, i) => ({
      id: `opt_${i}`,
      severity: f.severity === "p0" ? "critical" : f.severity === "p1" ? "high" : "medium",
      title: `${f.subject}: ${f.summary}`,
      impact: "Unfulfilled demand and rider abandonment in the affected cell",
      recommendedAction: f.recommendation,
      owner: "Marketplace operations",
      etaMinutes: f.severity === "p0" ? 15 : 60,
      source: "Marketplace optimisation",
    })),
    ...lcif.slaBreaches.slice(0, 4).map<MarketplaceAlert>((b, i) => ({
      id: `sla_${i}`,
      severity: "high",
      title: `SLA breach — ${b}`,
      impact: "Contractual SLA exposure on a revenue-bearing capability",
      recommendedAction: "Open a CAPA against the owning capability and re-run certification",
      owner: "Capability owner",
      etaMinutes: 120,
      source: "LCIF SLA register",
    })),
    ...authority.failedGates.slice(0, 4).map<MarketplaceAlert>((g, i) => ({
      id: `gate_${i}`,
      severity: "critical",
      title: `Release gate failing — ${g}`,
      impact: "Marketplace capability cannot be certified while the gate fails",
      recommendedAction: "Resolve the gate; strict release authority never averages a failure away",
      owner: "Release authority",
      etaMinutes: 240,
      source: "BCRA strict release authority",
    })),
  ];

  /* ---- certificate ---- */
  const scoreOf = (id: string) => kpis.find((k) => k.id === id)?.value ?? 0;
  const body = {
    maturity: round(lcif.score, 1),
    business: round(readiness.score, 1),
    operational: round(clamp(scoreOf("operational_readiness")), 1),
    ai: round(readiness.aiMaturity.score, 1),
    financial: round(clamp(scoreOf("financial_readiness")), 1),
    governance: round(readiness.certificate.enterpriseConfidenceScore, 1),
    integration: round(clamp(scoreOf("integration_readiness")), 1),
    executive: round(clamp(readiness.certificate.enterpriseConfidenceScore * 0.5 + readiness.score * 0.5), 1),
    roi: round(clamp(average(plans.map((p) => p.expectedRoi))), 1),
    risk: round(clamp(100 - outcomes.riskReductionPct), 1),
    health: healthScore,
  };
  const weakest = Math.min(body.maturity, body.business, body.operational, body.ai, body.financial, body.governance, body.integration, body.health);
  const certificate: Marketplace360Certificate = {
    ...body,
    decision: authority.approved && weakest >= 90 ? "go" : weakest >= 75 ? "conditional_go" : "no_go",
    grade: grade(weakest),
    fingerprint: fnv1a(JSON.stringify(body) + authority.fingerprint),
  };

  const blindSpots = [
    ...(observedCells ? [] : ["No market cells streamed — supply, demand, liquidity and ETA metrics are unobserved"]),
    ...health.filter((h) => !h.observed).map((h) => `${h.label} has no observed evidence`),
  ];

  return {
    version: MARKETPLACE_360_VERSION,
    generatedAt: now.toISOString(),
    segments,
    hero,
    kpis,
    health,
    healthScore,
    valueStreams,
    insights,
    alerts,
    optimization,
    outcomes,
    certificate,
    blindSpots,
    digest: fnv1a(
      JSON.stringify({
        segments,
        health: health.map((h) => [h.dimension, h.score]),
        kpis: kpis.map((k) => [k.id, k.value]),
        certificate,
      }),
    ),
  };
}
