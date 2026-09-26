/**
 * Pricing 360 — canonical commercial types.
 *
 * These mirror the database control plane (`pricing_rule_sets`,
 * `pricing_components`, `commercial_rate_cards`, `commercial_rate_lines`) so
 * the admin console, simulator and quote surfaces all speak one language.
 *
 * The DATABASE is the authoritative calculator (`pricing360_calculate`).
 * The TypeScript engine in `engine.ts` is a byte-for-byte behavioural mirror
 * used only for instant admin previews and for the golden regression suite.
 */

export type PricingDomain =
  | "ride_hailing"
  | "corporate_charter"
  | "delivery"
  | "logistics"
  | "rentals"
  | "leasing"
  | "all";

export type RuleSetStatus =
  | "draft"
  | "under_review"
  | "approved"
  | "scheduled"
  | "published"
  | "superseded"
  | "archived";

/** The governed lifecycle, in order. Publication is only legal from approved/scheduled. */
export const RULE_SET_LIFECYCLE: RuleSetStatus[] = [
  "draft", "under_review", "approved", "scheduled", "published", "superseded", "archived",
];

export type ComponentKind = "fee" | "tax" | "surcharge" | "discount" | "floor" | "commission";
export type ComponentCalc = "percentage" | "fixed" | "multiplier";
export type ComponentBasis = "base" | "adjusted_base" | "pre_tax_subtotal" | "total";

/** Operating day classification — drives surcharge applicability. */
export type DayType = "standard" | "night" | "sunday" | "holiday";

export interface PricingComponent {
  id: string;
  rule_set_id: string;
  kind: ComponentKind;
  code: string;
  label: string;
  calc: ComponentCalc;
  value: number;
  basis: ComponentBasis;
  scope: { day_type?: DayType[]; service_code?: string[]; category_code?: string[]; scope_label?: string[] };
  priority: number;
  stackable: boolean;
  requires_code: boolean;
  min_amount: number | null;
  max_amount: number | null;
  active: boolean;
  reason: string;
}

export interface PricingRuleSet {
  id: string;
  code: string;
  name: string;
  domain: PricingDomain;
  version: string;
  status: RuleSetStatus;
  currency: string;
  effective_from: string;
  effective_until: string | null;
  note: string;
  approved_at: string | null;
  published_at: string | null;
}

export interface RateLine {
  id: string;
  rate_card_id: string;
  service_code: string;
  scope_label: string;
  category_code: string;
  pricing_basis: string;
  amount: number;
  currency: string;
  included_distance_km: number | null;
  included_distance_period: string | null;
}

export interface RateCard {
  id: string;
  code: string;
  name: string;
  product_domain: PricingDomain;
  version: string;
  status: string;
  currency: string;
  effective_from: string | null;
}

export interface PriceCalculationInput {
  domain?: PricingDomain;
  service_code: string;
  scope_label?: string;
  category_code: string;
  pricing_basis?: string;
  quantity?: number;
  day_type?: DayType;
  promo_code?: string;
  effective_date?: string;
}

/** One identifiable line of the constructed price. */
export interface PriceComponentLine {
  kind: ComponentKind | "base";
  code: string;
  label: string;
  calc: ComponentCalc | "fixed";
  value?: number;
  amount: number;
  reason: string;
  source: string;
}

export type PriceStatus =
  | "OK"
  | "NO_VALID_RATE"
  | "NO_PUBLISHED_RATE_CARD"
  | "PRICING_CONFIGURATION_ERROR"
  | "PRICE_FLOOR_BREACH"
  | "AMBIGUOUS_PRICING_RULE"
  | "INVALID_INPUT";

export interface PriceResult {
  status: PriceStatus;
  error?: string;
  currency?: string;
  base?: number;
  adjusted_base?: number;
  fees_total?: number;
  discounts_total?: number;
  taxes_total?: number;
  total?: number;
  components?: PriceComponentLine[];
  included_distance_km?: number | null;
  included_distance_period?: string | null;
  rate_card_id?: string;
  rate_card_code?: string;
  rate_card_version?: string;
  rule_set_id?: string;
  rule_set_version?: string;
  effective_date?: string;
  calculated_at?: string;
  requested?: Record<string, unknown>;
}

/** Human-readable operational meaning of every non-OK status. */
export const PRICE_STATUS_COPY: Record<PriceStatus, string> = {
  OK: "Priced from the published configuration.",
  NO_VALID_RATE: "Pricing configuration unavailable — manual pricing review required.",
  NO_PUBLISHED_RATE_CARD: "No approved rate card is in force for this business line.",
  PRICING_CONFIGURATION_ERROR: "No published commercial rule set is in force.",
  PRICE_FLOOR_BREACH: "The calculated price falls below the configured price floor.",
  AMBIGUOUS_PRICING_RULE: "More than one rule matched — pricing governance must disambiguate.",
  INVALID_INPUT: "The pricing request is incomplete.",
};
