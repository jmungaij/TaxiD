/**
 * Governed asset pricing bands — database backed (Pricing 360, Engine B).
 *
 * The charter asset bands used to live in `localStorage`, which meant every
 * browser held its own private "governed" prices and nothing was auditable.
 * They now live in Postgres:
 *
 *   • `asset_pricing_versions`        — draft → under_review → approved → published
 *   • `asset_pricing_bands`           — one governed band per vehicle
 *   • `asset_pricing_fee_components`  — third-party charges per asset class
 *
 * Every amount a customer can be charged is computed by the server
 * (`asset_pricing_calculate`); this module never does pricing arithmetic.
 */
import { supabase } from "@/integrations/supabase/client";
import type { AssetClass } from "@/lib/charter/assetPricingProfiles";

export type AssetPricingStatus =
  | "draft" | "under_review" | "approved" | "published" | "superseded" | "archived";

export interface AssetPricingVersionRow {
  id: string;
  code: string;
  version: number;
  status: AssetPricingStatus;
  currency: string;
  effective_from: string;
  note: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  published_at: string | null;
  superseded_at: string | null;
  created_at: string;
}

export interface AssetBandRow {
  id: string;
  version_id: string;
  asset_class: AssetClass;
  vehicle_key: string;
  label: string;
  fleet_group: string;
  seats: number;
  basis: "block_hour" | "day" | "day_plus_mileage" | "voyage_day";
  category_code: string | null;
  service_code: string;
  base_kes: number;
  min_kes: number;
  max_kes: number;
  per_km_kes: number;
  extra_hour_kes: number;
  included_km_per_day: number;
  corporate_discount_pct: number;
  weekend_multiplier: number;
  holiday_multiplier: number;
  peak_multiplier: number;
  max_demand_multiplier: number;
  platform_fee_pct: number;
  vat_pct: number;
  operator_override_tolerance_pct: number;
  active: boolean;
  note: string;
}

export interface AssetFeeRow {
  id: string;
  version_id: string;
  asset_class: AssetClass;
  fee_key: string;
  label: string;
  unit: "per_trip" | "per_day" | "per_night" | "per_km" | "per_movement" | "per_passenger" | "per_hour";
  amount_kes: number;
  optional: boolean;
  active: boolean;
}

export interface ActiveAssetConfig {
  version_id: string | null;
  version: number | null;
  code: string | null;
  status: AssetPricingStatus | null;
  currency: string;
  effective_from: string | null;
  note: string | null;
  bands: AssetBandRow[];
  fees: AssetFeeRow[];
}

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Numeric columns arrive as strings over PostgREST; normalise once, here. */
export function normaliseBand(raw: Record<string, unknown>): AssetBandRow {
  return {
    ...(raw as unknown as AssetBandRow),
    seats: num(raw.seats, 1),
    base_kes: num(raw.base_kes),
    min_kes: num(raw.min_kes),
    max_kes: num(raw.max_kes),
    per_km_kes: num(raw.per_km_kes),
    extra_hour_kes: num(raw.extra_hour_kes),
    included_km_per_day: num(raw.included_km_per_day),
    corporate_discount_pct: num(raw.corporate_discount_pct),
    weekend_multiplier: num(raw.weekend_multiplier, 1),
    holiday_multiplier: num(raw.holiday_multiplier, 1),
    peak_multiplier: num(raw.peak_multiplier, 1),
    max_demand_multiplier: num(raw.max_demand_multiplier, 1),
    platform_fee_pct: num(raw.platform_fee_pct),
    vat_pct: num(raw.vat_pct),
    operator_override_tolerance_pct: num(raw.operator_override_tolerance_pct, 25),
  };
}

export function normaliseFee(raw: Record<string, unknown>): AssetFeeRow {
  return { ...(raw as unknown as AssetFeeRow), amount_kes: num(raw.amount_kes) };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** The configuration in force. Empty bands means "no published version". */
export async function fetchActiveAssetConfig(): Promise<ActiveAssetConfig> {
  const { data, error } = await supabase.rpc("asset_pricing_active_config");
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    version_id: (raw.version_id as string) ?? null,
    version: raw.version === null || raw.version === undefined ? null : num(raw.version),
    code: (raw.code as string) ?? null,
    status: (raw.status as AssetPricingStatus) ?? null,
    currency: (raw.currency as string) ?? "KES",
    effective_from: (raw.effective_from as string) ?? null,
    note: (raw.note as string) ?? null,
    bands: ((raw.bands as Record<string, unknown>[]) ?? []).map(normaliseBand),
    fees: ((raw.fees as Record<string, unknown>[]) ?? []).map(normaliseFee),
  };
}

