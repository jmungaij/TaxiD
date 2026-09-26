/**
 * Polymorphic asset pricing profiles.
 *
 * A charter price is never "one template with different numbers": an aircraft
 * has landing and navigation charges, a coach has parking, driver allowances
 * and tolls, a yacht has marina and mooring fees. This module owns, per asset
 * class:
 *
 *   • which cost components exist (and their labels / units),
 *   • the pricing formula inputs (day rate vs block hour vs mileage),
 *   • administrator-controlled base rate bands,
 *   • operator override limits.
 *
 * Aviation fields are structurally impossible to leak into road, marine or
 * equipment quotations because each profile only exposes its own components.
 */

export type AssetClass =
  | "aircraft" | "helicopter"
  | "bus" | "coach" | "shuttle" | "van"
  | "car" | "truck" | "trailer"
  | "boat" | "yacht"
  | "equipment";

export type FeeUnit = "per_trip" | "per_day" | "per_night" | "per_km" | "per_movement" | "per_passenger" | "per_hour";

export interface FeeComponent {
  key: string;
  label: string;
  unit: FeeUnit;
  /** Default marketplace amount, KES. Admin-configurable. */
  defaultKes: number;
  optional?: boolean;
}

export interface AssetPricingProfile {
  assetClass: AssetClass;
  label: string;
  /** Customer-facing noun used in quotations and receipts. */
  assetNoun: string;
  crewNoun: string;
  /** Primary metered basis for the profile. */
  basis: "block_hour" | "day" | "day_plus_mileage" | "voyage_day";
  /** Cost components exposed to the customer for this class only. */
  fees: FeeComponent[];
  /** Distance charge per km (0 when the basis is not distance-metered). */
  perKmKes: number;
  /** Marketplace commission, % of operator cost. */
  platformFeePct: number;
  vatPct: number;
}

const AIR_FEES: FeeComponent[] = [
  { key: "landing", label: "Landing fees", unit: "per_movement", defaultKes: 18000 },
  { key: "parking_apron", label: "Parking / apron fees", unit: "per_day", defaultKes: 9000 },
  { key: "navigation", label: "Navigation charges", unit: "per_km", defaultKes: 100 },
  { key: "handling", label: "Ground handling", unit: "per_movement", defaultKes: 26000 },
  { key: "psc", label: "Passenger service charge", unit: "per_passenger", defaultKes: 2600 },
  { key: "security", label: "Airport security charge", unit: "per_passenger", defaultKes: 800 },
];

const ROAD_FEES: FeeComponent[] = [
  { key: "parking", label: "Parking fees", unit: "per_day", defaultKes: 1200 },
  { key: "driver_overnight", label: "Driver overnight allowance", unit: "per_night", defaultKes: 2500 },
  { key: "driver_accommodation", label: "Driver accommodation", unit: "per_night", defaultKes: 3500 },
  { key: "tolls", label: "Toll charges", unit: "per_trip", defaultKes: 900, optional: true },
  { key: "event_parking", label: "Event parking", unit: "per_trip", defaultKes: 2500, optional: true },
  { key: "venue_access", label: "Venue access charges", unit: "per_trip", defaultKes: 3500, optional: true },
  { key: "cleaning", label: "Cleaning charges", unit: "per_trip", defaultKes: 2000 },
];

const CAR_FEES: FeeComponent[] = [
  { key: "parking", label: "Parking", unit: "per_day", defaultKes: 800 },
  { key: "insurance", label: "Insurance", unit: "per_day", defaultKes: 1500 },
  { key: "fuel_policy", label: "Fuel policy adjustment", unit: "per_km", defaultKes: 11 },
  { key: "mileage", label: "Excess mileage", unit: "per_km", defaultKes: 35, optional: true },
  { key: "delivery", label: "Delivery & collection", unit: "per_trip", defaultKes: 2500, optional: true },
  { key: "cleaning", label: "Cleaning", unit: "per_trip", defaultKes: 1200 },
];

