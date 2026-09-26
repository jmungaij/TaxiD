/**
 * Yalla Mobility — transparent bus/van/coach charter pricing engine.
 *
 * The Nairobi charter market prices by manual quotation: opaque, inconsistent
 * and slow. Yalla competes on *instant, explainable* pricing instead of being
 * the cheapest. Every number this engine produces carries a human-readable
 * reason so the customer never has to ask how the price was calculated.
 *
 *   Final Price = Base Vehicle Rate
 *               + Distance Charge
 *               + Time Charge
 *               + Operational Costs
 *               + Optional Services
 *               + Platform Fee
 *               - Eligible Discounts
 *               ± AI Demand Adjustment (capped)
 *               + Taxes
 *
 * All amounts are whole Kenyan Shillings.
 */

export type BusVehicleClass =
  | "seater_14_25"
  | "seater_28_33"
  | "seater_40_44"
  | "seater_45_51_executive"
  | "luxury_coach"
  | "van_7_13"
  | "double_deck";

export interface BusVehicleClassSpec {
  key: BusVehicleClass;
  label: string;
  minSeats: number;
  maxSeats: number;
  /** Marketplace default base rate per day (KES), operator-adjustable. */
  baseRateKes: number;
  /** Operators may move the base rate within these admin-defined limits. */
  minRateKes: number;
  maxRateKes: number;
  perKmKes: number;
  extraHourKes: number;
}

/**
 * Marketplace defaults benchmarked against publicly advertised Nairobi charter
 * rates: 10-seater vans ~KES 8k–15k/day, 14-seater shuttles ~KES 10k–18k,
 * 18–25 minibuses ~KES 15k–25k, 28–33 coaches ~KES 22k–35k, 45–49 executive
 * coaches ~KES 30k–45k, 51–53 ~KES 35k–50k, 62 ~KES 40k–60k and 67–72 double
 * deckers ~KES 55k–85k. Yalla is the marketplace, not the operator, so base
 * rates are set for conversion while operators keep margin inside the band.
 */
export const BUS_VEHICLE_CLASSES: BusVehicleClassSpec[] = [
  { key: "van_7_13", label: "7–13 seater van / shuttle", minSeats: 1, maxSeats: 13, baseRateKes: 12_000, minRateKes: 8_000, maxRateKes: 18_000, perKmKes: 72, extraHourKes: 1_300 },
  { key: "seater_14_25", label: "14–25 seater shuttle / minibus", minSeats: 14, maxSeats: 25, baseRateKes: 15_000, minRateKes: 10_000, maxRateKes: 25_000, perKmKes: 85, extraHourKes: 1_600 },
  { key: "seater_28_33", label: "28–33 seater coach", minSeats: 26, maxSeats: 33, baseRateKes: 24_000, minRateKes: 20_000, maxRateKes: 35_000, perKmKes: 100, extraHourKes: 2_300 },
  { key: "seater_40_44", label: "40–44 seater coach", minSeats: 34, maxSeats: 44, baseRateKes: 30_000, minRateKes: 25_000, maxRateKes: 42_000, perKmKes: 118, extraHourKes: 2_800 },
  { key: "seater_45_51_executive", label: "45–51 seater executive coach", minSeats: 45, maxSeats: 51, baseRateKes: 38_000, minRateKes: 30_000, maxRateKes: 50_000, perKmKes: 130, extraHourKes: 3_200 },
  { key: "luxury_coach", label: "52–66 seater executive coach", minSeats: 52, maxSeats: 66, baseRateKes: 48_000, minRateKes: 35_000, maxRateKes: 62_000, perKmKes: 152, extraHourKes: 3_800 },
  { key: "double_deck", label: "67–72 seater double decker", minSeats: 67, maxSeats: 80, baseRateKes: 65_000, minRateKes: 55_000, maxRateKes: 85_000, perKmKes: 175, extraHourKes: 4_600 },
];