export async function fetchAssetPricingVersions(limit = 50): Promise<AssetPricingVersionRow[]> {
  const { data, error } = await supabase
    .from("asset_pricing_versions")
    .select("id,code,version,status,currency,effective_from,note,created_by,approved_by,approved_at,published_at,superseded_at,created_at")
    .order("version", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as AssetPricingVersionRow[];
}

/**
 * Full governed bands, including internal figures (platform fee, corporate
 * discount, multipliers, override tolerance). Internal columns are not readable
 * from the table by signed-in users at all, so this goes through the
 * capability-checked service which requires `staff.pricing.read`.
 */
export async function fetchAssetBands(versionId: string): Promise<AssetBandRow[]> {
  const { data, error } = await supabase.rpc("asset_pricing_bands_internal", {
    p_version_id: versionId,
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(normaliseBand);
}

export async function fetchAssetFees(versionId: string): Promise<AssetFeeRow[]> {
  const { data, error } = await supabase
    .from("asset_pricing_fee_components")
    .select("*")
    .eq("version_id", versionId)
    .order("asset_class", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(normaliseFee);
}

export async function fetchVehicleCategories(): Promise<Array<{ code: string; label: string }>> {
  const { data, error } = await supabase
    .from("commercial_vehicle_categories")
    .select("code,label")
    .order("label", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<{ code: string; label: string }>;
}

/* ------------------------------------------------------------------ */
/* Governance writes — all server-validated                            */
/* ------------------------------------------------------------------ */

/** Opens a draft cloned from the published version. Admin only (enforced server-side). */
export async function createAssetPricingDraft(note: string): Promise<string> {
  const { data, error } = await supabase.rpc("asset_pricing_create_draft", { p_note: note });
  if (error) throw error;
  return data as unknown as string;
}

export type AssetBandInput = Partial<AssetBandRow> & {
  version_id: string;
  vehicle_key: string;
  asset_class: AssetClass;
  label: string;
  base_kes: number;
  min_kes: number;
  max_kes: number;
  reason?: string;
};

export async function saveAssetBand(band: AssetBandInput): Promise<AssetBandRow> {
  const { data, error } = await supabase.rpc("asset_pricing_save_band", { p_band: band as never });
  if (error) throw error;
  return normaliseBand((data ?? {}) as Record<string, unknown>);
}

export async function setAssetPricingStatus(
  versionId: string,
  status: "under_review" | "approved" | "published" | "archived",
  reason: string,
): Promise<AssetPricingVersionRow> {
  const { data, error } = await supabase.rpc("asset_pricing_set_status", {
    p_version_id: versionId, p_status: status, p_reason: reason,
  });
  if (error) throw error;
  return data as unknown as AssetPricingVersionRow;
}

/* ------------------------------------------------------------------ */
/* Server-side calculation                                             */
/* ------------------------------------------------------------------ */

export interface AssetCalcInput {
  vehicle_key: string;
  days?: number;
  nights?: number;
  distance_km?: number;
  passengers?: number;
  extra_hours?: number;
  day_type?: "standard" | "weekend" | "holiday" | "peak";
  fee_keys?: string[];
  base_override_kes?: number;
  corporate?: boolean;
}

export interface AssetCalcLine {
  kind: string;
  code: string;
  label: string;
  amount: number;
  reason: string;
}

export interface AssetCalcResult {
  status: "OK" | "NO_BAND" | "NO_PUBLISHED_VERSION";
  currency?: string;
  version?: number;
  vehicle_key?: string;
  asset_class?: AssetClass;
  category_code?: string | null;
  service_code?: string;
  base?: number;
  base_clamped?: boolean;
  distance_total?: number;
  extra_hours_total?: number;
  fees_total?: number;
  operator_cost?: number;
  discount_total?: number;
  commission_total?: number;
  tax_total?: number;
  total?: number;
  per_seat?: number | null;
  lines?: AssetCalcLine[];
  calculated_at?: string;
}

/** Authoritative asset price. Never recompute this in the browser. */
export async function calculateAssetPrice(input: AssetCalcInput): Promise<AssetCalcResult> {
  const { data, error } = await supabase.rpc("asset_pricing_calculate", { p_input: input as never });
  if (error) throw error;
  return data as unknown as AssetCalcResult;
}

export const ASSET_CALC_STATUS_COPY: Record<AssetCalcResult["status"], string> = {
  OK: "Governed price",
  NO_BAND: "No governed band exists for this vehicle — manual pricing review required.",
  NO_PUBLISHED_VERSION: "No published asset pricing version is in force — manual pricing review required.",
};

/* ------------------------------------------------------------------ */
/* Booking breakdown from the frozen quote snapshot                    */
/* ------------------------------------------------------------------ */

export interface BookingBreakdown {
  status: "OK" | "NO_SNAPSHOT";
  snapshot_id?: string;
  quote_ref?: string;
  currency?: string;
  total?: number;
  rate_card_version?: string | null;
  rule_set_version?: string | null;
  calculated_at?: string;
  base?: number;
  surcharge_total?: number;
  commission_total?: number;
  discount_total?: number;
  tax_total?: number;
  components?: Array<Record<string, unknown>>;
}

/**
 * Pricing breakdown of a booking, reconstructed from the immutable Pricing 360
 * snapshot taken when the quote was frozen. Commission is read from the
 * snapshot's own components — it is never inferred from a stored total.
 */
export async function fetchBookingBreakdown(quoteRef: string): Promise<BookingBreakdown> {
  const { data, error } = await supabase.rpc("pricing360_booking_breakdown", { p_quote_ref: quoteRef });
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    ...(raw as unknown as BookingBreakdown),
    total: raw.total === undefined ? undefined : num(raw.total),
    base: raw.base === undefined ? undefined : num(raw.base),
    surcharge_total: num(raw.surcharge_total),
    commission_total: num(raw.commission_total),
    discount_total: num(raw.discount_total),
    tax_total: num(raw.tax_total),
  };
}
