/**
 * Corporate Charter commercial engine — rate cards, contracts, quotations.
 *
 * Truth rules mirrored from the database:
 *   • Prices are only ever read from published `commercial_rate_lines`.
 *     The UI never computes or invents a price; `commercial_create_quotation`
 *     recomputes every line server-side from the pinned rate card version.
 *   • A combination with no published rate is NOT priced — it becomes a
 *     pricing request (`commercial_request_pricing`) for commercial approval.
 *   • A quotation always records the rate card version it was built from.
 */
import { supabase } from "@/integrations/supabase/client";

// Commercial pricing tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const CHARTER_RATE_CARD_CODE = "corporate_charter_rate_card";

export const SERVICE_CODES = [
  "day_trip",
  "executive",
  "pwd",
  "offroad",
  "airport_transfer",
  "monthly_long_term",
] as const;
export type ServiceCode = (typeof SERVICE_CODES)[number];

export const SERVICE_LABELS: Record<string, string> = {
  day_trip: "Day trip charges",
  executive: "Executive categories",
  pwd: "PWD category",
  offroad: "Offroad categories",
  airport_transfer: "Airport transfers",
  monthly_long_term: "Monthly / long-term",
};

export const PRICING_BASIS_LABELS: Record<string, string> = {
  per_day: "per day",
  per_trip: "per trip",
  per_month: "per month",
};

export type RateCardStatus =
  | "draft"
  | "source"
  | "pending_approval"
  | "scheduled"
  | "approved"
  | "retired";

