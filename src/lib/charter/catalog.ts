/**
 * Charter, Leasing & Rentals catalog — single registry powering the header
 * mega-menu, the hub landing page, every category page, the inventory grids
 * and the shared pricing engine. No per-category components or duplicate
 * pricing logic: everything composes from this registry.
 */

import { ROAD_FLEET, type AssetClass, type RoadFleetGroup } from "./assetPricingProfiles";

export type CharterGroupKey = "chartered" | "leasing" | "rentals";

export type RateUnit = "flight-hour" | "day" | "week" | "month" | "event";

export interface CharterInventoryItem {
  name: string;
  spec: string;
  capacity: string;
  /** Base rate expressed in the category's rate unit, in the category currency. */
  rate: number;
  /**
   * Administrator-configured marketplace band `[min, max]` in the category
   * currency. Present for market-benchmarked fleets, where the customer sees a
   * transparent "from" price instead of a single fabricated figure.
   */
  rateBand?: [number, number];
  status: "available" | "limited" | "on-request";
  /** Optional discounted repositioning / empty-leg style offer. */
  offer?: { label: string; discountPct: number };
}

export interface PricingControl {
  id: string;
  label: string;
  /** Multiplier applied to the base rate when the control is active. */
  multiplier: number;
  hint: string;
}

export interface CharterCategory {
  slug: string;
  group: CharterGroupKey;
  label: string;
  menuDesc: string;
  headline: string;
  subhead: string;
  icon: string;
  rateUnit: RateUnit;
  currency: "USD" | "KES";
  /** Default duration in rate units used by the estimator. */
  defaultDuration: number;
  /** Target gross margin used by the revenue estimate, 0-1. */
  targetMargin: number;
  /** Volume discount tiers: [minDuration, discountPct]. */
  volumeTiers: Array<[number, number]>;
  controls: PricingControl[];
  inventory: CharterInventoryItem[];
  workflow: string[];
  /** Category-specific operator cost defaults, in the category currency. */
  costDefaults?: Partial<CostSettings>;
}

export const CHARTER_GROUPS: Array<{ key: CharterGroupKey; title: string; blurb: string }> = [
  { key: "chartered", title: "Charter Business", blurb: "Air, road and marine charter booked end to end — one marketplace, one invoice." },
  { key: "leasing", title: "Leasing", blurb: "Short and long-term lease agreements for aircraft, machinery and haulage." },
  { key: "rentals", title: "Rentals", blurb: "Cars, equipment and event assets on flexible short-term terms." },
];

/**
 * Asset class per category. Drives customer-facing fee terminology so road,
 * marine and equipment quotes never display aviation charges.
 */
const CATEGORY_ASSET_CLASS: Record<string, AssetClass> = {
  "aircraft-charter": "aircraft",
  "helicopter-charter": "helicopter",
  "bus-charter": "coach",
  "marine-charter": "yacht",
  "aircraft-leasing": "aircraft",
  "heavy-machinery-leasing": "equipment",
  "truck-hauler-leasing": "truck",
  "car-rentals": "car",
  "equipment-rentals": "equipment",
  "event-rentals": "equipment",
};

export const categoryAssetClass = (category: Pick<CharterCategory, "slug">): AssetClass =>
  CATEGORY_ASSET_CLASS[category.slug] ?? "bus";

/** Marketing copy per road fleet group — no prices are hard-coded here. */
const ROAD_GROUP_SPEC: Record<RoadFleetGroup, string> = {
  van: "Chauffeur driven · A/C · Luggage space",
  shuttle: "Corporate shuttle spec · Telematics fitted",
  minibus: "Luggage hold · PA system · Reclining seats",
  coach: "Reclining seats · WiFi · Onboard washroom",
  double_deck: "Panoramic deck · PA & lighting · Branding ready",
  tourism: "Game-drive spec · Pop-up roof · Guide seat",
  school: "Safety certified · Seat belts · Speed limited",
};

