/**
 * Commission engine — client contract.
 *
 * Commission is CONFIGURED, never hardcoded. The platform default (15% of the
 * net service price, excluding tax and pass-through charges) lives in the
 * `commission_schedules` register as an approved, versioned row. Rules vary the
 * rate by service, scope, vehicle class, city, customer, partner, contract,
 * transaction type, tier, promotion or volume — resolved by priority in the
 * database.
 *
 * Every figure below comes from the server (`commission_resolve`,
 * `commission_simulate`, `commission_intelligence_summary`). Money fields are
 * returned as null when the signed-in user may not see commission economics;
 * the UI shows that restriction rather than guessing a number.
 */
import { supabase } from "@/integrations/supabase/client";

// Commission tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const COMMISSION_BASIS_OPTIONS = [
  { value: "net_service_price", label: "Net service price (excl. tax)" },
  { value: "service_price", label: "Service price incl. surcharges" },
  { value: "base_fare", label: "Base fare only" },
  { value: "eligible_transaction_amount", label: "Eligible transaction amount" },
  { value: "completed_service_amount", label: "Completed service amount" },
  { value: "collected_amount", label: "Amount actually collected" },
  { value: "gross_customer_total", label: "Gross customer total (incl. tax)" },
] as const;

export const COMMISSION_BASIS_LABELS: Record<string, string> = Object.fromEntries(
  COMMISSION_BASIS_OPTIONS.map((o) => [o.value, o.label]),
);

/** Dimensions a commission rule may be scoped by. Order drives the editor. */
export const COMMISSION_DIMENSIONS = [
  { key: "service_code", label: "Service" },
  { key: "scope_label", label: "Route / scope" },
  { key: "category_code", label: "Vehicle class" },
  { key: "city", label: "City" },
  { key: "region", label: "Region" },
  { key: "country", label: "Country" },
  { key: "customer_segment", label: "Customer segment" },
  { key: "transaction_type", label: "Transaction type" },
  { key: "partner_tier", label: "Partner tier" },
] as const;

export interface CommissionSchedule {
  id: string;
  code: string;
  name: string;
  version: number;
  status: "draft" | "pending_approval" | "approved" | "retired";
  default_rate_percent: number;
  min_rate_percent: number | null;
  max_rate_percent: number | null;
  default_basis: string;
  excluded_components: string[];
  effective_from: string | null;
  effective_to: string | null;
  change_summary: string | null;
  published_at: string | null;
}

export interface CommissionRule {
  id: string;
  schedule_id: string;
  label: string;
  priority: number;
  service_code: string | null;
  scope_label: string | null;
  category_code: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  account_id: string | null;
  customer_segment: string | null;
  partner_id: string | null;
  contract_id: string | null;
  transaction_type: string | null;
  partner_tier: string | null;
  min_volume: number | null;
  max_volume: number | null;
  rate_percent: number;
  basis: string | null;
  min_commission: number | null;
  max_commission: number | null;
  effective_from: string | null;
  effective_to: string | null;
  reason: string | null;
  active: boolean;
}

export interface PriceStackRow {
  label: string;
  amount: number;
}

export interface CommissionResolution {
  schedule_id: string;
  schedule_code: string;
  schedule_version: number;
  schedule_name: string;
  rule_id: string | null;
  rule_label: string | null;
  rate_percent: number;
  default_rate_percent: number;
  basis: string;
  excluded_components: string[];
  base_amount: number | null;
  commission_amount: number | null;
  supplier_payout: number | null;
  net_service_price: number;
  tax_amount: number;
  pass_through_amount: number;
  surcharge_amount: number;
  customer_total: number;
  money_visible: boolean;
  price_stack: PriceStackRow[];
}

export interface CommissionScenario {
  label: string;
  customer_price: number;
  rate_percent: number;
  commission_amount: number | null;
  supplier_payout: number | null;
  customer_total: number;
  basis: string;
  money_visible: boolean;
}

export interface CommissionIntelligence {
  from: string;
  to: string;
  transactions: number;
  gross_transaction_value: number;
  eligible_base: number;
  commission_revenue: number;
  supplier_payout: number;
  average_rate_percent: number | null;
  revenue_per_transaction: number | null;
  rate_min: number | null;
  rate_max: number | null;
  data_through: string | null;
  by_schedule: Array<{
    schedule_code: string;
    version: number;
    transactions: number;
    commission: number;
    avg_rate_percent: number | null;
  }>;
}

