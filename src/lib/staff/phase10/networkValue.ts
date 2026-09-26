/**
 * Phase 10 §10.33–10.34 + §10.25 — Incremental Marketplace Value, the Network
 * Effects Engine and the Enterprise Adaptation Engine.
 *
 * IMV replaces activity counting: for any action — a salesperson, a provider, a
 * city, an incentive, an integration, an automation — how much additional
 * economically valuable transaction capacity becomes possible?
 */
import { type Measure, clamp, modelledMeasure, unavailableMeasure } from "../phase8/provenance";

export type ActionKind =
  | "hire_salesperson"
  | "acquire_provider"
  | "launch_city"
  | "launch_service"
  | "pay_incentive"
  | "build_integration"
  | "automate_process"
  | "sign_partner";

export interface ImvInput {
  id: string;
  kind: ActionKind;
  description: string;
  /** Additional missions the action makes fulfillable per month. */
  incrementalMissionsPerMonth: number | null;
  /** Observed contribution per mission, cents. */
  contributionPerMissionCents: number | null;
  /** Probability the capacity is actually consumed, 0-100. */
  realisationProbability: number | null;
  /** Monthly cost of the action, cents. */
  monthlyCostCents: number | null;
  /** One-off cost, cents. */
  setupCostCents: number | null;
  /** Months over which the value is assessed. */
  horizonMonths: number;
}

export interface ImvResult {
  input: ImvInput;
  incrementalValue: Measure;
  netValue: Measure;
  /** Contribution per shilling spent; null when cost is unknown. */
  returnMultiple: number | null;
  paybackMonths: number | null
  verdict: "fund" | "fund_with_conditions" | "reject" | "not_assessable";
  reasons: string[];
}

const MV = "yalla-p10-imv-1.0.0";

export function incrementalMarketplaceValue(input: ImvInput): ImvResult {
  const src = "transaction spine + liquidity brain";
  const reasons: string[] = [];
  const missing: string[] = [];
  if (input.incrementalMissionsPerMonth === null) missing.push("incremental missions per month");
  if (input.contributionPerMissionCents === null) missing.push("contribution per mission");
  if (input.realisationProbability === null) missing.push("realisation probability");

  if (missing.length > 0) {
    const why = `Requires ${missing.join(", ")}`;
    return {
      input,
      incrementalValue: unavailableMeasure("Incremental marketplace value", "kes", src, why),
      netValue: unavailableMeasure("Net value", "kes", src, why),
      returnMultiple: null,
      paybackMonths: null,
      verdict: "not_assessable",
      reasons: [`${why} — Yalla will not fund an action whose marketplace value cannot be stated.`],
    };
  }

  const monthlyValue =
    ((input.incrementalMissionsPerMonth ?? 0) * (input.contributionPerMissionCents ?? 0) * ((input.realisationProbability ?? 0) / 100)) / 100;
  const gross = monthlyValue * input.horizonMonths;
  const cost = ((input.monthlyCostCents ?? 0) * input.horizonMonths + (input.setupCostCents ?? 0)) / 100;
  const costKnown = input.monthlyCostCents !== null || input.setupCostCents !== null;
  const net = gross - cost;
  const multiple = costKnown && cost > 0 ? gross / cost : null;
  const payback = costKnown && monthlyValue > 0 ? ((input.setupCostCents ?? 0) / 100) / Math.max(0.01, monthlyValue - (input.monthlyCostCents ?? 0) / 100) : null;

  if (!costKnown) reasons.push("Cost of the action is not stated — the return cannot be verified");
  if (multiple !== null && multiple < 1) reasons.push(`Return multiple of ${multiple.toFixed(2)}× destroys contribution`);
  if ((input.realisationProbability ?? 0) < 40) reasons.push(`Realisation probability of ${input.realisationProbability}% is speculative`);

  const verdict: ImvResult["verdict"] = !costKnown
    ? "fund_with_conditions"
    : multiple !== null && multiple >= 1.5
      ? "fund"
      : multiple !== null && multiple >= 1
        ? "fund_with_conditions"
        : "reject";

  return {
    input,
    incrementalValue: modelledMeasure("Incremental marketplace value", gross, "kes", src,
      "incremental missions × contribution per mission × realisation probability × horizon", 45, MV),
    netValue: costKnown
      ? modelledMeasure("Net value", net, "kes", src, "incremental value − (monthly cost × horizon + setup cost)", 45, MV)
      : unavailableMeasure("Net value", "kes", src, "Cost of the action is not stated"),
    returnMultiple: multiple === null ? null : Number(multiple.toFixed(2)),
    paybackMonths: payback === null || payback < 0 ? null : Number(payback.toFixed(1)),
    verdict,
    reasons,
  };
}

