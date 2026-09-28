/**
 * Asset Pricing 360 — client data access.
 *
 * Every price, every validation result and every lifecycle transition is
 * produced by the database (`ap360_quote`, `ap360_validate_version`,
 * `ap360_transition_version`, `ap360_rollback`). This module carries no pricing
 * arithmetic and no client-side lifecycle rules: it asks the authority and
 * reports exactly what the authority said.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

/* ------------------------------- taxonomy -------------------------------- */

export type Ap360EngineCode =
  | "time_distance" | "trip_payload" | "hours_mobilisation" | "block_hour"
  | "vessel_hours" | "negotiated" | "contract";

export interface Ap360Engine {
  code: Ap360EngineCode;
  label: string;
  required_keys: string[];
  parameter_keys: string[];
}

export interface Ap360Family {
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
}

export interface Ap360Category {
  code: string;
  family_code: string;
  label: string;
  engine_code: Ap360EngineCode;
  reference_low: number | null;
  reference_high: number | null;
  reference_unit: string | null;
  capacity: number | null;
  sort_order: number;
  active: boolean;
}

export interface Ap360Profile {
  id: string;
  category_code: string;
  code: string;
  label: string;
  currency: string;
  geography: string;
  active: boolean;
}

/** Backend-owned lifecycle. The UI never invents a state. */
export type Ap360VersionStatus =
  | "draft" | "validating" | "submitted" | "approved" | "scheduled"
  | "published" | "active" | "rejected" | "superseded" | "archived";

export interface Ap360Version {
  id: string;
  profile_id: string;
  version: number;
  status: Ap360VersionStatus;
  engine_code: Ap360EngineCode;
  params: Record<string, number | string | boolean | null>;
  commission_pct: number;
  max_discount_pct: number;
  demand_ceiling: number;
  override_tolerance_pct: number;
  target_margin_pct: number;
  fuel_policy: string;
  tax_rule_code: string | null;
  effective_from: string;
  effective_to: string | null;
  reason: string | null;
  approved_at: string | null;
  published_at: string | null;
  superseded_at: string | null;
  created_at: string;
}

export interface Ap360CostInput {
  id: string;
  version_id: string;
  cost_key: string;
  label: string;
  unit: string;
  amount: number;
  category: "direct" | "overhead" | "risk";
  note: string | null;
}

/* --------------------------------- reads --------------------------------- */

export async function fetchEngines(): Promise<Ap360Engine[]> {
  const { data, error } = await supabase
    .from("ap360_engines").select("code,label,required_keys,parameter_keys").order("code");
  if (error) throw error;
  return (data ?? []) as unknown as Ap360Engine[];
}

export async function fetchFamilies(): Promise<Ap360Family[]> {
  const { data, error } = await supabase
    .from("ap360_families").select("code,label,sort_order,active").order("sort_order");
  if (error) throw error;
  return (data ?? []) as unknown as Ap360Family[];
}

export async function fetchCategories(): Promise<Ap360Category[]> {
  const { data, error } = await supabase
    .from("ap360_categories")
    .select("code,family_code,label,engine_code,reference_low,reference_high,reference_unit,capacity,sort_order,active")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as unknown as Ap360Category[];
}

export async function fetchProfiles(categoryCode?: string): Promise<Ap360Profile[]> {
  let q = supabase.from("ap360_profiles")
    .select("id,category_code,code,label,currency,geography,active").order("code");
  if (categoryCode) q = q.eq("category_code", categoryCode);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Ap360Profile[];
}

export async function fetchVersions(profileId: string): Promise<Ap360Version[]> {
  const { data, error } = await supabase
    .from("ap360_versions")
    .select("id,profile_id,version,status,engine_code,params,commission_pct,max_discount_pct,demand_ceiling,override_tolerance_pct,target_margin_pct,fuel_policy,tax_rule_code,effective_from,effective_to,reason,approved_at,published_at,superseded_at,created_at")
    .eq("profile_id", profileId)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Ap360Version[];
}