/**
 * Bus, van and coach inventory is generated from the administrator-controlled
 * Nairobi market bands in `ROAD_FLEET` — there are no hard-coded marketplace
 * prices on this surface, and every rate stays inside its governed band.
 */
const ROAD_INVENTORY: CharterInventoryItem[] = ROAD_FLEET.map((v) => ({
  name: `${v.label} ${v.seats}`,
  spec: ROAD_GROUP_SPEC[v.group],
  capacity: `${v.seats} seats`,
  rate: v.baseKes,
  rateBand: [v.minKes, v.maxKes] as [number, number],
  status: "available" as const,
}));

const STANDARD_CONTROLS: PricingControl[] = [
  { id: "peak", label: "Peak season", multiplier: 1.18, hint: "Applied on high-demand calendar windows" },
  { id: "urgent", label: "Under 48h notice", multiplier: 1.12, hint: "Expedited crew, logistics and clearance" },
  { id: "corporate", label: "Corporate contract", multiplier: 0.92, hint: "Negotiated framework agreement rate" },
];

export const CHARTER_CATALOG: CharterCategory[] = [
  {
    slug: "aircraft-charter",
    group: "chartered",
    label: "Private Aircraft Charter",
    menuDesc: "Private jets, turboprops and fixed-wing",
    headline: "Private aviation, chartered on your schedule.",
    subhead: "Jets, turboprops and helicopters from vetted operators with live availability, transparent quotes and empty-leg pricing.",
    icon: "Plane",
    rateUnit: "flight-hour",
    currency: "USD",
    defaultDuration: 4,
    targetMargin: 0.24,
    volumeTiers: [[10, 6], [25, 11], [50, 16]],
    controls: [
      ...STANDARD_CONTROLS,
      { id: "empty-leg", label: "Empty-leg match", multiplier: 0.6, hint: "Repositioning flight on your route window" },
    ],
    inventory: [
      { name: "Gulfstream G650", spec: "7,500 nm · Mach 0.925 · Ultra long range", capacity: "14 passengers", rate: 12500, status: "available" },
      { name: "Bombardier Challenger 650", spec: "4,000 nm · Heavy jet", capacity: "12 passengers", rate: 8200, status: "available", offer: { label: "Nairobi → Dubai empty leg", discountPct: 40 } },
      { name: "Cessna Citation Latitude", spec: "2,700 nm · Midsize jet", capacity: "9 passengers", rate: 5400, status: "limited" },
      { name: "HondaJet Elite II", spec: "1,547 nm · Very light jet", capacity: "5 passengers", rate: 3100, status: "available" },
      { name: "Beechcraft King Air 350", spec: "1,800 nm · Turboprop", capacity: "9 passengers", rate: 2450, status: "available" },
      { name: "Airbus H145 Helicopter", spec: "351 nm · Twin-engine rotor", capacity: "8 passengers", rate: 4300, status: "on-request" },
    ],
    workflow: ["Search", "Aircraft selection", "Quote", "Passenger details", "Payment", "Confirmed", "Flight tracking"],
  },
  {
    slug: "helicopter-charter",
    group: "chartered",
    label: "Helicopter Charter",
    menuDesc: "City transfers, scenic tours and offshore lifts",
    headline: "Rotor-wing charter for transfers, tours and offshore work.",
    subhead: "Twin and single-engine helicopters for executive transfers, aerial survey, scenic flights, medical evacuation and offshore crew changes.",
    icon: "Fan",
    rateUnit: "flight-hour",
    currency: "USD",
    defaultDuration: 2,
    targetMargin: 0.25,
    volumeTiers: [[8, 6], [20, 11], [40, 16]],
    controls: STANDARD_CONTROLS,
    inventory: [
      { name: "Airbus H145", spec: "Twin-engine · IFR · VIP or EMS fit", capacity: "8 passengers", rate: 4300, status: "available" },
      { name: "Bell 407 GXi", spec: "Single-engine · Executive interior", capacity: "6 passengers", rate: 2650, status: "available" },
      { name: "Airbus H125 (AS350)", spec: "High-altitude · Sling & survey capable", capacity: "5 passengers", rate: 2100, status: "available" },
      { name: "Robinson R44 Raven II", spec: "Training, tours & short transfers", capacity: "3 passengers", rate: 950, status: "available" },
      { name: "Sikorsky S-76D", spec: "Offshore & VIP long-range rotor", capacity: "12 passengers", rate: 6100, status: "on-request" },
    ],
    workflow: ["Enquiry", "Aircraft & helipad match", "Quote", "Manifest & weights", "Payment", "Confirmed", "Flight tracking"],
  },
  {
    slug: "bus-charter",
    group: "chartered",
    label: "Bus, Van & Coach Charter",
    menuDesc: "Tourism, schools, corporate, events and VIP shuttles",
    headline: "Group transport chartered for tours, schools and corporates.",
    subhead: "Coaches, minibuses and executive shuttles with vetted drivers, live tracking and single-invoice billing.",
    icon: "Bus",
    rateUnit: "day",
    currency: "KES",
    defaultDuration: 3,
    targetMargin: 0.21,
    volumeTiers: [[7, 8], [14, 13], [30, 18]],
    controls: STANDARD_CONTROLS,
    inventory: ROAD_INVENTORY,
    costDefaults: {
      // Nairobi road transport cost drivers, KES.
      fuelPrice: 190,   // diesel per litre
      fuelBurn: 38,     // litres per operating day on a typical charter duty
      airportFees: 3700, // parking, cleaning & venue access (road fees only)
      crewCost: 3500,   // driver day rate + overnight allowance provision
      demandIndex: 1,
      seasonIndex: 1,
      emptyLegDiscountPct: 0,
    },
    workflow: ["Request", "Vehicle allocation", "Quote", "Manifest", "Payment", "Dispatch", "Live tracking"],
  },
  {
    slug: "marine-charter",
    group: "chartered",
    label: "Boat & Ship Charter",
    menuDesc: "Yachts, ferries, dhows and cargo vessels",
    headline: "Yacht, ferry and cargo vessel charters.",
    subhead: "Coastal leisure charters and commercial marine capacity with certified crews and port clearance handled.",
    icon: "Ship",
    rateUnit: "day",
    currency: "USD",
    defaultDuration: 2,
    targetMargin: 0.26,
    volumeTiers: [[5, 7], [12, 12], [30, 17]],
    controls: STANDARD_CONTROLS,
    inventory: [
      { name: "Motor Yacht 78ft", spec: "Crewed · 4 cabins · Water toys", capacity: "12 guests", rate: 6400, status: "available" },
      { name: "Catamaran 52ft", spec: "Day charter · Snorkel package", capacity: "20 guests", rate: 2300, status: "available" },
      { name: "Passenger Ferry", spec: "Coastal route · Certified crew", capacity: "180 passengers", rate: 5100, status: "limited" },
      { name: "Coastal Cargo Vessel", spec: "1,200 DWT · Bulk & containerised", capacity: "1,200 tonnes", rate: 9800, status: "on-request" },
      { name: "Traditional Dhow", spec: "Sunset & dining cruises · Crewed", capacity: "35 guests", rate: 1400, status: "available" },
      { name: "Offshore Crew Boat", spec: "Rig transfers · Certified for offshore", capacity: "40 crew", rate: 7200, status: "limited" },
    ],
    workflow: ["Enquiry", "Vessel match", "Quote", "Crew & clearance", "Payment", "Departure", "Voyage tracking"],
  },
  {
    slug: "aircraft-leasing",
    group: "leasing",
    label: "Aircraft Leasing",
    menuDesc: "Short and long-term lease agreements",
    headline: "Aircraft lease agreements, structured and governed.",
    subhead: "Dry, wet and ACMI lease structures with airworthiness evidence, maintenance reserves and lifecycle reporting.",
    icon: "PlaneTakeoff",
    rateUnit: "month",
    currency: "USD",
    defaultDuration: 12,
    targetMargin: 0.19,
    volumeTiers: [[12, 9], [24, 14], [60, 20]],
    controls: STANDARD_CONTROLS,
    inventory: [
      { name: "ATR 72-600 (Dry lease)", spec: "Regional turboprop · 2015 build", capacity: "70 seats", rate: 165000, status: "available" },
      { name: "Boeing 737-800 (ACMI)", spec: "Crew, maintenance & insurance included", capacity: "189 seats", rate: 430000, status: "limited" },
      { name: "Cessna Grand Caravan", spec: "Utility · Short field capable", capacity: "12 seats", rate: 48000, status: "available" },
      { name: "Bell 407 Helicopter", spec: "Utility & VIP configurable", capacity: "6 seats", rate: 72000, status: "on-request" },
    ],
    workflow: ["Requirement", "Aircraft match", "Term sheet", "Due diligence", "Lease execution", "Delivery", "Lifecycle reporting"],
  },
  {
    slug: "heavy-machinery-leasing",
    group: "leasing",
    label: "Heavy Machinery Leasing",
    menuDesc: "Excavators, dozers, loaders, graders",
    headline: "Heavy plant leasing for construction and mining.",
    subhead: "Caterpillars, excavators, bulldozers, soil compactors, dumpers, wheel loaders and graders with servicing included.",
    icon: "Tractor",
    rateUnit: "month",
    currency: "USD",
    defaultDuration: 6,
    targetMargin: 0.23,
    volumeTiers: [[6, 7], [12, 12], [36, 18]],
    controls: STANDARD_CONTROLS,
    inventory: [
      { name: "CAT 320 Excavator", spec: "20t · Hydraulic breaker option", capacity: "1.2 m³ bucket", rate: 9400, status: "available" },
      { name: "CAT D6 Bulldozer", spec: "Track-type tractor · GPS grade", capacity: "18t operating", rate: 12800, status: "available" },
      { name: "Wheel Loader 966", spec: "Quick coupler · 4.2 m³", capacity: "23t operating", rate: 11200, status: "limited" },
      { name: "Motor Grader 140", spec: "Fine grading · Ripper", capacity: "3.7 m blade", rate: 10600, status: "available" },
      { name: "Soil Compactor CS11", spec: "Vibratory single drum", capacity: "11t", rate: 6900, status: "available" },
      { name: "Articulated Dumper 730", spec: "6x6 · Haul cycle telemetry", capacity: "28t payload", rate: 13400, status: "on-request" },
    ],
    workflow: ["Scope", "Machine match", "Site survey", "Lease terms", "Mobilisation", "Servicing", "Utilisation reporting"],
  },
  {
    slug: "truck-hauler-leasing",
    group: "leasing",
    label: "Truck, Lorry & Hauler Leasing",
    menuDesc: "Commercial transport for logistics",
    headline: "Commercial haulage fleets on lease.",
    subhead: "Prime movers, tippers, flatbeds and refrigerated units with telematics, compliance and maintenance bundled.",
    icon: "Truck",
    rateUnit: "month",
    currency: "USD",
    defaultDuration: 12,
    targetMargin: 0.2,
    volumeTiers: [[6, 6], [12, 11], [36, 17]],
    controls: STANDARD_CONTROLS,
    inventory: [
      { name: "Prime Mover 6x4", spec: "Euro 5 · Telematics fitted", capacity: "40t GCW", rate: 4300, status: "available" },
      { name: "Tipper Truck 20m³", spec: "Quarry & aggregate duty", capacity: "20 m³", rate: 3600, status: "available" },
      { name: "Flatbed Trailer 40ft", spec: "Container & project cargo", capacity: "30t payload", rate: 1900, status: "available" },
      { name: "Reefer Truck 10t", spec: "Cold chain · Temperature logging", capacity: "10t payload", rate: 5200, status: "limited" },
    ],
    workflow: ["Route profile", "Fleet sizing", "Lease terms", "Telematics fit", "Handover", "Maintenance", "Cost per km reporting"],
  },
  {
    slug: "car-rentals",
    group: "rentals",
    label: "Car Rentals",
    menuDesc: "Self-drive or chauffeur-driven",
    headline: "Self-drive and chauffeur-driven car rentals.",
    subhead: "Economy to luxury, by the hour, day, week or month — with corporate billing and driver vetting built in.",
    icon: "Car",
    rateUnit: "day",
    currency: "USD",
    defaultDuration: 3,
    targetMargin: 0.25,
    volumeTiers: [[7, 10], [30, 18], [90, 25]],
    controls: STANDARD_CONTROLS,
    inventory: [
      { name: "Economy Hatchback", spec: "Fuel efficient · Self-drive", capacity: "5 seats", rate: 32, status: "available" },
      { name: "Executive Sedan", spec: "Chauffeur optional · Business class", capacity: "4 seats", rate: 72, status: "available" },
      { name: "Premium SUV", spec: "4x4 · Upcountry capable", capacity: "7 seats", rate: 95, status: "available" },
      { name: "Luxury Saloon", spec: "Chauffeur-driven · VIP protocol", capacity: "3 seats", rate: 180, status: "limited" },
      { name: "Passenger Van", spec: "Airport & group transfers", capacity: "14 seats", rate: 120, status: "available" },
    ],
    workflow: ["Search", "Select", "Verify", "Pay", "Collect", "Return", "Invoice"],
  },
  {
    slug: "equipment-rentals",
    group: "rentals",
    label: "Equipment Rentals",
    menuDesc: "Tools and specialised project gear",
    headline: "Project tools and specialised equipment on rent.",
    subhead: "Generators, compressors, access platforms, survey gear and power tools with delivery and on-site support.",
    icon: "Wrench",
    rateUnit: "week",
    currency: "USD",
    defaultDuration: 2,
    targetMargin: 0.28,
    volumeTiers: [[4, 8], [12, 14], [26, 20]],
    controls: STANDARD_CONTROLS,
    inventory: [
      { name: "Diesel Generator 100kVA", spec: "Silent canopy · ATS ready", capacity: "100 kVA", rate: 640, status: "available" },
      { name: "Scissor Lift 12m", spec: "Electric · Indoor rated", capacity: "230 kg", rate: 520, status: "available" },
      { name: "Air Compressor 185cfm", spec: "Towable · Breaker kit", capacity: "185 cfm", rate: 380, status: "available" },
      { name: "Total Station Survey Kit", spec: "Robotic · Tripod & prisms", capacity: "1 crew", rate: 450, status: "limited" },
      { name: "Concrete Mixer & Pump", spec: "Site pour package", capacity: "30 m³/h", rate: 710, status: "on-request" },
    ],
    workflow: ["Enquiry", "Availability", "Quote", "Delivery", "On-site support", "Collection", "Invoice"],
  },
  {
    slug: "event-rentals",
    group: "rentals",
    label: "Event Rentals",
    menuDesc: "Tents, staging, sound and seating",
    headline: "Event infrastructure rented and installed.",
    subhead: "Tents, chairs, sound systems, staging and lighting with crewed setup, teardown and event-day standby.",
    icon: "PartyPopper",
    rateUnit: "event",
    currency: "USD",
    defaultDuration: 1,
    targetMargin: 0.3,
    volumeTiers: [[3, 7], [6, 12], [12, 18]],
    controls: STANDARD_CONTROLS,
    inventory: [
      { name: "Marquee Tent 20x40m", spec: "Flooring & sidewalls · Crewed setup", capacity: "500 guests", rate: 3200, status: "available" },
      { name: "Line Array Sound System", spec: "Mixing desk · Engineer included", capacity: "1,000 guests", rate: 1850, status: "available" },
      { name: "Modular Stage 12x8m", spec: "Adjustable height · Skirting", capacity: "96 m² deck", rate: 1400, status: "available" },
      { name: "Banquet Seating Package", spec: "Chairs, tables, linen", capacity: "300 guests", rate: 950, status: "available" },
      { name: "Stage Lighting Rig", spec: "Moving heads · DMX control", capacity: "Main stage", rate: 1250, status: "limited" },
    ],
    workflow: ["Brief", "Site visit", "Quote", "Deposit", "Setup", "Event standby", "Teardown"],
  },
];