/** Local mirror of the server arithmetic — display only, never stored. */
export function commissionOn(
  amount: number,
  ratePercent: number,
  bounds?: { min?: number | null; max?: number | null },
): number {
  let value = Math.round(((Number(amount) || 0) * (Number(ratePercent) || 0)) / 100 * 100) / 100;
  if (bounds?.min != null) value = Math.max(value, bounds.min);
  if (bounds?.max != null) value = Math.min(value, bounds.max);
  return value;
}

/** How specific a rule is — higher means it targets a narrower slice. */
export function ruleSpecificity(rule: Partial<CommissionRule>): number {
  const keys: Array<keyof CommissionRule> = [
    "service_code", "scope_label", "category_code", "country", "region", "city",
    "account_id", "customer_segment", "partner_id", "contract_id",
    "transaction_type", "partner_tier",
  ];
  let score = keys.filter((k) => rule[k] != null && rule[k] !== "").length;
  if (rule.min_volume != null || rule.max_volume != null) score += 1;
  return score;
}

/** Plain-language summary of what a rule targets. */
export function describeRule(rule: Partial<CommissionRule>): string {
  const parts = COMMISSION_DIMENSIONS
    .map(({ key, label }) => {
      const value = (rule as Record<string, unknown>)[key];
      return value ? `${label}: ${String(value)}` : null;
    })
    .filter(Boolean) as string[];
  if (rule.min_volume != null || rule.max_volume != null) {
    parts.push(`Volume ${rule.min_volume ?? 0}–${rule.max_volume ?? "∞"}`);
  }
  return parts.length ? parts.join(" · ") : "Applies to every transaction";
}

// ---------------------------------------------------------------- data access

export async function fetchCommissionSchedules(): Promise<CommissionSchedule[]> {
  const { data, error } = await db
    .from("commission_schedules")
    .select("*")
    .order("code")
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CommissionSchedule[];
}

export async function fetchCommissionRules(scheduleId: string): Promise<CommissionRule[]> {
  const { data, error } = await db
    .from("commission_rules")
    .select("*")
    .eq("schedule_id", scheduleId)
    .order("priority");
  if (error) throw error;
  return (data ?? []) as CommissionRule[];
}

export async function resolveCommission(
  input: Record<string, unknown>,
): Promise<CommissionResolution> {
  const { data, error } = await db.rpc("commission_resolve", { p: input });
  if (error) throw error;
  return data as CommissionResolution;
}

export async function simulateCommission(
  input: Record<string, unknown>,
): Promise<{ options: CommissionScenario[]; note: string }> {
  const { data, error } = await db.rpc("commission_simulate", { p: input });
  if (error) throw error;
  return data as { options: CommissionScenario[]; note: string };
}

export async function fetchCommissionIntelligence(
  from: string,
  to: string,
): Promise<CommissionIntelligence> {
  const { data, error } = await db.rpc("commission_intelligence_summary", {
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return data as CommissionIntelligence;
}

export async function openCommissionDraft(input: {
  code: string;
  default_rate_percent?: number;
  default_basis?: string;
  change_summary?: string;
}): Promise<{ schedule_id: string; created: boolean; version?: number }> {
  const { data, error } = await db.rpc("commission_schedule_open_draft", { p: input });
  if (error) throw error;
  return data;
}

export async function saveCommissionRule(
  input: Record<string, unknown>,
): Promise<{ rule_id: string }> {
  const { data, error } = await db.rpc("commission_rule_save", { p: input });
  if (error) throw error;
  return data;
}

export async function deleteCommissionRule(ruleId: string, reason?: string): Promise<void> {
  const { error } = await db.rpc("commission_rule_delete", {
    p: { rule_id: ruleId, reason: reason ?? null },
  });
  if (error) throw error;
}

export async function publishCommissionSchedule(input: {
  schedule_id: string;
  effective_from?: string;
  reason: string;
}): Promise<{ schedule_id: string; version: number; effective_from: string }> {
  const { data, error } = await db.rpc("commission_schedule_publish", { p: input });
  if (error) throw error;
  return data;
}
