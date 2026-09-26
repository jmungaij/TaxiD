/**
 * Competitive Pricing Engine — client contract.
 *
 * ONE principle governs this module:
 *
 *     RECOMMENDED PRICE  ≠  SELLING PRICE
 *
 * The rate card is a *recommended* price book. A salesperson may propose a
 * price below or above it; the engine never refuses a commercial price. It
 * computes the variance, resolves the configured guardrail (none / notify /
 * approve) and shows the margin where cost data exists. Governance lives in
 * `pricing_guardrails` rows — never in this code.
 *
 * The database (`pricing_resolve`, `pricing_negotiation_record`,
 * `commercial_create_quotation`) remains the authority for every stored price.
 * The pure helpers below exist for instant UI feedback and are unit-tested
 * against the same arithmetic the server uses.
 */
import { supabase } from "@/integrations/supabase/client";

// Pricing tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type PriceSource =
  | "RECOMMENDED"
  | "CONTRACT"
  | "CUSTOMER"
  | "VOLUME"
  | "PROMOTIONAL"
  | "PROJECT"
  | "SEASONAL"
  | "COMPETITIVE"
  | "SPOT"
  | "NEGOTIATED";

export const PRICE_SOURCE_LABELS: Record<string, string> = {
  RECOMMENDED: "Recommended rate",
  CONTRACT: "Contract rate",
  CUSTOMER: "Customer rate",
  VOLUME: "Volume rate",
  PROMOTIONAL: "Promotional rate",
  PROJECT: "Project rate",
  SEASONAL: "Seasonal rate",
  COMPETITIVE: "Competitive rate",
  SPOT: "Spot rate",
  NEGOTIATED: "Negotiated price",
};

export const PRICING_BASIS_OPTIONS = [
  { value: "per_day", label: "Per day" },
  { value: "per_trip", label: "Per trip" },
  { value: "per_month", label: "Per month" },
  { value: "per_hour", label: "Per hour" },
  { value: "per_km", label: "Per kilometre" },
  { value: "per_route", label: "Per route" },
  { value: "hybrid", label: "Hybrid" },
] as const;

export interface Guardrail {
  code: string | null;
  label: string;
  action: "none" | "notify" | "approve";
  required_role: string | null;
}

export interface PriceExplanationLine {
  label: string;
  amount: number;
  detail: string;
}

export interface PriceResolution {
  status: "OK" | "NO_PUBLISHED_RATE_CARD" | "NO_VALID_RATE";
  currency?: string;
  recommended_price?: number;
  customer_rate_price?: number | null;
  applied_price?: number;
  quantity?: number;
  line_total?: number;
  variance_amount?: number;
  variance_percent?: number;
  pricing_source?: PriceSource;
  rate_card_id?: string;
  rate_card_code?: string;
  rate_card_version?: string;
  rate_line_id?: string;
  pricing_basis?: string;
  included_distance_km?: number | null;
  distance_unit?: string | null;
  excess_distance_rate?: number | null;
  included_hours?: number | null;
  excess_hour_rate?: number | null;
  waiting_rate_per_hour?: number | null;
  guardrail?: Guardrail;
  approval_required?: boolean;
  estimated_cost?: number | null;
  margin_amount?: number | null;
  margin_percent?: number | null;
  market_reference?: number | null;
  explanation?: PriceExplanationLine[];
  negotiation_id?: string;
  approval_status?: "not_required" | "pending";
}

export interface GuardrailRule {
  id: string;
  code: string;
  label: string;
  direction: "discount" | "premium";
  variance_from: number;
  variance_to: number | null;
  action: "none" | "notify" | "approve";
  required_role: string | null;
  active: boolean;
  notes: string | null;
}

/* ------------------------------------------------------------------ *
 * Pure helpers — unit tested, no network, no clocks
 * ------------------------------------------------------------------ */

/** Variance of a proposed price against the recommendation. Never throws. */
export function variance(recommended: number, proposed: number) {
  const amount = Math.round((proposed - recommended) * 100) / 100;
  const percent =
    recommended > 0 ? Math.round(((proposed - recommended) / recommended) * 10000) / 100 : 0;
  return { amount, percent };
}

/**
 * Resolves the configured guardrail for a variance. Mirrors
 * `public.pricing_guardrail_for`: widest matching band, direction-aware,
 * inclusive lower bound, exclusive upper bound.
 */