export function categoriesByGroup(group: CharterGroupKey): CharterCategory[] {
  return CHARTER_CATALOG.filter((c) => c.group === group);
}

export function categoryBySlug(slug: string): CharterCategory | undefined {
  return CHARTER_CATALOG.find((c) => c.slug === slug);
}

export const RATE_UNIT_LABEL: Record<RateUnit, string> = {
  "flight-hour": "flight hour",
  day: "day",
  week: "week",
  month: "month",
  event: "event",
};

/** Operator cost drivers exposed as the "pricing settings" panel. */
export interface CostSettings {
  /** Fuel price per litre / per gallon in category currency. */
  fuelPrice: number;
  /** Fuel burn per rate unit (litres per flight hour / per day). */
  fuelBurn: number;
  /** Airport, port or site handling fees charged per rate unit. */
  airportFees: number;
  /** Crew / operator cost per rate unit. */
  crewCost: number;
  /** Demand index — 1.0 is balanced supply. */
  demandIndex: number;
  /** Season index — 1.0 is shoulder season. */
  seasonIndex: number;
  /** Empty-leg / repositioning discount, percent. */
  emptyLegDiscountPct: number;
}

const COST_DEFAULTS: Partial<Record<RateUnit, CostSettings>> = {
  "flight-hour": { fuelPrice: 2.4, fuelBurn: 780, airportFees: 950, crewCost: 1200, demandIndex: 1, seasonIndex: 1, emptyLegDiscountPct: 0 },
  day: { fuelPrice: 1.6, fuelBurn: 120, airportFees: 90, crewCost: 180, demandIndex: 1, seasonIndex: 1, emptyLegDiscountPct: 0 },
  week: { fuelPrice: 1.6, fuelBurn: 420, airportFees: 150, crewCost: 640, demandIndex: 1, seasonIndex: 1, emptyLegDiscountPct: 0 },
  month: { fuelPrice: 1.6, fuelBurn: 1200, airportFees: 400, crewCost: 2200, demandIndex: 1, seasonIndex: 1, emptyLegDiscountPct: 0 },
  event: { fuelPrice: 1.6, fuelBurn: 60, airportFees: 250, crewCost: 480, demandIndex: 1, seasonIndex: 1, emptyLegDiscountPct: 0 },
};

