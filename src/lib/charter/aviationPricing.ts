/**
 * Yalla Air Dynamic Pricing Engine.
 *
 * Kenya's charter market still quotes manually (aircraft type, route, flight
 * hours, positioning, landing fees, crew). This engine inverts that model: the
 * operator declares *cost and minimum acceptable revenue*, and the platform
 * computes the selling price deterministically.
 *
 * Pure functions only — no React, no fetch — so the marketplace, the booking
 * workflow, the operator portal and the Pricing Control Center all price the
 * same way, and every rule is configurable rather than hard-coded.
 */
import { AIR_POINTS, resolvePoint, type AirPoint } from "./airports";

/* ------------------------------------------------------------------ */
/* Aircraft                                                            */
/* ------------------------------------------------------------------ */

export interface AircraftCategory {
  key: string;
  label: string;
  /** Operator-defined minimum commercial rate per flight hour (USD). */
  baseHourlyRate: number;
  cruiseKts: number;
  /** Taxi + apron time added to every sector, minutes. */
  taxiMinutes: number;
  seats: number;
  /** Typical fuel burn used by the fuel adjustment layer, USD/hour. */
  fuelPerHour: number;
  crewPerHour: number;
}

export const AIRCRAFT_CATEGORIES: AircraftCategory[] = [
  { key: "helicopter", label: "Helicopter", baseHourlyRate: 2400, cruiseKts: 120, taxiMinutes: 10, seats: 5, fuelPerHour: 620, crewPerHour: 220 },
  { key: "cessna_172", label: "Cessna 172", baseHourlyRate: 250, cruiseKts: 110, taxiMinutes: 10, seats: 3, fuelPerHour: 60, crewPerHour: 70 },
  { key: "cessna_206", label: "Cessna 206", baseHourlyRate: 900, cruiseKts: 140, taxiMinutes: 12, seats: 5, fuelPerHour: 210, crewPerHour: 120 },
  { key: "caravan_208b", label: "Caravan 208B", baseHourlyRate: 1500, cruiseKts: 175, taxiMinutes: 12, seats: 12, fuelPerHour: 340, crewPerHour: 160 },
  { key: "twin_otter", label: "Twin Otter", baseHourlyRate: 1900, cruiseKts: 160, taxiMinutes: 13, seats: 19, fuelPerHour: 430, crewPerHour: 200 },
  { key: "king_air_350", label: "King Air 350", baseHourlyRate: 2450, cruiseKts: 300, taxiMinutes: 14, seats: 9, fuelPerHour: 520, crewPerHour: 240 },
  { key: "light_jet", label: "Light Jet", baseHourlyRate: 3100, cruiseKts: 400, taxiMinutes: 15, seats: 6, fuelPerHour: 720, crewPerHour: 280 },
  { key: "midsize_jet", label: "Midsize Jet", baseHourlyRate: 5400, cruiseKts: 450, taxiMinutes: 15, seats: 9, fuelPerHour: 1050, crewPerHour: 340 },
  { key: "heavy_jet", label: "Heavy Jet", baseHourlyRate: 8200, cruiseKts: 480, taxiMinutes: 18, seats: 13, fuelPerHour: 1580, crewPerHour: 420 },
];

/**
 * Recommended commercial bands for the Kenyan marketplace (KES per flight
 * hour). These are configurable starting points for operator onboarding, not
 * official tariffs — operators may set any rate inside (or outside) the band.
 */
export const KES_RATE_BANDS: Record<string, { min: number; max: number }> = {
  cessna_172: { min: 25000, max: 40000 },
  cessna_206: { min: 45000, max: 70000 },
  caravan_208b: { min: 90000, max: 140000 },
  twin_otter: { min: 180000, max: 260000 },
  king_air_350: { min: 250000, max: 420000 },
  light_jet: { min: 500000, max: 800000 },
  midsize_jet: { min: 850000, max: 1400000 },
  heavy_jet: { min: 1600000, max: 2600000 },
  helicopter: { min: 180000, max: 350000 },
};