export function classForSeats(seats: number): BusVehicleClassSpec {
  return (
    BUS_VEHICLE_CLASSES.find((c) => seats >= c.minSeats && seats <= c.maxSeats) ??
    (seats < 14 ? BUS_VEHICLE_CLASSES[0] : BUS_VEHICLE_CLASSES[BUS_VEHICLE_CLASSES.length - 1])
  );
}

/** Distance and hours included in the base rate before metering kicks in. */
export const INCLUDED_KM = 100;
export const INCLUDED_HOURS = 10;

export type RentalTerm = "hourly" | "half_day" | "full_day" | "multi_day" | "monthly";

export const TERM_MULTIPLIER: Record<RentalTerm, number> = {
  hourly: 0.18,      // per hour of the daily base
  half_day: 0.6,
  full_day: 1,
  multi_day: 1,      // per day, with a long-hire discount applied separately
  monthly: 22,       // 30 calendar days billed as 22 operating days
};

export interface OperationalCostOption {
  key: string;
  label: string;
  amountKes: number;
  /** How the amount scales. */
  unit: "per_trip" | "per_day" | "per_night" | "per_km";
}

export const OPERATIONAL_COSTS: OperationalCostOption[] = [
  { key: "fuel_adjustment", label: "Fuel price adjustment", amountKes: 12, unit: "per_km" },
  { key: "driver_overnight", label: "Driver overnight allowance", amountKes: 2_500, unit: "per_night" },
  { key: "driver_accommodation", label: "Driver accommodation", amountKes: 3_500, unit: "per_night" },
  { key: "parking", label: "Parking charges", amountKes: 1_200, unit: "per_day" },
  { key: "tolls", label: "Toll charges", amountKes: 900, unit: "per_trip" },
  { key: "ferry", label: "Ferry charges", amountKes: 1_500, unit: "per_trip" },
  { key: "event_permit", label: "Event / county permit", amountKes: 6_000, unit: "per_trip" },
  { key: "security_escort", label: "Security escort", amountKes: 12_500, unit: "per_day" },
  { key: "cleaning", label: "Deep cleaning & sanitisation", amountKes: 2_000, unit: "per_trip" },
  { key: "standby", label: "Standby time", amountKes: 1_500, unit: "per_day" },
];

export interface OptionalServiceOption {
  key: string;
  label: string;
  amountKes: number;
  unit: "per_trip" | "per_day" | "per_seat";
}

export const OPTIONAL_SERVICES: OptionalServiceOption[] = [
  { key: "executive_host", label: "Executive onboard host", amountKes: 6_500, unit: "per_day" },
  { key: "tour_guide", label: "Licensed tour guide", amountKes: 7_500, unit: "per_day" },
  { key: "bottled_water", label: "Bottled water service", amountKes: 120, unit: "per_seat" },
  { key: "wifi", label: "Premium WiFi & entertainment", amountKes: 4_200, unit: "per_day" },
  { key: "refreshments", label: "Onboard refreshments", amountKes: 350, unit: "per_seat" },
  { key: "branded_bus", label: "Vehicle branding wrap", amountKes: 18_000, unit: "per_trip" },
  { key: "meet_and_greet", label: "Airport meet & greet", amountKes: 4_500, unit: "per_trip" },
  { key: "wheelchair", label: "Wheelchair accessibility", amountKes: 3_800, unit: "per_trip" },
  { key: "vip_seating", label: "VIP seating configuration", amountKes: 9_000, unit: "per_trip" },
];

export type CustomerSegment =
  | "retail"
  | "corporate"
  | "corporate_contract"
  | "government"
  | "ngo"
  | "education";

export interface SegmentRule {
  segment: CustomerSegment;
  label: string;
  /** Automatic discount, no negotiation required. */
  discountPct: number;
  /** Corporate segments are invoiced monthly instead of paying up front. */
  invoiceMonthly: boolean;
  note: string;
}

