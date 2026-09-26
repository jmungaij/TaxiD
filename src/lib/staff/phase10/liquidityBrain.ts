/**
 * Phase 10 §10.12 — the Yalla Liquidity Brain.
 *
 * Phase 9 measured liquidity. Phase 10 operationalises it: classify the market
 * state, then emit ranked interventions with the economic value each unlocks.
 * A liquidity state is never asserted without observed demand and supply.
 */
import { type Measure, clamp, modelledMeasure, unavailableMeasure } from "../phase8/provenance";

export const LIQUIDITY_STATES = [
  "critical_failure",
  "supply_shortage",
  "emerging_shortage",
  "balanced",
  "excess_supply",
  "unmeasured",
] as const;
export type LiquidityState = (typeof LIQUIDITY_STATES)[number];

export const LIQUIDITY_LABEL: Record<LiquidityState, string> = {
  critical_failure: "Critical liquidity failure",
  supply_shortage: "Supply shortage",
  emerging_shortage: "Emerging shortage",
  balanced: "Balanced market",
  excess_supply: "Excess supply",
  unmeasured: "Unmeasured",
};

export interface LiquidityCell {
  id: string;
  market: string;
  zone: string;
  window: string;
  service: string;
}

export interface LiquidityObservation {
  demand: number | null;
  availableSupply: number | null;
  committedSupply: number | null;
  unavailableSupply: number | null;
  expectedCancellationRate: number | null;
  matchRate: number | null;
  fulfilmentRate: number | null;
  timeToMatchMinutes: number | null;
  timeToPickupMinutes: number | null;
  contributionPerMissionCents: number | null;
  asOf: string | null;
}

export type InterventionKind =
  | "recruit_providers"
  | "reposition_providers"
  | "adjust_incentives"
  | "modify_pricing"
  | "change_service_availability"
  | "reroute_demand"
  | "defer_low_priority_demand"
  | "escalate_operations";

export interface LiquidityIntervention {
  kind: InterventionKind;
  action: string;
  /** Expected economic value unlocked; UNAVAILABLE when uncalculable. */
  expectedValue: Measure;
  /** Missions expected to become fulfillable. */
  missionsUnlocked: number | null;
  requiresApproval: boolean;
  rationale: string;
}

export interface LiquidityAssessment {
  cell: LiquidityCell;
  state: LiquidityState;
  effectiveSupply: Measure;
  supplyGap: Measure;
  matchProbability: Measure;
  fulfilmentProbability: Measure;
  valueAtRisk: Measure;
  interventions: LiquidityIntervention[];
  gaps: string[];
}

const MV = "yalla-p10-liquidity-1.0.0";