/** Demand tiers exposed to operators and the admin pricing console. */
export const DEMAND_TIERS = [
  { key: "normal", label: "Normal", multiplier: 1.0 },
  { key: "busy", label: "Busy", multiplier: 1.15 },
  { key: "high", label: "High demand", multiplier: 1.3 },
  { key: "peak", label: "Peak holiday", multiplier: 1.5 },
] as const;

export type DemandTier = (typeof DEMAND_TIERS)[number]["key"];

export const demandTierMultiplier = (tier?: DemandTier | null) =>
  DEMAND_TIERS.find((t) => t.key === tier)?.multiplier ?? 1;

export const aircraftByKey = (key: string) =>
  AIRCRAFT_CATEGORIES.find((a) => a.key === key) ?? AIRCRAFT_CATEGORIES[5];


/* ------------------------------------------------------------------ */
/* Airport charges                                                     */
/* ------------------------------------------------------------------ */

export interface AirportCharges {
  code: string;
  label: string;
  landingFee: number;
  parkingFee: number;
  /** Overnight parking, charged per night away from home base. */
  overnightParking: number;
  navigationFee: number;
  groundHandling: number;
  passengerCharge: number;
  securityCharge: number;
  nightSurcharge: number;
  internationalClearance: number;
  international: boolean;
}

const charges = (
  code: string, label: string, landing: number, ground: number, pax: number, intl = false,
): AirportCharges => ({
  code, label,
  landingFee: landing,
  parkingFee: Math.round(landing * 0.18),
  overnightParking: Math.round(landing * 0.45),
  navigationFee: Math.round(landing * 0.35),
  groundHandling: ground,
  passengerCharge: pax,
  securityCharge: Math.round(pax * 0.4),
  nightSurcharge: Math.round(landing * 0.5),
  internationalClearance: intl ? 240 : 0,
  international: intl,
});

/** Default, fully configurable airport charge table (USD). */
export const DEFAULT_AIRPORT_CHARGES: AirportCharges[] = [
  charges("WIL", "Wilson Airport", 120, 180, 22),
  charges("NBO", "JKIA Nairobi", 320, 420, 46, true),
  charges("MBA", "Mombasa (Moi Intl)", 240, 320, 38, true),
  charges("KIS", "Kisumu", 160, 210, 26),
  charges("MYD", "Malindi", 140, 190, 24),
  charges("UKA", "Ukunda (Diani)", 150, 200, 26),
  charges("MRE", "Maasai Mara", 110, 160, 20),
  charges("NYK", "Nanyuki", 115, 165, 20),
  charges("ASV", "Amboseli", 110, 160, 20),
  charges("LOK", "Lodwar", 130, 175, 22),
  charges("EBB", "Entebbe", 280, 360, 42, true),
  charges("KGL", "Kigali", 280, 360, 42, true),
  charges("JRO", "Kilimanjaro (Arusha)", 260, 340, 40, true),
];

export const DEFAULT_AIRPORT: AirportCharges = charges("XXX", "Unlisted airfield", 140, 200, 24);

export function chargesFor(table: AirportCharges[], code?: string | null): AirportCharges {
  if (!code) return DEFAULT_AIRPORT;
  return table.find((a) => a.code === code.toUpperCase()) ?? DEFAULT_AIRPORT;
}

/* ------------------------------------------------------------------ */
/* Global controls                                                     */
/* ------------------------------------------------------------------ */

export interface GlobalPricingControls {
  platformCommissionPct: number;
  paymentProcessingPct: number;
  technologyFee: number;
  premiumServicePct: number;
  minMarginPct: number;
  maxMarginPct: number;
  minBookingValue: number;
  maxBookingValue: number;
  weekendMultiplier: number;
  holidayMultiplier: number;
  nightMultiplier: number;
  fuelMultiplier: number;
  luxuryMultiplier: number;
  demandMultiplier: number;
  corporateDiscountPct: number;
  vipDiscountPct: number;
  loyaltyDiscountPct: number;
  emptyLegDiscountPct: number;
  /** Operator-configurable floor for empty-leg discounting (regulated 20–60%). */
  emptyLegMinDiscountPct: number;
  /** Operator-configurable ceiling for empty-leg discounting (regulated 20–60%). */
  emptyLegMaxDiscountPct: number;
  /** Share of any price above the operator minimum retained by the platform. */
  dynamicUpliftSharePct: number;
  cancellationFeePct: number;
  refundWindowHours: number;
  /** Hours before departure below which the late-cancellation fee applies. */
  lateCancellationHours: number;
  /** Fee charged for a late cancellation, % of the customer total. */
  lateCancellationFeePct: number;
  /** Fee retained on a no-show, % of the customer total. */
  noShowFeePct: number;
  /** Working days quoted to the customer for refund settlement. */
  refundProcessingDays: number;
  operatorPayoutDays: number;
  /** Applicable tax (VAT) on the customer-facing total, %. */
  vatPct: number;
  /** Indicative FX used to display KES totals alongside USD. */
  fxKesPerUsd: number;
}

