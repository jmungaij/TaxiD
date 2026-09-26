/**
 * Public projection of the governed rental rate card.
 *
 * Marketing surfaces must never invent a price. The administrator publishes a
 * versioned rate card (`asset_pricing_versions` + `asset_pricing_bands`); this
 * reader returns the rows of the *published* version only, through the
 * column-level public grant, so a public page can quote a band and name the
 * version that produced it.
 *
 * When nothing is published (or the read fails) the reader returns `null` and
 * the page must say the price is confirmed on quotation — it may not fall back
 * to a hard-coded figure.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export type RateBasis = "day" | "day_plus_mileage" | "block_hour" | "voyage_day";

export interface PublicRateRow {
  assetClass: string;
  label: string;
  fleetGroup: string | null;
  seats: number | null;
  basis: RateBasis;
  /** Governed band, KES per operating day (or block hour for aviation). */
  minKes: number;
  maxKes: number;
  perKmKes: number;
  extraHourKes: number;
  includedKmPerDay: number;
  vatPct: number;
}

export interface PublicRateCard {
  version: number;
  effectiveFrom: string | null;
  rows: PublicRateRow[];
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

interface PublicCardRow {
  version: number;
  effective_from: string | null;
  asset_class: string;
  label: string;
  fleet_group: string | null;
  seats: number | null;
  basis: string | null;
  base_kes: number | null;
  min_kes: number | null;
  max_kes: number | null;
  per_km_kes: number | null;
  extra_hour_kes: number | null;
  included_km_per_day: number | null;
  vat_pct: number | null;
}

/**
 * Published rate card, optionally narrowed to the asset classes a page shows.
 * Rows arrive cheapest-first so a page can render "from" figures directly.
 *
 * Read through the customer-facing projection only: platform fee, corporate
 * discount, override tolerance and demand multipliers are commercial internals
 * and are not readable outside the pricing team.
 */
export async function fetchPublicRateCard(assetClasses?: string[]): Promise<PublicRateCard | null> {
  let query = untypedDb
    .from("v_public_asset_rate_card")
    .select(
      "version, effective_from, asset_class, label, fleet_group, seats, basis, base_kes, min_kes, max_kes, per_km_kes, extra_hour_kes, included_km_per_day, vat_pct",
    )
    .order("version", { ascending: false })
    .order("base_kes", { ascending: true });

  if (assetClasses?.length) query = query.in("asset_class", assetClasses);

  const { data, error } = await query;
  if (error || !data?.length) return null;

  const rows = data as unknown as PublicCardRow[];
  const latest = Math.max(...rows.map((r) => Number(r.version)));
  const current = rows.filter((r) => Number(r.version) === latest);
  if (current.length === 0) return null;

  return {
    version: latest,
    effectiveFrom: current[0].effective_from ?? null,
    rows: current.map((b) => ({
      assetClass: String(b.asset_class),
      label: String(b.label),
      fleetGroup: b.fleet_group ?? null,
      seats: b.seats ?? null,
      basis: (b.basis ?? "day_plus_mileage") as RateBasis,
      minKes: num(b.min_kes),
      maxKes: num(b.max_kes),
      perKmKes: num(b.per_km_kes),
      extraHourKes: num(b.extra_hour_kes),
      includedKmPerDay: Number(b.included_km_per_day ?? 0),
      vatPct: num(b.vat_pct),
    })),
  };
}

export const kes = (n: number): string => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

export const BASIS_LABEL: Record<RateBasis, string> = {
  day: "Per day",
  day_plus_mileage: "Per day + mileage",
  block_hour: "Per block hour",
  voyage_day: "Per voyage day",
};
