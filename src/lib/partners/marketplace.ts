/**
 * TaxiD PARTNERS 360 — marketplace orchestration client.
 *
 * Supply, demand matching, quotation, explainable performance and risk.
 * Every write below is a governed server routine (SECURITY DEFINER + role
 * checks + audit). Nothing here is an authorization boundary: the browser can
 * only ask, the database decides. All money on quotes (commission, partner net,
 * TaxiD margin) is computed server-side from the contracted margin — the client
 * never supplies it.
 */
import { supabase } from "@/integrations/supabase/client";

/* ------------------------------------------------------------------- types */

export type SupplyAssetKind = "DRIVER" | "VEHICLE" | "FLEET_CAPACITY" | "EQUIPMENT";

export type SupplyStatus =
  | "REGISTERED" | "VERIFICATION" | "APPROVED" | "AVAILABLE" | "ASSIGNED"
  | "ON_TRIP" | "UNAVAILABLE" | "SUSPENDED" | "RETIRED";

export const SUPPLY_STATUSES: SupplyStatus[] = [
  "REGISTERED", "VERIFICATION", "APPROVED", "AVAILABLE", "ASSIGNED",
  "ON_TRIP", "UNAVAILABLE", "SUSPENDED", "RETIRED",
];

export interface SupplyAsset {
  id: string;
  partner_id: string;
  asset_kind: SupplyAssetKind;
  driver_id: string | null;
  vehicle_id: string | null;
  label: string;
  service_types: string[];
  vehicle_class: string | null;
  city: string | null;
  county: string | null;
  country: string;
  capacity: number;
  status: SupplyStatus;
  compliance_expires_at: string | null;
  quality_score: number;
  is_demo: boolean;
  notes: string | null;
  created_at: string;
}

export type QuoteState =
  | "REQUESTED" | "VIEWED" | "DRAFT" | "SUBMITTED" | "UNDER_REVIEW"
  | "ACCEPTED" | "REJECTED" | "EXPIRED" | "WITHDRAWN";

export interface PartnerQuote {
  id: string;
  quote_code: string;
  request_id: string;
  partner_id: string;
  state: QuoteState;
  currency: string;
  quoted_amount: number | null;
  tax_amount: number;
  fees_amount: number;
  commission_pct: number | null;
  commission_amount: number | null;
  partner_net: number | null;
  yalla_margin: number | null;
  validity_until: string | null;
  inclusions: string | null;
  exclusions: string | null;
  terms: string | null;
  decision_notes: string | null;
  response_minutes: number | null;
  requested_by: string | null;
  submitted_by: string | null;
  decided_by: string | null;
  requested_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  is_demo: boolean;
}

export interface MatchCandidate {
  partner_id: string;
  partner_code: string;
  partner_name: string;
  eligible: boolean;
  score: number;
  matched_assets: number;
  capacity_available: number;
  reasons: string[];
  exclusions: string[];
}

export interface PerformanceComponent {
  component: string;
  weight: number;
  score: number;
  evidence: Record<string, unknown>;
  computed_at?: string;
  window_days?: number;
}

export type RiskState = "OPEN" | "INVESTIGATING" | "RESOLVED" | "DISMISSED";

export interface RiskFlag {
  id: string;
  partner_id: string;
  kind: string;
  severity: "low" | "medium" | "high" | "critical";
  state: RiskState;
  detail: string;
  evidence: Record<string, unknown>;
  detected_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
}

export interface CoverageRow {
  city: string;
  service_type: string;
  available_capacity: number;
  available_assets: number;
  qualified_partners: number;
  open_demand: number;
  required_capacity: number;
}

/** Performance classification from the stored component total. */
export function classifyPerformance(total: number): string {
  if (total >= 90) return "ELITE";
  if (total >= 78) return "PREFERRED";
  if (total >= 60) return "STANDARD";
  if (total >= 45) return "PROBATION";
  return "AT_RISK";
}

export const COMPONENT_LABEL: Record<string, string> = {
  RELIABILITY: "Reliability",
  SERVICE_QUALITY: "Service quality",
  COMPLIANCE: "Compliance",
  COMMERCIAL: "Commercial performance",
  RESPONSIVENESS: "Responsiveness",
};

/** Surfaces the server's message instead of a generic failure. */
export function explain(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (!raw) return fallback;
  if (/permission denied|not authoris|requires .*authority/i.test(raw)) return raw;
  return raw.replace(/^.*?:\s*/, "") || fallback;
}

/* ------------------------------------------------------------------- reads */