/** Hard platform guardrail — empty-leg discounts may never leave this band. */
export const EMPTY_LEG_DISCOUNT_BAND = { min: 20, max: 60 } as const;

export const DEFAULT_GLOBAL_CONTROLS: GlobalPricingControls = {
  platformCommissionPct: 12,
  paymentProcessingPct: 2.9,
  technologyFee: 75,
  premiumServicePct: 0,
  minMarginPct: 8,
  maxMarginPct: 38,
  minBookingValue: 750,
  maxBookingValue: 250000,
  weekendMultiplier: 1.08,
  holidayMultiplier: 1.15,
  nightMultiplier: 1.12,
  fuelMultiplier: 1,
  luxuryMultiplier: 1,
  demandMultiplier: 1,
  corporateDiscountPct: 0,
  vipDiscountPct: 0,
  loyaltyDiscountPct: 0,
  emptyLegDiscountPct: 45,
  emptyLegMinDiscountPct: 20,
  emptyLegMaxDiscountPct: 60,
  dynamicUpliftSharePct: 50,
  cancellationFeePct: 15,
  refundWindowHours: 48,
  lateCancellationHours: 12,
  lateCancellationFeePct: 50,
  noShowFeePct: 100,
  refundProcessingDays: 7,
  operatorPayoutDays: 7,
  vatPct: 16,
  fxKesPerUsd: 129,
};

/* ------------------------------------------------------------------ */
/* Empty-leg discount governance                                       */
/* ------------------------------------------------------------------ */

export interface EmptyLegResolution {
  /** Discount actually applied after operator limits and the platform band. */
  pct: number;
  /** Effective floor after reconciling operator limits with the platform band. */
  minPct: number;
  /** Effective ceiling after reconciling operator limits with the platform band. */
  maxPct: number;
  /** The discount requested before clamping. */
  requestedPct: number;
  /** True when the request had to be clamped to stay inside the band. */
  clamped: boolean;
}

/**
 * Resolves the empty-leg discount for a booking.
 *
 * Operators may narrow the band (e.g. 25–40%) but can never escape the
 * platform-wide 20–60% guardrail, so marketplace pricing stays comparable.
 */
export function resolveEmptyLegDiscount(
  cfg: Pick<GlobalPricingControls, "emptyLegDiscountPct" | "emptyLegMinDiscountPct" | "emptyLegMaxDiscountPct">,
  operator?: { discountPct?: number; minPct?: number; maxPct?: number },
): EmptyLegResolution {
  const band = EMPTY_LEG_DISCOUNT_BAND;
  const minPct = Math.min(
    Math.max(operator?.minPct ?? cfg.emptyLegMinDiscountPct ?? band.min, band.min),
    band.max,
  );
  const maxPct = Math.max(
    Math.min(operator?.maxPct ?? cfg.emptyLegMaxDiscountPct ?? band.max, band.max),
    minPct,
  );
  const requestedPct = operator?.discountPct ?? cfg.emptyLegDiscountPct ?? band.min;
  const pct = Math.min(maxPct, Math.max(minPct, requestedPct));
  return { pct, minPct, maxPct, requestedPct, clamped: pct !== requestedPct };
}

/* ------------------------------------------------------------------ */
/* Cancellation & refund policy                                        */
/* ------------------------------------------------------------------ */

export interface CancellationTier {
  key: "flexible" | "standard" | "late" | "no_show";
  label: string;
  /** Notice window described to the customer. */
  window: string;
  feePct: number;
  feeAmount: number;
  refundAmount: number;
}

