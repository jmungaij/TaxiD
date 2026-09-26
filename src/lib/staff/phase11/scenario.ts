/**
 * Phase 11 §11.4, §11.5, §11.17, §11.30 — Scenario Engine, Intervention
 * Optimiser and the multi-sided incentive check.
 *
 * Prediction says what is likely. This module answers "what happens if we
 * intervene?" — and ranks interventions by Expected Incremental Enterprise Value
 * net of cost, risk, customer harm, provider harm and operational complexity.
 * An intervention whose value cannot be quantified is `unquantified`, never
 * recommended, so the platform cannot chase activity in place of contribution.
 */
import { clamp } from "@/lib/staff/phase8/provenance";

export type InterventionKind =
  | "add_supply"
  | "remove_supply"
  | "incentivise_supply"
  | "reposition_supply"
  | "adjust_price"
  | "adjust_matching"
  | "adjust_service_availability"
  | "prioritise_missions"
  | "reroute_logistics"
  | "shift_demand"
  | "customer_incentive"
  | "change_sales_capacity"
  | "do_nothing";

export const INTERVENTION_LABEL: Record<InterventionKind, string> = {
  add_supply: "Recruit additional providers",
  remove_supply: "Reduce committed supply",
  incentivise_supply: "Incentivise existing providers",
  reposition_supply: "Reposition available providers",
  adjust_price: "Adjust pricing within policy",
  adjust_matching: "Change matching rules",
  adjust_service_availability: "Adjust service availability",
  prioritise_missions: "Change dispatch priorities",
  reroute_logistics: "Reroute logistics",
  shift_demand: "Contact accounts about alternative windows",
  customer_incentive: "Customer incentive",
  change_sales_capacity: "Change sales capacity",
  do_nothing: "Do nothing",
};

export type IncentiveSide =
  | "none"
  | "customer"
  | "driver"
  | "courier"
  | "fleet_operator"
  | "charter_operator"
  | "aircraft_operator"
  | "rental_provider"
  | "corporate_customer";

export interface InterventionOption {
  id: string;
  kind: InterventionKind;
  stateId: string;
  description: string;
  /** Direct cost of the intervention in cents. null when not costed. */
  costCents: number | null;
  /** Additional missions expected to be fulfilled. null when not quantified. */
  expectedIncrementalMissions: number | null;
  contributionPerMissionCents: number | null;
  /** -100..100. Negative is harm. */
  customerImpact: number;
  providerImpact: number;
  fulfilmentImpact: number;
  /** 0-100. */
  riskScore: number;
  operationalComplexity: number;
  /** 0-100 confidence that the effect materialises. */
  confidence: number;
  incentiveSide: IncentiveSide;
  policyDomain: string;
  leadTimeMinutes: number | null;
}

export type ScenarioVerdict = "recommended" | "viable" | "rejected" | "unquantified";

export interface ScenarioResult {
  option: InterventionOption;
  expectedRevenueCents: number | null;
  expectedContributionCents: number | null;
  netValueCents: number | null;
  /** Expected Incremental Enterprise Value: net value × confidence − penalties. */
  eiev: number | null;
  harms: string[];
  verdict: ScenarioVerdict;
  rationale: string;
}

const HARM_THRESHOLD = -20;

export function simulateIntervention(option: InterventionOption): ScenarioResult {
  const harms: string[] = [];
  if (option.customerImpact <= HARM_THRESHOLD) harms.push("material customer harm");
  if (option.providerImpact <= HARM_THRESHOLD) harms.push("material provider harm");
  if (option.fulfilmentImpact <= HARM_THRESHOLD) harms.push("material fulfilment harm");

  const quantifiable =
    option.expectedIncrementalMissions !== null && option.contributionPerMissionCents !== null;

  if (!quantifiable) {
    return {
      option,
      expectedRevenueCents: null,
      expectedContributionCents: null,
      netValueCents: null,
      eiev: null,
      harms,
      verdict: "unquantified",
      rationale:
        "Incremental missions or contribution per mission are not observed — the intervention cannot be valued and must not be recommended on assumption.",
    };
  }

  const missions = option.expectedIncrementalMissions ?? 0;
  const contributionPer = option.contributionPerMissionCents ?? 0;
  const expectedContributionCents = Math.round(missions * contributionPer);
  const expectedRevenueCents = expectedContributionCents;
  const netValueCents = Math.round(expectedContributionCents - (option.costCents ?? 0));

  const riskPenalty = (option.riskScore / 100) * Math.abs(netValueCents) * 0.5;
  const complexityPenalty = (option.operationalComplexity / 100) * Math.abs(netValueCents) * 0.2;
  const harmPenalty = harms.length * Math.abs(netValueCents) * 0.25;
  const eiev = Math.round((netValueCents * option.confidence) / 100 - riskPenalty - complexityPenalty - harmPenalty);

  const verdict: ScenarioVerdict =
    harms.length > 0 && eiev <= 0
      ? "rejected"
      : eiev <= 0
        ? "rejected"
        : eiev > 0 && option.confidence >= 60 && harms.length === 0
          ? "recommended"
          : "viable";

  return {
    option,
    expectedRevenueCents,
    expectedContributionCents,
    netValueCents,
    eiev,
    harms,
    verdict,
    rationale: `${missions} incremental mission(s) × KES ${Math.round(contributionPer / 100).toLocaleString()} contribution = KES ${Math.round(
      expectedContributionCents / 100,
    ).toLocaleString()}; cost KES ${Math.round((option.costCents ?? 0) / 100).toLocaleString()}; risk ${option.riskScore}, complexity ${option.operationalComplexity}, confidence ${option.confidence}% ⇒ EIEV KES ${Math.round(
      eiev / 100,
    ).toLocaleString()}${harms.length ? ` (harms: ${harms.join(", ")})` : ""}.`,
  };
}