export async function fetchCostInputs(versionId: string): Promise<Ap360CostInput[]> {
  const { data, error } = await supabase
    .from("ap360_cost_inputs")
    .select("id,version_id,cost_key,label,unit,amount,category,note")
    .eq("version_id", versionId)
    .order("category");
  if (error) throw error;
  return (data ?? []) as unknown as Ap360CostInput[];
}

/* ------------------------------ governance ------------------------------- */

export interface Ap360Validation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  version?: number;
  status?: Ap360VersionStatus;
}

export async function validateVersion(versionId: string): Promise<Ap360Validation> {
  const { data, error } = await supabase.rpc("ap360_validate_version", { p_version_id: versionId });
  if (error) throw error;
  return data as unknown as Ap360Validation;
}

export type Ap360Action = "submit" | "approve" | "reject" | "publish" | "archive";

export interface Ap360TransitionResult {
  ok: boolean;
  status?: Ap360VersionStatus;
  validation?: Ap360Validation;
  /** False when the server refused on authority grounds. */
  authorized?: boolean;
  /** Plain-language refusal, present whenever `authorized` is false. */
  blocked_reason?: string;
  attempted_action?: string;
}

/** Server refusal on authority grounds, carrying the reason the operator sees. */
export class Ap360AuthorizationError extends Error {
  readonly attemptedAction?: string;
  constructor(message: string, attemptedAction?: string) {
    super(message);
    this.name = "Ap360AuthorizationError";
    this.attemptedAction = attemptedAction;
  }
}

/**
 * Requests a lifecycle transition. The server decides: when it refuses because
 * validation failed it returns `ok: false` with the failing rules, and the UI
 * must keep the operator on the version rather than advancing. When it refuses
 * on authority grounds it returns `authorized: false` with the reason — the
 * refusal is already recorded in `pricing_audit_events` server-side — and we
 * raise it so no surface can mistake a refusal for a completed transition.
 */
export async function transitionVersion(
  versionId: string, action: Ap360Action, reason: string,
): Promise<Ap360TransitionResult> {
  const { data, error } = await supabase.rpc("ap360_transition_version", {
    p_version_id: versionId, p_action: action, p_reason: reason,
  });
  if (error) throw error;
  const result = data as unknown as Ap360TransitionResult;
  if (result?.authorized === false) {
    throw new Ap360AuthorizationError(
      result.blocked_reason ?? "You do not hold the pricing authority for this action.",
      result.attempted_action ?? action,
    );
  }
  return result;
}

export async function rollbackVersion(versionId: string, reason: string): Promise<Ap360TransitionResult> {
  const { data, error } = await supabase.rpc("ap360_rollback", { p_version_id: versionId, p_reason: reason });
  if (error) throw error;
  const result = data as unknown as Ap360TransitionResult;
  if (result?.authorized === false) {
    throw new Ap360AuthorizationError(
      result.blocked_reason ?? "Rollback requires super admin or finance admin.",
      "rollback",
    );
  }
  return result;
}


/** Saves the parameter set of a draft. Published versions are immutable server-side. */
export async function saveDraftParams(
  versionId: string,
  patch: Partial<Pick<Ap360Version, "params" | "commission_pct" | "max_discount_pct" | "demand_ceiling" | "target_margin_pct" | "override_tolerance_pct" | "fuel_policy" | "tax_rule_code" | "reason">>,
): Promise<void> {
  const { error } = await supabase.from("ap360_versions").update(patch as never).eq("id", versionId);
  if (error) throw error;
}

