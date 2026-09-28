/**
 * Phase 9 §3, §4, §19-§23, §29 — the two-sided marketplace control system.
 *
 * Demand Engine and Supply Engine are computed independently and then coupled
 * through the balance engine, so a sales forecast can never silently assume
 * capacity. Introduces Revenue-Weighted Liquidity and the marketplace North
 * Star: Successful Fulfilled Commercial Demand.
 */
import {
  type Measure, type Provenance, clamp, liveMeasure, modelledMeasure, unavailableMeasure, weakestProvenance,
} from "../phase8/provenance";
import type { ServiceLine } from "../phase8/customerEconomics";

const MODEL_VERSION = "yalla-sd-1.0.0";

export interface MarketCell {
  location: string;
  /** ISO window start or a human label such as "Mon 07:00-09:00". */
  window: string;
  category: string;
  service: ServiceLine;
}

export function cellId(c: MarketCell): string {
  return `${c.location}|${c.window}|${c.category}|${c.service}`;
}

/* ------------------------------------------------------- demand engine */

export interface DemandFacts extends MarketCell {
  /** Observed requests / requirements in the window. */
  requests: number | null;
  /** Requests that passed commercial qualification. */
  qualifiedRequests: number | null;
  /** Contribution observed per fulfilled request, KES. */
  contributionPerRequest: number | null;
  /** Historical same-window demand, ordered oldest → newest. */
  history: number[];
  source: string;
  provenance: Provenance;
}

export interface DemandSignal extends DemandFacts {
  demand: Measure;
  qualifiedDemand: Measure;
  /** Probabilistic forecast, never presented as fact. */
  forecast: Measure;
  forecastLow: Measure;
  forecastHigh: Measure;
  /** Commercial weight of the demand, not just its volume. */
  commercialValue: Measure;
  provenance: Provenance;
}

/** Simple, explainable forecast: trend-damped mean with observed dispersion. */
function forecastFromHistory(history: readonly number[]): { point: number; low: number; high: number; confidence: number } | null {
  if (history.length < 3) return null;
  const n = history.length;
  const mean = history.reduce((a, b) => a + b, 0) / n;
  const recent = history.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const point = mean * 0.4 + recent * 0.6;
  const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  return {
    point,
    low: Math.max(0, point - 1.28 * sd),
    high: point + 1.28 * sd,
    confidence: clamp(85 - (sd / Math.max(1, mean)) * 100, 20, 85),
  };
}

export function computeDemand(f: DemandFacts): DemandSignal {
  const src = f.source;
  const na = (l: string, u: Measure["unit"], why: string) => unavailableMeasure(l, u, src, why);
  const fc = forecastFromHistory(f.history);

  const demand = f.requests === null
    ? na("Demand", "count", "No request record readable for this cell")
    : liveMeasure("Demand", f.requests, "count", src, "COUNT of requests in window");
  const qualified = f.qualifiedRequests === null
    ? na("Qualified demand", "count", "Commercial qualification is not recorded for these requests")
    : liveMeasure("Qualified demand", f.qualifiedRequests, "count", src, "COUNT of requests passing commercial qualification");

  const value = (f.qualifiedRequests !== null && f.contributionPerRequest !== null)
    ? liveMeasure("Commercial value of demand", f.qualifiedRequests * f.contributionPerRequest, "kes", src,
        "qualified demand × observed contribution per fulfilled request")
    : na("Commercial value of demand", "kes", "Requires qualified demand and observed contribution per request");

  return {
    ...f,
    demand,
    qualifiedDemand: qualified,
    forecast: fc
      ? modelledMeasure("Forecast demand", fc.point, "count", `${src} (history n=${f.history.length})`,
          "0.4 × long-run mean + 0.6 × last-3-window mean", fc.confidence, MODEL_VERSION)
      : na("Forecast demand", "count", "Fewer than three comparable historical windows — no forecast may be stated"),
    forecastLow: fc
      ? modelledMeasure("Forecast P10", fc.low, "count", src, "point − 1.28 × observed standard deviation", fc.confidence, MODEL_VERSION)
      : na("Forecast P10", "count", "Insufficient history"),
    forecastHigh: fc
      ? modelledMeasure("Forecast P90", fc.high, "count", src, "point + 1.28 × observed standard deviation", fc.confidence, MODEL_VERSION)
      : na("Forecast P90", "count", "Insufficient history"),
    commercialValue: value,
    provenance: f.provenance,
  };
}

/* ------------------------------------------------------- supply engine */