export function rankActions(inputs: readonly ImvInput[]): ImvResult[] {
  return inputs
    .map(incrementalMarketplaceValue)
    .sort((a, b) => (b.netValue.value ?? b.incrementalValue.value ?? -1) - (a.netValue.value ?? a.incrementalValue.value ?? -1));
}

/* ------------------------------------------------------------------ */
/* §10.34 Network Effects Engine                                       */
/* ------------------------------------------------------------------ */

export interface FlywheelObservation {
  customers: number | null;
  providers: number | null;
  /** Share of demand matched, 0-100. */
  availability: number | null;
  /** Mean customer rating out of 5. */
  experience: number | null;
  transactions: number | null;
  /** Transactions per provider — provider attractiveness. */
  providerOpportunity: number | null;
  /** Missions with complete telemetry, share 0-100 — the data asset. */
  dataCoverage: number | null;
  /** Matched-first-attempt share, 0-100 — matching quality. */
  matchingQuality: number | null;
  asOf: string | null;
}

export interface FlywheelLink {
  from: string;
  to: string;
  /** 0-100 strength; null when either side is unmeasured. */
  strength: number | null;
  basis: string;
}

export interface NetworkEffects {
  score: Measure;
  links: FlywheelLink[];
  /** Links that cannot be measured yet — the honest weak points. */
  unmeasured: string[];
  narrative: string;
}

export function assessNetworkEffects(o: FlywheelObservation): NetworkEffects {
  const src = "marketplace telemetry";
  const pct = (v: number | null) => (v === null ? null : clamp(v, 0, 100));

  const links: FlywheelLink[] = [
    { from: "More customers", to: "Provider opportunity", strength: o.providerOpportunity === null ? null : clamp(o.providerOpportunity * 10, 0, 100), basis: "transactions per provider" },
    { from: "More providers", to: "Availability", strength: pct(o.availability), basis: "share of demand matched" },
    { from: "Availability", to: "Customer experience", strength: o.experience === null ? null : clamp((o.experience / 5) * 100, 0, 100), basis: "mean customer rating" },
    { from: "Customer experience", to: "Transactions", strength: o.transactions !== null && o.customers ? clamp((o.transactions / Math.max(1, o.customers)) * 25, 0, 100) : null, basis: "transactions per customer" },
    { from: "Transactions", to: "Provider attractiveness", strength: o.providerOpportunity === null ? null : clamp(o.providerOpportunity * 10, 0, 100), basis: "transactions per provider" },
    { from: "Transactions", to: "Data asset", strength: pct(o.dataCoverage), basis: "share of missions with complete telemetry" },
    { from: "Data asset", to: "Matching quality", strength: pct(o.matchingQuality), basis: "share matched on first attempt" },
    { from: "Matching quality", to: "Liquidity", strength: pct(o.availability), basis: "share of demand matched" },
  ];

  const measured = links.filter((l) => l.strength !== null);
  const unmeasured = links.filter((l) => l.strength === null).map((l) => `${l.from} → ${l.to} (${l.basis} is not observed)`);

  /* Fewer than half the links measured means the flywheel is a claim, not a finding. */
  const score = measured.length < links.length / 2
    ? unavailableMeasure("Network effect score", "score", src,
        `Only ${measured.length} of ${links.length} flywheel links are measured — the flywheel cannot be scored`)
    : modelledMeasure(
        "Network effect score",
        measured.reduce((a, l) => a + (l.strength ?? 0), 0) / measured.length,
        "score",
        src,
        "mean strength of measured flywheel links",
        Math.round((measured.length / links.length) * 70),
        MV,
      );

  const weakest = [...measured].sort((a, b) => (a.strength ?? 0) - (b.strength ?? 0))[0];
  return {
    score,
    links,
    unmeasured,
    narrative: score.value === null
      ? "The flywheel is not yet measurable: instrument the missing links before claiming network effects."
      : `Weakest measured link: ${weakest.from} → ${weakest.to} at ${Math.round(weakest.strength ?? 0)}/100 (${weakest.basis}).`,
  };
}

