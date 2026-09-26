/**
 * Rate card completion validator.
 *
 * A final (binding) SmartFare quote may only be issued when the operator has
 * submitted every required mission cost component *and* confirmed availability
 * for the selected route. Anything short of that stays an indicative "From"
 * price. This module is the single gate both the customer workspace and the
 * admin console use, so the rule cannot drift between surfaces.
 */
import {
  RATE_CARD_COMPONENTS, resolveOperatorInputs, type OperatorMissionInputs,
} from "./operatorRateCards";
import type { MissionFare } from "./smartFare";

/** Components that must be present before a quote can be finalised. */
export const REQUIRED_COMPONENTS: (keyof OperatorMissionInputs)[] = [
  "hourlyRateKes",
  "positioningRateKes",
  "airportChargesKes",
  "handlingKes",
  "navigationKes",
  "crewKes",
];

export interface ValidationIssue {
  key: string;
  label: string;
  reason: string;
  blocking: boolean;
}

export interface RateCardValidation {
  /** True when a binding quote may be issued. */
  canFinalise: boolean;
  /** 0–100 share of required components supplied. */
  completionPct: number;
  blocking: ValidationIssue[];
  advisory: ValidationIssue[];
  card: OperatorMissionInputs | null;
  /** Human summary used in banners, exports and audit records. */
  summary: string;
}

const LABEL = new Map(RATE_CARD_COMPONENTS.map((c) => [String(c.key), c.label]));
const label = (k: keyof OperatorMissionInputs) => LABEL.get(String(k)) ?? String(k);

const has = (card: OperatorMissionInputs | null, k: keyof OperatorMissionInputs) => {
  const v = card ? (card[k] as number | null | undefined) : undefined;
  return typeof v === "number" && v > 0;
};

export interface ValidateArgs {
  aircraftKey: string;
  fromCode?: string;
  toCode?: string;
  /** Pre-resolved card (tests / callers that already resolved one). */
  card?: OperatorMissionInputs | null;
  cards?: OperatorMissionInputs[];
  now?: Date;
}

/** Validate the operator submission backing a mission route. */
export function validateRateCard(args: ValidateArgs): RateCardValidation {
  const card = args.card !== undefined
    ? args.card
    : resolveOperatorInputs({
      aircraftKey: args.aircraftKey,
      fromCode: args.fromCode,
      toCode: args.toCode,
      cards: args.cards,
      now: args.now,
    });

  const blocking: ValidationIssue[] = [];
  const advisory: ValidationIssue[] = [];

  if (!card) {
    blocking.push({
      key: "rate_card",
      label: "Operator rate card",
      reason: "No operator submission matches this aircraft and route, so no binding price can be issued.",
      blocking: true,
    });
    return {
      canFinalise: false,
      completionPct: 0,
      blocking,
      advisory,
      card: null,
      summary: "Indicative only — no operator rate card for this mission.",
    };
  }

  const supplied = REQUIRED_COMPONENTS.filter((k) => has(card, k));
  for (const k of REQUIRED_COMPONENTS) {
    if (!has(card, k)) {
      blocking.push({
        key: String(k),
        label: label(k),
        reason: `${label(k)} was not submitted — this layer is currently a platform estimate.`,
        blocking: true,
      });
    }
  }

  if (!card.availabilityConfirmed) {
    blocking.push({
      key: "availability",
      label: "Confirmed availability",
      reason: "The operator has not confirmed the aircraft for this mission window.",
      blocking: true,
    });
  }

  const routeScoped = Boolean(card.fromCode && card.toCode);
  if (!routeScoped) {
    advisory.push({
      key: "route_scope",
      label: "Route-specific rate card",
      reason: "A fleet-wide card is in force. A route-scoped submission prices positioning more accurately.",
      blocking: false,
    });
  }
  if (!has(card, "missionBaseFeeKes")) {
    advisory.push({
      key: "missionBaseFeeKes",
      label: label("missionBaseFeeKes"),
      reason: "Mission base fee falls back to the admin configuration.",
      blocking: false,
    });
  }
  if (card.validTo && new Date(card.validTo).getTime() - (args.now ?? new Date()).getTime() < 14 * 864e5) {
    advisory.push({
      key: "expiry",
      label: "Rate card expiry",
      reason: `This submission expires on ${new Date(card.validTo).toLocaleDateString("en-KE")} — request a renewal before contracting.`,
      blocking: false,
    });
  }

  const completionPct = Math.round((supplied.length / REQUIRED_COMPONENTS.length) * 100);
  const canFinalise = blocking.length === 0;

  return {
    canFinalise,
    completionPct,
    blocking,
    advisory,
    card,
    summary: canFinalise
      ? `Binding quote available — ${card.operatorName} supplied all required components and confirmed availability.`
      : `Indicative only — ${blocking.length} requirement${blocking.length === 1 ? "" : "s"} outstanding (${completionPct}% of cost components submitted).`,
  };
}

/** Convenience: validate straight from a computed mission fare. */
export function validateFare(fare: MissionFare, now?: Date): RateCardValidation {
  return validateRateCard({
    aircraftKey: fare.aircraft.key,
    fromCode: fare.from?.code,
    toCode: fare.to?.code,
    card: fare.operator ?? null,
    now,
  });
}
