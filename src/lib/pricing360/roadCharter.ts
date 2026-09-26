/**
 * Road charter → Pricing 360 binding.
 *
 * The marketing charter booking surface used to compute its own price from a
 * client-side cost build-up (vehicle day rate + fuel + crew + site fees) and
 * then add a hard-coded 15% fee. That produced totals that no rate card had ever
 * approved (e.g. KSh 30,383 for a Nairobi van day trip against the published
 * 18,400).
 *
 * This module is the only bridge between the marketing catalogue vocabulary
 * (asset names, free-text destinations) and the governed rate card vocabulary
 * (service_code / scope_label / category_code). Everything it cannot map is
 * reported as unmapped so the surface can route to manual pricing review —
 * it never guesses a price.
 */
import type { DayType, PriceCalculationInput, PriceResult } from "./types";

/** Rate-card vehicle categories reachable from the road catalogue. */
export type RoadCategoryCode =
  | "saloon_comfort" | "comfort_plus_noah" | "van" | "bus"
  | "suv_prado" | "offroad_suv" | "pwd_accessible";

/**
 * Maps a marketing inventory asset name to a published rate-card category.
 * Ordered most-specific first: an "Executive coach 49" must resolve to `bus`,
 * not to whatever a looser token match would find.
 */
const ASSET_RULES: Array<{ test: RegExp; category: RoadCategoryCode }> = [
  { test: /wheelchair|accessib|pwd/i,                  category: "pwd_accessible" },
  { test: /land\s?cruiser|hardtop|safari land/i,        category: "offroad_suv" },
  { test: /prado/i,                                     category: "suv_prado" },
  { test: /double\s?deck|coach|minibus|bus|shuttle/i,   category: "bus" },
  { test: /sprinter|viano|vito|hiace|\bvan\b/i,         category: "van" },
  { test: /noah|serena|voxy/i,                          category: "comfort_plus_noah" },
  { test: /premio|allion|fielder|axio|saloon|sedan/i,   category: "saloon_comfort" },
];

export function roadCategoryForAsset(assetName: string | null | undefined): RoadCategoryCode | null {
  const name = (assetName ?? "").trim();
  if (!name) return null;
  return ASSET_RULES.find((r) => r.test.test(name))?.category ?? null;
}

/**
 * Published day-trip scopes, longest token first so "Within Nairobi" wins over
 * a bare "Nairobi" mention inside a longer itinerary string.
 */
const SCOPE_RULES: Array<{ test: RegExp; scope: string }> = [
  { test: /nanyuki/i,            scope: "Nanyuki" },
  { test: /naivasha/i,           scope: "Naivasha" },
  { test: /nakuru/i,             scope: "Nakuru" },
  { test: /isiolo/i,             scope: "Isiolo" },
  { test: /\bmeru\b/i,           scope: "Meru" },
  { test: /mombasa/i,            scope: "Within Mombasa" },
  { test: /kisumu/i,             scope: "Within Kisumu" },
  { test: /nairobi|jkia|wilson/i, scope: "Within Nairobi" },
];

/**
 * Resolves a free-text itinerary to a published scope, or null when unmapped.
 *
 * The destination is authoritative: a Nairobi → Eldoret run is NOT a "Within
 * Nairobi" booking, so an unrecognised destination is refused outright. The
 * origin is consulted only when no destination was captured.
 */
export function roadScopeForItinerary(origin?: string | null, destination?: string | null): string | null {
  const dest = (destination ?? "").trim();
  const org = (origin ?? "").trim();
  if (dest) return SCOPE_RULES.find((r) => r.test.test(dest))?.scope ?? null;
  return SCOPE_RULES.find((r) => r.test.test(org))?.scope ?? null;
}

/** Airport transfers are priced per trip; everything else per operating day. */
export function roadServiceForItinerary(origin?: string | null, destination?: string | null): {
  service_code: string; pricing_basis: string;
} {
  const text = `${origin ?? ""} ${destination ?? ""}`;
  if (/\bjkia\b|wilson|airport|terminal/i.test(text)) {
    return { service_code: "airport_transfer", pricing_basis: "per_trip" };
  }
  return { service_code: "day_trip", pricing_basis: "per_day" };
}