/** Opens a new draft for a profile, seeded from the version supplied. */
export async function createDraftVersion(source: Ap360Version, nextVersion: number): Promise<string> {
  const { data, error } = await supabase.from("ap360_versions").insert({
    profile_id: source.profile_id,
    version: nextVersion,
    status: "draft",
    engine_code: source.engine_code,
    params: source.params as never,
    commission_pct: source.commission_pct,
    max_discount_pct: source.max_discount_pct,
    demand_ceiling: source.demand_ceiling,
    override_tolerance_pct: source.override_tolerance_pct,
    target_margin_pct: source.target_margin_pct,
    fuel_policy: source.fuel_policy,
    tax_rule_code: source.tax_rule_code,
    effective_from: new Date().toISOString(),
    reason: `Draft opened from v${source.version}`,
  } as never).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/* --------------------------------- quote --------------------------------- */

export interface Ap360QuoteInput {
  category_code: string;
  days?: number;
  hours?: number;
  distance_km?: number;
  empty_return_km?: number;
  passengers?: number;
  nights?: number;
  positioning_hours?: number;
  landings?: number;
  mobilisation?: boolean;
  standby_hours?: number;
  waiting_hours?: number;
  day_type?: "standard" | "night" | "sunday" | "holiday";
  demand_multiplier?: number;
  corporate?: boolean;
  discount_pct?: number;
  region?: string;
  shared?: boolean;
  fuel_type?: string;
  at?: string;
}

export type Ap360QuoteStatus =
  | "OK" | "PRICE_RAISED_TO_FLOOR" | "PRICE_EXCEPTION_REQUIRED" | "QUOTE_REQUIRED"
  | "NO_PUBLISHED_VERSION" | "UNKNOWN_CATEGORY" | "UNKNOWN_ENGINE" | "INVALID_INPUT";

export interface Ap360Line { code: string; label: string; amount: number; reason: string }
export interface Ap360Notice { code: string; message: string }

export interface Ap360Quote {
  status: Ap360QuoteStatus;
  error?: string;
  message?: string;
  category_code?: string;
  family_code?: string;
  category_label?: string;
  engine_code?: Ap360EngineCode;
  profile_id?: string;
  version_id?: string;
  version?: number;
  currency?: string;
  lines?: Ap360Line[];
  notices?: Ap360Notice[];
  market?: { low?: number | null; median?: number | null; high?: number | null; samples?: number | null } | null;
  market_position?: string;
  direct_cost?: number;
  overhead?: number;
  risk_reserve?: number;
  operator_floor?: number;
  subtotal?: number;
  discount?: number;
  net_before_tax?: number;
  commission?: number;
  tax?: number;
  tax_rule?: string | null;
  /**
   * Legacy field name for the governed, customer-payable figure. New callers
   * should read `authoritative_price`; both are kept in step by the authority.
   */
  customer_price?: number;
  /**
   * The governed price. It is `null` (or absent) whenever the authority
   * withheld pricing — a validation failure never yields a payable figure.
   */
  authoritative_price?: number | null;
  /** A non-binding estimate. Never a price anybody may be charged. */
  indicative_price?: number | null;
  /** Populated when the authority's answer breached the quote contract. */
  contract_violations?: Ap360ContractViolation[];


  operator_net?: number;
  yalla_revenue?: number;
  contribution_pct?: number | null;
  profitability_band?: "GREEN" | "AMBER" | "RED" | "UNPROVEN" | string;
  demand_ceiling?: number;
  demand_applied?: number;
  indicative_from?: string | number;
  indicative_to?: string | number;
  quote_validity_days?: string | number;
  calculated_at?: string;
}

/** Statuses that may carry a customer-payable figure. Everything else is a refusal. */
export const AP360_PRICED_STATUSES: Ap360QuoteStatus[] = ["OK", "PRICE_RAISED_TO_FLOOR"];

export interface Ap360ContractViolation {
  field: string;
  problem: string;
}

/**
 * Contract audit of a raw `ap360_quote` payload.
 *
 * The authority must answer with an unambiguous shape: a status, a currency, and
 * either a governed payable price or nothing payable at all. A payload that both
 * withholds pricing and carries a payable figure is semantically dangerous — it
 * is exactly the shape that leaks an unapproved number into an order total — so
 * it is reported here rather than trusted.
 */
export function quoteContractViolations(raw: unknown): Ap360ContractViolation[] {
  const v: Ap360ContractViolation[] = [];
  if (!raw || typeof raw !== "object") return [{ field: "payload", problem: "no quote object was returned" }];
  const q = raw as Record<string, unknown>;
  const status = q.status;
  if (typeof status !== "string" || !(status in AP360_STATUS_COPY)) {
    v.push({ field: "status", problem: `unknown pricing status ${JSON.stringify(status)}` });
  }
  if (typeof q.currency !== "string" || !q.currency.trim()) {
    v.push({ field: "currency", problem: "every quote must state its currency" });
  }
  const priced = typeof status === "string" && (AP360_PRICED_STATUSES as string[]).includes(status);
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);

  if (priced) {
    if (!num(q.authoritative_price) || (q.authoritative_price as number) <= 0) {
      v.push({ field: "authoritative_price", problem: "a priced outcome must carry a positive governed price" });
    }
    if (q.indicative_price !== null && q.indicative_price !== undefined) {
      v.push({ field: "indicative_price", problem: "a priced outcome must not also offer an estimate" });
    }
  } else {
    if (q.authoritative_price !== null && q.authoritative_price !== undefined) {
      v.push({ field: "authoritative_price", problem: "a withheld outcome must not carry a payable price" });
    }
    if (q.customer_price !== null && q.customer_price !== undefined) {
      v.push({ field: "customer_price", problem: "a withheld outcome must not carry the legacy payable field" });
    }
    if (q.indicative_price !== null && q.indicative_price !== undefined && !num(q.indicative_price)) {
      v.push({ field: "indicative_price", problem: "an estimate must be a finite number when present" });
    }
    const message = typeof q.message === "string" ? q.message : typeof q.error === "string" ? q.error : "";
    if (!message.trim()) v.push({ field: "message", problem: "a withheld outcome must say why" });
  }
  return v;
}