export function assessLiquidity(cell: LiquidityCell, o: LiquidityObservation): LiquidityAssessment {
  const src = "dispatch_assignments + trip_bookings + driver availability";
  const gaps: string[] = [];
  const na = (label: string, unit: Measure["unit"], why: string) => {
    gaps.push(why);
    return unavailableMeasure(label, unit, src, why);
  };

  if (o.demand === null || o.availableSupply === null) {
    return {
      cell,
      state: "unmeasured",
      effectiveSupply: na("Effective supply", "count", "Available supply is not instrumented for this cell"),
      supplyGap: na("Supply gap", "count", "Demand or supply is not instrumented for this cell"),
      matchProbability: na("Match probability", "percent", "Requires observed demand and supply"),
      fulfilmentProbability: na("Fulfilment probability", "percent", "Requires observed demand and supply"),
      valueAtRisk: na("Value at risk", "kes", "Requires observed demand, supply and contribution per mission"),
      interventions: [{
        kind: "escalate_operations",
        action: `Instrument demand and supply telemetry for ${cell.zone} · ${cell.window}`,
        expectedValue: unavailableMeasure("Expected value", "kes", src, "The cell is unmeasured, so no value can be claimed"),
        missionsUnlocked: null,
        requiresApproval: false,
        rationale: "Yalla will not intervene in a market it cannot measure — telemetry precedes incentives.",
      }],
      gaps,
    };
  }

  const cancellation = o.expectedCancellationRate ?? 0;
  const effective = o.availableSupply * (1 - clamp(cancellation, 0, 100) / 100);
  const gap = o.demand - effective;
  const ratio = o.demand === 0 ? 1 : effective / o.demand;

  const state: LiquidityState = ratio >= 1.35
    ? "excess_supply"
    : ratio >= 0.95
      ? "balanced"
      : ratio >= 0.8
        ? "emerging_shortage"
        : ratio >= 0.5
          ? "supply_shortage"
          : "critical_failure";

  const matchProbability = o.matchRate !== null
    ? modelledMeasure("Match probability", clamp(o.matchRate, 0, 100), "percent", src, "observed historical match rate for this cell", 65, MV)
    : modelledMeasure("Match probability", clamp(ratio * 100, 0, 100), "percent", src, "effective supply ÷ demand (no historical match rate observed)", 35, MV);

  const fulfilmentProbability = o.fulfilmentRate !== null
    ? modelledMeasure("Fulfilment probability", clamp(o.fulfilmentRate, 0, 100), "percent", src, "observed fulfilment rate for this cell", 65, MV)
    : na("Fulfilment probability", "percent", "Fulfilment rate is not observed for this cell");

  const unservedMissions = Math.max(0, gap);
  const valueAtRisk = o.contributionPerMissionCents === null
    ? na("Value at risk", "kes", "Contribution per mission is not observed, so unserved demand cannot be priced")
    : modelledMeasure("Value at risk", (unservedMissions * o.contributionPerMissionCents) / 100, "kes", src,
        "unserved missions × observed contribution per mission", 55, MV);

  const interventions = recommendInterventions(cell, state, {
    unservedMissions,
    contributionPerMissionCents: o.contributionPerMissionCents,
    committedSupply: o.committedSupply,
    timeToMatchMinutes: o.timeToMatchMinutes,
    ratio,
    src,
  });

  return {
    cell,
    state,
    effectiveSupply: modelledMeasure("Effective supply", effective, "count", src,
      "available supply × (1 − expected cancellation rate)", o.expectedCancellationRate === null ? 45 : 70, MV),
    supplyGap: modelledMeasure("Supply gap", gap, "count", src, "demand − effective supply", 60, MV),
    matchProbability,
    fulfilmentProbability,
    valueAtRisk,
    interventions,
    gaps,
  };
}

interface InterventionContext {
  unservedMissions: number;
  contributionPerMissionCents: number | null;
  committedSupply: number | null;
  timeToMatchMinutes: number | null;
  ratio: number;
  src: string;
}

