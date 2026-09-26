/**
 * Phase 10 §10.13–10.14 — Marketplace Pricing Intelligence and the Provider
 * Incentive Engine.
 *
 * Two governance rules are absolute:
 *   1. AI may recommend a price inside authorised boundaries; it may never
 *      silently change an economically consequential price. Corporate, charter,
 *      air and logistics always require a named approver.
 *   2. No incentive exceeds the incremental value it unlocks. Indiscriminate
 *      incentives are rejected by the engine, not by an operator's judgement.
 */
import { type Measure, clamp, modelledMeasure, unavailableMeasure } from "../phase8/provenance";
import type { ProductLine } from "./mission";

export interface PricingContext {
  productLine: ProductLine;
  market: string;
  service: string;
  window: string;
  /** Current authorised price in cents. */
  basePriceCents: number | null;
  demand: number | null;
  effectiveSupply: number | null;
  distanceKm: number | null;
  customerSegment: "individual" | "corporate" | "enterprise";
  /** Observed provider cost/entitlement per mission in cents. */
  providerEntitlementCents: number | null;
  /** Observed conversion at the base price, 0-100. */
  historicalConversion: number | null;
  /** Competitor reference price in cents, when registered. */
  competitorPriceCents: number | null;
  slaMinutes: number | null;
}

export interface PricingBoundary {
  /** Maximum permitted movement from the base price, percent. */
  maxDeltaPercent: number;
  /** Absolute price floor as a multiple of provider entitlement. */
  minMarginMultiple: number;
  /** Product lines where any change needs a named approver. */
  approvalAlways: ProductLine[];
  /** Movements above this percent always need an approver. */
  approvalAbovePercent: number;
}

export const DEFAULT_PRICING_BOUNDARY: PricingBoundary = {
  maxDeltaPercent: 20,
  minMarginMultiple: 1.1,
  approvalAlways: ["corporate_mobility", "charter", "yalla_air", "delivery_logistics", "leasing"],
  approvalAbovePercent: 8,
};

export interface PriceRecommendation {
  context: PricingContext;
  recommendedPriceCents: number | null;
  deltaPercent: number | null;
  recommendation: Measure;
  /** True when the recommendation may be applied automatically. */
  autoApplicable: boolean;
  requiresApproval: boolean;
  approverRole: string | null;
  /** Boundary clamps that were actually applied. */
  clamps: string[];
  drivers: string[];
  blockers: string[];
}

const MV = "yalla-p10-pricing-1.0.0";

export function recommendPrice(
  ctx: PricingContext,
  boundary: PricingBoundary = DEFAULT_PRICING_BOUNDARY,
): PriceRecommendation {
  const src = `pricing rules + liquidity telemetry (${ctx.market} · ${ctx.service})`;
  const blockers: string[] = [];
  const clamps: string[] = [];
  const drivers: string[] = [];

  if (ctx.basePriceCents === null) blockers.push("No authorised base price is configured for this service");
  if (ctx.demand === null || ctx.effectiveSupply === null) blockers.push("Demand or effective supply is not observed — a market-sensitive price cannot be justified");

  const alwaysApproves = boundary.approvalAlways.includes(ctx.productLine);

  if (blockers.length > 0 || ctx.basePriceCents === null) {
    return {
      context: ctx,
      recommendedPriceCents: null,
      deltaPercent: null,
      recommendation: unavailableMeasure("Recommended price", "kes", src, blockers[0] ?? "Insufficient evidence"),
      autoApplicable: false,
      requiresApproval: true,
      approverRole: alwaysApproves ? "commercial_director" : "pricing_manager",
      clamps,
      drivers,
      blockers,
    };
  }

  /* Scarcity is the primary signal; competition and conversion temper it. */
  const ratio = ctx.effectiveSupply !== null && ctx.demand ? (ctx.effectiveSupply || 0.01) / ctx.demand : 1;
  let delta = 0;
  if (ratio < 0.8) {
    delta += clamp((0.8 - ratio) * 40, 0, 18);
    drivers.push(`Effective supply covers only ${Math.round(ratio * 100)}% of demand`);
  } else if (ratio > 1.3) {
    delta -= clamp((ratio - 1.3) * 20, 0, 10);
    drivers.push(`Effective supply exceeds demand by ${Math.round((ratio - 1) * 100)}%`);
  }

  if (ctx.competitorPriceCents !== null) {
    const gap = ((ctx.basePriceCents - ctx.competitorPriceCents) / ctx.competitorPriceCents) * 100;
    if (gap > 10) { delta -= clamp(gap / 3, 0, 6); drivers.push(`Base price sits ${Math.round(gap)}% above the registered competitor reference`); }
    if (gap < -10) { delta += clamp(-gap / 4, 0, 5); drivers.push(`Base price sits ${Math.round(-gap)}% below the registered competitor reference`); }
  } else {
    drivers.push("No competitor reference price is registered — the recommendation rests on liquidity alone");
  }

  if (ctx.historicalConversion !== null && ctx.historicalConversion < 40 && delta > 0) {
    delta = delta * 0.5;
    clamps.push(`Upward movement halved: observed conversion is only ${Math.round(ctx.historicalConversion)}%`);
  }

  if (Math.abs(delta) > boundary.maxDeltaPercent) {
    clamps.push(`Movement clamped to the authorised ±${boundary.maxDeltaPercent}% boundary`);
    delta = Math.sign(delta) * boundary.maxDeltaPercent;
  }

  let price = Math.round(ctx.basePriceCents * (1 + delta / 100));

  if (ctx.providerEntitlementCents !== null) {
    const floor = Math.round(ctx.providerEntitlementCents * boundary.minMarginMultiple);
    if (price < floor) {
      clamps.push(`Price raised to the ${boundary.minMarginMultiple}× provider entitlement floor`);
      price = floor;
    }
  } else {
    blockers.push("Provider entitlement is not observed — the margin floor cannot be enforced");
  }

  const finalDelta = ((price - ctx.basePriceCents) / ctx.basePriceCents) * 100;
  const requiresApproval = alwaysApproves || Math.abs(finalDelta) > boundary.approvalAbovePercent || blockers.length > 0;

  return {
    context: ctx,
    recommendedPriceCents: price,
    deltaPercent: Number(finalDelta.toFixed(2)),
    recommendation: modelledMeasure("Recommended price", price / 100, "kes", src,
      "base price × liquidity/competition adjustment, clamped by pricing governance", 55, MV),
    autoApplicable: !requiresApproval,
    requiresApproval,
    approverRole: requiresApproval ? (alwaysApproves ? "commercial_director" : "pricing_manager") : null,
    clamps,
    drivers,
    blockers,
  };
}