/**
 * Makes a payload safe to consume. A contract violation never becomes a price:
 * the payable fields are stripped, the outcome stays withheld and the violation
 * is surfaced on the quote so the operator sees a refusal, not a number.
 */
export function normalizeQuote(raw: unknown): Ap360Quote {
  const violations = quoteContractViolations(raw);
  const q = { ...((raw ?? {}) as Ap360Quote) };
  if (typeof q.currency !== "string" || !q.currency.trim()) q.currency = "KES";
  const priced = (AP360_PRICED_STATUSES as string[]).includes(q.status as string);
  if (!priced || violations.length > 0) {
    if (!priced) {
      q.indicative_price =
        typeof q.indicative_price === "number"
          ? q.indicative_price
          : typeof q.customer_price === "number"
            ? q.customer_price
            : null;
    }
    delete q.customer_price;
    q.authoritative_price = null;
    if (violations.length > 0) {
      q.contract_violations = violations;
      q.message =
        q.message ??
        q.error ??
        "The pricing authority returned an inconsistent answer, so no price is applied.";
       
      console.error("[ap360] quote contract violation", violations);
    }
  }
  return q;
}

export async function ap360Quote(input: Ap360QuoteInput): Promise<Ap360Quote> {
  const { data, error } = await supabase.rpc("ap360_quote", { p_input: input as never });
  if (error) throw error;
  return normalizeQuote(data);
}

export interface Ap360SaveQuoteResult {
  saved: boolean;
  snapshot_id?: string;
  status?: Ap360QuoteStatus;
  /** Why the authority refused to freeze the quote. */
  blocked_reason?: string;
  result: Ap360Quote;
}

/**
 * Calculates and freezes an immutable snapshot so a booking total never drifts.
 * The server refuses to freeze anything the authority did not price, so a
 * `saved: false` answer is the backend rejecting an indicative-only booking.
 */
export async function ap360SaveQuote(input: Ap360QuoteInput, quoteRef?: string): Promise<Ap360SaveQuoteResult> {
  const { data, error } = await supabase.rpc("ap360_save_quote", {
    p_input: input as never, p_quote_ref: quoteRef ?? null,
  });
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  const result = normalizeQuote(raw.result);
  return {
    saved: raw.saved === true,
    snapshot_id: typeof raw.snapshot_id === "string" ? raw.snapshot_id : undefined,
    status: result.status,
    blocked_reason:
      typeof raw.blocked_reason === "string"
        ? raw.blocked_reason
        : raw.saved === true
          ? undefined
          : (result.message ?? result.error ?? AP360_STATUS_COPY[result.status] ?? "The pricing authority withheld this price."),
    result,
  };
}