export async function fetchSupplyAssets(partnerId?: string): Promise<SupplyAsset[]> {
  let q = supabase.from("partner_supply_assets").select("*").order("created_at", { ascending: false });
  if (partnerId) q = q.eq("partner_id", partnerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as SupplyAsset[];
}

export async function fetchCoverage(): Promise<CoverageRow[]> {
  const { data, error } = await supabase.rpc("partner_supply_coverage");
  if (error) throw error;
  return (data ?? []) as unknown as CoverageRow[];
}

export async function fetchQuotes(opts: { requestId?: string; partnerId?: string; limit?: number } = {}): Promise<PartnerQuote[]> {
  let q = supabase.from("partner_quotes").select("*").order("requested_at", { ascending: false });
  if (opts.requestId) q = q.eq("request_id", opts.requestId);
  if (opts.partnerId) q = q.eq("partner_id", opts.partnerId);
  const { data, error } = await q.limit(opts.limit ?? 200);
  if (error) throw error;
  return (data ?? []) as unknown as PartnerQuote[];
}

export async function fetchPerformanceComponents(partnerId: string): Promise<PerformanceComponent[]> {
  const { data, error } = await supabase
    .from("partner_performance_components")
    .select("component, weight, score, evidence, computed_at, window_days")
    .eq("partner_id", partnerId)
    .order("weight", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PerformanceComponent[];
}

export async function fetchRiskFlags(state?: RiskState): Promise<RiskFlag[]> {
  let q = supabase.from("partner_risk_flags").select("*").order("detected_at", { ascending: false });
  if (state) q = q.eq("state", state);
  const { data, error } = await q.limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as RiskFlag[];
}

/* ------------------------------------------------------------------ writes */

export async function registerSupply(input: {
  partnerId: string;
  kind: SupplyAssetKind;
  label: string;
  serviceTypes: string[];
  driverId?: string | null;
  vehicleId?: string | null;
  vehicleClass?: string | null;
  city?: string | null;
  capacity?: number;
  complianceExpiresAt?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("partner_supply_register", {
    _partner_id: input.partnerId,
    _asset_kind: input.kind,
    _label: input.label,
    _service_types: input.serviceTypes,
    _driver_id: input.driverId ?? null,
    _vehicle_id: input.vehicleId ?? null,
    _vehicle_class: input.vehicleClass ?? null,
    _city: input.city ?? null,
    _capacity: input.capacity ?? 1,
    _compliance_expires_at: input.complianceExpiresAt ?? null,
  });
  if (error) throw new Error(explain(error, "Supply registration failed."));
  return data as unknown as string;
}

export async function setSupplyStatus(assetId: string, status: SupplyStatus, note?: string) {
  const { error } = await supabase.rpc("partner_supply_set_status", {
    _asset_id: assetId, _status: status, _note: note ?? null,
  });
  if (error) throw new Error(explain(error, "Status change failed."));
}

/** Explainable ranking: every considered partner, with reasons and exclusions. */
export async function matchDemand(requestId: string): Promise<MatchCandidate[]> {
  const { data, error } = await supabase.rpc("partner_match_demand", { _request_id: requestId });
  if (error) throw new Error(explain(error, "Matching failed."));
  return (data ?? []) as unknown as MatchCandidate[];
}

export async function requestQuote(requestId: string, partnerId: string): Promise<string> {
  const { data, error } = await supabase.rpc("partner_quote_request", {
    _request_id: requestId, _partner_id: partnerId,
  });
  if (error) throw new Error(explain(error, "Quote request failed."));
  return data as unknown as string;
}

export async function submitQuote(input: {
  quoteId: string;
  amount: number;
  tax?: number;
  fees?: number;
  validityHours?: number;
  inclusions?: string;
  exclusions?: string;
  terms?: string;
}): Promise<PartnerQuote> {
  const { data, error } = await supabase.rpc("partner_quote_submit", {
    _quote_id: input.quoteId,
    _quoted_amount: input.amount,
    _tax_amount: input.tax ?? 0,
    _fees_amount: input.fees ?? 0,
    _validity_hours: input.validityHours ?? 72,
    _inclusions: input.inclusions ?? null,
    _exclusions: input.exclusions ?? null,
    _terms: input.terms ?? null,
  });
  if (error) throw new Error(explain(error, "Quote submission failed."));
  return data as unknown as PartnerQuote;
}

/** Maker-checker enforced server-side: the pricer cannot accept their own quote. */
export async function decideQuote(quoteId: string, accept: boolean, note?: string): Promise<PartnerQuote> {
  const { data, error } = await supabase.rpc("partner_quote_decide", {
    _quote_id: quoteId, _accept: accept, _note: note ?? null,
  });
  if (error) throw new Error(explain(error, "Quote decision failed."));
  return data as unknown as PartnerQuote;
}

export async function recomputeScore(partnerId: string, days = 90): Promise<PerformanceComponent[]> {
  const { data, error } = await supabase.rpc("partner_score_recompute", {
    _partner_id: partnerId, _days: days,
  });
  if (error) throw new Error(explain(error, "Score recalculation failed."));
  return (data ?? []) as unknown as PerformanceComponent[];
}

/** Idempotent sweep — safe to run repeatedly; returns newly raised flags. */
export async function runRiskScan(): Promise<number> {
  const { data, error } = await supabase.rpc("partner_risk_scan");
  if (error) throw new Error(explain(error, "Risk scan failed."));
  return Number(data ?? 0);
}

export async function resolveRiskFlag(flagId: string, state: RiskState, note?: string) {
  const { error } = await supabase.rpc("partner_risk_resolve", {
    _flag_id: flagId, _state: state, _note: note ?? null,
  });
  if (error) throw new Error(explain(error, "Risk update failed."));
}