const TRUCK_FEES: FeeComponent[] = [
  { key: "tolls", label: "Toll charges", unit: "per_trip", defaultKes: 1800 },
  { key: "axle_levy", label: "Axle levy", unit: "per_trip", defaultKes: 3200, optional: true },
  { key: "loading", label: "Loading charges", unit: "per_trip", defaultKes: 6000 },
  { key: "offloading", label: "Offloading charges", unit: "per_trip", defaultKes: 6000 },
  { key: "escort", label: "Escort fees", unit: "per_day", defaultKes: 14000, optional: true },
  { key: "weighbridge", label: "Weighbridge fees", unit: "per_trip", defaultKes: 1500, optional: true },
  { key: "driver_overnight", label: "Overnight driver allowance", unit: "per_night", defaultKes: 2500 },
];

const MARINE_FEES: FeeComponent[] = [
  { key: "marina", label: "Marina fees", unit: "per_day", defaultKes: 12000 },
  { key: "mooring", label: "Mooring charges", unit: "per_day", defaultKes: 8000 },
  { key: "docking", label: "Docking fees", unit: "per_trip", defaultKes: 9000 },
  { key: "fuel", label: "Fuel", unit: "per_hour", defaultKes: 14000 },
  { key: "captain", label: "Captain", unit: "per_day", defaultKes: 18000 },
  { key: "crew", label: "Crew", unit: "per_day", defaultKes: 12000 },
  { key: "catering", label: "Catering", unit: "per_passenger", defaultKes: 3500, optional: true },
  { key: "cleaning", label: "Cleaning", unit: "per_trip", defaultKes: 4500 },
];

const EQUIPMENT_FEES: FeeComponent[] = [
  { key: "mobilisation", label: "Mobilisation", unit: "per_trip", defaultKes: 15000 },
  { key: "demobilisation", label: "Demobilisation", unit: "per_trip", defaultKes: 15000 },
  { key: "operator_crew", label: "Certified operator", unit: "per_day", defaultKes: 9000 },
  { key: "fuel", label: "Fuel", unit: "per_hour", defaultKes: 2200 },
  { key: "maintenance", label: "Maintenance reserve", unit: "per_day", defaultKes: 3500 },
];

export const ASSET_PRICING_PROFILES: Record<AssetClass, AssetPricingProfile> = {
  aircraft: { assetClass: "aircraft", label: "Aircraft", assetNoun: "Aircraft", crewNoun: "Crew", basis: "block_hour", fees: AIR_FEES, perKmKes: 0, platformFeePct: 12, vatPct: 16 },
  helicopter: { assetClass: "helicopter", label: "Helicopter", assetNoun: "Helicopter", crewNoun: "Crew", basis: "block_hour", fees: AIR_FEES, perKmKes: 0, platformFeePct: 12, vatPct: 16 },
  bus: { assetClass: "bus", label: "Bus", assetNoun: "Vehicle", crewNoun: "Driver", basis: "day_plus_mileage", fees: ROAD_FEES, perKmKes: 105, platformFeePct: 8, vatPct: 16 },
  coach: { assetClass: "coach", label: "Coach", assetNoun: "Coach", crewNoun: "Driver", basis: "day_plus_mileage", fees: ROAD_FEES, perKmKes: 130, platformFeePct: 8, vatPct: 16 },
  shuttle: { assetClass: "shuttle", label: "Shuttle", assetNoun: "Shuttle", crewNoun: "Driver", basis: "day_plus_mileage", fees: ROAD_FEES, perKmKes: 85, platformFeePct: 8, vatPct: 16 },
  van: { assetClass: "van", label: "Van", assetNoun: "Van", crewNoun: "Driver", basis: "day_plus_mileage", fees: ROAD_FEES, perKmKes: 75, platformFeePct: 8, vatPct: 16 },
  car: { assetClass: "car", label: "Car", assetNoun: "Vehicle", crewNoun: "Driver", basis: "day_plus_mileage", fees: CAR_FEES, perKmKes: 45, platformFeePct: 10, vatPct: 16 },
  truck: { assetClass: "truck", label: "Truck", assetNoun: "Truck", crewNoun: "Driver", basis: "day_plus_mileage", fees: TRUCK_FEES, perKmKes: 160, platformFeePct: 8, vatPct: 16 },
  trailer: { assetClass: "trailer", label: "Trailer / hauler", assetNoun: "Trailer", crewNoun: "Driver", basis: "day_plus_mileage", fees: TRUCK_FEES, perKmKes: 190, platformFeePct: 8, vatPct: 16 },
  boat: { assetClass: "boat", label: "Boat", assetNoun: "Vessel", crewNoun: "Captain", basis: "voyage_day", fees: MARINE_FEES, perKmKes: 0, platformFeePct: 10, vatPct: 16 },
  yacht: { assetClass: "yacht", label: "Yacht", assetNoun: "Yacht", crewNoun: "Captain", basis: "voyage_day", fees: MARINE_FEES, perKmKes: 0, platformFeePct: 10, vatPct: 16 },
  equipment: { assetClass: "equipment", label: "Equipment", assetNoun: "Unit", crewNoun: "Operator", basis: "day", fees: EQUIPMENT_FEES, perKmKes: 0, platformFeePct: 10, vatPct: 16 },
};

