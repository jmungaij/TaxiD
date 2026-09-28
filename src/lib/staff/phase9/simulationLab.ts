/**
 * Phase 9 §31-§36 — controlled market optimisation, the simulation lab,
 * digital-twin scenarios, marketplace resilience and next-best-market ranking.
 *
 * "Autonomous growth" is explicitly replaced with a promotion pipeline. No
 * policy change reaches the live marketplace without passing offline modelling,
 * simulation, shadow mode, a controlled experiment and human commercial
 * approval — and every stage records the evidence that let it advance.
 */
import { type Measure, clamp, liveMeasure, modelledMeasure, unavailableMeasure } from "../phase8/provenance";

/* ------------------------ §31 controlled optimisation pipeline */

export const OPTIMISATION_STAGES = [
  "offline_model", "simulation", "shadow_mode", "controlled_experiment",
  "commercial_approval", "limited_production", "measure", "expand_or_rollback",
] as const;
export type OptimisationStage = (typeof OPTIMISATION_STAGES)[number];

export const OPTIMISATION_STAGE_LABEL: Record<OptimisationStage, string> = {
  offline_model: "Offline modelling",
  simulation: "Simulation",
  shadow_mode: "Shadow mode",
  controlled_experiment: "Controlled experiment",
  commercial_approval: "Human commercial approval",
  limited_production: "Limited production deployment",
  measure: "Measurement",
  expand_or_rollback: "Expand or roll back",
};

/** What a change must prove before it may leave each stage. */
export const STAGE_EXIT_CRITERIA: Record<OptimisationStage, string> = {
  offline_model: "The model reproduces historical outcomes better than the incumbent policy on held-out data.",
  simulation: "Simulated fulfilment, contribution and operator earnings do not degrade against the baseline.",
  shadow_mode: "Recommendations were logged against live decisions with no live effect, and agreement/divergence was reviewed.",
  controlled_experiment: "A pre-registered experiment shows a statistically credible improvement on the primary metric with no guardrail breach.",
  commercial_approval: "A named commercial authority approved the change, its bounds and its rollback trigger.",
  limited_production: "The change ran within an explicit blast radius with a live rollback path.",
  measure: "Measured effect on fulfilment, contribution, customer experience, operator economics and risk is recorded.",
  expand_or_rollback: "A decision was recorded with evidence; no change is left running unreviewed.",
};

export interface PolicyChange {
  id: string;
  name: string;
  /** e.g. "pricing", "matching", "incentives", "dispatch". */
  domain: string;
  stage: OptimisationStage;
  /** Evidence recorded per completed stage. */
  evidence: Partial<Record<OptimisationStage, string>>;
  blastRadiusPercent: number;
  approvedBy: string | null;
  rollbackTrigger: string | null;
  /** Guardrails that must not degrade. */
  guardrails: { metric: string; baseline: number | null; observed: number | null; maxDegradationPercent: number }[];
}

export interface PromotionDecision {
  changeId: string;
  currentStage: OptimisationStage;
  nextStage: OptimisationStage | null;
  mayPromote: boolean;
  blockers: string[];
  guardrailBreaches: string[];
  mustRollback: boolean;
  rationale: string;
}

