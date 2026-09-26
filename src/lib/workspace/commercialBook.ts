/**
 * STAGE 9 — COMMERCIAL BOOK.
 *
 * Create and manage the commercial chain end to end:
 *   account → opportunity → proposal → contract → service order
 *
 * Writes that must stay consistent go through the database, never the browser:
 *   opportunity   → commercial_book_create_opportunity (ref + account link)
 *   stage change  → crm_set_opportunity_stage
 *   proposal      → commercial_create_quotation (prices from published rate lines)
 * Contract instances and service schedules are inserted directly and are
 * protected by the commercial-staff row policies on those tables.
 */
import { supabase } from "@/integrations/supabase/client";
import { createAccount, listAccounts, setOpportunityStage, type NewAccount } from "@/lib/crm/api";
import type { CrmAccount } from "@/lib/crm/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function fail(message: string): never {
  throw new Error(message);
}

export const OPPORTUNITY_STAGES = ["new", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export interface BookOpportunity {
  id: string;
  opportunity_ref: string;
  title: string;
  stage: string;
  customer_label: string | null;
  expected_value_cents: number | null;
  currency: string | null;
  probability_pct: number | null;
  updated_at: string;
}

export interface BookQuotation {
  id: string;
  quote_number: string;
  account_id: string | null;
  opportunity_id: string | null;
  total_amount: number | null;
  currency: string | null;
  status: string;
  approval_status: string | null;
  valid_until: string | null;
  created_at: string;
}

export interface BookContract {
  id: string;
  account_id: string;
  customer_legal_name: string;
  status: string;
  contract_term: string | null;
  effective_date: string | null;
  selected_services: string[] | null;
  rate_card_id: string | null;
  created_at: string;
}

export interface BookSchedule {
  id: string;
  contract_instance_id: string;
  title: string;
  services: string[] | null;
  locations: string[] | null;
  vehicle_categories: string[] | null;
  validity: string | null;
  approval_status: string;
  created_at: string;
}

export interface RateLine {
  id: string;
  service_code: string;
  scope_label: string;
  category_code: string;
  pricing_basis: string;
  amount: number;
  currency: string;
  included_distance_km: number | null;
}

export interface RateCard {
  id: string;
  code: string;
  name: string;
  version: string;
  status: string;
  currency: string;
  lines: RateLine[];
}

export interface ContractTemplate {
  id: string;
  code: string;
  name: string;
  version: string;
  status: string;
  scope_services: string[] | null;
}

/* --------------------------------- reads --------------------------------- */

export const listBookAccounts = (): Promise<CrmAccount[]> => listAccounts();

export async function listBookOpportunities(): Promise<BookOpportunity[]> {
  const { data, error } = await db
    .from("commercial_opportunities")
    .select(
      "id, opportunity_ref, title, stage, customer_label, expected_value_cents, currency, probability_pct, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) fail(error.message);
  return (data ?? []) as BookOpportunity[];
}

export async function listBookQuotations(): Promise<BookQuotation[]> {
  const { data, error } = await db
    .from("commercial_quotations")
    .select(
      "id, quote_number, account_id, opportunity_id, total_amount, currency, status, approval_status, valid_until, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail(error.message);
  return (data ?? []) as BookQuotation[];
}

export async function listBookContracts(): Promise<BookContract[]> {
  const { data, error } = await db
    .from("commercial_contract_instances")
    .select(
      "id, account_id, customer_legal_name, status, contract_term, effective_date, selected_services, rate_card_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail(error.message);
  return (data ?? []) as BookContract[];
}

export async function listBookSchedules(): Promise<BookSchedule[]> {
  const { data, error } = await db
    .from("commercial_schedules")
    .select(
      "id, contract_instance_id, title, services, locations, vehicle_categories, validity, approval_status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail(error.message);
  return (data ?? []) as BookSchedule[];
}

/** The live rate card and its published lines — the only source of a price. */
export async function loadRateCard(code = "corporate_charter_rate_card"): Promise<RateCard | null> {
  const { data, error } = await db
    .from("commercial_rate_cards")
    .select("id, code, name, version, status, currency")
    .eq("code", code)
    .is("retired_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const lines = await db
    .from("commercial_rate_lines")
    .select("id, service_code, scope_label, category_code, pricing_basis, amount, currency, included_distance_km")
    .eq("rate_card_id", data.id)
    .order("service_code", { ascending: true });
  return { ...(data as Omit<RateCard, "lines">), lines: (lines.data ?? []) as RateLine[] };
}

export async function listContractTemplates(): Promise<ContractTemplate[]> {
  const { data, error } = await db
    .from("commercial_contract_templates")
    .select("id, code, name, version, status, scope_services")
    .order("created_at", { ascending: false });
  if (error) fail(error.message);
  return (data ?? []) as ContractTemplate[];
}

/* --------------------------------- writes -------------------------------- */

export const createBookAccount = (input: NewAccount): Promise<CrmAccount> => createAccount(input);

export interface NewOpportunityInput {
  accountId: string;
  title: string;
  stage?: OpportunityStage;
  expectedValueKes?: number | null;
  probabilityPct?: number | null;
  currency?: string;
}

export async function createBookOpportunity(
  input: NewOpportunityInput,
): Promise<{ opportunity_id: string; opportunity_ref: string }> {
  const { data, error } = await db.rpc("commercial_book_create_opportunity", {
    p: {
      account_id: input.accountId,
      title: input.title,
      stage: input.stage ?? "qualified",
      expected_value_cents:
        input.expectedValueKes == null || Number.isNaN(input.expectedValueKes)
          ? null
          : Math.round(input.expectedValueKes * 100),
      probability_pct: input.probabilityPct ?? null,
      currency: input.currency ?? "KES",
    },
  });
  if (error) fail(error.message);
  return data as { opportunity_id: string; opportunity_ref: string };
}

export const advanceOpportunity = (id: string, stage: OpportunityStage, reason?: string) =>
  setOpportunityStage(id, stage, reason);

export interface QuotationLineInput {
  service_code: string;
  scope_label: string;
  category_code: string;
  pricing_basis?: string;
  quantity: number;
}

export interface QuotationResult {
  quotation_id: string;
  quote_number: string;
  total_amount: number;
  currency: string;
  rate_card_version: string;
  rate_card_status: string;
  unpriced: unknown[];
}

export async function createBookQuotation(input: {
  accountId: string;
  lines: QuotationLineInput[];
  opportunityId?: string | null;
  validUntil?: string | null;
  notes?: string | null;
  rateCardCode?: string;
}): Promise<QuotationResult> {
  if (input.lines.length === 0) fail("Add at least one priced service line.");
  const { data, error } = await db.rpc("commercial_create_quotation", {
    p_account_id: input.accountId,
    p_lines: input.lines,
    p_opportunity_id: input.opportunityId ?? null,
    p_contract_instance_id: null,
    p_rate_card_code: input.rateCardCode ?? "corporate_charter_rate_card",
    p_valid_until: input.validUntil ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) fail(error.message);
  return data as QuotationResult;
}

export async function createBookContract(input: {
  accountId: string;
  templateId: string;
  customerLegalName: string;
  contractTerm?: string | null;
  effectiveDate?: string | null;
  paymentTerms?: string | null;
  selectedServices?: string[];
  opportunityId?: string | null;
  rateCardId?: string | null;
}): Promise<BookContract> {
  const { data, error } = await db
    .from("commercial_contract_instances")
    .insert({
      account_id: input.accountId,
      template_id: input.templateId,
      customer_legal_name: input.customerLegalName,
      contract_term: input.contractTerm ?? null,
      effective_date: input.effectiveDate ?? null,
      payment_terms: input.paymentTerms ?? null,
      selected_services: input.selectedServices ?? [],
      opportunity_id: input.opportunityId ?? null,
      rate_card_id: input.rateCardId ?? null,
      status: "draft",
    })
    .select(
      "id, account_id, customer_legal_name, status, contract_term, effective_date, selected_services, rate_card_id, created_at",
    )
    .single();
  if (error) fail(error.message);
  return data as BookContract;
}

export async function updateContractStatus(id: string, status: string): Promise<void> {
  const { error } = await db.from("commercial_contract_instances").update({ status }).eq("id", id);
  if (error) fail(error.message);
}

/** A service order is the schedule of services executed under a signed contract. */
export async function createServiceOrder(input: {
  contractInstanceId: string;
  rateCardId: string;
  title: string;
  services?: string[];
  locations?: string[];
  vehicleCategories?: string[];
  validity?: string | null;
  commercialTerms?: string | null;
  specialConditions?: string | null;
}): Promise<BookSchedule> {
  const { data, error } = await db
    .from("commercial_schedules")
    .insert({
      contract_instance_id: input.contractInstanceId,
      rate_card_id: input.rateCardId,
      title: input.title,
      services: input.services ?? [],
      locations: input.locations ?? [],
      vehicle_categories: input.vehicleCategories ?? [],
      validity: input.validity ?? null,
      commercial_terms: input.commercialTerms ?? null,
      special_conditions: input.specialConditions ?? null,
    })
    .select(
      "id, contract_instance_id, title, services, locations, vehicle_categories, validity, approval_status, created_at",
    )
    .single();
  if (error) fail(error.message);
  return data as BookSchedule;
}

/* -------------------------------- helpers -------------------------------- */

export function money(amount: number | null | undefined, currency = "KES"): string {
  if (amount == null) return "—";
  return `${currency} ${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function moneyFromCents(cents: number | null | undefined, currency = "KES"): string {
  if (cents == null) return "—";
  return money(cents / 100, currency);
}

/** Distinct service codes on a rate card, for pickers. */
export function serviceCodesOf(card: RateCard | null): string[] {
  return [...new Set((card?.lines ?? []).map((l) => l.service_code))].sort();
}

export function linesFor(card: RateCard | null, serviceCode: string): RateLine[] {
  return (card?.lines ?? []).filter((l) => l.service_code === serviceCode);
}