export const SEGMENT_RULES: Record<CustomerSegment, SegmentRule> = {
  retail: { segment: "retail", label: "Individual / retail", discountPct: 0, invoiceMonthly: false, note: "Standard published marketplace pricing." },
  corporate: { segment: "corporate", label: "Corporate account", discountPct: 7, invoiceMonthly: false, note: "Verified corporate account discount." },
  corporate_contract: { segment: "corporate_contract", label: "Corporate contract", discountPct: 15, invoiceMonthly: true, note: "Annual contract rate with consolidated monthly invoicing." },
  government: { segment: "government", label: "Government", discountPct: 10, invoiceMonthly: true, note: "Government framework pricing." },
  ngo: { segment: "ngo", label: "NGO / humanitarian", discountPct: 12, invoiceMonthly: true, note: "NGO relief pricing." },
  education: { segment: "education", label: "Educational institution", discountPct: 12, invoiceMonthly: true, note: "Schools and universities pricing." },
};

export type DemandLevel = "low" | "normal" | "high";

/** Controlled demand adjustment — never open-ended surge. */
export const DEMAND_ADJUSTMENT: Record<DemandLevel, { pct: number; label: string }> = {
  low: { pct: -6, label: "Low demand promotional adjustment" },
  normal: { pct: 0, label: "Standard demand — no adjustment" },
  high: { pct: 8, label: "High demand adjustment (capped)" },
};

/** Hard administrator cap on any demand adjustment, in percent. */
export const DEMAND_ADJUSTMENT_CAP_PCT = 10;

export const PLATFORM_FEE_PCT = 6;
export const VAT_PCT = 16;

export interface BusPricingInput {
  seats: number;
  passengers: number;
  term: RentalTerm;
  /** Days for full/multi-day and monthly terms. */
  days?: number;
  /** Hours for hourly/half-day terms, or total on-duty hours per day. */
  hours?: number;
  distanceKm: number;
  nights?: number;
  operationalCostKeys?: string[];
  optionalServiceKeys?: string[];
  segment?: CustomerSegment;
  demand?: DemandLevel;
  /** Number of trips per month for the volume discount ladder. */
  monthlyTripVolume?: number;
  /** Operator override of the class base rate, clamped to admin limits. */
  baseRateOverrideKes?: number;
}

export interface PriceLine {
  key: string;
  label: string;
  amountKes: number;
  /** Plain-language explanation shown to the customer. */
  reason: string;
}

export interface BusPriceBreakdown {
  vehicleClass: BusVehicleClassSpec;
  lines: PriceLine[];
  baseKes: number;
  distanceKes: number;
  timeKes: number;
  operationalKes: number;
  optionalKes: number;
  demandKes: number;
  subtotalKes: number;
  platformFeeKes: number;
  discountKes: number;
  discountPct: number;
  taxableKes: number;
  taxKes: number;
  totalKes: number;
  perSeatKes: number;
  perKmKes: number;
  invoiceMonthly: boolean;
  includedKm: number;
  includedHours: number;
  billableDays: number;
  cancellationPolicy: string;
}

const round = (n: number) => Math.max(0, Math.round(n));

/** Volume ladder — applied automatically, no manual negotiation. */
export function volumeDiscountPct(tripsPerMonth: number): number {
  if (tripsPerMonth >= 200) return 15;
  if (tripsPerMonth >= 100) return 12;
  if (tripsPerMonth >= 50) return 9;
  if (tripsPerMonth >= 20) return 6;
  if (tripsPerMonth >= 10) return 3;
  return 0;
}

/** Long-hire discount for multi-day and monthly commitments. */
export function durationDiscountPct(term: RentalTerm, days: number): number {
  if (term === "monthly") return 18;
  if (term !== "multi_day") return 0;
  if (days >= 21) return 14;
  if (days >= 14) return 11;
  if (days >= 7) return 8;
  if (days >= 3) return 4;
  return 0;
}

export function billableDaysFor(term: RentalTerm, days: number, hours: number): number {
  if (term === "monthly") return TERM_MULTIPLIER.monthly;
  if (term === "hourly") return Math.max(1, hours) * TERM_MULTIPLIER.hourly;
  if (term === "half_day") return TERM_MULTIPLIER.half_day;
  return Math.max(1, days);
}

