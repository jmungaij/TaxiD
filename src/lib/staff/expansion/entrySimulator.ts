/**
 * Phase 9.4–9.5 — Entry scenario simulator.
 *
 * Runs the market twin under named strategies (lean pilot, balanced launch,
 * blitz) and stress cases (supply shortfall, fare compression, regulatory
 * delay). Outputs are SIMULATED by construction; the simulator's job is to make
 * the trade-off between speed, cash and fragility explicit.
 */
import { type Measure, seededMeasure, unavailableMeasure } from "../phase8/provenance";
import type { MarketRecord } from "./marketModel";
import { DEFAULT_TWIN_ASSUMPTIONS, buildMarketTwin, type TwinAssumptions } from "./marketTwin";

export type StrategyId = "lean_pilot" | "balanced_launch" | "blitz";
export type StressId = "base" | "supply_shortfall" | "fare_compression" | "regulatory_delay";

export interface Scenario {
  strategy: StrategyId;
  stress: StressId;
  label: string;
  peakCashNeed: Measure;
  breakevenMonth: Measure;
  month12Trips: number | null;
  unservedShare: number | null;
  contributionAtHorizon: number | null;
  verdict: "viable" | "fragile" | "unviable" | "not_assessable";
  notes: string[];
}

const STRATEGY_LABEL: Record<StrategyId, string> = {
  lean_pilot: "Lean pilot",
  balanced_launch: "Balanced launch",
  blitz: "Blitz scale",
};

const STRESS_LABEL: Record<StressId, string> = {
  base: "Base case",
  supply_shortfall: "Supply shortfall (−35% recruitment)",
  fare_compression: "Fare compression (−18% fare)",
  regulatory_delay: "Regulatory delay (6 months of fixed cost)",
};

function strategyAssumptions(strategy: StrategyId): TwinAssumptions {
  const base = DEFAULT_TWIN_ASSUMPTIONS;
  switch (strategy) {
    case "lean_pilot":
      return { ...base, riderPenetrationAt12m: 0.025, supplyPenetrationAt12m: 0.18,
        riderAcquisitionCost: 260, fixedMonthlyCost: base.fixedMonthlyCost * 0.45 };
    case "blitz":
      return { ...base, riderPenetrationAt12m: 0.12, supplyPenetrationAt12m: 0.6,
        riderAcquisitionCost: 720, supplyAcquisitionCost: 4_600,
        fixedMonthlyCost: base.fixedMonthlyCost * 1.7 };
    default:
      return base;
  }
}

/** Stress is applied to the market record and/or the assumptions, never hidden. */
function applyStress(record: MarketRecord, assumptions: TwinAssumptions, stress: StressId) {
  const r: MarketRecord = { ...record, signals: { ...record.signals } };
  let a = assumptions;
  if (stress === "supply_shortfall") {
    a = { ...a, supplyPenetrationAt12m: a.supplyPenetrationAt12m * 0.65 };
  }
  if (stress === "fare_compression" && r.signals.averageFare.value !== null) {
    r.signals.averageFare = { ...r.signals.averageFare, value: r.signals.averageFare.value * 0.82 };
  }
  if (stress === "regulatory_delay") {
    a = { ...a, fixedMonthlyCost: a.fixedMonthlyCost, horizonMonths: a.horizonMonths };
  }
  return { record: r, assumptions: a };
}

export function simulateScenario(
  record: MarketRecord,
  strategy: StrategyId,
  stress: StressId,
): Scenario {
  const label = `${STRATEGY_LABEL[strategy]} · ${STRESS_LABEL[stress]}`;
  const src = `sim:${record.definition.id}:${strategy}:${stress}`;
  const { record: r, assumptions } = applyStress(record, strategyAssumptions(strategy), stress);
  const twin = buildMarketTwin(r, assumptions);

  if (twin.months.length === 0) {
    return {
      strategy, stress, label,
      peakCashNeed: unavailableMeasure("Peak cash need", "kes", src, twin.blockers.join("; ")),
      breakevenMonth: unavailableMeasure("Breakeven month", "count", src, twin.blockers.join("; ")),
      month12Trips: null, unservedShare: null, contributionAtHorizon: null,
      verdict: "not_assessable",
      notes: twin.blockers,
    };
  }

  const notes: string[] = [];
  let peak = twin.peakCashNeed;
  let breakeven = twin.breakevenMonth;

  if (stress === "regulatory_delay") {
    const extra = assumptions.fixedMonthlyCost * 6;
    peak = seededMeasure("Peak cash need", (peak.value ?? 0) + extra, "kes", src,
      "twin peak cash need + 6 months of fixed cost carried before launch",
      "Regulatory delay stress applied to the twin projection");
    breakeven = breakeven.value === null ? breakeven : seededMeasure(
      "Breakeven month", breakeven.value + 6, "count", src,
      "twin breakeven shifted by the 6-month licensing delay",
      "Regulatory delay stress applied to the twin projection");
    notes.push("Six months of fixed cost is carried before the first trip completes.");
  }

  const m12 = twin.months.find((m) => m.month === 12) ?? null;
  const demanded = twin.months.reduce((a, m) => a + m.demandedTrips, 0);
  const unserved = twin.months.reduce((a, m) => a + m.unservedTrips, 0);
  const unservedShare = demanded === 0 ? null : (unserved / demanded) * 100;
  const horizonContribution = twin.months[twin.months.length - 1].contribution;

  if (unservedShare !== null && unservedShare > 20) {
    notes.push(`${unservedShare.toFixed(0)}% of projected demand goes unserved — the constraint is supply, not sales.`);
  }
  const supplyBound = twin.months.filter((m) => m.constraint === "supply").length;
  if (supplyBound > twin.months.length / 2) {
    notes.push("The market is supply-constrained for most of the horizon; acquisition must lead demand generation.");
  }

  const viable = breakeven.value !== null && breakeven.value <= 18 && horizonContribution > 0;
  const fragile = breakeven.value !== null && breakeven.value <= 24;

  return {
    strategy, stress, label,
    peakCashNeed: peak,
    breakevenMonth: breakeven,
    month12Trips: m12 ? m12.completedTrips : null,
    unservedShare,
    contributionAtHorizon: horizonContribution,
    verdict: viable ? "viable" : fragile ? "fragile" : "unviable",
    notes,
  };
}

export const STRATEGIES: StrategyId[] = ["lean_pilot", "balanced_launch", "blitz"];
export const STRESSES: StressId[] = ["base", "supply_shortfall", "fare_compression", "regulatory_delay"];

export interface ScenarioMatrix {
  marketId: string;
  marketName: string;
  scenarios: Scenario[];
  /** Strategy that stays viable under the most stress cases. */
  mostRobustStrategy: StrategyId | null;
  robustnessByStrategy: Record<StrategyId, number>;
}

export function runScenarioMatrix(record: MarketRecord): ScenarioMatrix {
  const scenarios = STRATEGIES.flatMap((s) => STRESSES.map((t) => simulateScenario(record, s, t)));
  const robustness = Object.fromEntries(STRATEGIES.map((s) => [
    s, scenarios.filter((x) => x.strategy === s && x.verdict === "viable").length,
  ])) as Record<StrategyId, number>;

  const best = STRATEGIES
    .filter((s) => robustness[s] > 0)
    .sort((a, b) => robustness[b] - robustness[a])[0] ?? null;

  return {
    marketId: record.definition.id,
    marketName: record.definition.name,
    scenarios,
    mostRobustStrategy: best,
    robustnessByStrategy: robustness,
  };
}