/** Customer-safe meaning of every non-priced outcome — never a fabricated zero. */
export const AP360_STATUS_COPY: Record<string, string> = {
  OK: "Priced from the published pricing version.",
  PRICE_RAISED_TO_FLOOR: "Priced at the operator economic floor — TaxiD never sells below cost.",
  PRICE_EXCEPTION_REQUIRED: "This price needs a governed commercial exception before it can be sold.",
  QUOTE_REQUIRED: "This asset is priced by negotiated quote — our team will confirm the figure.",
  NO_PUBLISHED_VERSION: "No published pricing version governs this asset yet, so no price is shown.",
  UNKNOWN_CATEGORY: "This asset category is not registered in the pricing authority.",
  UNKNOWN_ENGINE: "The pricing engine for this asset is not configured.",
  INVALID_INPUT: "The pricing request is incomplete.",
};

/**
 * The governed, customer-payable figure — or `null` when pricing was withheld.
 * Only `OK` and `PRICE_RAISED_TO_FLOOR` can carry one; every other status is a
 * refusal, whatever numbers the payload happens to contain.
 */
export function authoritativePrice(q: Ap360Quote | null): number | null {
  if (!q || (q.status !== "OK" && q.status !== "PRICE_RAISED_TO_FLOOR")) return null;
  const v = q.authoritative_price ?? q.customer_price;
  return typeof v === "number" ? v : null;
}

/** A non-binding estimate, if the authority offered one. Never payable. */
export function indicativePrice(q: Ap360Quote | null): number | null {
  return typeof q?.indicative_price === "number" ? q.indicative_price : null;
}

/** True when the outcome carries a customer-payable figure. */
export function isPriced(q: Ap360Quote | null): boolean {
  return authoritativePrice(q) !== null;
}


/* ------------------------------ capabilities ------------------------------ */

/**
 * What the signed-in operator may actually do, as decided by the database
 * (`ap360_capabilities`). The console renders permissions from this answer only:
 * it never infers authority from a client-held role list, so the UI can never
 * offer an action the server would refuse.
 */
export interface Ap360Capabilities {
  authenticated: boolean;
  staff: boolean;
  can_view: boolean;
  can_edit_draft: boolean;
  can_submit: boolean;
  can_approve: boolean;
  can_reject: boolean;
  can_publish: boolean;
  can_archive: boolean;
  can_compare: boolean;
  roles: string[];
  reason: string;
}

/** Fully-denied posture, used when the authority itself cannot be reached. */
export const AP360_NO_CAPABILITIES: Ap360Capabilities = {
  authenticated: false, staff: false, can_view: false, can_edit_draft: false,
  can_submit: false, can_approve: false, can_reject: false, can_publish: false,
  can_archive: false, can_compare: false, roles: [],
  reason: "Pricing permissions could not be confirmed, so no pricing action is offered.",
};

export async function fetchAp360Capabilities(): Promise<Ap360Capabilities> {
  const { data, error } = await (untypedDb).rpc("ap360_capabilities");
  if (error) throw new Error(error.message);
  const c = (data ?? {}) as Partial<Ap360Capabilities>;
  return { ...AP360_NO_CAPABILITIES, ...c, roles: Array.isArray(c.roles) ? c.roles : [] };
}

/* ---------------------------- shadow comparison --------------------------- */

export interface Ap360ShadowCompare {
  inputs: Record<string, unknown>;
  legacy: Record<string, unknown> & { status?: string; error?: string; total?: number };
  ap360: Ap360Quote;
  legacy_total: number | null;
  ap360_total: number | null;
  difference: number | null;
  difference_pct: number | null;
  comparable: boolean;
}

/**
 * Runs the same inputs through the legacy calculator and the pricing authority.
 * The server answers with both results; nothing is recomputed on the client, so
 * a difference shown here is a real difference in the two engines.
 */
export async function ap360ShadowCompare(input: Ap360QuoteInput): Promise<Ap360ShadowCompare> {
  const { data, error } = await supabase.rpc("ap360_shadow_compare", { p_input: input as never });
  if (error) throw error;
  return data as unknown as Ap360ShadowCompare;
}
