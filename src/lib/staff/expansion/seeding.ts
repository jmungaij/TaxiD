/**
 * Phase 9.7 — Market seeding playbook.
 *
 * Turns an approved entry into a sequenced 90-day plan: which side of the
 * marketplace is seeded first, how many units, at what incentive cost, and the
 * liquidity checkpoint each wave must clear before the next is funded.
 */
import { type Measure, seededMeasure, unavailableMeasure } from "../phase8/provenance";
import { contributionPerTrip } from "./attractiveness";
import type { MarketRecord } from "./marketModel";
import type { StrategyId } from "./entrySimulator";

export type SeedSide = "supply_first" | "demand_first" | "simultaneous";

export interface SeedWave {
  wave: number;
  window: string;
  focus: SeedSide;
  supplyUnits: number;
  riderTargets: number;
  incentiveBudget: Measure;
  /** Gate that must pass before the next wave is funded. */
  checkpoint: string;
}

export interface SeedingPlan {
  marketId: string;
  marketName: string;
  side: SeedSide;
  sideRationale: string;
  waves: SeedWave[];
  totalBudget: Measure;
  /** Trips per active supply unit per week the plan must reach to be liquid. */
  liquidityTarget: number;
  blockers: string[];
}

export interface SeedingInputs {
  strategy: StrategyId;
  /** Incentive per recruited supply unit for the first 30 days, KES. */
  supplyIncentive: number;
  /** Promotional cost per acquired rider, KES. */
  riderIncentive: number;
  /** Trips per supply unit per week that marks a liquid market. */
  liquidityTarget: number;
}

export const DEFAULT_SEEDING_INPUTS: SeedingInputs = {
  strategy: "balanced_launch",
  supplyIncentive: 4_500,
  riderIncentive: 350,
  liquidityTarget: 22,
};

const SCALE: Record<StrategyId, number> = { lean_pilot: 0.4, balanced_launch: 1, blitz: 2.1 };

export function buildSeedingPlan(
  record: MarketRecord,
  inputs: SeedingInputs = DEFAULT_SEEDING_INPUTS,
): SeedingPlan {
  const src = `seed:${record.definition.id}`;
  const supplyPool = record.signals.reachableSupply.value;
  const riders = record.signals.addressableRiders.value;
  const contribution = contributionPerTrip(record);
  const blockers: string[] = [];
  if (supplyPool === null) blockers.push("Reachable supply is not observed — wave sizing is not possible.");
  if (riders === null) blockers.push("Addressable riders are not observed — demand targets cannot be set.");
  if (contribution === null) blockers.push("Contribution per trip is not calculable — incentive payback is unknown.");

  if (supplyPool === null || riders === null) {
    return {
      marketId: record.definition.id,
      marketName: record.definition.name,
      side: "supply_first",
      sideRationale: "Default to supply-first: fulfilment capacity is the binding constraint in every unevidenced market.",
      waves: [],
      totalBudget: unavailableMeasure("Seeding budget", "kes", src, blockers.join(" ")),
      liquidityTarget: inputs.liquidityTarget,
      blockers,
    };
  }

  const freq = record.signals.tripFrequency.value ?? 4;
  const demandTrips = riders * 0.02 * freq;
  const supplyCapacity = supplyPool * 0.2 * 110;
  const side: SeedSide = supplyCapacity < demandTrips * 0.9 ? "supply_first"
    : supplyCapacity > demandTrips * 1.3 ? "demand_first" : "simultaneous";
  const sideRationale = side === "supply_first"
    ? "Reachable supply cannot cover early demand — recruit and activate operators before spending on rider promotion."
    : side === "demand_first"
      ? "Reachable supply comfortably exceeds early demand — spend on rider acquisition to raise utilisation before recruiting more."
      : "Both sides are within 30% of each other — seed simultaneously and rebalance weekly on observed utilisation.";

  const scale = SCALE[inputs.strategy];
  const waveShape = side === "supply_first"
    ? [{ s: 0.5, r: 0.15 }, { s: 0.3, r: 0.35 }, { s: 0.2, r: 0.5 }]
    : side === "demand_first"
      ? [{ s: 0.15, r: 0.5 }, { s: 0.35, r: 0.3 }, { s: 0.5, r: 0.2 }]
      : [{ s: 0.34, r: 0.34 }, { s: 0.33, r: 0.33 }, { s: 0.33, r: 0.33 }];

  const totalSupply = Math.round(supplyPool * 0.2 * scale);
  const totalRiders = Math.round(riders * 0.02 * scale);
  const evidence = `Wave sizing derived from ${record.evidenceGrade} supply and demand signals`;

  const waves: SeedWave[] = waveShape.map((w, i) => {
    const supplyUnits = Math.round(totalSupply * w.s);
    const riderTargets = Math.round(totalRiders * w.r);
    const budget = supplyUnits * inputs.supplyIncentive + riderTargets * inputs.riderIncentive;
    return {
      wave: i + 1,
      window: `Day ${i * 30 + 1}–${(i + 1) * 30}`,
      focus: side,
      supplyUnits,
      riderTargets,
      incentiveBudget: seededMeasure(`Wave ${i + 1} incentive budget`, budget, "kes", src,
        "supply units × supply incentive + rider targets × rider incentive", evidence),
      checkpoint: i === 0
        ? `≥60% of wave-1 operators active and ≥${Math.round(inputs.liquidityTarget * 0.5)} trips per operator per week`
        : `≥${Math.round(inputs.liquidityTarget * (i === 1 ? 0.75 : 1))} trips per operator per week and unserved demand below 15%`,
    };
  });

  const total = waves.reduce((a, w) => a + (w.incentiveBudget.value ?? 0), 0);
  if (contribution !== null && contribution > 0) {
    const tripsToRepay = Math.round(total / contribution);
    if (blockers.length === 0) waves.push({
      wave: waves.length + 1,
      window: "Day 91+",
      focus: side,
      supplyUnits: 0,
      riderTargets: 0,
      incentiveBudget: seededMeasure("Payback checkpoint", 0, "kes", src,
        "no further incentive; the market must now repay the seeding spend", evidence),
      checkpoint: `Seeding spend repaid after ${tripsToRepay.toLocaleString()} contributing trips`,
    });
  }

  return {
    marketId: record.definition.id,
    marketName: record.definition.name,
    side,
    sideRationale,
    waves,
    totalBudget: seededMeasure("Seeding budget", total, "kes", src,
      "sum of wave incentive budgets", evidence),
    liquidityTarget: inputs.liquidityTarget,
    blockers,
  };
}