export function guardrailFor(rules: GuardrailRule[], variancePercent: number): Guardrail {
  const direction = variancePercent < 0 ? "discount" : "premium";
  const magnitude = Math.abs(variancePercent);
  const match = rules
    .filter(
      (r) =>
        r.active &&
        r.direction === direction &&
        magnitude >= r.variance_from &&
        (r.variance_to === null || magnitude < r.variance_to),
    )
    .sort((a, b) => b.variance_from - a.variance_from)[0];
  if (!match) {
    return { code: null, label: "No guardrail configured", action: "none", required_role: null };
  }
  return {
    code: match.code,
    label: match.label,
    action: match.action,
    required_role: match.required_role,
  };
}

/** Commercial signal — never an error state for a legitimate negotiation. */
export type PriceSignal =
  | "RECOMMENDED"
  | "NEAR_RECOMMENDED"
  | "BELOW_RECOMMENDED"
  | "ABOVE_RECOMMENDED"
  | "HIGH_PREMIUM"
  | "APPROVAL_REQUIRED";

export function priceSignal(variancePercent: number, guardrail: Guardrail): PriceSignal {
  if (guardrail.action === "approve") return "APPROVAL_REQUIRED";
  if (variancePercent === 0) return "RECOMMENDED";
  if (Math.abs(variancePercent) <= 2) return "NEAR_RECOMMENDED";
  if (variancePercent >= 25) return "HIGH_PREMIUM";
  return variancePercent < 0 ? "BELOW_RECOMMENDED" : "ABOVE_RECOMMENDED";
}

export const SIGNAL_LABELS: Record<PriceSignal, string> = {
  RECOMMENDED: "At recommended rate",
  NEAR_RECOMMENDED: "Near recommended",
  BELOW_RECOMMENDED: "Below recommended",
  ABOVE_RECOMMENDED: "Above recommended",
  HIGH_PREMIUM: "High premium",
  APPROVAL_REQUIRED: "Approval required",
};

/** Margin on a proposed price where a cost baseline exists. */
export function margin(proposed: number, estimatedCost: number | null | undefined) {
  if (estimatedCost === null || estimatedCost === undefined) {
    return { amount: null as number | null, percent: null as number | null };
  }
  const amount = Math.round((proposed - estimatedCost) * 100) / 100;
  const percent = proposed > 0 ? Math.round(((proposed - estimatedCost) / proposed) * 10000) / 100 : 0;
  return { amount, percent };
}

/** Human sentence describing the commercial terms attached to a rate item. */
export function describeTerms(item: {
  pricing_basis: string;
  included_distance_km?: number | null;
  distance_unit?: string | null;
  excess_distance_rate?: number | null;
  included_hours?: number | null;
  excess_hour_rate?: number | null;
  currency?: string;
}): string {
  const basis =
    PRICING_BASIS_OPTIONS.find((b) => b.value === item.pricing_basis)?.label ?? item.pricing_basis;
  const parts: string[] = [basis];
  const unit = item.distance_unit || "km";
  parts.push(
    item.included_distance_km
      ? `${item.included_distance_km} ${unit} included`
      : "no distance cap",
  );
  if (item.excess_distance_rate) {
    parts.push(`excess ${item.currency ?? "KES"} ${item.excess_distance_rate}/${unit}`);
  }
  if (item.included_hours) parts.push(`${item.included_hours} h included`);
  if (item.excess_hour_rate) parts.push(`overtime ${item.currency ?? "KES"} ${item.excess_hour_rate}/h`);
  return parts.join(" · ");
}

/** Renders the server explanation as readable lines. No magic prices. */
export function explainLines(res: PriceResolution, currency = "KES"): string[] {
  if (res.status !== "OK") return [res.status.replace(/_/g, " ").toLowerCase()];
  const out = (res.explanation ?? []).map(
    (l) =>
      `${l.label}: ${l.amount < 0 ? "−" : ""}${currency} ${Math.abs(Number(l.amount)).toLocaleString(
        "en-KE",
      )} — ${l.detail}`,
  );
  out.push(`Final price: ${currency} ${Number(res.applied_price ?? 0).toLocaleString("en-KE")}`);
  return out;
}