export interface RateCard {
  id: string;
  code: string;
  name: string;
  product_domain: string;
  version: string;
  status: RateCardStatus;
  currency: string;
  effective_from: string | null;
  source_note: string | null;
  source_reference: string | null;
  change_reason: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface VehicleCategory {
  code: string;
  label: string;
  example_models: string[];
  accessibility: boolean;
  notes: string | null;
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
  drive_mode: string | null;
  min_days: number | null;
  inclusion_note: string | null;
  conditions: string | null;
  /** Configurable commercial terms — never assumed by the client. */
  distance_unit?: string | null;
  excess_distance_rate?: number | null;
  included_hours?: number | null;
  excess_hour_rate?: number | null;
  waiting_rate_per_hour?: number | null;
}

export interface QuoteLineRequest {
  service_code: string;
  scope_label: string;
  category_code: string;
  pricing_basis?: string;
  quantity: number;
  /** Negotiated selling price. Null / omitted = quote at the recommended rate. */
  proposed_amount?: number | null;
  commercial_reason?: string | null;
}

export interface QuotationResult {
  quotation_id: string;
  quote_number: string;
  total_amount: number;
  currency: string;
  rate_card_version: string;
  rate_card_status: string;
  unpriced: QuoteLineRequest[];
}

export interface AccountCommercialPack {
  contracts: {
    id: string;
    template: string;
    template_version: string;
    status: string;
    effective_date: string | null;
    contract_term: string | null;
    selected_services: string[];
    customer_legal_name: string;
    document_id: string | null;
    rate_card_version: string | null;
    rate_card_status: string | null;
    schedules: {
      id: string;
      title: string;
      services: string[];
      locations: string[];
      vehicle_categories: string[];
      commercial_terms: string | null;
      validity: string | null;
      special_conditions: string | null;
      approval_status: string;
    }[];
  }[];
  quotations: {
    id: string;
    quote_number: string;
    total_amount: number;
    currency: string;
    status: string;
    approval_status: string;
    rate_card_version: string;
    valid_until: string | null;
    created_at: string;
  }[];
  pricing_requests: {
    id: string;
    service_code: string;
    scope_label: string | null;
    category_code: string | null;
    requirement: string;
    status: string;
    decision_note: string | null;
  }[];
}

/* ------------------------------------------------------------------ *
 * Pure helpers (unit tested — no network)
 * ------------------------------------------------------------------ */

export function formatMoney(amount: number, currency = "KES"): string {
  return `${currency} ${Math.round(amount).toLocaleString("en-KE")}`;
}

/** Unique, ordered scope labels for a service (Nairobi, Mombasa, …). */
export function scopesFor(lines: RateLine[], service: string): string[] {
  const seen: string[] = [];
  for (const l of lines) {
    if (l.service_code !== service) continue;
    if (!seen.includes(l.scope_label)) seen.push(l.scope_label);
  }
  return seen;
}

/** Categories that actually have a published rate for a service + scope. */
export function categoriesFor(lines: RateLine[], service: string, scope: string): string[] {
  const seen: string[] = [];
  for (const l of lines) {
    if (l.service_code !== service || l.scope_label !== scope) continue;
    if (!seen.includes(l.category_code)) seen.push(l.category_code);
  }
  return seen;
}

/** Exact published rate, or null when the combination is not covered. */
export function findRate(
  lines: RateLine[],
  service: string,
  scope: string,
  category: string,
  basis?: string,
): RateLine | null {
  const matches = lines.filter(
    (l) =>
      l.service_code === service &&
      l.scope_label === scope &&
      l.category_code === category &&
      (!basis || l.pricing_basis === basis),
  );
  return matches[0] ?? null;
}

/** Client-side preview only — the server recomputes the authoritative total. */
export function previewTotal(
  lines: RateLine[],
  requests: QuoteLineRequest[],
): { total: number; priced: QuoteLineRequest[]; unpriced: QuoteLineRequest[] } {
  let total = 0;
  const priced: QuoteLineRequest[] = [];
  const unpriced: QuoteLineRequest[] = [];
  for (const r of requests) {
    const rate = findRate(lines, r.service_code, r.scope_label, r.category_code, r.pricing_basis);
    if (!rate) {
      unpriced.push(r);
      continue;
    }
    total += rate.amount * Math.max(1, r.quantity);
    priced.push(r);
  }
  return { total: Math.round(total * 100) / 100, priced, unpriced };
}

/** A quote may only be sent when its pricing source is commercially approved. */
export function quoteReadiness(card: Pick<RateCard, "status">, unpricedCount: number) {
  const blockers: string[] = [];
  if (card.status !== "approved") blockers.push("Rate card version is not commercially approved");
  if (unpricedCount > 0) blockers.push(`${unpricedCount} requested item(s) have no published rate`);
  return { canSend: blockers.length === 0, blockers };
}

/** Fill contract variables; missing required values are reported, never guessed. */
export function resolveContractVariables(
  variables: { key: string; required?: boolean }[],
  values: Record<string, string | null | undefined>,
) {
  const missing = variables
    .filter((v) => v.required && !String(values[v.key] ?? "").trim())
    .map((v) => v.key);
  const resolved: Record<string, string> = {};
  for (const v of variables) {
    const val = String(values[v.key] ?? "").trim();
    if (val) resolved[v.key] = val;
  }
  return { resolved, missing, complete: missing.length === 0 };
}

/* ------------------------------------------------------------------ *
 * Data access
 * ------------------------------------------------------------------ */

export async function fetchActiveRateCard(code = CHARTER_RATE_CARD_CODE): Promise<RateCard | null> {
  const { data, error } = await db
    .from("commercial_rate_cards")
    .select("*")
    .eq("code", code)
    .is("retired_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as RateCard) ?? null;
}

export async function fetchRateLines(rateCardId: string): Promise<RateLine[]> {
  const { data, error } = await db
    .from("commercial_rate_lines")
    .select("*")
    .eq("rate_card_id", rateCardId)
    .order("service_code")
    .order("scope_label")
    .order("amount");
  if (error) throw error;
  return (data ?? []).map((l: RateLine) => ({ ...l, amount: Number(l.amount) }));
}

export async function fetchVehicleCategories(): Promise<VehicleCategory[]> {
  const { data, error } = await db
    .from("commercial_vehicle_categories")
    .select("code,label,example_models,accessibility,notes")
    .order("label");
  if (error) throw error;
  return (data ?? []) as VehicleCategory[];
}

export async function fetchContractTemplates() {
  const { data, error } = await db
    .from("commercial_contract_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchAccountPack(accountId: string): Promise<AccountCommercialPack> {
  const { data, error } = await db.rpc("commercial_account_pack", { p_account_id: accountId });
  if (error) throw error;
  return (data as AccountCommercialPack) ?? { contracts: [], quotations: [], pricing_requests: [] };
}

export async function fetchQuotationLines(quotationId: string) {
  const { data, error } = await db
    .from("commercial_quotation_lines")
    .select("*")
    .eq("quotation_id", quotationId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((l: { unit_amount: number; line_total: number }) => ({
    ...l,
    unit_amount: Number(l.unit_amount),
    line_total: Number(l.line_total),
  }));
}

export async function createQuotation(input: {
  accountId: string;
  lines: QuoteLineRequest[];
  opportunityId?: string | null;
  contractInstanceId?: string | null;
  validUntil?: string | null;
  notes?: string | null;
}): Promise<QuotationResult> {
  const { data, error } = await db.rpc("commercial_create_quotation", {
    p_account_id: input.accountId,
    p_lines: input.lines,
    p_opportunity_id: input.opportunityId ?? null,
    p_contract_instance_id: input.contractInstanceId ?? null,
    p_rate_card_code: CHARTER_RATE_CARD_CODE,
    p_valid_until: input.validUntil ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  const result = data as QuotationResult;
  return { ...result, total_amount: Number(result.total_amount) };
}

export async function requestPricing(input: {
  serviceCode: string;
  requirement: string;
  accountId?: string | null;
  opportunityId?: string | null;
  scopeLabel?: string | null;
  categoryCode?: string | null;
}): Promise<string> {
  const { data, error } = await db.rpc("commercial_request_pricing", {
    p_service_code: input.serviceCode,
    p_requirement: input.requirement,
    p_account_id: input.accountId ?? null,
    p_opportunity_id: input.opportunityId ?? null,
    p_scope_label: input.scopeLabel ?? null,
    p_category_code: input.categoryCode ?? null,
    p_rate_card_code: CHARTER_RATE_CARD_CODE,
  });
  if (error) throw error;
  return data as string;
}

export async function decidePricingRequest(
  requestId: string,
  status: "approved" | "declined" | "superseded",
  note: string,
) {
  const { error } = await db.rpc("commercial_decide_pricing_request", {
    p_request_id: requestId,
    p_status: status,
    p_decision_note: note,
  });
  if (error) throw error;
}

export async function fetchPricingRequests(status?: string) {
  let q = db
    .from("commercial_pricing_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listAccounts() {
  const { data, error } = await db
    .from("crm_accounts")
    .select("id,name,legal_name,lifecycle_stage")
    .order("name");
  if (error) throw error;
  return (data ?? []) as { id: string; name: string; legal_name: string | null; lifecycle_stage: string | null }[];
}

export async function generateContractInstance(input: {
  templateId: string;
  accountId: string;
  rateCardId: string;
  customerLegalName: string;
  selectedServices: string[];
  variables: Record<string, string>;
  effectiveDate?: string | null;
  contractTerm?: string | null;
  paymentTerms?: string | null;
  opportunityId?: string | null;
}) {
  const { data, error } = await db
    .from("commercial_contract_instances")
    .insert({
      template_id: input.templateId,
      account_id: input.accountId,
      rate_card_id: input.rateCardId,
      customer_legal_name: input.customerLegalName,
      selected_services: input.selectedServices,
      customer_variables: input.variables,
      effective_date: input.effectiveDate ?? null,
      contract_term: input.contractTerm ?? null,
      payment_terms: input.paymentTerms ?? null,
      opportunity_id: input.opportunityId ?? null,
      status: "generated",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}