export interface CancellationPolicy {
  tiers: CancellationTier[];
  refundWindowHours: number;
  lateCancellationHours: number;
  refundProcessingDays: number;
  summary: string;
}

/** Builds the customer-facing cancellation / refund schedule for a total. */
export function computeCancellationPolicy(
  total: number,
  cfg: Partial<GlobalPricingControls> = {},
): CancellationPolicy {
  const c = { ...DEFAULT_GLOBAL_CONTROLS, ...cfg };
  const amount = Math.max(0, total);
  const tier = (
    key: CancellationTier["key"], label: string, window: string, feePct: number,
  ): CancellationTier => {
    const feeAmount = Math.round(amount * (feePct / 100) * 100) / 100;
    return { key, label, window, feePct, feeAmount, refundAmount: Math.round((amount - feeAmount) * 100) / 100 };
  };
  return {
    refundWindowHours: c.refundWindowHours,
    lateCancellationHours: c.lateCancellationHours,
    refundProcessingDays: c.refundProcessingDays,
    summary: `Cancel more than ${c.refundWindowHours}h before departure for a ${c.cancellationFeePct}% fee. Inside ${c.lateCancellationHours}h a ${c.lateCancellationFeePct}% fee applies. Refunds settle within ${c.refundProcessingDays} working days.`,
    tiers: [
      tier("flexible", "Free cancellation", `More than ${c.refundWindowHours * 2}h before departure`, 0),
      tier("standard", "Standard cancellation", `${c.lateCancellationHours}–${c.refundWindowHours * 2}h before departure`, c.cancellationFeePct),
      tier("late", "Late cancellation", `Within ${c.lateCancellationHours}h of departure`, c.lateCancellationFeePct),
      tier("no_show", "No-show", "After scheduled departure", c.noShowFeePct),
    ],
  };
}




/* ------------------------------------------------------------------ */
/* Flight time                                                         */
/* ------------------------------------------------------------------ */