/** §11.30 — the mandatory "what if we do nothing?" baseline. */
export function doNothingScenario(stateId: string, valueAtRiskCents: number | null): ScenarioResult {
  const option: InterventionOption = {
    id: `${stateId}-do-nothing`,
    kind: "do_nothing",
    stateId,
    description: "Take no action and accept the predicted outcome",
    costCents: 0,
    expectedIncrementalMissions: 0,
    contributionPerMissionCents: 0,
    customerImpact: valueAtRiskCents && valueAtRiskCents > 0 ? -15 : 0,
    providerImpact: 0,
    fulfilmentImpact: valueAtRiskCents && valueAtRiskCents > 0 ? -15 : 0,
    riskScore: valueAtRiskCents && valueAtRiskCents > 0 ? 40 : 5,
    operationalComplexity: 0,
    confidence: 100,
    incentiveSide: "none",
    policyDomain: "operations",
    leadTimeMinutes: 0,
  };
  return {
    option,
    expectedRevenueCents: 0,
    expectedContributionCents: 0,
    netValueCents: 0,
    eiev: 0,
    harms: [],
    verdict: "viable",
    rationale:
      valueAtRiskCents === null
        ? "Doing nothing forgoes an unquantified outcome — the counterfactual is not measurable on this cell."
        : `Doing nothing forgoes KES ${Math.round(valueAtRiskCents / 100).toLocaleString()} of contribution at risk.`,
  };
}

export interface OptimiserResult {
  stateId: string;
  ranked: ScenarioResult[];
  baseline: ScenarioResult;
  best: ScenarioResult | null;
  /** Options that could not be valued at all. */
  unquantified: number;
  narrative: string;
}

/** §11.5 — Next Best Action: rank by EIEV, never by gross bookings. */
export function optimiseInterventions(
  stateId: string,
  options: readonly InterventionOption[],
  valueAtRiskCents: number | null,
): OptimiserResult {
  const baseline = doNothingScenario(stateId, valueAtRiskCents);
  const results = options.map(simulateIntervention);
  const ranked = [...results].sort((a, b) => (b.eiev ?? -Infinity) - (a.eiev ?? -Infinity));
  const best = ranked.find((r) => r.verdict === "recommended") ?? null;

  return {
    stateId,
    ranked,
    baseline,
    best,
    unquantified: results.filter((r) => r.verdict === "unquantified").length,
    narrative: best
      ? `Best feasible intervention: ${INTERVENTION_LABEL[best.option.kind]} at EIEV KES ${Math.round((best.eiev ?? 0) / 100).toLocaleString()}, ahead of doing nothing.`
      : `No intervention clears the value, harm and confidence bar on ${stateId} — the recommendation is to hold and instrument.`,
  };
}

export interface IncentiveBalance {
  side: IncentiveSide;
  options: number;
  totalCostCents: number;
  totalContributionCents: number;
  /** Contribution per shilling of incentive. null when no incentive spend. */
  returnRatio: number | null;
}

/** §11.17 — incentives are optimised on incremental contribution, not GMV. */
export function assessIncentives(results: readonly ScenarioResult[]): IncentiveBalance[] {
  const sides = Array.from(new Set(results.map((r) => r.option.incentiveSide))).filter((s) => s !== "none");
  return sides.map((side) => {
    const rows = results.filter((r) => r.option.incentiveSide === side);
    const cost = rows.reduce((a, r) => a + (r.option.costCents ?? 0), 0);
    const contribution = rows.reduce((a, r) => a + (r.expectedContributionCents ?? 0), 0);
    return {
      side,
      options: rows.length,
      totalCostCents: cost,
      totalContributionCents: contribution,
      returnRatio: cost === 0 ? null : Math.round((contribution / cost) * 100) / 100,
    };
  });
}

/** §11.16 — the flywheel must create contribution, not merely activity. */
export interface FlywheelCheck {
  activityIndex: number | null;
  contributionIndex: number | null;
  verdict: "compounding" | "activity_only" | "unmeasured";
  narrative: string;
}

export function checkFlywheel(input: {
  missions: number | null;
  grossValueCents: number | null;
  contributionCents: number | null;
}): FlywheelCheck {
  if (input.missions === null || input.contributionCents === null) {
    return {
      activityIndex: input.missions,
      contributionIndex: null,
      verdict: "unmeasured",
      narrative: "Contribution per mission is not observed — the flywheel cannot be declared healthy on volume alone.",
    };
  }
  const perMission = input.contributionCents / Math.max(1, input.missions);
  const activityIndex = input.missions;
  const contributionIndex = Math.round(perMission) / 100;
  return {
    activityIndex,
    contributionIndex,
    verdict: perMission > 0 ? "compounding" : "activity_only",
    narrative:
      perMission > 0
        ? `Each mission returns KES ${contributionIndex.toLocaleString()} contribution — growth compounds value, not just volume.`
        : "Missions are being fulfilled at zero or negative contribution — growth here would be vanity GMV.",
  };
}

export function clampImpact(n: number): number {
  return clamp(n, -100, 100);
}