export function evaluatePromotion(c: PolicyChange): PromotionDecision {
  const idx = OPTIMISATION_STAGES.indexOf(c.stage);
  const next = idx < OPTIMISATION_STAGES.length - 1 ? OPTIMISATION_STAGES[idx + 1] : null;
  const blockers: string[] = [];

  /* Every earlier stage must have recorded evidence — no stage skipping. */
  for (const s of OPTIMISATION_STAGES.slice(0, idx + 1)) {
    if (!c.evidence[s]) blockers.push(`${OPTIMISATION_STAGE_LABEL[s]} has no recorded evidence. Exit criterion: ${STAGE_EXIT_CRITERIA[s]}`);
  }
  if (next === "limited_production" && !c.approvedBy) blockers.push("No named commercial authority has approved live deployment.");
  if (next === "limited_production" && !c.rollbackTrigger) blockers.push("No rollback trigger is defined.");
  if (next === "limited_production" && c.blastRadiusPercent > 10) blockers.push(`Blast radius ${c.blastRadiusPercent}% exceeds the 10% limited-production ceiling.`);

  const guardrailBreaches = c.guardrails
    .filter((g) => g.baseline !== null && g.observed !== null && g.baseline !== 0 &&
      ((g.baseline - g.observed) / Math.abs(g.baseline)) * 100 > g.maxDegradationPercent)
    .map((g) => `${g.metric} degraded ${(((g.baseline! - g.observed!) / Math.abs(g.baseline!)) * 100).toFixed(1)}% against a ${g.maxDegradationPercent}% tolerance.`);

  const mustRollback = guardrailBreaches.length > 0 && idx >= OPTIMISATION_STAGES.indexOf("limited_production");

  return {
    changeId: c.id,
    currentStage: c.stage,
    nextStage: next,
    mayPromote: blockers.length === 0 && guardrailBreaches.length === 0 && next !== null,
    blockers,
    guardrailBreaches,
    mustRollback,
    rationale: mustRollback
      ? "Guardrail breach in production — roll back now and return the change to simulation."
      : blockers.length
        ? `Cannot promote: ${blockers.length} unmet requirement(s). The marketplace is not a test environment.`
        : next
          ? `Cleared to advance to ${OPTIMISATION_STAGE_LABEL[next]}.`
          : "Terminal stage: record the expand-or-rollback decision.",
  };
}

/* --------------------------------- §32 scientific model selection */

export const PROBLEM_CLASSES = [
  "demand_forecasting", "matching", "routing", "corporate_scheduling",
  "dynamic_marketplace", "customer_retention", "revenue_forecasting",
  "pricing", "fraud", "recommendations", "orchestration",
] as const;
export type ProblemClass = (typeof PROBLEM_CLASSES)[number];

export interface ModelChoice {
  problem: ProblemClass;
  label: string;
  method: string;
  /** Why an LLM is not the right tool here (or is). */
  llmRole: string;
}

/**
 * The critical distinction of §32: LLMs reason and orchestrate; they are not
 * the mathematical optimiser for any of these problems.
 */
export const MODEL_SELECTION: ModelChoice[] = [
  { problem: "demand_forecasting", label: "Demand forecasting", method: "Time-series / probabilistic forecasting with prediction intervals", llmRole: "Explains the forecast and its drivers; does not produce the numbers." },
  { problem: "matching", label: "Matching", method: "Constrained optimisation / bipartite matching with hard feasibility constraints", llmRole: "Narrates why a candidate won; never overrides the constraints." },
  { problem: "routing", label: "Routing", method: "Vehicle routing with time windows (VRPTW) heuristics", llmRole: "Summarises route exceptions for dispatchers." },
  { problem: "corporate_scheduling", label: "Corporate scheduling", method: "MILP / constraint programming, with ALNS heuristics at scale", llmRole: "Translates policy text into machine constraints for human review." },
  { problem: "dynamic_marketplace", label: "Dynamic marketplace", method: "Mechanism design plus game theory and optimisation", llmRole: "Drafts and critiques mechanism proposals for commercial approval." },
  { problem: "customer_retention", label: "Customer retention", method: "Survival analysis and churn models", llmRole: "Explains at-risk drivers to account owners." },
  { problem: "revenue_forecasting", label: "Revenue forecasting", method: "Probabilistic forecasting with explicit intervals", llmRole: "Writes the commentary, not the forecast." },
  { problem: "pricing", label: "Pricing", method: "Elasticity modelling with constrained experimentation", llmRole: "Never sets a price; may draft a policy proposal." },
  { problem: "fraud", label: "Fraud", method: "Anomaly detection with graph analysis over the commerce graph", llmRole: "Summarises a case file for an investigator." },
  { problem: "recommendations", label: "Recommendations", method: "Ranking and contextual decision models", llmRole: "Explains the ranking rationale." },
  { problem: "orchestration", label: "Agent orchestration", method: "LLM reasoning over tools with authority gates", llmRole: "This is the appropriate LLM role: reasoning and orchestration under authority limits." },
];

export function modelFor(problem: ProblemClass): ModelChoice | undefined {
  return MODEL_SELECTION.find((m) => m.problem === problem);
}

/* ------------------------------- §33/§34 simulation lab & digital twins */

