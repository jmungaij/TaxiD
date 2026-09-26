/**
 * Phase 9.1 — Market intelligence model.
 *
 * A market is a named geography plus a set of observed signals. Every signal
 * carries its provenance through the Phase 8 kernel, so an unobserved market
 * can never masquerade as a measured one. Nothing here invents a figure: an
 * absent signal is UNAVAILABLE and blocks anything downstream that needs it.
 */
import {
  type Measure,
  type Provenance,
  liveMeasure,
  modelledMeasure,
  unavailableMeasure,
  weakestProvenance,
} from "../phase8/provenance";

export type MarketTier = "core" | "adjacent" | "frontier";

export interface MarketDefinition {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  tier: MarketTier;
  /** Population of the addressable urban catchment. */
  populationSource: string;
}

/** The signal set that any expansion judgement is allowed to consume. */
export interface MarketSignals {
  urbanPopulation: Measure;
  /** Households or individuals able to afford a premium mobility trip. */
  addressableRiders: Measure;
  /** Observed trips per addressable rider per month, from comparable markets. */
  tripFrequency: Measure;
  /** Achievable average fare, KES. */
  averageFare: Measure;
  /** Drivers/vehicles reachable for recruitment inside 90 days. */
  reachableSupply: Measure;
  /** Named incumbent operators. */
  competitorCount: Measure;
  /** Regulatory friction, 0 (open) – 100 (closed). */
  regulatoryFriction: Measure;
  /** Cost to serve one completed trip, KES. */
  costToServe: Measure;
  /** Share of trips that can settle digitally (M-Pesa/card). */
  digitalPaymentReadiness: Measure;
}

export interface MarketRecord {
  definition: MarketDefinition;
  signals: MarketSignals;
  /** Weakest provenance across all signals — the market's evidence grade. */
  evidenceGrade: Provenance;
  /** Signals that are not admissible, by label. */
  gaps: string[];
}

export type SignalKey = keyof MarketSignals;

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  urbanPopulation: "Urban catchment population",
  addressableRiders: "Addressable riders",
  tripFrequency: "Trips per rider per month",
  averageFare: "Average achievable fare",
  reachableSupply: "Reachable supply (90 days)",
  competitorCount: "Incumbent operators",
  regulatoryFriction: "Regulatory friction",
  costToServe: "Cost to serve per trip",
  digitalPaymentReadiness: "Digital payment readiness",
};

export interface SignalInput {
  value: number | null;
  source: string;
  /** How the number was obtained; required whenever a value is present. */
  calculation: string;
  /** LIVE for an observed SAFARID/registry fact, MODELLED for an inference. */
  provenance: Extract<Provenance, "LIVE" | "MODELLED">;
  confidence?: number;
  asOf?: string;
}

const UNITS: Record<SignalKey, Measure["unit"]> = {
  urbanPopulation: "count",
  addressableRiders: "count",
  tripFrequency: "count",
  averageFare: "kes",
  reachableSupply: "count",
  competitorCount: "count",
  regulatoryFriction: "score",
  costToServe: "kes",
  digitalPaymentReadiness: "percent",
};

const MODEL_VERSION = "yalla-market-model-1.0.0";

function toMeasure(key: SignalKey, input: SignalInput | undefined): Measure {
  const label = SIGNAL_LABELS[key];
  const unit = UNITS[key];
  if (!input || input.value === null || !Number.isFinite(input.value)) {
    return unavailableMeasure(label, unit, input?.source ?? "—",
      "No admissible observation for this market");
  }
  if (input.provenance === "LIVE") {
    return liveMeasure(label, input.value, unit, input.source, input.calculation, input.asOf);
  }
  return modelledMeasure(
    label, input.value, unit, input.source, input.calculation,
    input.confidence ?? 55, MODEL_VERSION,
  );
}

export function buildMarketRecord(
  definition: MarketDefinition,
  inputs: Partial<Record<SignalKey, SignalInput>>,
): MarketRecord {
  const keys = Object.keys(SIGNAL_LABELS) as SignalKey[];
  const signals = Object.fromEntries(
    keys.map((k) => [k, toMeasure(k, inputs[k])]),
  ) as unknown as MarketSignals;

  const all = keys.map((k) => signals[k]);
  return {
    definition,
    signals,
    evidenceGrade: weakestProvenance(all.map((m) => m.provenance)),
    gaps: all.filter((m) => m.value === null).map((m) => m.label),
  };
}

/** Signals without which no entry decision may be taken (9.6 hard gate). */
export const DECISION_CRITICAL_SIGNALS: SignalKey[] = [
  "addressableRiders",
  "tripFrequency",
  "averageFare",
  "reachableSupply",
  "costToServe",
  "regulatoryFriction",
];

export function missingDecisionSignals(record: MarketRecord): string[] {
  return DECISION_CRITICAL_SIGNALS
    .filter((k) => record.signals[k].value === null)
    .map((k) => SIGNAL_LABELS[k]);
}