export const pricingProfile = (assetClass: AssetClass): AssetPricingProfile =>
  ASSET_PRICING_PROFILES[assetClass] ?? ASSET_PRICING_PROFILES.bus;

/* ------------------------------------------------------------------ */
/* Road fleet catalogue — Nairobi market-aligned marketplace bands      */
/* ------------------------------------------------------------------ */

export type RoadFleetGroup = "van" | "shuttle" | "minibus" | "coach" | "double_deck" | "tourism" | "school";

export interface RoadFleetVehicle {
  key: string;
  label: string;
  group: RoadFleetGroup;
  assetClass: AssetClass;
  seats: number;
  /** Suggested marketplace base rate per operating day, KES. */
  baseKes: number;
  /** Administrator band — operator overrides are clamped to it. */
  minKes: number;
  maxKes: number;
  perKmKes: number;
  extraHourKes: number;
}

const band = (base: number): [number, number] => [Math.round(base * 0.8), Math.round(base * 1.45)];

const veh = (
  key: string, label: string, group: RoadFleetGroup, assetClass: AssetClass,
  seats: number, baseKes: number, perKmKes: number, extraHourKes: number,
): RoadFleetVehicle => {
  const [minKes, maxKes] = band(baseKes);
  return { key, label, group, assetClass, seats, baseKes, minKes, maxKes, perKmKes, extraHourKes };
};

/**
 * Base rates are benchmarked to publicly advertised Nairobi charter pricing
 * (10-seater vans ~KES 8k–15k/day up to 67–72 seater double deckers
 * ~KES 55k–85k/day) so the marketplace converts instead of pricing above
 * market. Operators may move within the admin band; contract, seasonal and
 * distance adjustments are applied on top by the pricing formula.
 */
export const ROAD_FLEET: RoadFleetVehicle[] = [
  veh("economy_van_7", "Economy van", "van", "van", 7, 12000, 70, 1200),
  veh("executive_van_8", "Executive van", "van", "van", 8, 13000, 72, 1300),
  veh("luxury_van_10", "Luxury van", "van", "van", 10, 14000, 75, 1400),
  veh("vip_sprinter_12", "VIP Sprinter", "van", "van", 12, 18000, 85, 1800),
  veh("shuttle_14", "Shuttle", "shuttle", "shuttle", 14, 15000, 80, 1500),
  veh("executive_shuttle_14", "Executive shuttle", "shuttle", "shuttle", 14, 17000, 85, 1700),
  veh("staff_shuttle_18", "Staff shuttle", "shuttle", "shuttle", 18, 19000, 90, 1900),
  veh("staff_shuttle_25", "Staff shuttle XL", "shuttle", "shuttle", 25, 22000, 95, 2100),
  veh("minibus_25", "Minibus", "minibus", "bus", 25, 22000, 95, 2100),
  veh("executive_minibus_29", "Executive minibus", "minibus", "bus", 29, 24000, 100, 2300),
  veh("tour_minibus_33", "Tour minibus", "minibus", "bus", 33, 26000, 105, 2400),
  veh("executive_coach_33", "Executive coach", "coach", "coach", 33, 28000, 110, 2600),
  veh("executive_coach_49", "Executive coach", "coach", "coach", 49, 38000, 130, 3200),
  veh("executive_coach_53", "Executive coach", "coach", "coach", 53, 42000, 138, 3400),
  veh("executive_coach_62", "Executive coach", "coach", "coach", 62, 48000, 150, 3800),
  veh("double_decker_67", "Double decker", "double_deck", "coach", 67, 58000, 165, 4200),
  veh("double_decker_vip_72", "Double decker VIP", "double_deck", "coach", 72, 65000, 175, 4600),
  veh("safari_van_7", "Safari van", "tourism", "van", 7, 12000, 70, 1200),
  veh("safari_land_cruiser_5", "Safari Land Cruiser", "tourism", "car", 5, 16000, 90, 1600),
  veh("safari_bus_25", "Safari bus", "tourism", "bus", 25, 24000, 100, 2300),
  veh("school_van_14", "School van", "school", "van", 14, 13000, 70, 1200),
  veh("school_bus_33", "School bus", "school", "bus", 33, 24000, 100, 2200),
  veh("school_bus_51", "School bus", "school", "coach", 51, 34000, 125, 3000),
  veh("school_bus_62", "School bus", "school", "coach", 62, 42000, 140, 3400),
];