export function defaultCostSettings(category: CharterCategory): CostSettings {
  return {
    ...(COST_DEFAULTS[category.rateUnit] ?? COST_DEFAULTS.day!),
    ...(category.costDefaults ?? {}),
  };
}

/**
 * Customer-facing "from" price for an inventory item. Band-governed fleets
 * quote the lower bound so the marketplace never advertises a single
 * fabricated figure; unbanded assets fall back to their rate card.
 */
export const itemFromRate = (item: CharterInventoryItem): number =>
  item.rateBand ? item.rateBand[0] : item.rate;

/** True when the item's price is expressed as a governed band. */
export const hasRateBand = (item: CharterInventoryItem): boolean => Boolean(item.rateBand);


export interface QuoteInput {
  category: CharterCategory;
  /** Base rate of the selected inventory item. */
  baseRate: number;
  duration: number;
  quantity?: number;
  /** Ids of active pricing controls. */
  activeControls?: string[];
  /** Additional item-level offer discount, percent. */
  offerDiscountPct?: number;
  /** Operator cost drivers; omitted means base-rate-only pricing. */
  costs?: Partial<CostSettings>;
}

export interface QuoteBreakdown {
  gross: number;
  fuelCost: number;
  crewCost: number;
  airportFees: number;
  operatingCost: number;
  demandMultiplier: number;
  seasonMultiplier: number;
  volumeDiscountPct: number;
  offerDiscountPct: number;
  controlMultiplier: number;
  net: number;
  margin: number;
  effectiveRate: number;
}

