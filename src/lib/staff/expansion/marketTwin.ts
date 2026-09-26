/**
 * Phase 9.3 — Market digital twin.
 *
 * A twin projects one market month-by-month: riders acquired, supply recruited,
 * completed trips constrained by whichever side is scarcer, gross bookings,
 * contribution and cash burn. Every twin output is SIMULATED — it is never
 * presented as SAFARID performance, and it refuses to run without the decision
 * signals it depends on.
 */
import { type Measure, clamp, seededMeasure, unavailableMeasure } from "../phase8/provenance";
import { contributionPerTrip } from "./attractiveness";
import { type MarketRecord, missingDecisionSignals } from "./marketModel";

export interface TwinAssumptions {
  /** Months to project. */
  horizonMonths: number;
  /** Share of addressable riders acquired by month 12, 0–1. */
  riderPenetrationAt12m: number;
  /** Share of reachable supply recruited by month 12, 0–1. */
  supplyPenetrationAt12m: number;
  /** Completed trips one active supply unit delivers per month. */
  tripsPerSupplyUnit: number;
  /** Marketing + incentive spend per acquired rider, KES. */
  riderAcquisitionCost: number;
  /** Recruitment + activation spend per supply unit, KES. */
  supplyAcquisitionCost: number;
  /** Fixed local operating cost per month, KES. */
  fixedMonthlyCost: number;
}

export const DEFAULT_TWIN_ASSUMPTIONS: TwinAssumptions = {
  horizonMonths: 24,
  riderPenetrationAt12m: 0.06,
  supplyPenetrationAt12m: 0.35,
  tripsPerSupplyUnit: 110,
  riderAcquisitionCost: 450,
  supplyAcquisitionCost: 3_200,
  fixedMonthlyCost: 1_800_000,
};

export interface TwinMonth {
  month: number;
  activeRiders: number;
  activeSupply: number;
  demandedTrips: number;
  supplyCapacity: number;
  completedTrips: number;
  /** Trips lost because the scarcer side could not serve them. */
  unservedTrips: number;
  grossBookings: number;
  contribution: number;
  spend: number;
  netCashflow: number;
  cumulativeCash: number;
  constraint: "supply" | "demand" | "balanced";
}

export interface MarketTwin {
  marketId: string;
  marketName: string;
  assumptions: TwinAssumptions;
  months: TwinMonth[];
  peakCashNeed: Measure;
  breakevenMonth: Measure;
  month24Contribution: Measure;
  /** Reasons the twin could not be built. */
  blockers: string[];
}

/** Logistic adoption curve reaching `at12` of the ceiling at month 12. */
function adoption(month: number, at12: number): number {
  const k = 0.35;
  const midpoint = 12 + Math.log(Math.max(1e-6, 1 / clamp(at12, 0.001, 0.98) - 1)) / k;
  return 1 / (1 + Math.exp(-k * (month - midpoint)));
}

export function buildMarketTwin(
  record: MarketRecord,
  assumptions: TwinAssumptions = DEFAULT_TWIN_ASSUMPTIONS,
): MarketTwin {
  const src = `twin:${record.definition.id}`;
  const blockers = missingDecisionSignals(record);
  const na = (label: string, unit: Measure["unit"]) =>
    unavailableMeasure(label, unit, src, blockers.length
      ? `Missing decision signals: ${blockers.join(", ")}`
      : "Twin could not be projected");

  const riders = record.signals.addressableRiders.value;
  const freq = record.signals.tripFrequency.value;
  const fare = record.signals.averageFare.value;
  const supplyPool = record.signals.reachableSupply.value;
  const contribution = contributionPerTrip(record);

  if (blockers.length > 0 || riders === null || freq === null || fare === null
    || supplyPool === null || contribution === null) {
    return {
      marketId: record.definition.id,
      marketName: record.definition.name,
      assumptions,
      months: [],
      peakCashNeed: na("Peak cash need", "kes"),
      breakevenMonth: na("Contribution breakeven", "count"),
      month24Contribution: na("Month-24 monthly contribution", "kes"),
      blockers: blockers.length ? blockers : ["Contribution per trip is not calculable"],
    };
  }

  const months: TwinMonth[] = [];
  let cumulativeCash = 0;
  let prevRiders = 0;
  let prevSupply = 0;

  for (let m = 1; m <= assumptions.horizonMonths; m++) {
    const activeRiders = Math.round(riders * assumptions.riderPenetrationAt12m
      * (adoption(m, 0.5) / adoption(12, 0.5)) * (m >= 12 ? 1 + (m - 12) * 0.035 : 1));
    const activeSupply = Math.round(supplyPool * assumptions.supplyPenetrationAt12m
      * (adoption(m, 0.55) / adoption(12, 0.55)));

    const demandedTrips = Math.round(activeRiders * freq);
    const supplyCapacity = Math.round(activeSupply * assumptions.tripsPerSupplyUnit);
    const completedTrips = Math.min(demandedTrips, supplyCapacity);
    const unservedTrips = Math.max(0, demandedTrips - supplyCapacity);

    const grossBookings = completedTrips * fare;
    const contributionTotal = completedTrips * contribution;
    const spend = Math.max(0, activeRiders - prevRiders) * assumptions.riderAcquisitionCost
      + Math.max(0, activeSupply - prevSupply) * assumptions.supplyAcquisitionCost
      + assumptions.fixedMonthlyCost;
    const netCashflow = contributionTotal - spend;
    cumulativeCash += netCashflow;

    const ratio = supplyCapacity === 0 ? 0 : demandedTrips / supplyCapacity;
    months.push({
      month: m, activeRiders, activeSupply, demandedTrips, supplyCapacity, completedTrips,
      unservedTrips, grossBookings, contribution: contributionTotal, spend, netCashflow,
      cumulativeCash,
      constraint: ratio > 1.1 ? "supply" : ratio < 0.9 ? "demand" : "balanced",
    });
    prevRiders = activeRiders;
    prevSupply = activeSupply;
  }

  const trough = Math.min(...months.map((x) => x.cumulativeCash));
  const breakeven = months.find((x) => x.netCashflow >= 0)?.month ?? null;
  const last = months[months.length - 1];
  const evidence = `Projection from ${record.evidenceGrade} market signals under ${assumptions.horizonMonths}-month assumptions`;

  return {
    marketId: record.definition.id,
    marketName: record.definition.name,
    assumptions,
    months,
    peakCashNeed: seededMeasure("Peak cash need", Math.abs(Math.min(0, trough)), "kes", src,
      "most negative cumulative cash position across the horizon", evidence),
    breakevenMonth: breakeven === null
      ? unavailableMeasure("Contribution breakeven", "count", src,
        "No month reaches positive net cashflow inside the horizon")
      : seededMeasure("Contribution breakeven", breakeven, "count", src,
        "first month with non-negative net cashflow", evidence),
    month24Contribution: seededMeasure("Final-month contribution", last.contribution, "kes", src,
      "completed trips × contribution per trip in the final projected month", evidence),
    blockers: [],
  };
}
