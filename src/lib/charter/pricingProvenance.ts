/**
 * SmartFare pricing provenance.
 *
 * Procurement reviewers must be able to see *which live inputs* produced a
 * mission price and *what was missing* when an indicative "From" value is
 * shown. This module derives that audit view deterministically from a computed
 * MissionFare — no extra calculation, no second source of truth.
 */
import {
  loadSmartFareVersions, type FareSource, type MissionFare,
} from "./smartFare";
import { RATE_CARD_COMPONENTS, type OperatorMissionInputs } from "./operatorRateCards";

export const SOURCE_LABEL: Record<FareSource, string> = {
  operator_confirmed: "Operator rate card · availability confirmed",
  operator_rate_card: "Operator rate card (submitted)",
  airport_tariff: "Published airport / navigation tariff",
  platform_estimate: "TaxiD platform estimate",
  customer_selected: "Customer selection",
};

export const SOURCE_TONE: Record<FareSource, "live" | "published" | "estimated" | "selected"> = {
  operator_confirmed: "live",
  operator_rate_card: "live",
  airport_tariff: "published",
  platform_estimate: "estimated",
  customer_selected: "selected",
};

export interface ProvenanceLayer {
  key: string;
  label: string;
  amount: number;
  detail?: string;
  source: FareSource;
  sourceLabel: string;
  tone: "live" | "published" | "estimated" | "selected";
}

export interface MissingInput {
  key: string;
  label: string;
  impact: string;
}

export interface MissionProvenance {
  basis: MissionFare["priceBasis"];
  basisLabel: string;
  /** Share of priced value backed by operator-submitted components, 0–100. */
  operatorCoveragePct: number;
  layers: ProvenanceLayer[];
  missing: MissingInput[];
  savings: { key: string; label: string; amount: number; explanation: string; source: string }[];
  operator: OperatorMissionInputs | null;
  availabilityConfirmed: boolean;
  configVersion: number;
  configSavedAt: string | null;
  configActor: string | null;
}

const BASIS_LABEL: Record<MissionFare["priceBasis"], string> = {
  operator_calculated: "Operator-calculated mission price",
  operator_partial: "Partially operator-sourced — remaining layers estimated",
  platform_indicative: "Indicative “From” price — no operator submission applied",
};

const MISSING_IMPACT: Record<string, string> = {
  hourlyRateKes: "Flight time priced from the indicative fleet starting rate.",
  positioningRateKes: "Positioning priced from the aircraft repositioning ratio.",
  missionBaseFeeKes: "Mission base fee taken from the admin configuration.",
  airportChargesKes: "Landing, parking and passenger charges taken from published tariff tables.",
  handlingKes: "Ground handling taken from the airport-class tariff table.",
  navigationKes: "Navigation charge taken from the per-nautical-mile tariff.",
  crewKes: "Crew cost derived from the configured day and overnight rates.",
};

export function buildMissionProvenance(fare: MissionFare): MissionProvenance {
  const layers: ProvenanceLayer[] = fare.costLines.map((l) => {
    const source = l.source ?? "platform_estimate";
    return {
      key: l.key,
      label: l.label,
      amount: l.amount,
      detail: l.detail,
      source,
      sourceLabel: SOURCE_LABEL[source],
      tone: SOURCE_TONE[source],
    };
  });

  const priced = layers.filter((l) => l.amount > 0 && l.key !== "optional");
  const pricedTotal = priced.reduce((s, l) => s + l.amount, 0);
  const operatorTotal = priced
    .filter((l) => l.tone === "live")
    .reduce((s, l) => s + l.amount, 0);

  const card = fare.operator;
  const missing: MissingInput[] = RATE_CARD_COMPONENTS
    .filter((c) => {
      const v = card ? (card[c.key] as number | null | undefined) : undefined;
      return !(typeof v === "number" && v > 0);
    })
    .map((c) => ({ key: String(c.key), label: c.label, impact: MISSING_IMPACT[String(c.key)] ?? "Layer estimated by the platform." }));

  if (!card) {
    missing.unshift({
      key: "rate_card",
      label: "Operator rate card",
      impact: "No operator submission matched this aircraft and route, so every cost layer is a platform estimate.",
    });
  } else if (!card.availabilityConfirmed) {
    missing.unshift({
      key: "availability",
      label: "Confirmed availability",
      impact: "The operator has not confirmed the aircraft for this mission window, so the price stays indicative.",
    });
  }

  const versions = loadSmartFareVersions();
  const latest = versions[versions.length - 1];

  return {
    basis: fare.priceBasis,
    basisLabel: BASIS_LABEL[fare.priceBasis],
    operatorCoveragePct: pricedTotal > 0 ? Math.round((operatorTotal / pricedTotal) * 100) : 0,
    layers,
    missing,
    savings: fare.savings.map((s) => ({
      ...s,
      source: s.key === "empty_leg" || s.key === "shared"
        ? "Operator fleet utilisation"
        : s.key === "contract"
          ? "Admin-configured framework rate"
          : "Admin-configured optimisation rule",
    })),
    operator: card,
    availabilityConfirmed: Boolean(card?.availabilityConfirmed),
    configVersion: latest?.version ?? 0,
    configSavedAt: latest?.savedAt ?? null,
    configActor: latest?.actor ?? null,
  };
}
