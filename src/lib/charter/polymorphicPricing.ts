/**
 * Polymorphic asset pricing engine.
 *
 * One engine, many asset classes. Aircraft, helicopters, coaches, buses,
 * shuttles, vans, cars, trucks, trailers, boats, yachts and equipment all
 * price through `computePolymorphicQuote`, but each class contributes:
 *
 *   • its own fee component set (a coach can never emit landing or navigation
 *     charges — the components simply do not exist on its profile),
 *   • its own terminology (asset noun, crew noun, fee bundle label),
 *   • its own metering basis (block hour, day, day + mileage, voyage day),
 *   • its own governed band, multipliers and discounts from the admin panel.
 *
 * `computeAssetQuote` (road fleet) is a thin adapter over this engine, so
 * there is a single pricing implementation in production.
 */
import {
  pricingProfile, feeBundleLabel,
  type AssetClass, type AssetPricingProfile, type FeeComponent,
} from "./assetPricingProfiles";
import {
  activeAssetPricingConfig, assetProfileConfig, operatorDayRate,
  type AssetPricingConfig, type AssetProfileConfig,
} from "./assetPricingAdmin";

export interface PolymorphicQuoteInput {
  assetClass: AssetClass;
  /** Customer-facing asset name used on the base-rate line. */
  assetLabel?: string;
  seats?: number;
  /** Operator day rate; clamped to the governed admin band. */
  baseDayKes?: number;
  /** Operator id used to resolve a configured override when no rate is given. */
  operatorId?: string;
  days: number;
  nights?: number;
  /** Hours for hourly-hire or block-hour billing. */
  hours?: number;
  /** On-duty hours beyond the standard day (day-metered classes). */
  extraHours?: number;
  distanceKm?: number;
  passengers?: number;
  /** Optional fee component keys the customer opted into. */
  feeKeys?: string[];
  /** Included kilometres before metering (defaults to the admin allowance). */
  includedKm?: number;
  /** Mission date — drives weekend and holiday multipliers. */
  date?: string | Date;
  /** Administrator-declared peak calendar window. */
  peak?: boolean;
  /** Live demand index, 0 (soft) … 1 (fully booked). */
  demandIndex?: number;
  corporate?: boolean;
  contractDiscountPct?: number;
  longTermDiscountPct?: number;
  /** Explicit seasonal adjustment, % (overrides calendar multipliers). */
  seasonalAdjustmentPct?: number;
  /** Band override used by the road adapter (vehicle-specific band). */
  band?: [number, number];
  perKmKes?: number;
  extraHourKes?: number;
  config?: AssetPricingConfig;
}

export interface QuoteLine { key: string; label: string; amountKes: number; reason: string }

export interface PolymorphicQuote {
  assetClass: AssetClass;
  profile: AssetPricingProfile;
  admin: AssetProfileConfig;
  /** Terminology resolved from the asset class, never from the page. */
  terminology: { assetNoun: string; crewNoun: string; feeBundleLabel: string; basis: AssetPricingProfile["basis"] };
  lines: QuoteLine[];
  baseRateKes: number;
  baseClamped: boolean;
  operatorCostKes: number;
  discountKes: number;
  discountPct: number;
  platformFeeKes: number;
  vatKes: number;
  totalKes: number;
  perSeatKes: number;
  /** Every multiplier / discount applied, for provenance panels and exports. */
  factors: Array<{ label: string; effect: string; reason: string }>;
}

const r = (n: number) => Math.round(n);

const KE_HOLIDAYS = new Set([
  "01-01", "05-01", "06-01", "10-10", "10-20", "12-12", "12-25", "12-26",
]);