export interface SimulationBaseline {
  demand: number;
  effectiveCapacity: number;
  /** Contribution per fulfilled transaction, KES. */
  contributionPerFulfilment: number;
  /** Operator net earnings per available hour, KES. */
  operatorEarningsPerHour: number;
  cancellationRate: number;  // 0-1
  priceIndex: number;        // 1.0 = current price level
  source: string;
}

export interface ScenarioLever {
  demandMultiplier?: number;
  capacityMultiplier?: number;
  priceMultiplier?: number;
  /** Elasticity of demand to price, negative by convention. */
  priceElasticity?: number;
  cancellationDelta?: number;
  /** Operator exit as a share of capacity. */
  operatorExitShare?: number;
}

export interface Scenario {
  id: string;
  name: string;
  question: string;
  levers: ScenarioLever;
}

export const STANDARD_SCENARIOS: Scenario[] = [
  { id: "demand_up_40", name: "Demand +40%", question: "What happens if demand increases 40%?", levers: { demandMultiplier: 1.4 } },
  { id: "operators_out_20", name: "20% operators unavailable", question: "What if 20% of operators become unavailable?", levers: { capacityMultiplier: 0.8, operatorExitShare: 0.2 } },
  { id: "corporate_double", name: "Corporate bookings double", question: "What if corporate bookings double?", levers: { demandMultiplier: 2 } },
  { id: "airport_spike", name: "Airport demand spike", question: "What if airport demand spikes?", levers: { demandMultiplier: 1.6, cancellationDelta: 0.02 } },
  { id: "corridor_shift", name: "Delivery corridor shift", question: "What if delivery demand shifts to another corridor?", levers: { capacityMultiplier: 0.7 } },
  { id: "major_operator_exit", name: "Major operator exits", question: "What if a major operator exits?", levers: { capacityMultiplier: 0.65, operatorExitShare: 0.35 } },
  { id: "price_up_10", name: "Price +10%", question: "What if pricing changes?", levers: { priceMultiplier: 1.1, priceElasticity: -0.8 } },
];

export interface ScenarioOutcome {
  scenarioId: string;
  name: string;
  question: string;
  fulfilmentRate: Measure;
  fulfilledTransactions: Measure;
  contribution: Measure;
  unservedDemand: Measure;
  operatorEarningsPerHour: Measure;
  customerExperienceIndex: Measure;
  riskNote: string;
  /** Delta vs the baseline, percent. */
  deltas: { metric: string; deltaPercent: number | null }[];
  /** Simulation output is MODELLED and must never be shown as performance. */
  disclaimer: string;
}

function simulate(base: SimulationBaseline, levers: ScenarioLever) {
  const priceMult = levers.priceMultiplier ?? 1;
  const elasticity = levers.priceElasticity ?? 0;
  const priceDemandEffect = 1 + elasticity * (priceMult - 1);
  const demand = base.demand * (levers.demandMultiplier ?? 1) * priceDemandEffect;
  const capacity = base.effectiveCapacity * (levers.capacityMultiplier ?? 1);
  const cancellation = clamp(base.cancellationRate + (levers.cancellationDelta ?? 0), 0, 1);
  const fulfilled = Math.min(demand, capacity) * (1 - cancellation);
  const contribution = fulfilled * base.contributionPerFulfilment * priceMult;
  const utilisationPressure = capacity > 0 ? clamp(demand / capacity, 0, 3) : 0;
  const operatorEarnings = base.operatorEarningsPerHour * clamp(utilisationPressure, 0.2, 1.6) * priceMult;
  const cx = clamp(100 - Math.max(0, (demand - capacity) / Math.max(1, demand)) * 120 - cancellation * 80, 0, 100);
  return { demand, capacity, fulfilled, contribution, operatorEarnings, cx, cancellation };
}

