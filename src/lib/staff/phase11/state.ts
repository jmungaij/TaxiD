/**
 * Phase 11 §11.2 — Yalla State Engine.
 *
 * "Airport demand is rising" is not a state. A state is demand, available supply,
 * committed supply, expected arrivals, provider quality, price, fulfilment
 * probability and financial value at a named granularity and time window. Any
 * dimension that is not observed stays null and degrades the state to
 * `unmeasured` — the engine never infers a comfortable balance from silence.
 */
import { clamp } from "@/lib/staff/phase8/provenance";

export interface StateGranularity {
  market: string;
  city: string | null;
  zone: string | null;
  corridor: string | null;
  airport: string | null;
  service: string;
  customerSegment: string;
  window: string;
}

export interface StateObservation {
  demand: number | null;
  availableSupply: number | null;
  committedSupply: number | null;
  expectedArrivals: number | null;
  providerQualityScore: number | null;
  priceIndex: number | null;
  fulfilmentProbability: number | null;
  contributionPerMissionCents: number | null;
  asOf: string | null;
}

export type StateLabel = "surplus" | "balanced" | "tight" | "shortage" | "unmeasured";

export const STATE_LABEL_TEXT: Record<StateLabel, string> = {
  surplus: "Supply surplus",
  balanced: "Balanced",
  tight: "Tight",
  shortage: "Supply shortage",
  unmeasured: "Not measured",
};

export interface MarketplaceState {
  id: string;
  granularity: StateGranularity;
  observation: StateObservation;
  label: StateLabel;
  /** demand ÷ (available + committed + expected arrivals). null when unmeasured. */
  tension: number | null;
  /** Unserved demand implied by the tension ratio. */
  unservedDemand: number | null;
  /** Contribution at risk in cents if the gap is not closed. */
  valueAtRiskCents: number | null;
  /** 0-100 share of state dimensions actually observed. */
  completeness: number;
  missing: string[];
  narrative: string;
}

const DIMENSIONS: (keyof StateObservation)[] = [
  "demand",
  "availableSupply",
  "committedSupply",
  "expectedArrivals",
  "providerQualityScore",
  "priceIndex",
  "fulfilmentProbability",
  "contributionPerMissionCents",
];

const LABELS: Record<string, string> = {
  demand: "demand",
  availableSupply: "available supply",
  committedSupply: "committed supply",
  expectedArrivals: "expected arrivals",
  providerQualityScore: "provider quality",
  priceIndex: "price",
  fulfilmentProbability: "fulfilment probability",
  contributionPerMissionCents: "contribution per mission",
};

export function buildState(
  id: string,
  granularity: StateGranularity,
  observation: StateObservation,
): MarketplaceState {
  const missing = DIMENSIONS.filter((d) => observation[d] === null).map((d) => LABELS[d]);
  const completeness = Math.round(((DIMENSIONS.length - missing.length) / DIMENSIONS.length) * 100);

  const effectiveSupply =
    observation.availableSupply === null && observation.committedSupply === null && observation.expectedArrivals === null
      ? null
      : (observation.availableSupply ?? 0) + (observation.committedSupply ?? 0) + (observation.expectedArrivals ?? 0);

  const tension =
    observation.demand === null || effectiveSupply === null || effectiveSupply <= 0
      ? null
      : Math.round((observation.demand / effectiveSupply) * 100) / 100;

  const label: StateLabel =
    tension === null
      ? "unmeasured"
      : tension >= 1.5
        ? "shortage"
        : tension >= 1.1
          ? "tight"
          : tension >= 0.7
            ? "balanced"
            : "surplus";

  const unservedDemand =
    tension === null || observation.demand === null || effectiveSupply === null
      ? null
      : Math.max(0, Math.round(observation.demand - effectiveSupply));

  const valueAtRiskCents =
    unservedDemand === null || observation.contributionPerMissionCents === null
      ? null
      : Math.round(unservedDemand * observation.contributionPerMissionCents);

  const narrative =
    tension === null
      ? `State not measurable — missing ${missing.join(", ") || "all dimensions"}. No intervention may be justified on this cell.`
      : `${STATE_LABEL_TEXT[label]} at tension ${tension.toFixed(2)}${
          unservedDemand === null ? "" : `, ${unservedDemand} mission(s) of demand unserved`
        }${valueAtRiskCents === null ? " (contribution at risk not quantifiable)" : `, KES ${Math.round(valueAtRiskCents / 100).toLocaleString()} contribution at risk`}.`;

  return {
    id,
    granularity,
    observation,
    label,
    tension,
    unservedDemand,
    valueAtRiskCents,
    completeness: clamp(completeness, 0, 100),
    missing,
    narrative,
  };
}

export interface StateSummary {
  cells: number;
  measured: number;
  shortages: number;
  totalValueAtRiskCents: number | null;
  /** Mean completeness across cells, 0-100. */
  instrumentation: number;
}

export function summariseStates(states: readonly MarketplaceState[]): StateSummary {
  const measured = states.filter((s) => s.label !== "unmeasured");
  const risks = states.map((s) => s.valueAtRiskCents).filter((v): v is number => v !== null);
  return {
    cells: states.length,
    measured: measured.length,
    shortages: states.filter((s) => s.label === "shortage" || s.label === "tight").length,
    totalValueAtRiskCents: risks.length === 0 ? null : risks.reduce((a, v) => a + v, 0),
    instrumentation: states.length === 0 ? 0 : Math.round(states.reduce((a, s) => a + s.completeness, 0) / states.length),
  };
}

/** The state cell that most deserves attention: highest quantified value at risk. */
export function priorityState(states: readonly MarketplaceState[]): MarketplaceState | null {
  const quantified = states.filter((s) => s.valueAtRiskCents !== null && s.valueAtRiskCents > 0);
  if (quantified.length === 0) return null;
  return [...quantified].sort((a, b) => (b.valueAtRiskCents ?? 0) - (a.valueAtRiskCents ?? 0))[0];
}