export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
export const isKenyanHoliday = (d: Date) =>
  KE_HOLIDAYS.has(`${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);

function feeQuantity(fee: FeeComponent, ctx: { days: number; nights: number; pax: number; km: number; hours: number }): number {
  switch (fee.unit) {
    case "per_day": return ctx.days;
    case "per_night": return ctx.nights;
    case "per_km": return ctx.km;
    case "per_passenger": return ctx.pax;
    case "per_hour": return ctx.hours;
    case "per_movement": return 2 * Math.max(1, Math.ceil(ctx.days / 2));
    default: return 1;
  }
}

/**
 * Price = Base (band-governed) + Distance/Hours + Class fee components
 *         ± Calendar & demand multipliers − Corporate/contract/long-haul
 *         discounts + Marketplace commission + VAT
 */
export function computePolymorphicQuote(input: PolymorphicQuoteInput): PolymorphicQuote {
  const config = input.config ?? activeAssetPricingConfig();
  const profile = pricingProfile(input.assetClass);
  const admin = assetProfileConfig(input.assetClass, config);

  const [bandMin, bandMax] = input.band ?? [admin.minKes, admin.maxKes];
  const requested = input.baseDayKes ?? operatorDayRate(input.assetClass, input.operatorId, config).rateKes;
  const baseRateKes = Math.min(bandMax, Math.max(bandMin, requested));
  const baseClamped = baseRateKes !== requested;

  const hourlyOnly = admin.hourly.enabled && !!input.hours && (input.days ?? 0) <= 0;
  const days = hourlyOnly ? 0 : Math.max(1, input.days || 1);
  const billableHours = hourlyOnly ? Math.max(admin.hourly.minimumHours, input.hours ?? 0) : (input.hours ?? 0);
  const nights = Math.max(0, input.nights ?? Math.max(0, days - 1));
  const pax = Math.max(1, input.passengers ?? input.seats ?? 1);
  const km = Math.max(0, input.distanceKm ?? 0);
  const perKm = input.perKmKes ?? admin.perKmKes;
  const includedKm = input.includedKm ?? admin.includedKmPerDay * Math.max(days, 1);
  const meteredKm = Math.max(0, km - includedKm);

  const lines: QuoteLine[] = [];
  const label = input.assetLabel ?? profile.label;

  if (hourlyOnly) {
    const hourly = r((baseRateKes * admin.hourly.hourlyRatePctOfDay) / 100);
    lines.push({
      key: "base_hourly",
      label: `${label} hourly hire`,
      amountKes: r(hourly * billableHours),
      reason: `${billableHours} billable hour(s) at ${admin.hourly.hourlyRatePctOfDay}% of the governed day rate (minimum ${admin.hourly.minimumHours}h)`,
    });
  } else {
    lines.push({
      key: "base",
      label: `${label} base rate`,
      amountKes: r(baseRateKes * days),
      reason: `${days} ${profile.basis === "block_hour" ? "operating" : "operating"} day(s) · governed band KSh ${bandMin.toLocaleString()}–${bandMax.toLocaleString()}`,
    });
  }

  if (meteredKm > 0 && perKm > 0) {
    const taper = km >= admin.longDistance.thresholdKm ? admin.longDistance.taperPct : 0;
    const gross = meteredKm * perKm;
    lines.push({
      key: "distance",
      label: "Distance charge",
      amountKes: r(gross * (1 - taper / 100)),
      reason: taper
        ? `${r(meteredKm)} km beyond ${r(includedKm)} km included, tapered ${taper}% above ${admin.longDistance.thresholdKm} km`
        : `${r(meteredKm)} km beyond the ${r(includedKm)} km included`,
    });
  }

  if (!hourlyOnly && input.extraHours) {
    const extraHourKes = input.extraHourKes ?? r((baseRateKes * admin.hourly.hourlyRatePctOfDay) / 100);
    lines.push({
      key: "extra_hours",
      label: "Extra on-duty hours",
      amountKes: r(input.extraHours * extraHourKes),
      reason: `${input.extraHours} hour(s) beyond the standard duty day`,
    });
  }

  const selected = new Set(input.feeKeys ?? []);
  const feeCtx = { days: Math.max(days, hourlyOnly ? 1 : days), nights, pax, km, hours: hourlyOnly ? billableHours : (input.extraHours ?? billableHours) };
  for (const fee of profile.fees) {
    if (fee.optional && !selected.has(fee.key)) continue;
    const amount = r(fee.defaultKes * feeQuantity(fee, feeCtx));
    if (amount > 0) {
      lines.push({ key: fee.key, label: fee.label, amountKes: amount, reason: `${fee.unit.replace(/_/g, " ")} × ${r(feeQuantity(fee, feeCtx))}` });
    }
  }

  /* Calendar, peak and demand multipliers ---------------------------- */
  const factors: Array<{ label: string; effect: string; reason: string }> = [];
  let uplift = 0;
  if (input.seasonalAdjustmentPct !== undefined) {
    uplift = input.seasonalAdjustmentPct;
    if (uplift) factors.push({ label: uplift > 0 ? "Seasonal adjustment" : "Off-peak adjustment", effect: `${uplift > 0 ? "+" : ""}${uplift}%`, reason: "Administrator seasonal band" });
  } else {
    const when = input.date ? new Date(input.date) : null;
    const add = (m: number, label: string, reason: string) => {
      const pct = r((m - 1) * 100);
      if (!pct) return;
      uplift += pct;
      factors.push({ label, effect: `${pct > 0 ? "+" : ""}${pct}%`, reason });
    };
    if (when && !Number.isNaN(when.getTime())) {
      if (isKenyanHoliday(when)) add(admin.holidayMultiplier, "Public holiday", "Mission date falls on a Kenyan public holiday");
      else if (isWeekend(when)) add(admin.weekendMultiplier, "Weekend", "Mission date falls on a weekend");
    }
    if (input.peak) add(admin.peakMultiplier, "Peak window", "Administrator-declared peak calendar window");
    if (input.demandIndex && input.demandIndex > 0) {
      const idx = Math.min(1, input.demandIndex);
      add(1 + (admin.maxDemandMultiplier - 1) * idx, "Live demand", `Utilisation index ${Math.round(idx * 100)}% of the demand ceiling`);
    }
  }

  const subtotal = lines.reduce((s, l) => s + l.amountKes, 0);
  const upliftKes = r((subtotal * uplift) / 100);
  if (upliftKes !== 0) {
    lines.push({
      key: "demand_adjustment",
      label: upliftKes > 0 ? "Calendar & demand adjustment" : "Off-peak adjustment",
      amountKes: upliftKes,
      reason: factors.map((f) => `${f.label} ${f.effect}`).join(" · ") || `${uplift}%`,
    });
  }

  /* Discounts -------------------------------------------------------- */
  const gross = subtotal + upliftKes;
  let discountPct = Math.max(0, (input.contractDiscountPct ?? 0) + (input.longTermDiscountPct ?? 0));
  if (input.contractDiscountPct) factors.push({ label: "Contract discount", effect: `−${input.contractDiscountPct}%`, reason: "Negotiated segment agreement" });
  if (input.longTermDiscountPct) factors.push({ label: "Long-term hire", effect: `−${input.longTermDiscountPct}%`, reason: "Extended hire duration" });
  if (input.corporate) {
    discountPct += admin.corporateDiscountPct;
    factors.push({ label: "Corporate account", effect: `−${admin.corporateDiscountPct}%`, reason: "Corporate framework agreement rate" });
  }
  const discountKes = r((gross * discountPct) / 100);
  const operatorCostKes = Math.max(0, gross - discountKes);
  const platformFeeKes = r((operatorCostKes * admin.platformFeePct) / 100);
  const vatKes = r(((operatorCostKes + platformFeeKes) * admin.vatPct) / 100);
  const totalKes = operatorCostKes + platformFeeKes + vatKes;

  return {
    assetClass: input.assetClass,
    profile,
    admin,
    terminology: {
      assetNoun: profile.assetNoun,
      crewNoun: profile.crewNoun,
      feeBundleLabel: feeBundleLabel(input.assetClass),
      basis: profile.basis,
    },
    lines,
    baseRateKes,
    baseClamped,
    operatorCostKes,
    discountKes,
    discountPct,
    platformFeeKes,
    vatKes,
    totalKes,
    perSeatKes: r(totalKes / Math.max(1, input.seats ?? pax)),
    factors,
  };
}