export interface SupplyFacts extends MarketCell {
  registeredOperators: number | null;
  availableUnits: number | null;
  /** Units that pass the category capability + compliance test. */
  qualifiedUnits: number | null;
  /** Historical realised capacity for the same window. */
  history: number[];
  /** Observed jobs completed per available unit in the window. */
  jobsPerUnit: number | null;
  acceptanceRate: number | null;   // 0-1
  cancellationRate: number | null; // 0-1
  source: string;
  provenance: Provenance;
}

export interface SupplySignal extends SupplyFacts {
  registered: Measure;
  available: Measure;
  /** Capacity TaxiD may actually commit: qualified units × jobs per unit. */
  committableCapacity: Measure;
  /** Reliability-discounted capacity. */
  effectiveCapacity: Measure;
  forecastCapacity: Measure;
  provenance: Provenance;
}

export function computeSupply(f: SupplyFacts): SupplySignal {
  const src = f.source;
  const na = (l: string, u: Measure["unit"], why: string) => unavailableMeasure(l, u, src, why);
  const fc = forecastFromHistory(f.history);

  const committable = (f.qualifiedUnits !== null && f.jobsPerUnit !== null)
    ? liveMeasure("Committable capacity", f.qualifiedUnits * f.jobsPerUnit, "count", src,
        "qualified units × observed jobs per available unit")
    : na("Committable capacity", "count", "Requires qualified units and observed jobs per unit");

  const reliability = (f.acceptanceRate ?? null) !== null && (f.cancellationRate ?? null) !== null
    ? clamp((f.acceptanceRate ?? 0) * (1 - (f.cancellationRate ?? 0)), 0, 1)
    : null;

  return {
    ...f,
    registered: f.registeredOperators === null
      ? na("Registered operators", "count", "No operator register readable")
      : liveMeasure("Registered operators", f.registeredOperators, "count", src, "COUNT of registered operators"),
    available: f.availableUnits === null
      ? na("Available units", "count", "No availability signal readable")
      : liveMeasure("Available units", f.availableUnits, "count", src, "COUNT of units available in window"),
    committableCapacity: committable,
    effectiveCapacity: (committable.value !== null && reliability !== null)
      ? modelledMeasure("Effective capacity", committable.value * reliability, "count", src,
          "committable capacity × acceptance rate × (1 − cancellation rate)", 70, MODEL_VERSION)
      : na("Effective capacity", "count", "Requires committable capacity plus acceptance and cancellation rates"),
    forecastCapacity: fc
      ? modelledMeasure("Forecast capacity", fc.point, "count", src, "0.4 × long-run mean + 0.6 × recent mean", fc.confidence, MODEL_VERSION)
      : na("Forecast capacity", "count", "Fewer than three comparable historical windows"),
    provenance: f.provenance,
  };
}

/* ------------------------------------------ supply-demand balance engine */

export type BalanceVerdict = "oversupply" | "balanced" | "undersupply" | "not_evidenced";

export interface BalanceCell extends MarketCell {
  id: string;
  demand: DemandSignal;
  supply: SupplySignal;
  matchProbability: Measure;
  fulfilmentProbability: Measure;
  expectedWaitMinutes: Measure;
  capacityGap: Measure;
  revenueOpportunity: Measure;
  /** §19 — commercially valuable demand TaxiD can actually fulfil now. */
  revenueWeightedLiquidity: Measure;
  verdict: BalanceVerdict;
  narrative: string;
  provenance: Provenance;
}