const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in nautical miles. */
export function distanceNm(a: AirPoint, b: AirPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface FlightTimeInput {
  origin: string;
  destination: string;
  aircraft: AircraftCategory;
  roundTrip?: boolean;
  /** Where the aircraft currently sits — drives positioning + ferry legs. */
  homeBase?: string;
  /** Ground waiting time billed to the customer, hours. */
  waitingHours?: number;
}

export interface FlightTime {
  distanceNm: number;
  airborneHours: number;
  taxiHours: number;
  positioningHours: number;
  ferryHours: number;
  waitingHours: number;
  /** Total billable hours used by the base rate layer. */
  billableHours: number;
  resolved: boolean;
}

const hrs = (n: number) => Math.round(n * 100) / 100;

export function computeFlightTime(input: FlightTimeInput): FlightTime {
  const { aircraft, roundTrip = false, waitingHours = 0 } = input;
  const from = resolvePoint(input.origin);
  const to = resolvePoint(input.destination);
  const base = resolvePoint(input.homeBase ?? "WIL");
  const sectors = roundTrip ? 2 : 1;

  if (!from || !to) {
    // Unresolved geography still prices — fall back to a conservative sector.
    const airborne = 1 * sectors;
    const taxi = (aircraft.taxiMinutes / 60) * sectors;
    return {
      distanceNm: 0, airborneHours: hrs(airborne), taxiHours: hrs(taxi),
      positioningHours: 0, ferryHours: 0, waitingHours: hrs(waitingHours),
      billableHours: hrs(airborne + taxi + waitingHours), resolved: false,
    };
  }

  const dist = distanceNm(from, to);
  const airborne = (dist / aircraft.cruiseKts) * sectors;
  const taxi = (aircraft.taxiMinutes / 60) * sectors;

  // Positioning: fly the aircraft from its base to the departure point, and
  // ferry it home from the arrival point when the trip is one-way.
  const positioning = base && base.code !== from.code ? distanceNm(base, from) / aircraft.cruiseKts : 0;
  const ferry = !roundTrip && base && base.code !== to.code ? distanceNm(to, base) / aircraft.cruiseKts : 0;

  return {
    distanceNm: Math.round(dist),
    airborneHours: hrs(airborne),
    taxiHours: hrs(taxi),
    positioningHours: hrs(positioning),
    ferryHours: hrs(ferry),
    waitingHours: hrs(waitingHours),
    billableHours: hrs(airborne + taxi + positioning + ferry + waitingHours),
    resolved: true,
  };
}

/* ------------------------------------------------------------------ */
/* Price computation                                                   */
/* ------------------------------------------------------------------ */

export interface PriceInput {
  aircraftKey: string;
  origin: string;
  destination: string;
  passengers: number;
  roundTrip?: boolean;
  homeBase?: string;
  waitingHours?: number;
  nightsAway?: number;
  /** Operator override of the category base hourly rate. */
  operatorHourlyRate?: number;
  /** Operator's minimum acceptable revenue for the trip, USD. */
  operatorMinimumRevenue?: number;
  weekend?: boolean;
  holiday?: boolean;
  /** Marketplace demand tier (normal / busy / high / peak). */
  demandTier?: DemandTier;
  /** Operator-specific commission override, % (falls back to the global rate). */
  operatorCommissionPct?: number;
  /** Zero-rated / exempt sectors skip VAT. */
  taxExempt?: boolean;
  nightOps?: boolean;
  emptyLeg?: boolean;
  /** Operator-configurable empty-leg limits, clamped to the 20–60% platform band. */
  emptyLegLimits?: { discountPct?: number; minPct?: number; maxPct?: number };

  corporate?: boolean;
  vip?: boolean;
  loyalty?: boolean;
  premiumPackage?: boolean;
  controls?: Partial<GlobalPricingControls>;
  airportTable?: AirportCharges[];
}

export interface ChargeLine { label: string; amount: number }

export interface PriceBreakdown {
  time: FlightTime;
  aircraft: AircraftCategory;
  hourlyRate: number;
  /** Step 1+2 — base aircraft rate × billable flight time. */
  baseCost: number;
  /** Step 3 — operational charges, itemised. */
  operationalCharges: ChargeLine[];
  operationalTotal: number;
  fuelAdjustment: number;
  /** Demand / calendar multipliers applied. */
  multipliers: ChargeLine[];
  multiplierEffect: number;
  discounts: ChargeLine[];
  discountTotal: number;
  /** Step 4 — revenue layers. */
  operatorRevenue: number;
  platformCommission: number;
  paymentProcessing: number;
  technologyFee: number;
  premiumServiceFee: number;
  dynamicUpliftShare: number;
  /** Applicable taxes (VAT) on the customer-facing total. */
  taxes: number;
  customerPrice: number;
  /** Indicative customer total in KES at the configured FX rate. */
  customerPriceKes: number;
  platformRevenue: number;
  marginPct: number;
  demandTier: DemandTier;
  clamped: "min" | "max" | null;
  /** Empty-leg governance detail (null when the booking is not an empty leg). */
  emptyLeg: EmptyLegResolution | null;
  /** Cancellation / refund schedule attached to this price. */
  cancellationPolicy: CancellationPolicy;
  currency: "USD";
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function computeAviationPrice(input: PriceInput): PriceBreakdown {
  const cfg: GlobalPricingControls = { ...DEFAULT_GLOBAL_CONTROLS, ...(input.controls ?? {}) };
  const table = input.airportTable ?? DEFAULT_AIRPORT_CHARGES;
  const aircraft = aircraftByKey(input.aircraftKey);
  const hourlyRate = Math.max(0, input.operatorHourlyRate ?? aircraft.baseHourlyRate);
  const pax = Math.max(1, input.passengers || 1);
  const nights = Math.max(0, input.nightsAway ?? 0);

  const time = computeFlightTime({
    origin: input.origin,
    destination: input.destination,
    aircraft,
    roundTrip: input.roundTrip,
    homeBase: input.homeBase,
    waitingHours: input.waitingHours,
  });

  const baseCost = hourlyRate * time.billableHours;

  // Step 3 — operational charges from the configurable airport tables.
  const dep = chargesFor(table, resolvePoint(input.origin)?.code);
  const arr = chargesFor(table, resolvePoint(input.destination)?.code);
  const lines: ChargeLine[] = [
    { label: `Landing fees (${dep.code}/${arr.code})`, amount: dep.landingFee + arr.landingFee },
    { label: "Navigation fees", amount: dep.navigationFee + arr.navigationFee },
    { label: "Parking", amount: dep.parkingFee + arr.parkingFee },
    { label: "Ground handling", amount: dep.groundHandling + arr.groundHandling },
    { label: "Passenger & security charges", amount: (dep.passengerCharge + arr.passengerCharge + dep.securityCharge + arr.securityCharge) * pax },
  ];
  if (nights > 0) {
    lines.push({ label: `Overnight parking (${nights})`, amount: arr.overnightParking * nights });
    lines.push({ label: `Crew accommodation & transport (${nights})`, amount: (180 + 60) * nights });
  }
  if (dep.international || arr.international) {
    lines.push({
      label: "International permits, customs & immigration",
      amount: dep.internationalClearance + arr.internationalClearance,
    });
  }
  if (input.nightOps) lines.push({ label: "Night operations surcharge", amount: dep.nightSurcharge + arr.nightSurcharge });

  const crewCost = aircraft.crewPerHour * time.billableHours;
  lines.push({ label: "Crew duty", amount: r2(crewCost) });

  const fuelAdjustment = r2(aircraft.fuelPerHour * time.billableHours * (cfg.fuelMultiplier - 1));
  if (fuelAdjustment !== 0) lines.push({ label: "Fuel adjustment", amount: fuelAdjustment });

  const operationalTotal = r2(lines.reduce((s, l) => s + l.amount, 0));

  // Multipliers.
  const multipliers: ChargeLine[] = [];
  let effect = 1;
  const apply = (label: string, m: number) => {
    if (m && m !== 1) { multipliers.push({ label, amount: m }); effect *= m; }
  };
  const demandTier: DemandTier = input.demandTier ?? "normal";
  apply("Demand", cfg.demandMultiplier);
  apply(`Demand tier — ${DEMAND_TIERS.find((t) => t.key === demandTier)?.label}`, demandTierMultiplier(demandTier));
  if (input.weekend) apply("Weekend", cfg.weekendMultiplier);
  if (input.holiday) apply("Holiday", cfg.holidayMultiplier);
  if (input.nightOps) apply("Night operations", cfg.nightMultiplier);
  if (input.premiumPackage) apply("Luxury package", cfg.luxuryMultiplier);

  const preDiscount = (baseCost + operationalTotal) * effect;

  // Discounts (additive, capped).
  const discounts: ChargeLine[] = [];
  let discountPct = 0;
  const disc = (label: string, pct: number) => {
    if (pct > 0) { discounts.push({ label, amount: pct }); discountPct += pct; }
  };
  const emptyLeg = input.emptyLeg ? resolveEmptyLegDiscount(cfg, input.emptyLegLimits) : null;
  if (emptyLeg) disc("Empty-leg", emptyLeg.pct);
  if (input.corporate) disc("Corporate", cfg.corporateDiscountPct);
  if (input.vip) disc("VIP", cfg.vipDiscountPct);
  if (input.loyalty) disc("Loyalty", cfg.loyaltyDiscountPct);
  discountPct = clamp(discountPct, 0, 90);
  const discountTotal = r2(preDiscount * (discountPct / 100));

  // Step 4 — revenue layers stacked on the operator's revenue.
  let operatorRevenue = r2(preDiscount - discountTotal);
  if (input.operatorMinimumRevenue && operatorRevenue < input.operatorMinimumRevenue) {
    operatorRevenue = r2(input.operatorMinimumRevenue);
  }

  // Dynamic pricing revenue: uplift above the operator minimum is shared.
  const uplift = input.operatorMinimumRevenue
    ? Math.max(0, operatorRevenue - input.operatorMinimumRevenue)
    : 0;
  const dynamicUpliftShare = r2(uplift * (cfg.dynamicUpliftSharePct / 100));

  const commissionPct = input.operatorCommissionPct ?? cfg.platformCommissionPct;
  let commission = r2(operatorRevenue * (commissionPct / 100));
  const marginFloor = r2(operatorRevenue * (cfg.minMarginPct / 100));
  const marginCeiling = r2(operatorRevenue * (cfg.maxMarginPct / 100));
  commission = clamp(commission, marginFloor, marginCeiling);

  const premiumServiceFee = r2(operatorRevenue * (cfg.premiumServicePct / 100));
  const technologyFee = cfg.technologyFee;
  const subtotal = operatorRevenue + commission + technologyFee + premiumServiceFee + dynamicUpliftShare;
  const paymentProcessing = r2(subtotal * (cfg.paymentProcessingPct / 100));

  const taxable = subtotal + paymentProcessing;
  const taxes = input.taxExempt ? 0 : r2(taxable * (cfg.vatPct / 100));
  let customerPrice = r2(taxable + taxes);
  let clamped: "min" | "max" | null = null;
  if (customerPrice < cfg.minBookingValue) { customerPrice = cfg.minBookingValue; clamped = "min"; }
  if (customerPrice > cfg.maxBookingValue) { customerPrice = cfg.maxBookingValue; clamped = "max"; }

  const platformRevenue = r2(customerPrice - operatorRevenue);

  return {
    time,
    aircraft,
    hourlyRate,
    baseCost: r2(baseCost),
    operationalCharges: lines.map((l) => ({ ...l, amount: r2(l.amount) })),
    operationalTotal,
    fuelAdjustment,
    taxes,
    demandTier,
    multipliers,
    multiplierEffect: Number(effect.toFixed(4)),
    discounts,
    discountTotal,
    operatorRevenue,
    platformCommission: commission,
    paymentProcessing,
    technologyFee,
    premiumServiceFee,
    dynamicUpliftShare,
    customerPrice,
    platformRevenue,
    customerPriceKes: Math.round(customerPrice * cfg.fxKesPerUsd),
    marginPct: customerPrice > 0 ? Math.round((platformRevenue / customerPrice) * 1000) / 10 : 0,
    clamped,
    emptyLeg,
    cancellationPolicy: computeCancellationPolicy(customerPrice, cfg),
    currency: "USD",
  };
}

/* ------------------------------------------------------------------ */
/* Route intelligence                                                  */
/* ------------------------------------------------------------------ */

export interface RouteDefinition { origin: string; destination: string }

/** Kenya's highest-demand charter corridors — seeds the route intelligence grid. */
export const CORE_ROUTES: RouteDefinition[] = [
  { origin: "WIL", destination: "MRE" },
  { origin: "WIL", destination: "ASV" },
  { origin: "WIL", destination: "UKA" },
  { origin: "WIL", destination: "NYK" },
  { origin: "WIL", destination: "KIS" },
  { origin: "WIL", destination: "MBA" },
  { origin: "WIL", destination: "LOK" },
  { origin: "NBO", destination: "EBB" },
  { origin: "NBO", destination: "KGL" },
  { origin: "NBO", destination: "JRO" },
];

export interface RoutePriceSummary extends RouteDefinition {
  originLabel: string;
  destinationLabel: string;
  distanceNm: number;
  blockHours: number;
  indicativePrice: number;
  perSeat: number;
  emptyLegPrice: number;
}

/** Indicative pricing for the core route grid — powers the demand board. */
export function priceRouteGrid(
  aircraftKey: string,
  controls?: Partial<GlobalPricingControls>,
  airportTable?: AirportCharges[],
  routes: RouteDefinition[] = CORE_ROUTES,
): RoutePriceSummary[] {
  const aircraft = aircraftByKey(aircraftKey);
  return routes.map((route) => {
    const base = { ...route, controls, airportTable, aircraftKey, passengers: aircraft.seats };
    const full = computeAviationPrice(base);
    const empty = computeAviationPrice({ ...base, emptyLeg: true });
    return {
      ...route,
      originLabel: AIR_POINTS.find((p) => p.code === route.origin)?.name ?? route.origin,
      destinationLabel: AIR_POINTS.find((p) => p.code === route.destination)?.name ?? route.destination,
      distanceNm: full.time.distanceNm,
      blockHours: full.time.billableHours,
      indicativePrice: full.customerPrice,
      perSeat: r2(full.customerPrice / Math.max(1, aircraft.seats)),
      emptyLegPrice: empty.customerPrice,
    };
  });
}