export function runScenario(base: SimulationBaseline, scenario: Scenario): ScenarioOutcome {
  const src = `${base.source} (simulated)`;
  const b = simulate(base, {});
  const s = simulate(base, scenario.levers);
  const mv = "yalla-sim-1.0.0";
  const pct = (a: number, bb: number) => (bb === 0 ? null : ((a - bb) / Math.abs(bb)) * 100);

  return {
    scenarioId: scenario.id,
    name: scenario.name,
    question: scenario.question,
    fulfilmentRate: modelledMeasure("Fulfilment rate", s.demand > 0 ? (s.fulfilled / s.demand) * 100 : 0, "percent", src, "min(demand, capacity) × (1 − cancellation) ÷ demand", 60, mv),
    fulfilledTransactions: modelledMeasure("Fulfilled transactions", s.fulfilled, "count", src, "min(demand, capacity) × (1 − cancellation)", 60, mv),
    contribution: modelledMeasure("Contribution", s.contribution, "kes", src, "fulfilled × contribution per fulfilment × price multiplier", 55, mv),
    unservedDemand: modelledMeasure("Unserved demand", Math.max(0, s.demand - s.capacity), "count", src, "demand less effective capacity", 60, mv),
    operatorEarningsPerHour: modelledMeasure("Operator earnings per hour", s.operatorEarnings, "kes", src, "baseline earnings × utilisation pressure × price multiplier", 50, mv),
    customerExperienceIndex: modelledMeasure("Customer experience index", s.cx, "score", src, "penalised for unserved demand and cancellation", 50, mv),
    riskNote: s.demand > s.capacity
      ? `Demand exceeds capacity by ${Math.round(s.demand - s.capacity)} units — the binding risk is fulfilment failure, not pricing.`
      : s.operatorEarnings < base.operatorEarningsPerHour * 0.85
        ? "Operator earnings per hour fall materially — supply will erode before customers notice."
        : "No dominant failure mode surfaced under these levers.",
    deltas: [
      { metric: "Fulfilled transactions", deltaPercent: pct(s.fulfilled, b.fulfilled) },
      { metric: "Contribution", deltaPercent: pct(s.contribution, b.contribution) },
      { metric: "Operator earnings / hour", deltaPercent: pct(s.operatorEarnings, b.operatorEarnings) },
      { metric: "Customer experience", deltaPercent: pct(s.cx, b.cx) },
    ],
    disclaimer: "Simulated output from an explicit model of the baseline. It is not TaxiD performance and must never be reported as actual results.",
  };
}

export function runStandardScenarios(base: SimulationBaseline): ScenarioOutcome[] {
  return STANDARD_SCENARIOS.map((s) => runScenario(base, s));
}

/* ------------------------------ §35 marketplace resilience engine */

export const DEPENDENCY_KINDS = ["operator", "category", "location", "payment", "technology", "partner"] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export interface DependencyExposure {
  kind: DependencyKind;
  name: string;
  /** Share of fulfilled transactions or revenue this dependency carries, 0-1. */
  share: number | null;
  /** Substitutes that could absorb the load. */
  alternatives: number | null;
  /** Hours to switch to an alternative. */
  failoverHours: number | null;
  source: string;
}

export interface ResilienceFinding {
  kind: DependencyKind;
  name: string;
  concentration: Measure;
  severity: "critical" | "high" | "moderate" | "low" | "not_evidenced";
  /** Simulated revenue at risk if this dependency fails. */
  revenueAtRisk: Measure;
  mitigation: string;
}

export function assessResilience(
  exposures: readonly DependencyExposure[],
  periodRevenue: number | null,
): ResilienceFinding[] {
  return exposures.map((e) => {
    const src = e.source;
    const concentration = e.share === null
      ? unavailableMeasure("Concentration", "percent", src, "Dependency share of fulfilled volume is not measurable")
      : liveMeasure("Concentration", e.share * 100, "percent", src, "share of fulfilled transactions carried by this dependency");

    const severity: ResilienceFinding["severity"] =
      e.share === null ? "not_evidenced"
        : e.share >= 0.4 && (e.alternatives ?? 0) === 0 ? "critical"
        : e.share >= 0.4 ? "high"
        : e.share >= 0.2 ? "moderate"
        : "low";

    return {
      kind: e.kind,
      name: e.name,
      concentration,
      severity,
      revenueAtRisk: (e.share !== null && periodRevenue !== null)
        ? modelledMeasure("Revenue at risk", periodRevenue * e.share, "kes", src,
            "period revenue × dependency share, assuming total loss of the dependency", 55, "yalla-resilience-1.0.0")
        : unavailableMeasure("Revenue at risk", "kes", src, "Requires a dependency share and period revenue"),
      mitigation: severity === "critical"
        ? `Single point of failure: ${e.name} carries ${((e.share ?? 0) * 100).toFixed(0)}% of volume with no alternative. Acquire substitutable capacity before growing this dependency further.`
        : severity === "high"
          ? `Reduce concentration or shorten failover (currently ${e.failoverHours ?? "unknown"} h).`
          : severity === "not_evidenced"
            ? "Instrument this dependency before relying on it."
            : "Within tolerance; monitor.",
    };
  }).sort((a, b) => (b.revenueAtRisk.value ?? -1) - (a.revenueAtRisk.value ?? -1));
}