export const roadVehicle = (key: string): RoadFleetVehicle | null =>
  ROAD_FLEET.find((v) => v.key === key) ?? null;

export function roadVehiclesForSeats(seats: number): RoadFleetVehicle[] {
  return ROAD_FLEET.filter((v) => v.seats >= seats).sort((a, b) => a.baseKes - b.baseKes);
}

/* ------------------------------------------------------------------ */
/* Category-aware quotation formula                                    */
/* ------------------------------------------------------------------ */

export interface AssetQuoteInput {
  vehicleKey: string;
  days: number;
  distanceKm: number;
  nights?: number;
  passengers?: number;
  extraHours?: number;
  /** Fee component keys the customer opted into (optional components only). */
  feeKeys?: string[];
  /** Operator base rate override — clamped to the admin band. */
  baseOverrideKes?: number;
  /** Contract / segment discount, %. */
  contractDiscountPct?: number;
  /** Long-term hire discount, %. */
  longTermDiscountPct?: number;
  /** Seasonal adjustment, % (may be negative). */
  seasonalAdjustmentPct?: number;
  /** Included kilometres before distance metering. */
  includedKm?: number;
}

export interface AssetQuoteLine { key: string; label: string; amountKes: number; reason: string }

export interface AssetQuote {
  vehicle: RoadFleetVehicle;
  profile: AssetPricingProfile;
  lines: AssetQuoteLine[];
  operatorCostKes: number;
  discountKes: number;
  platformFeeKes: number;
  vatKes: number;
  totalKes: number;
  perSeatKes: number;
}

/**
 * Daily Price = Base Vehicle Rate + Distance + Crew + Fuel + Fees + Options
 *               − Contract / long-term discounts + Platform commission + VAT
 *
 * The arithmetic lives in the polymorphic engine (`polymorphicPricing.ts`) so
 * every asset class — aircraft, coach, van, yacht, equipment — shares one
 * implementation and only contributes its own fee components and terminology.
 */
export type { computeAssetQuote } from "./assetQuote";


/* ------------------------------------------------------------------ */
/* Customer-facing fee terminology per asset class                     */
/* ------------------------------------------------------------------ */

/**
 * Label used wherever a quotation summarises the "third-party charges" line.
 * Road, marine, car, truck and equipment quotes must never borrow aviation
 * terminology (landing, navigation, handling, cabin), so the wording is owned
 * by the profile rather than by any page.
 */
export const FEE_BUNDLE_LABEL: Record<AssetClass, string> = {
  aircraft: "Airport, handling & navigation charges",
  helicopter: "Helipad, handling & navigation charges",
  bus: "Parking, driver allowance & tolls",
  coach: "Parking, driver allowance & tolls",
  shuttle: "Parking, driver allowance & tolls",
  van: "Parking, driver allowance & tolls",
  car: "Parking, insurance & delivery",
  truck: "Tolls, loading & weighbridge",
  trailer: "Tolls, loading & weighbridge",
  boat: "Marina, mooring & docking fees",
  yacht: "Marina, mooring & docking fees",
  equipment: "Mobilisation & site charges",
};

export const feeBundleLabel = (assetClass: AssetClass): string =>
  FEE_BUNDLE_LABEL[assetClass] ?? FEE_BUNDLE_LABEL.bus;

/** Crew wording per asset class ("Crew" for aircraft, "Driver" for road). */
export const crewLabel = (assetClass: AssetClass): string => pricingProfile(assetClass).crewNoun;

/** Marketplace "from" band for a road vehicle, KES per operating day. */
export const roadRateBand = (v: RoadFleetVehicle): [number, number] => [v.minKes, v.maxKes];