/** Deterministic shared pricing engine used by every category page. */
export function computeQuote(input: QuoteInput): QuoteBreakdown {
  const { category, baseRate, duration, quantity = 1, activeControls = [], offerDiscountPct = 0 } = input;
  const dur = Math.max(1, duration);
  const qty = Math.max(1, quantity);
  const units = dur * qty;

  const c = { ...defaultCostSettings(category), ...(input.costs ?? {}) };
  const hasCosts = input.costs !== undefined;

  const fuelCost = hasCosts ? c.fuelPrice * c.fuelBurn * units : 0;
  const crewCost = hasCosts ? c.crewCost * units : 0;
  const airportFees = hasCosts ? c.airportFees * units : 0;
  const operatingCost = fuelCost + crewCost + airportFees;

  const demandMultiplier = hasCosts ? clamp(c.demandIndex, 0.6, 2) : 1;
  const seasonMultiplier = hasCosts ? clamp(c.seasonIndex, 0.6, 2) : 1;
  const emptyLegPct = hasCosts ? clamp(c.emptyLegDiscountPct, 0, 90) : 0;

  const controlMultiplier = category.controls
    .filter((ctl) => activeControls.includes(ctl.id))
    .reduce((m, ctl) => m * ctl.multiplier, 1);

  const volumeDiscountPct = category.volumeTiers
    .filter(([min]) => dur >= min)
    .reduce((best, [, pct]) => Math.max(best, pct), 0);

  const gross = baseRate * units + operatingCost;
  const afterMarket = gross * controlMultiplier * demandMultiplier * seasonMultiplier;
  const afterVolume = afterMarket * (1 - volumeDiscountPct / 100);
  const totalOfferPct = Math.min(90, offerDiscountPct + emptyLegPct);
  const net = afterVolume * (1 - totalOfferPct / 100);

  return {
    gross: round2(gross),
    fuelCost: round2(fuelCost),
    crewCost: round2(crewCost),
    airportFees: round2(airportFees),
    operatingCost: round2(operatingCost),
    demandMultiplier: Number(demandMultiplier.toFixed(2)),
    seasonMultiplier: Number(seasonMultiplier.toFixed(2)),
    volumeDiscountPct,
    offerDiscountPct: totalOfferPct,
    controlMultiplier: Number(controlMultiplier.toFixed(4)),
    net: round2(net),
    margin: round2(net * category.targetMargin),
    effectiveRate: round2(net / units),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Indicative USD→KES conversion used for customer-facing quotes. Every price
 * in this platform is quoted to the customer in Kenyan Shillings; catalog rate
 * cards remain USD-denominated internally so operator contracts stay stable.
 */
export const KES_PER_USD = Number(
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_KES_PER_USD ?? 129,
);

/** Converts a USD amount to KES using the configured indicative rate. */
export function usdToKes(amountUsd: number): number {
  return Math.round(amountUsd * KES_PER_USD);
}

/** Formats an amount as `KSh 1,234`. USD inputs are converted first. */
export function formatMoney(amount: number, currency: "USD" | "KES" = "USD"): string {
  const kes = currency === "USD" ? usdToKes(amount) : Math.round(amount);
  return `KSh ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(kes)}`;
}