/* ------------------------------------------------------------------ */
/* §10.14 Provider Incentive Engine                                    */
/* ------------------------------------------------------------------ */

export interface IncentiveContext {
  market: string;
  service: string;
  window: string;
  /** Providers the intervention would add. */
  providersAdded: number;
  /** Missions one added provider is expected to serve in the window. */
  missionsPerProvider: number | null;
  /** Observed contribution per mission in cents. */
  contributionPerMissionCents: number | null;
  /** Probability the added supply actually converts unserved demand, 0-100. */
  conversionProbability: number | null;
  /** Missions currently unserved in the cell — the ceiling on the uplift. */
  unservedMissions: number | null;
}

export interface IncentiveRecommendation {
  context: IncentiveContext;
  /** §10.33 incremental value: additional economically valuable capacity. */
  incrementalSupplyValue: Measure;
  /** The most SAFARID can rationally pay for that value. */
  maxRationalIncentive: Measure;
  perProviderIncentive: Measure;
  requiresApproval: boolean;
  rationale: string;
  blockers: string[];
}

/** SAFARID never pays away more than a defined share of the value unlocked. */
export const INCENTIVE_VALUE_SHARE = 0.5;

export function recommendIncentive(ctx: IncentiveContext): IncentiveRecommendation {
  const src = `liquidity telemetry + transaction spine (${ctx.market} · ${ctx.service} · ${ctx.window})`;
  const blockers: string[] = [];
  if (ctx.missionsPerProvider === null) blockers.push("Missions per provider are not observed for this cell");
  if (ctx.contributionPerMissionCents === null) blockers.push("Contribution per mission is not observed for this cell");
  if (ctx.conversionProbability === null) blockers.push("Conversion probability is not observed — the uplift would be a guess");

  if (blockers.length > 0) {
    const why = blockers[0];
    return {
      context: ctx,
      incrementalSupplyValue: unavailableMeasure("Incremental supply value", "kes", src, why),
      maxRationalIncentive: unavailableMeasure("Maximum rational incentive", "kes", src, why),
      perProviderIncentive: unavailableMeasure("Incentive per provider", "kes", src, why),
      requiresApproval: true,
      rationale: "SAFARID does not spend incentive budget against unobserved economics.",
      blockers,
    };
  }

  const rawMissions = ctx.providersAdded * (ctx.missionsPerProvider ?? 0) * ((ctx.conversionProbability ?? 0) / 100);
  const missions = ctx.unservedMissions === null ? rawMissions : Math.min(rawMissions, ctx.unservedMissions);
  const valueKes = (missions * (ctx.contributionPerMissionCents ?? 0)) / 100;
  const maxIncentive = valueKes * INCENTIVE_VALUE_SHARE;

  return {
    context: ctx,
    incrementalSupplyValue: modelledMeasure("Incremental supply value", valueKes, "kes", src,
      "providers added × missions per provider × conversion probability × contribution per mission, capped by unserved demand", 50, MV),
    maxRationalIncentive: modelledMeasure("Maximum rational incentive", maxIncentive, "kes", src,
      `${INCENTIVE_VALUE_SHARE * 100}% of the incremental value unlocked`, 50, MV),
    perProviderIncentive: modelledMeasure("Incentive per provider", ctx.providersAdded > 0 ? maxIncentive / ctx.providersAdded : 0, "kes", src,
      "maximum rational incentive ÷ providers added", 50, MV),
    requiresApproval: maxIncentive > 50_000,
    rationale: `Adding ${ctx.providersAdded} providers to ${ctx.market} · ${ctx.window} is expected to convert ${Math.round(missions)} otherwise-unserved missions. Paying more than KES ${Math.round(maxIncentive).toLocaleString()} destroys contribution.`,
    blockers,
  };
}
