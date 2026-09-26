/**
 * Phase 9.2 — Market attractiveness engine.
 *
 * Six weighted dimensions produce a 0–100 score. A dimension whose signal is
 * unavailable is excluded and disclosed, and the score is renormalised over the
 * dimensions that could actually be evaluated — a missing signal is never
 * scored as a zero, and never as a pass.
 */
import { type Measure, clamp, modelledMeasure, unavailableMeasure } from "../phase8/provenance";
import type { MarketRecord } from "./marketModel";

export type AttractivenessDimension =
  | "demand_scale"
  | "revenue_density"
  | "supply_feasibility"
  | "competitive_headroom"
  | "regulatory_openness"
  | "payment_readiness";

export interface DimensionScore {
  dimension: AttractivenessDimension;
  label: string;
  weight: number;
  /** 0–100, or null when the signal is not admissible. */
  score: number | null;
  basis: string;
  reason: string;
}

export interface AttractivenessResult {
  marketId: string;
  marketName: string;
  score: Measure;
  dimensions: DimensionScore[];
  /** Share of total weight that could be evaluated, 0–100. */
  coveragePct: number;
  /** Dimensions excluded because their signal is unavailable. */
  excluded: string[];
  band: "prioritise" | "qualify" | "watch" | "reject" | "not_assessable";
}

const WEIGHTS: Record<AttractivenessDimension, number> = {
  demand_scale: 0.22,
  revenue_density: 0.22,
  supply_feasibility: 0.2,
  competitive_headroom: 0.14,
  regulatory_openness: 0.14,
  payment_readiness: 0.08,
};

const LABELS: Record<AttractivenessDimension, string> = {
  demand_scale: "Demand scale",
  revenue_density: "Revenue density",
  supply_feasibility: "Supply feasibility",
  competitive_headroom: "Competitive headroom",
  regulatory_openness: "Regulatory openness",
  payment_readiness: "Payment readiness",
};

const MODEL_VERSION = "yalla-attractiveness-1.1.0";

/** Monthly gross bookings implied by the demand signals, KES. Null if unproven. */
export function impliedMonthlyGross(record: MarketRecord): number | null {
  const riders = record.signals.addressableRiders.value;
  const freq = record.signals.tripFrequency.value;
  const fare = record.signals.averageFare.value;
  if (riders === null || freq === null || fare === null) return null;
  return riders * freq * fare;
}

/** Contribution per trip, KES. Null when fare or cost to serve is unproven. */
export function contributionPerTrip(record: MarketRecord): number | null {
  const fare = record.signals.averageFare.value;
  const cost = record.signals.costToServe.value;
  if (fare === null || cost === null) return null;
  return fare - cost;
}

function logScale(value: number, floor: number, ceiling: number): number {
  if (value <= floor) return 0;
  if (value >= ceiling) return 100;
  const l = Math.log(value / floor) / Math.log(ceiling / floor);
  return clamp(l * 100, 0, 100);
}

export function scoreAttractiveness(record: MarketRecord): AttractivenessResult {
  const s = record.signals;
  const dims: DimensionScore[] = [];

  const push = (
    dimension: AttractivenessDimension,
    score: number | null,
    basis: string,
    reason: string,
  ) => dims.push({ dimension, label: LABELS[dimension], weight: WEIGHTS[dimension], score, basis, reason });

  const riders = s.addressableRiders.value;
  push("demand_scale",
    riders === null ? null : logScale(riders, 20_000, 3_000_000),
    s.addressableRiders.source,
    riders === null ? "Addressable riders not observed" : "log scale 20k → 3m addressable riders");

  const gross = impliedMonthlyGross(record);
  push("revenue_density",
    gross === null ? null : logScale(gross, 5_000_000, 2_000_000_000),
    "addressable riders × trip frequency × average fare",
    gross === null ? "Demand signals incomplete" : "log scale KES 5m → 2bn monthly gross");

  const supply = s.reachableSupply.value;
  const tripsNeeded = riders !== null && s.tripFrequency.value !== null ? riders * s.tripFrequency.value : null;
  const supplyRatio = supply !== null && tripsNeeded ? supply * 120 / tripsNeeded : null;
  push("supply_feasibility",
    supplyRatio === null ? null : clamp(supplyRatio * 100, 0, 100),
    s.reachableSupply.source,
    supplyRatio === null ? "Reachable supply or demand volume not observed"
      : "reachable supply × 120 trips/month ÷ forecast monthly trips");

  const competitors = s.competitorCount.value;
  push("competitive_headroom",
    competitors === null ? null : clamp(100 - competitors * 18, 0, 100),
    s.competitorCount.source,
    competitors === null ? "Incumbent count not observed" : "100 − 18 points per entrenched incumbent");

  const friction = s.regulatoryFriction.value;
  push("regulatory_openness",
    friction === null ? null : clamp(100 - friction, 0, 100),
    s.regulatoryFriction.source,
    friction === null ? "Regulatory friction not assessed" : "inverse of assessed friction");

  const pay = s.digitalPaymentReadiness.value;
  push("payment_readiness", pay === null ? null : clamp(pay, 0, 100), s.digitalPaymentReadiness.source,
    pay === null ? "Digital settlement share not observed" : "share of trips that can settle digitally");

  const scored = dims.filter((d) => d.score !== null);
  const coverageWeight = scored.reduce((a, d) => a + d.weight, 0);
  const coveragePct = Math.round(coverageWeight * 100);
  const excluded = dims.filter((d) => d.score === null).map((d) => d.label);

  const src = `market:${record.definition.id}`;
  if (coverageWeight < 0.6) {
    return {
      marketId: record.definition.id,
      marketName: record.definition.name,
      score: unavailableMeasure("Attractiveness", "score", src,
        `Only ${coveragePct}% of scoring weight is evidenced — below the 60% assessability floor`),
      dimensions: dims, coveragePct, excluded, band: "not_assessable",
    };
  }

  const raw = scored.reduce((a, d) => a + (d.score ?? 0) * d.weight, 0) / coverageWeight;
  const value = Math.round(raw);
  const confidence = Math.round(clamp(coverageWeight * 100 - excluded.length * 4, 10, 95));

  return {
    marketId: record.definition.id,
    marketName: record.definition.name,
    score: modelledMeasure("Attractiveness", value, "score", src,
      "weighted mean of evidenced dimensions, renormalised over evaluated weight",
      confidence, MODEL_VERSION),
    dimensions: dims,
    coveragePct,
    excluded,
    band: value >= 72 ? "prioritise" : value >= 58 ? "qualify" : value >= 42 ? "watch" : "reject",
  };
}

export function rankMarkets(records: readonly MarketRecord[]): AttractivenessResult[] {
  return records
    .map(scoreAttractiveness)
    .sort((a, b) => (b.score.value ?? -1) - (a.score.value ?? -1));
}