/* ----------------------------------- §36 next best market engine */

export const MARKET_CRITERIA = [
  "demand", "supply_availability", "competition", "regulatory_feasibility",
  "cac", "liquidity_potential", "operator_economics", "revenue_potential",
  "operational_complexity", "strategic_fit",
] as const;
export type MarketCriterion = (typeof MARKET_CRITERIA)[number];

export const CRITERION_LABEL: Record<MarketCriterion, string> = {
  demand: "Demand",
  supply_availability: "Supply availability",
  competition: "Competition",
  regulatory_feasibility: "Regulatory feasibility",
  cac: "Customer acquisition cost",
  liquidity_potential: "Liquidity potential",
  operator_economics: "Operator economics",
  revenue_potential: "Revenue potential",
  operational_complexity: "Operational complexity",
  strategic_fit: "Strategic fit",
};

const MARKET_WEIGHTS: Record<MarketCriterion, number> = {
  demand: 0.16, supply_availability: 0.16, competition: 0.08, regulatory_feasibility: 0.12,
  cac: 0.08, liquidity_potential: 0.12, operator_economics: 0.1, revenue_potential: 0.1,
  operational_complexity: 0.04, strategic_fit: 0.04,
};

/** Higher raw value is worse for these criteria, so they are inverted. */
const INVERTED: MarketCriterion[] = ["competition", "cac", "operational_complexity"];

export interface MarketCandidate {
  id: string;
  name: string;
  /** 0-100 per criterion; null when not assessed. */
  scores: Partial<Record<MarketCriterion, number | null>>;
  source: string;
}

export interface MarketRanking {
  marketId: string;
  name: string;
  score: Measure;
  criteria: { criterion: MarketCriterion; weight: number; score: number | null; inverted: boolean }[];
  unassessed: MarketCriterion[];
  recommendation: string;
}

export function rankMarkets(candidates: readonly MarketCandidate[]): MarketRanking[] {
  return candidates.map((c) => {
    const criteria = MARKET_CRITERIA.map((criterion) => {
      const raw = c.scores[criterion] ?? null;
      const inverted = INVERTED.includes(criterion);
      return { criterion, weight: MARKET_WEIGHTS[criterion], score: raw === null ? null : inverted ? 100 - raw : raw, inverted };
    });
    const usable = criteria.filter((x) => x.score !== null);
    const weightAvailable = usable.reduce((a, x) => a + x.weight, 0);
    const unassessed = criteria.filter((x) => x.score === null).map((x) => x.criterion);

    const score: Measure = usable.length === 0
      ? unavailableMeasure("Market score", "score", c.source, "No criterion has been assessed for this market")
      : modelledMeasure("Market score",
          usable.reduce((a, x) => a + (x.score ?? 0) * x.weight, 0) / weightAvailable,
          "score", c.source, `weighted mean of ${usable.length} assessed criteria`, Math.round(weightAvailable * 100), "yalla-market-1.0.0");

    const regulatory = c.scores.regulatory_feasibility ?? null;
    const supply = c.scores.supply_availability ?? null;
    return {
      marketId: c.id,
      name: c.name,
      score,
      criteria,
      unassessed,
      recommendation: regulatory !== null && regulatory < 40
        ? "Do not enter: regulatory feasibility is the binding constraint, and no amount of demand compensates for it."
        : supply !== null && supply < 40
          ? "Do not enter yet: supply availability is too thin to serve demand TaxiD would create."
          : unassessed.length > 3
            ? `Insufficiently assessed: ${unassessed.length} criteria unscored. Entry decisions require evidence, not intuition.`
            : "Viable candidate — sequence against the higher-scoring markets.",
    };
  }).sort((a, b) => (b.score.value ?? -1) - (a.score.value ?? -1));
}