/* ------------------------------------------------------------------ */
/* §10.25 Enterprise Adaptation Engine                                 */
/* ------------------------------------------------------------------ */

export type AdaptationSignalKind =
  | "demand_change"
  | "supply_change"
  | "competitor_change"
  | "pricing_change"
  | "customer_behaviour"
  | "provider_behaviour"
  | "regulatory_change"
  | "service_failure"
  | "expansion_signal";

export type AdaptationResponse =
  | "change_supply"
  | "change_pricing"
  | "change_service"
  | "change_sales_priority"
  | "change_partner_incentives"
  | "change_market_strategy"
  | "change_operating_process"
  | "launch_experiment"
  | "pause_activity"
  | "observe_only";

export interface AdaptationSignal {
  id: string;
  kind: AdaptationSignalKind;
  observation: string;
  /** Signed percentage change, when quantified. */
  deltaPercent: number | null;
  /** Economic exposure or opportunity, cents. */
  impactCents: number | null;
  source: string;
  detectedAt: string;
}

export interface AdaptationVerdict {
  signal: AdaptationSignal;
  adaptationRequired: boolean;
  responses: AdaptationResponse[];
  urgency: "immediate" | "this_week" | "this_quarter" | "monitor";
  requiresApproval: boolean;
  rationale: string;
}

const RESPONSE_MAP: Record<AdaptationSignalKind, AdaptationResponse[]> = {
  demand_change: ["change_supply", "change_sales_priority", "change_pricing"],
  supply_change: ["change_partner_incentives", "change_supply", "change_pricing"],
  competitor_change: ["change_pricing", "change_market_strategy", "launch_experiment"],
  pricing_change: ["change_pricing", "change_operating_process"],
  customer_behaviour: ["change_service", "change_sales_priority", "launch_experiment"],
  provider_behaviour: ["change_partner_incentives", "change_operating_process"],
  regulatory_change: ["pause_activity", "change_operating_process", "change_market_strategy"],
  service_failure: ["change_operating_process", "pause_activity", "change_supply"],
  expansion_signal: ["change_market_strategy", "launch_experiment"],
};

export function assessAdaptation(signal: AdaptationSignal): AdaptationVerdict {
  const magnitude = Math.abs(signal.deltaPercent ?? 0);
  const impact = signal.impactCents ?? 0;
  const material = magnitude >= 10 || impact >= 100_000_00 || signal.kind === "regulatory_change" || signal.kind === "service_failure";

  const urgency: AdaptationVerdict["urgency"] = signal.kind === "regulatory_change" || signal.kind === "service_failure"
    ? "immediate"
    : magnitude >= 25 || impact >= 500_000_00
      ? "this_week"
      : material
        ? "this_quarter"
        : "monitor";

  return {
    signal,
    adaptationRequired: material,
    responses: material ? RESPONSE_MAP[signal.kind] : ["observe_only"],
    urgency,
    requiresApproval: material && (impact >= 250_000_00 || signal.kind === "regulatory_change" || signal.kind === "pricing_change"),
    rationale: material
      ? `${signal.kind.replace(/_/g, " ")} is material${signal.deltaPercent !== null ? ` at ${signal.deltaPercent.toFixed(1)}%` : ""}${signal.impactCents !== null ? ` and KES ${Math.round(impact / 100).toLocaleString()} of exposure` : " with unquantified exposure"} — Yalla should adapt.`
      : `${signal.kind.replace(/_/g, " ")} is below the materiality threshold; continue observing rather than reacting.`,
  };
}