export function computeBalance(d: DemandSignal, s: SupplySignal, opts?: { medianWaitMinutes?: number | null }): BalanceCell {
  const src = `${d.demand.source} + ${s.available.source}`;
  const na = (l: string, u: Measure["unit"], why: string) => unavailableMeasure(l, u, src, why);

  const demandV = d.qualifiedDemand.value ?? d.demand.value;
  const capacityV = s.effectiveCapacity.value ?? s.committableCapacity.value;

  const match = (demandV !== null && capacityV !== null && demandV > 0)
    ? modelledMeasure("Match probability", clamp((capacityV / demandV) * 100, 0, 100), "percent", src,
        "min(1, effective capacity ÷ qualified demand)", 70, MODEL_VERSION)
    : na("Match probability", "percent", "Requires qualified demand and effective capacity");

  const fulfil = (match.value !== null && s.cancellationRate !== null)
    ? modelledMeasure("Fulfilment probability", match.value * (1 - clamp(s.cancellationRate, 0, 1)), "percent", src,
        "match probability × (1 − cancellation rate)", 65, MODEL_VERSION)
    : match.value !== null
      ? modelledMeasure("Fulfilment probability", match.value, "percent", src,
          "match probability; no cancellation signal available to discount it", 45, MODEL_VERSION)
      : na("Fulfilment probability", "percent", "Requires a match probability");

  const gap = (demandV !== null && capacityV !== null)
    ? liveMeasure("Capacity gap", demandV - capacityV, "count", src, "qualified demand less effective capacity")
    : na("Capacity gap", "count", "Requires qualified demand and effective capacity");

  const perRequest = d.commercialValue.value !== null && demandV
    ? d.commercialValue.value / demandV
    : null;

  const opportunity = (gap.value !== null && gap.value > 0 && perRequest !== null)
    ? modelledMeasure("Revenue opportunity", gap.value * perRequest, "kes", src,
        "capacity gap × observed contribution per request", 60, MODEL_VERSION)
    : gap.value !== null && gap.value <= 0
      ? liveMeasure("Revenue opportunity", 0, "kes", src, "No capacity gap — demand is served")
      : na("Revenue opportunity", "kes", "Requires a capacity gap and observed contribution per request");

  /* §19 Revenue-Weighted Liquidity: not "vehicles online" but the commercial
     value of demand that can actually be fulfilled right now. */
  const rwl = (d.commercialValue.value !== null && fulfil.value !== null)
    ? modelledMeasure("Revenue-weighted liquidity", d.commercialValue.value * (fulfil.value / 100), "kes", src,
        "commercial value of qualified demand × fulfilment probability", Math.min(65, fulfil.confidence ?? 65), MODEL_VERSION)
    : na("Revenue-weighted liquidity", "kes", "Requires commercial value of demand and a fulfilment probability");

  const wait = opts?.medianWaitMinutes ?? null;
  const verdict: BalanceVerdict =
    match.value === null ? "not_evidenced"
      : match.value >= 130 ? "oversupply"
      : match.value >= 90 ? "balanced"
      : "undersupply";

  const narrative =
    verdict === "not_evidenced"
      ? "Neither side of this cell is sufficiently evidenced to state a balance verdict."
      : verdict === "undersupply"
        ? `Undersupplied: capacity covers ${Math.round(match.value ?? 0)}% of qualified demand. This is simultaneously a revenue opportunity and a customer-risk zone.`
        : verdict === "oversupply"
          ? `Oversupplied: capacity is ${Math.round(match.value ?? 0)}% of qualified demand — operator earnings per hour will fall before customer experience does.`
          : "Balanced: capacity approximately meets qualified demand.";

  return {
    location: d.location, window: d.window, category: d.category, service: d.service,
    id: cellId(d),
    demand: d,
    supply: s,
    matchProbability: match,
    fulfilmentProbability: fulfil,
    expectedWaitMinutes: wait === null
      ? na("Expected wait", "count", "No wait telemetry for this cell")
      : liveMeasure("Expected wait (min)", wait, "count", src, "median observed wait in window"),
    capacityGap: gap,
    revenueOpportunity: opportunity,
    revenueWeightedLiquidity: rwl,
    verdict,
    narrative,
    provenance: weakestProvenance([d.provenance, s.provenance, match.provenance]),
  };
}

/* ------------------------------------ §22 revenue fulfilment funnel */

export const FULFILMENT_FUNNEL_STEPS = [
  "demand", "qualified_demand", "available_capacity", "match",
  "confirmed_booking", "fulfilled_transaction", "paid_transaction",
  "settled_transaction", "repeat_transaction",
] as const;
export type FulfilmentFunnelStep = (typeof FULFILMENT_FUNNEL_STEPS)[number];

export const FUNNEL_LABEL: Record<FulfilmentFunnelStep, string> = {
  demand: "Demand",
  qualified_demand: "Qualified demand",
  available_capacity: "Available capacity",
  match: "Match",
  confirmed_booking: "Confirmed booking",
  fulfilled_transaction: "Fulfilled transaction",
  paid_transaction: "Paid transaction",
  settled_transaction: "Settled transaction",
  repeat_transaction: "Repeat transaction",
};

export interface FunnelStepResult {
  step: FulfilmentFunnelStep;
  count: Measure;
  /** Conversion from the previous evidenced step. */
  conversion: Measure;
  /** The biggest single loss point in the funnel. */
  isBottleneck: boolean;
}