function recommendInterventions(cell: LiquidityCell, state: LiquidityState, ctx: InterventionContext): LiquidityIntervention[] {
  const value = (label: string, missions: number, confidence: number, calc: string): Measure =>
    ctx.contributionPerMissionCents === null
      ? unavailableMeasure(label, "kes", ctx.src, "Contribution per mission is not observed — the intervention cannot be priced")
      : modelledMeasure(label, (missions * ctx.contributionPerMissionCents) / 100, "kes", ctx.src, calc, confidence, MV);

  const out: LiquidityIntervention[] = [];
  const where = `${cell.zone} · ${cell.window} · ${cell.service}`;

  if (state === "critical_failure" || state === "supply_shortage") {
    out.push({
      kind: "recruit_providers",
      action: `Recruit supply for ${where} — approximately ${Math.ceil(ctx.unservedMissions / 3)} providers`,
      expectedValue: value("Contribution unlocked by recruitment", ctx.unservedMissions, 45, "unserved missions × contribution per mission"),
      missionsUnlocked: Math.round(ctx.unservedMissions),
      requiresApproval: true,
      rationale: "The shortage is structural: matching cannot create capacity that does not exist.",
    });
    out.push({
      kind: "reposition_providers",
      action: `Reposition idle providers into ${where}`,
      expectedValue: value("Contribution unlocked by repositioning", ctx.unservedMissions * 0.4, 40, "40% of unserved missions × contribution per mission"),
      missionsUnlocked: Math.round(ctx.unservedMissions * 0.4),
      requiresApproval: false,
      rationale: "Repositioning is the fastest lever and consumes no acquisition budget.",
    });
    out.push({
      kind: "adjust_incentives",
      action: `Offer a bounded availability incentive in ${where}`,
      expectedValue: value("Contribution unlocked by incentives", ctx.unservedMissions * 0.5, 35, "50% of unserved missions × contribution per mission"),
      missionsUnlocked: Math.round(ctx.unservedMissions * 0.5),
      requiresApproval: true,
      rationale: "Incentives must stay inside the economically rational ceiling from the incentive engine.",
    });
  }

  if (state === "critical_failure") {
    out.push({
      kind: "escalate_operations",
      action: `Escalate ${where} to the duty operations lead`,
      expectedValue: value("Contribution protected by escalation", ctx.unservedMissions * 0.25, 30, "25% of unserved missions × contribution per mission"),
      missionsUnlocked: Math.round(ctx.unservedMissions * 0.25),
      requiresApproval: false,
      rationale: "Fulfilment is failing at scale; a human owner must hold the cell until liquidity returns.",
    });
    out.push({
      kind: "defer_low_priority_demand",
      action: `Defer discretionary demand in ${where} to protect SLA-bound missions`,
      expectedValue: value("Contribution protected by triage", ctx.unservedMissions * 0.2, 30, "20% of unserved missions × contribution per mission"),
      missionsUnlocked: null,
      requiresApproval: true,
      rationale: "When capacity cannot meet demand, Yalla protects contracted SLAs before discretionary trips.",
    });
  }

  if (state === "emerging_shortage") {
    out.push({
      kind: "modify_pricing",
      action: `Propose a bounded price adjustment in ${where}`,
      expectedValue: value("Contribution protected by pricing", ctx.unservedMissions * 0.3, 35, "30% of unserved missions × contribution per mission"),
      missionsUnlocked: Math.round(ctx.unservedMissions * 0.3),
      requiresApproval: true,
      rationale: "Pricing is economically consequential and never moves without an authorised approver.",
    });
  }

  if (state === "excess_supply") {
    out.push({
      kind: "reroute_demand",
      action: `Route adjacent demand into ${where} to absorb idle capacity`,
      expectedValue: value("Contribution from absorbing idle supply", Math.max(0, (ctx.committedSupply ?? 0) * 0.1), 35, "10% of committed supply × contribution per mission"),
      missionsUnlocked: null,
      requiresApproval: false,
      rationale: "Idle providers churn; routing demand protects the supply base without spending incentive budget.",
    });
    out.push({
      kind: "change_service_availability",
      action: `Open additional service categories in ${where}`,
      expectedValue: unavailableMeasure("Expected value", "kes", ctx.src, "Category-level conversion is not yet observed for this cell"),
      missionsUnlocked: null,
      requiresApproval: true,
      rationale: "Excess capacity is an opportunity to widen the catalogue rather than discount the core product.",
    });
  }

  return out.sort((a, b) => (b.expectedValue.value ?? -1) - (a.expectedValue.value ?? -1));
}

/** Portfolio view: the cells operations should act on first. */
export function liquidityPriorities(assessments: readonly LiquidityAssessment[]): LiquidityAssessment[] {
  const rank: Record<LiquidityState, number> = {
    critical_failure: 0, supply_shortage: 1, emerging_shortage: 2, excess_supply: 3, balanced: 4, unmeasured: 5,
  };
  return [...assessments].sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    return (b.valueAtRisk.value ?? -1) - (a.valueAtRisk.value ?? -1);
  });
}