/** Classifies a departure into the governed operating-day type. */
export function roadDayType(when?: string | null): DayType {
  if (!when) return "standard";
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return "standard";
  if (d.getDay() === 0) return "sunday";
  if (!when.includes("T")) return "standard";
  const h = d.getHours();
  return h >= 20 || h < 6 ? "night" : "standard";
}

export interface RoadRequest {
  assetName: string | null | undefined;
  origin?: string | null;
  destination?: string | null;
  /** Operating days (or trips for an airport transfer). */
  duration: number;
  /** Number of vehicles. */
  quantity: number;
  /** ISO date, optionally with a time component. */
  when?: string | null;
  promoCode?: string | null;
}

export type RoadPricingRequest =
  | { ok: true; input: PriceCalculationInput }
  | { ok: false; reason: string; unmapped: "asset" | "scope" };

/**
 * Builds the governed calculation request. Returns a structured refusal when the
 * booking cannot be expressed in rate-card terms, so the caller can offer manual
 * pricing instead of inventing a figure.
 */
export function buildRoadPricingRequest(req: RoadRequest): RoadPricingRequest {
  const category_code = roadCategoryForAsset(req.assetName);
  if (!category_code) {
    return {
      ok: false, unmapped: "asset",
      reason: `“${req.assetName || "No vehicle"}” is not mapped to a published vehicle category — manual pricing review required.`,
    };
  }
  const scope_label = roadScopeForItinerary(req.origin, req.destination);
  if (!scope_label) {
    return {
      ok: false, unmapped: "scope",
      reason: "This route is not on the published rate card — manual pricing review required.",
    };
  }
  const { service_code, pricing_basis } = roadServiceForItinerary(req.origin, req.destination);
  const units = Math.max(1, Math.round(req.duration || 1)) * Math.max(1, Math.round(req.quantity || 1));
  return {
    ok: true,
    input: {
      domain: "corporate_charter",
      service_code,
      scope_label,
      category_code,
      pricing_basis,
      quantity: units,
      day_type: roadDayType(req.when),
      promo_code: req.promoCode || undefined,
    },
  };
}

/** Presentation shape shared by every road charter surface. */
export interface GovernedRoadFare {
  bookingFee: number;
  surcharge: number;
  surchargeApplies: boolean;
  commission: number;
  servicePct: number;
  taxes: number;
  discounts: number;
  total: number;
  perUnit: number;
  units: number;
  rateCardVersion: string | null;
  ruleSetVersion: string | null;
}

/**
 * Projects an authoritative `PriceResult` onto the three-line road presentation.
 * Returns null unless the server actually produced a price.
 */
export function governedRoadFare(result: PriceResult | null, units = 1): GovernedRoadFare | null {
  if (!result || result.status !== "OK" || typeof result.total !== "number") return null;
  const components = result.components ?? [];
  const sum = (kind: string) =>
    components.filter((c) => c.kind === kind).reduce((t, c) => t + c.amount, 0);
  const surcharge = sum("surcharge");
  const commission = sum("fee");
  const base = result.base ?? 0;
  const pctComponent = components.find((c) => c.kind === "fee" && c.calc === "percentage");
  const safeUnits = Math.max(1, units);
  return {
    bookingFee: base,
    surcharge,
    surchargeApplies: surcharge > 0,
    commission,
    servicePct: pctComponent?.value ?? (base > 0 ? Math.round((commission / base) * 100) : 0),
    taxes: result.taxes_total ?? 0,
    discounts: result.discounts_total ?? 0,
    total: result.total,
    perUnit: Math.round(result.total / safeUnits),
    units: safeUnits,
    rateCardVersion: result.rate_card_version ?? null,
    ruleSetVersion: result.rule_set_version ?? null,
  };
}