/* ------------------------------------------------------------------ *
 * Data access — the server is the authority
 * ------------------------------------------------------------------ */

export interface ResolveInput {
  service_code: string;
  scope_label?: string;
  category_code: string;
  pricing_basis?: string;
  quantity?: number;
  account_id?: string | null;
  proposed_amount?: number | null;
  commercial_reason?: string | null;
  rate_card_code?: string;
}

export async function resolvePrice(input: ResolveInput): Promise<PriceResolution> {
  const { data, error } = await db.rpc("pricing_resolve", { p_input: input });
  if (error) throw error;
  return data as PriceResolution;
}

export async function recordNegotiation(
  input: ResolveInput & { opportunity_id?: string | null; quotation_id?: string | null },
): Promise<PriceResolution> {
  const { data, error } = await db.rpc("pricing_negotiation_record", { p_payload: input });
  if (error) throw error;
  return data as PriceResolution;
}

export async function decideNegotiation(id: string, status: "approved" | "rejected", note: string) {
  const { error } = await db.rpc("pricing_negotiation_decide", {
    p_negotiation_id: id,
    p_status: status,
    p_note: note,
  });
  if (error) throw error;
}

export async function fetchGuardrails(): Promise<GuardrailRule[]> {
  const { data, error } = await db
    .from("pricing_guardrails")
    .select("*")
    .order("direction")
    .order("variance_from");
  if (error) throw error;
  return (data ?? []).map((r: GuardrailRule) => ({
    ...r,
    variance_from: Number(r.variance_from),
    variance_to: r.variance_to === null ? null : Number(r.variance_to),
  }));
}

