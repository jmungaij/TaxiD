/**
 * Estimated daily rate calculator — the source of every customer-facing
 * "From KSh …/day" figure.
 *
 * No surface may hard-code a marketplace price. Instead each card asks this
 * calculator for a governed estimate derived from:
 *
 *   • the administrator's per-asset-class band (min / max day rate),
 *   • the mission date (weekend, public holiday, declared peak window),
 *   • destination and distance / duration (metering + long-haul taper),
 *   • vehicle category and passenger load,
 *   • live demand index,
 *   • corporate account status (framework discount).
 *
 * The result is a *band* plus the factors that produced it, so the UI can show
 * "From KSh X / day" honestly and explain what moves the price.
 */
import { type AssetClass } from "./assetPricingProfiles";
import {
  activeAssetPricingConfig, assetProfileConfig,
  type AssetPricingConfig,
} from "./assetPricingAdmin";
import { computePolymorphicQuote, isKenyanHoliday, isWeekend } from "./polymorphicPricing";

export interface DailyRateInput {
  assetClass: AssetClass;
  /** Vehicle / asset label for provenance ("Executive coach 49"). */
  assetLabel?: string;
  seats?: number;
  passengers?: number;
  /** Governed band for the specific asset, when narrower than the class band. */
  band?: [number, number];
  perKmKes?: number;
  date?: string | Date;
  destination?: string;
  distanceKm?: number;
  /** Hours for hourly-hire estimates. */
  hours?: number;
  days?: number;
  demandIndex?: number;
  peak?: boolean;
  corporate?: boolean;
  operatorId?: string;
  config?: AssetPricingConfig;
}

export interface DailyRateEstimate {
  /** Headline figure for "From KSh … / day". */
  fromKes: number;
  /** Upper end of the governed estimate. */
  toKes: number;
  /** Most likely all-in day rate for the described mission. */
  expectedKes: number;
  unit: "day" | "hour";
  currency: "KES";
  /** True when the estimate is hourly (short hires on enabled classes). */
  hourly: boolean;
  factors: Array<{ label: string; effect: string; reason: string }>;
  /** Human-readable summary of what the estimate accounts for. */
  basisNote: string;
}

const r = (n: number) => Math.round(n);

/**
 * Governed estimate for one asset. The low end uses the band minimum with no
 * uplift; the high end uses the band maximum with the calendar, demand and
 * distance factors that apply to the requested mission.
 */
export function estimateDailyRate(input: DailyRateInput): DailyRateEstimate {
  const config = input.config ?? activeAssetPricingConfig();
  const admin = assetProfileConfig(input.assetClass, config);
  const [bandMin, bandMax] = input.band ?? [admin.minKes, admin.maxKes];
  const days = Math.max(1, input.days ?? 1);
  const hourly = Boolean(admin.hourly.enabled && input.hours && !input.days);

  const shared = {
    assetClass: input.assetClass,
    assetLabel: input.assetLabel,
    seats: input.seats,
    passengers: input.passengers,
    band: [bandMin, bandMax] as [number, number],
    perKmKes: input.perKmKes,
    distanceKm: input.distanceKm,
    date: input.date,
    peak: input.peak,
    demandIndex: input.demandIndex,
    corporate: input.corporate,
    operatorId: input.operatorId,
    config,
  };

  const low = computePolymorphicQuote({
    ...shared, date: undefined, peak: false, demandIndex: 0,
    baseDayKes: bandMin, days: hourly ? 0 : days, hours: hourly ? input.hours : undefined,
  });
  const expected = computePolymorphicQuote({
    ...shared,
    baseDayKes: r((bandMin + bandMax) / 2), days: hourly ? 0 : days, hours: hourly ? input.hours : undefined,
  });
  const high = computePolymorphicQuote({
    ...shared,
    baseDayKes: bandMax, days: hourly ? 0 : days, hours: hourly ? input.hours : undefined,
  });

  const divisor = hourly ? Math.max(admin.hourly.minimumHours, input.hours ?? 1) : days;
  const per = (total: number) => r(total / Math.max(1, divisor));

  const notes: string[] = [];
  if (input.destination) notes.push(`destination ${input.destination}`);
  if (input.distanceKm) notes.push(`${r(input.distanceKm)} km`);
  if (input.passengers) notes.push(`${input.passengers} passengers`);
  if (input.date) {
    const d = new Date(input.date);
    if (!Number.isNaN(d.getTime())) {
      notes.push(isKenyanHoliday(d) ? "public holiday" : isWeekend(d) ? "weekend" : "weekday");
    }
  }
  if (input.corporate) notes.push("corporate rate");

  return {
    fromKes: per(low.totalKes),
    toKes: per(high.totalKes),
    expectedKes: per(expected.totalKes),
    unit: hourly ? "hour" : "day",
    currency: "KES",
    hourly,
    factors: expected.factors,
    basisNote: notes.length
      ? `Includes ${notes.join(" · ")} — final quote confirmed against operator availability.`
      : "Governed marketplace band — final quote varies with date, route, duration and demand.",
  };
}

/** Short label for cards: "From KSh 14,300 / day". */
export const formatFromRate = (e: DailyRateEstimate): string =>
  `From KSh ${e.fromKes.toLocaleString()} / ${e.unit}`;

/**
 * Slice a class band into commercial tiers (economy → executive → luxury) so
 * marketing surfaces can show tiered "from" prices without hard-coding any
 * figure: every tier is a governed slice of the administrator's band.
 */
export function classTierBand(
  assetClass: AssetClass,
  tierIndex: number,
  tierCount: number,
  config: AssetPricingConfig = activeAssetPricingConfig(),
): [number, number] {
  const admin = assetProfileConfig(assetClass, config);
  const span = (admin.maxKes - admin.minKes) / Math.max(1, tierCount);
  const i = Math.max(0, Math.min(tierCount - 1, tierIndex));
  return [r(admin.minKes + span * i), r(admin.minKes + span * (i + 1))];
}
