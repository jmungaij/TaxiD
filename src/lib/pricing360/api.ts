/**
 * Pricing 360 — data access.
 *
 * Every authoritative calculation goes through the database RPCs. The client
 * NEVER submits a total, a fee, a discount or a tax amount: it submits the
 * commercial request and the server returns the governed price.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  PriceCalculationInput, PriceResult, PricingComponent, PricingRuleSet, RateCard, RateLine,
} from "./types";

/** Authoritative server-side price. Use this for anything a customer pays. */
export async function calculatePriceServer(input: PriceCalculationInput): Promise<PriceResult> {
  const { data, error } = await supabase.rpc("pricing360_calculate", { p_input: input as never });
  if (error) throw error;
  return data as unknown as PriceResult;
}

/** Calculates and freezes an immutable snapshot so the quote stays reproducible. */
export async function snapshotQuote(input: PriceCalculationInput, quoteRef?: string): Promise<PriceResult> {
  const { data, error } = await supabase.rpc("pricing360_snapshot_quote", {
    p_input: input as never,
    p_quote_ref: quoteRef ?? null,
  });
  if (error) throw error;
  return data as unknown as PriceResult;
}

export async function fetchRuleSets(): Promise<PricingRuleSet[]> {
  const { data, error } = await supabase
    .from("pricing_rule_sets")
    .select("id,code,name,domain,version,status,currency,effective_from,effective_until,note,approved_at,published_at")
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PricingRuleSet[];
}

export async function fetchComponents(ruleSetId?: string): Promise<PricingComponent[]> {
  let query = supabase
    .from("pricing_components")
    .select("id,rule_set_id,kind,code,label,calc,value,basis,scope,priority,stackable,requires_code,min_amount,max_amount,active,reason")
    .order("priority", { ascending: true });
  if (ruleSetId) query = query.eq("rule_set_id", ruleSetId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as PricingComponent[];
}

export async function fetchRateCards(): Promise<RateCard[]> {
  const { data, error } = await supabase
    .from("commercial_rate_cards")
    .select("id,code,name,product_domain,version,status,currency,effective_from")
    .order("effective_from", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as RateCard[];
}

export async function fetchRateLines(rateCardId: string): Promise<RateLine[]> {
  const { data, error } = await supabase
    .from("commercial_rate_lines")
    .select("id,rate_card_id,service_code,scope_label,category_code,pricing_basis,amount,currency,included_distance_km,included_distance_period")
    .eq("rate_card_id", rateCardId)
    .order("service_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as RateLine[];
}

/** Publishes an approved rule set. Server enforces role and separation of duties. */
export async function publishRuleSet(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("pricing360_publish_rule_set", { p_id: id, p_reason: reason });
  if (error) throw error;
}

export interface PricingHealth {
  published_rule_sets: number;
  domains_without_rule_set: string[];
  approved_rate_cards: number;
  rate_lines: number;
  non_positive_rates: number;
  duplicate_rate_lines: number;
  active_tax_components: number;
  active_discount_components: number;
  invalid_effective_windows: number;
  snapshots: number;
  generated_at: string;
}

export async function fetchPricingHealth(): Promise<PricingHealth> {
  const { data, error } = await supabase.rpc("pricing360_health");
  if (error) throw error;
  return data as unknown as PricingHealth;
}

export interface PricingAuditEvent {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  reason: string;
  created_at: string;
}

export async function fetchPricingAudit(limit = 100): Promise<PricingAuditEvent[]> {
  const { data, error } = await supabase
    .from("pricing_audit_events")
    .select("id,actor_id,action,entity,entity_id,reason,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as PricingAuditEvent[];
}

export interface QuoteSnapshotRow {
  id: string;
  quote_ref: string | null;
  domain: string;
  rate_card_version: string | null;
  rule_set_version: string | null;
  currency: string;
  total: number;
  calculated_at: string;
}

export async function fetchQuoteSnapshots(limit = 50): Promise<QuoteSnapshotRow[]> {
  const { data, error } = await supabase
    .from("pricing_quote_snapshots")
    .select("id,quote_ref,domain,rate_card_version,rule_set_version,currency,total,calculated_at")
    .order("calculated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as QuoteSnapshotRow[];
}