export async function fetchNegotiations(limit = 50) {
  const { data, error } = await db
    .from("pricing_negotiations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchCustomerRates(accountId?: string) {
  let q = db.from("pricing_customer_rates").select("*").order("created_at", { ascending: false });
  if (accountId) q = q.eq("account_id", accountId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function saveCustomerRate(row: Record<string, unknown>) {
  const { error } = await db.from("pricing_customer_rates").insert(row);
  if (error) throw error;
}

export async function recordCompetitorObservation(row: Record<string, unknown>) {
  const { error } = await db.from("pricing_competitor_observations").insert(row);
  if (error) throw error;
}

/* Rate card authoring (pricing administration) */

export async function openRateCardDraft(code: string, reason: string) {
  const { data, error } = await db.rpc("pricing_rate_card_open_draft", {
    p_code: code,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { rate_card_id: string; version: string; reused: boolean };
}

export async function saveRateItem(payload: Record<string, unknown>) {
  const { data, error } = await db.rpc("pricing_rate_item_save", { p_payload: payload });
  if (error) throw error;
  return data as { rate_line_id: string };
}

export async function deleteRateItem(rateLineId: string, reason: string) {
  const { error } = await db.rpc("pricing_rate_item_delete", {
    p_rate_line_id: rateLineId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function bulkAdjust(input: {
  rateCardId: string;
  filters: Record<string, string>;
  percent?: number | null;
  includedKm?: number | null;
  apply: boolean;
  reason?: string;
}) {
  const { data, error } = await db.rpc("pricing_rate_card_bulk_adjust", {
    p_rate_card_id: input.rateCardId,
    p_filters: input.filters,
    p_percent: input.percent ?? null,
    p_included_distance_km: input.includedKm ?? null,
    p_apply: input.apply,
    p_reason: input.reason ?? "",
  });
  if (error) throw error;
  return data as {
    affected: number;
    applied: boolean;
    rows: {
      rate_line_id: string;
      service_code: string;
      scope_label: string;
      category_code: string;
      current_amount: number;
      proposed_amount: number;
      current_included_km: number | null;
      proposed_included_km: number | null;
    }[];
  };
}

export async function publishRateCard(rateCardId: string, effectiveFrom: string | null, reason: string) {
  const { data, error } = await db.rpc("pricing_rate_card_publish", {
    p_rate_card_id: rateCardId,
    p_effective_from: effectiveFrom,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { rate_card_id: string; status: string; lines: number };
}

export async function fetchRateCardVersions(code: string) {
  const { data, error } = await db
    .from("commercial_rate_cards")
    .select("*")
    .eq("code", code)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchServiceTypes() {
  const { data, error } = await db
    .from("pricing_service_types")
    .select("code,label,sort_order,active")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as { code: string; label: string; sort_order: number; active: boolean }[];
}

export async function fetchPricingIntelligence(from: string, to: string) {
  const { data, error } = await db.rpc("pricing_intelligence_summary", { p_from: from, p_to: to });
  if (error) throw error;
  return data as PricingIntelligence;
}

export interface IntelligenceLane {
  service_code: string;
  scope_label: string;
  category_code: string;
  lines: number;
  recommended_total: number | null;
  sold_total: number | null;
  avg_variance_percent: number | null;
  discounted_lines: number | null;
  premium_lines: number | null;
  margin_total: number | null;
}

export interface IntelligenceOwner {
  owner_staff_id: string | null;
  owner_name: string | null;
  quotations: number;
  sold_total: number | null;
  avg_variance_percent: number | null;
}

export interface PricingIntelligence {
  negotiations?: number;
  approval_required?: number;
  pending_approval?: number;
  by_lane?: IntelligenceLane[];
  by_owner?: IntelligenceOwner[];
  cost_visible?: boolean;
  [k: string]: unknown;
}

/* Cost baselines — margin and market comparison depend on these real figures */

export interface CostBaseline {
  id: string;
  service_code: string;
  scope_label: string;
  category_code: string;
  pricing_basis: string;
  driver_cost: number | null;
  fuel_cost: number | null;
  tolls_parking: number | null;
  supplier_cost: number | null;
  operational_cost: number | null;
  platform_cost: number | null;
  currency: string;
  effective_from: string | null;
  effective_to: string | null;
  source: string | null;
}

export function costTotal(row: Partial<CostBaseline>): number {
  return (
    Number(row.driver_cost ?? 0) +
    Number(row.fuel_cost ?? 0) +
    Number(row.tolls_parking ?? 0) +
    Number(row.supplier_cost ?? 0) +
    Number(row.operational_cost ?? 0) +
    Number(row.platform_cost ?? 0)
  );
}

export async function fetchCostBaselines(): Promise<CostBaseline[]> {
  const { data, error } = await db
    .from("pricing_cost_baselines")
    .select("*")
    .order("service_code")
    .order("scope_label")
    .order("category_code");
  if (error) throw error;
  return (data ?? []) as CostBaseline[];
}

export async function saveCostBaseline(row: Partial<CostBaseline> & { id?: string }) {
  const payload = { ...row, updated_at: new Date().toISOString() };
  const { error } = row.id
    ? await db.from("pricing_cost_baselines").update(payload).eq("id", row.id)
    : await db.from("pricing_cost_baselines").insert(payload);
  if (error) throw error;
}

export async function deleteCostBaseline(id: string) {
  const { error } = await db.from("pricing_cost_baselines").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchCompetitorObservations(limit = 100) {
  const { data, error } = await db
    .from("pricing_competitor_observations")
    .select("*")
    .order("observed_on", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/* Quotation acceptance — the quoted price becomes the transaction price */

export interface QuotationRow {
  id: string;
  quote_number: string;
  account_id: string;
  currency: string;
  total_amount: number;
  status: string;
  approval_status: string;
  rate_card_version: string | null;
  valid_until: string | null;
  created_at: string;
}

export async function fetchQuotations(limit = 40): Promise<QuotationRow[]> {
  const { data, error } = await db
    .from("commercial_quotations")
    .select(
      "id,quote_number,account_id,currency,total_amount,status,approval_status,rate_card_version,valid_until,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as QuotationRow[];
}

export interface QuotationAcceptResult {
  quotation_id: string;
  quote_number: string;
  invoice_id: string;
  invoice_created: boolean;
  bookings_created: number;
  commission_event_id: string | null;
  commission_note: string | null;
  transaction_value: number;
}

export async function acceptQuotation(input: {
  quotationId: string;
  serviceFrom: string;
  customerReference?: string | null;
  createBookings?: boolean;
}): Promise<QuotationAcceptResult> {
  const { data, error } = await db.rpc("commercial_quotation_accept", {
    p: {
      quotation_id: input.quotationId,
      service_from: input.serviceFrom,
      customer_reference: input.customerReference ?? null,
      create_bookings: input.createBookings ?? true,
    },
  });
  if (error) throw error;
  return data as QuotationAcceptResult;
}