export interface FulfilmentFunnel {
  steps: FunnelStepResult[];
  bottleneck: FulfilmentFunnelStep | null;
  /** §23 North Star — Successful Fulfilled Commercial Demand. */
  northStar: Measure;
  provenance: Provenance;
}

export function computeFulfilmentFunnel(
  counts: Partial<Record<FulfilmentFunnelStep, number | null>>,
  contributionPerFulfilled: number | null,
  source: string,
  provenance: Provenance = "LIVE",
): FulfilmentFunnel {
  const na = (l: string, u: Measure["unit"], why: string) => unavailableMeasure(l, u, source, why);

  let prev: number | null = null;
  const steps: FunnelStepResult[] = FULFILMENT_FUNNEL_STEPS.map((step) => {
    const v = counts[step] ?? null;
    const count = v === null
      ? na(FUNNEL_LABEL[step], "count", `No readable count for ${FUNNEL_LABEL[step]}`)
      : liveMeasure(FUNNEL_LABEL[step], v, "count", source, `COUNT at ${FUNNEL_LABEL[step]}`);
    const conversion = (v !== null && prev !== null && prev > 0)
      ? liveMeasure(`${FUNNEL_LABEL[step]} conversion`, (v / prev) * 100, "percent", source, "step ÷ previous evidenced step")
      : na(`${FUNNEL_LABEL[step]} conversion`, "percent", "Requires this step and the previous step");
    if (v !== null) prev = v;
    return { step, count, conversion, isBottleneck: false };
  });

  let worst: FunnelStepResult | null = null;
  for (const s of steps) {
    if (s.conversion.value === null) continue;
    if (!worst || s.conversion.value < (worst.conversion.value ?? 101)) worst = s;
  }
  if (worst) worst.isBottleneck = true;

  const fulfilledPaid = counts.settled_transaction ?? counts.paid_transaction ?? null;
  const northStar = (fulfilledPaid !== null && contributionPerFulfilled !== null)
    ? liveMeasure("Successful fulfilled commercial demand", fulfilledPaid * contributionPerFulfilled, "kes", source,
        "settled (or paid) transactions × observed contribution per fulfilled transaction")
    : na("Successful fulfilled commercial demand", "kes",
        "Requires settled transactions and observed contribution per fulfilled transaction");

  return { steps, bottleneck: worst?.step ?? null, northStar, provenance };
}

/* --------------------------------------------- §29 marketplace flywheel */

export const FLYWHEEL_STEPS = [
  "trusted_supply", "availability", "customer_experience", "demand",
  "transactions", "operator_earnings", "supply_attractiveness", "liquidity", "friction",
] as const;
export type FlywheelStep = (typeof FLYWHEEL_STEPS)[number];

export const FLYWHEEL_LABEL: Record<FlywheelStep, string> = {
  trusted_supply: "More trusted supply",
  availability: "Better availability",
  customer_experience: "Better customer experience",
  demand: "More demand",
  transactions: "More transactions",
  operator_earnings: "More operator earnings",
  supply_attractiveness: "More attractive supply",
  liquidity: "More liquidity",
  friction: "Lower friction",
};

export interface FlywheelReading {
  step: FlywheelStep;
  measure: Measure;
  /** Change vs the prior period, when both are readable. */
  delta: number | null;
}

export interface FlywheelAssessment {
  readings: FlywheelReading[];
  /** The step that is braking the wheel. */
  brakingStep: FlywheelStep | null;
  verdict: "accelerating" | "braking" | "not_evidenced";
  explanation: string;
}

export function assessFlywheel(readings: readonly FlywheelReading[]): FlywheelAssessment {
  const readable = readings.filter((r) => r.measure.value !== null && r.delta !== null);
  if (readable.length < 4) {
    return {
      readings: [...readings],
      brakingStep: null,
      verdict: "not_evidenced",
      explanation: "Fewer than four flywheel steps carry a period-on-period delta; no flywheel claim may be made.",
    };
  }
  const worst = readable.reduce((a, b) => ((a.delta ?? 0) <= (b.delta ?? 0) ? a : b));
  const braking = (worst.delta ?? 0) < 0;
  return {
    readings: [...readings],
    brakingStep: braking ? worst.step : null,
    verdict: braking ? "braking" : "accelerating",
    explanation: braking
      ? `${FLYWHEEL_LABEL[worst.step]} moved ${(worst.delta ?? 0).toFixed(1)}% and is braking the wheel — fixing it compounds through every downstream step.`
      : "Every evidenced step moved forward period-on-period; the wheel is reinforcing.",
  };
}