export function computeBusPrice(input: BusPricingInput): BusPriceBreakdown {
  const spec = classForSeats(input.seats);
  const baseRate = Math.min(
    spec.maxRateKes,
    Math.max(spec.minRateKes, Math.round(input.baseRateOverrideKes ?? spec.baseRateKes)),
  );
  const days = Math.max(1, Math.round(input.days ?? 1));
  const hours = Math.max(1, Math.round(input.hours ?? INCLUDED_HOURS));
  const term = input.term;
  const distanceKm = Math.max(0, Math.round(input.distanceKm));
  const nights = Math.max(0, Math.round(input.nights ?? (term === "multi_day" ? days - 1 : 0)));
  const billableDays = billableDaysFor(term, days, hours);
  const segment = SEGMENT_RULES[input.segment ?? "retail"];
  const demand = DEMAND_ADJUSTMENT[input.demand ?? "normal"];

  const lines: PriceLine[] = [];

  // 1 — Base vehicle rate
  const baseKes = round(baseRate * billableDays);
  lines.push({
    key: "base",
    label: `Base vehicle rate — ${spec.label}`,
    amountKes: baseKes,
    reason:
      term === "hourly"
        ? `KES ${baseRate.toLocaleString("en-KE")}/day billed hourly for ${hours} hour${hours > 1 ? "s" : ""}.`
        : term === "monthly"
          ? `KES ${baseRate.toLocaleString("en-KE")}/day × 22 operating days in a monthly contract.`
          : `KES ${baseRate.toLocaleString("en-KE")} per day × ${billableDays} day${billableDays > 1 ? "s" : ""}, driver included.`,
  });

  // 2 — Distance component
  const includedKm = INCLUDED_KM * Math.max(1, Math.ceil(billableDays));
  const chargeableKm = Math.max(0, distanceKm - includedKm);
  const distanceKes = round(chargeableKm * spec.perKmKes);
  lines.push({
    key: "distance",
    label: "Distance charge",
    amountKes: distanceKes,
    reason: chargeableKm
      ? `${includedKm.toLocaleString("en-KE")} km included; ${chargeableKm.toLocaleString("en-KE")} extra km × KES ${spec.perKmKes}/km.`
      : `${distanceKm.toLocaleString("en-KE")} km is within the ${includedKm.toLocaleString("en-KE")} km included allowance.`,
  });

  // 3 — Time component
  const chargeableHours = term === "hourly" || term === "half_day" ? 0 : Math.max(0, hours - INCLUDED_HOURS) * days;
  const timeKes = round(chargeableHours * spec.extraHourKes);
  lines.push({
    key: "time",
    label: "Extra time charge",
    amountKes: timeKes,
    reason: chargeableHours
      ? `${INCLUDED_HOURS} hours/day included; ${chargeableHours} extra hour${chargeableHours > 1 ? "s" : ""} × KES ${spec.extraHourKes.toLocaleString("en-KE")}.`
      : `Within the ${INCLUDED_HOURS} hours/day included allowance.`,
  });

  // 4 — Operational costs
  let operationalKes = 0;
  for (const key of input.operationalCostKeys ?? []) {
    const opt = OPERATIONAL_COSTS.find((o) => o.key === key);
    if (!opt) continue;
    const qty =
      opt.unit === "per_km" ? distanceKm
        : opt.unit === "per_day" ? Math.ceil(billableDays)
          : opt.unit === "per_night" ? nights
            : 1;
    const amount = round(opt.amountKes * qty);
    operationalKes += amount;
    if (amount > 0) {
      lines.push({
        key: `op_${opt.key}`,
        label: opt.label,
        amountKes: amount,
        reason: `KES ${opt.amountKes.toLocaleString("en-KE")} ${opt.unit.replace(/_/g, " ")} × ${qty}.`,
      });
    }
  }

  // 5 — Optional services
  let optionalKes = 0;
  for (const key of input.optionalServiceKeys ?? []) {
    const opt = OPTIONAL_SERVICES.find((o) => o.key === key);
    if (!opt) continue;
    const qty =
      opt.unit === "per_seat" ? Math.max(1, input.passengers)
        : opt.unit === "per_day" ? Math.ceil(billableDays)
          : 1;
    const amount = round(opt.amountKes * qty);
    optionalKes += amount;
    lines.push({
      key: `svc_${opt.key}`,
      label: opt.label,
      amountKes: amount,
      reason: `KES ${opt.amountKes.toLocaleString("en-KE")} ${opt.unit.replace(/_/g, " ")} × ${qty}.`,
    });
  }

  // 6 — AI demand adjustment (capped both ways)
  const demandPct = Math.max(-DEMAND_ADJUSTMENT_CAP_PCT, Math.min(DEMAND_ADJUSTMENT_CAP_PCT, demand.pct));
  const preDemand = baseKes + distanceKes + timeKes + operationalKes + optionalKes;
  const demandKes = Math.round((preDemand * demandPct) / 100);
  if (demandKes !== 0) {
    lines.push({
      key: "demand",
      label: demand.label,
      amountKes: demandKes,
      reason: `${demandPct > 0 ? "+" : ""}${demandPct}% controlled adjustment, capped at ±${DEMAND_ADJUSTMENT_CAP_PCT}% by policy.`,
    });
  }

  const subtotalKes = preDemand + demandKes;

  // 7 — Platform fee
  const platformFeeKes = round((subtotalKes * PLATFORM_FEE_PCT) / 100);
  lines.push({
    key: "platform_fee",
    label: "Yalla platform fee",
    amountKes: platformFeeKes,
    reason: `${PLATFORM_FEE_PCT}% covers instant pricing, digital contract, payment, tracking and 24/7 support.`,
  });

  // 8 — Discounts
  const volPct = volumeDiscountPct(input.monthlyTripVolume ?? 0);
  const durPct = durationDiscountPct(term, days);
  const discountPct = Math.min(30, segment.discountPct + volPct + durPct);
  const discountKes = round(((subtotalKes + platformFeeKes) * discountPct) / 100);
  if (discountKes > 0) {
    lines.push({
      key: "discount",
      label: "Eligible discounts",
      amountKes: -discountKes,
      reason: [
        segment.discountPct ? `${segment.label} ${segment.discountPct}%` : null,
        volPct ? `volume ${volPct}% (${input.monthlyTripVolume} trips/month)` : null,
        durPct ? `long-hire ${durPct}%` : null,
      ].filter(Boolean).join(" + ") + " — applied automatically, no negotiation needed.",
    });
  }

  // 9 — Taxes
  const taxableKes = Math.max(0, subtotalKes + platformFeeKes - discountKes);
  const taxKes = round((taxableKes * VAT_PCT) / 100);
  lines.push({
    key: "vat",
    label: `VAT (${VAT_PCT}%)`,
    amountKes: taxKes,
    reason: "Kenya Revenue Authority VAT, itemised on your eTIMS-compliant invoice.",
  });

  const totalKes = taxableKes + taxKes;

  return {
    vehicleClass: spec,
    lines,
    baseKes,
    distanceKes,
    timeKes,
    operationalKes,
    optionalKes,
    demandKes,
    subtotalKes,
    platformFeeKes,
    discountKes,
    discountPct,
    taxableKes,
    taxKes,
    totalKes,
    perSeatKes: Math.round(totalKes / Math.max(1, input.passengers)),
    perKmKes: distanceKm > 0 ? Math.round(totalKes / distanceKm) : 0,
    invoiceMonthly: segment.invoiceMonthly,
    includedKm,
    includedHours: INCLUDED_HOURS,
    billableDays,
    cancellationPolicy:
      term === "monthly" || term === "multi_day"
        ? "Free cancellation up to 72 hours before departure; 25% thereafter."
        : "Free cancellation up to 24 hours before departure; 30% thereafter.",
  };
}

export const kes = (n: number) =>
  `${n < 0 ? "-" : ""}KES ${new Intl.NumberFormat("en-KE").format(Math.abs(Math.round(n)))}`;
