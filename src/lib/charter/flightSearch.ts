/**
 * SAFARID Air charter search — turns a search criteria object into priced,
 * comparable aircraft options plus price insights and an AI recommendation.
 *
 * Everything is derived from the existing aviation pricing engine
 * (`computeAviationPrice`) and the seeded airport registry, so search results,
 * the booking quote and the operator payout all agree on one number.
 */
import {
  AIRCRAFT_CATEGORIES, computeAviationPrice, type AircraftCategory, type PriceBreakdown,
  type DemandTier,
} from "./aviationPricing";
import { airportByCode, routeInsight, type AirportRecord } from "./airportRegistry";
import jetExterior from "@/assets/charter/jet-exterior.jpg";
import jetInterior from "@/assets/charter/jet-interior.jpg";
import helicopterImg from "@/assets/charter/helicopter.jpg";
import turbopropImg from "@/assets/charter/turboprop.jpg";

export type TripType = "one_way" | "return" | "multi_city";
export type TimeBand = "morning" | "afternoon" | "evening" | "night" | "specific";
export type CabinClass = "standard" | "executive" | "luxury" | "ultra" | "vip";
export type TravelPurpose =
  | "business" | "leisure" | "medical" | "corporate" | "government" | "vip" | "tourism" | "cargo";
export type AircraftPreference =
  | "any" | "helicopter" | "turboprop" | "light_jet" | "midsize_jet" | "heavy_jet" | "luxury_jet";

export const TRIP_TYPES: Array<{ key: TripType; label: string }> = [
  { key: "one_way", label: "One Way" },
  { key: "return", label: "Return" },
  { key: "multi_city", label: "Multi-City" },
];

export const TIME_BANDS: Array<{ key: TimeBand; label: string; window: string }> = [
  { key: "morning", label: "Morning", window: "06:00 – 11:59" },
  { key: "afternoon", label: "Afternoon", window: "12:00 – 16:59" },
  { key: "evening", label: "Evening", window: "17:00 – 20:59" },
  { key: "night", label: "Night", window: "21:00 – 05:59" },
];

export const CABIN_CLASSES: Array<{ key: CabinClass; label: string; blurb: string }> = [
  { key: "standard", label: "Standard Charter", blurb: "Point-to-point private lift" },
  { key: "executive", label: "Executive", blurb: "Business cabin, refreshments, lounge" },
  { key: "luxury", label: "Luxury", blurb: "Premium cabin crew and catering" },
  { key: "ultra", label: "Ultra Luxury", blurb: "Bespoke catering, concierge, chauffeur" },
  { key: "vip", label: "VIP", blurb: "Protocol handling, private terminal, security" },
];

export const TRAVEL_PURPOSES: TravelPurpose[] = [
  "business", "leisure", "medical", "corporate", "government", "vip", "tourism", "cargo",
];

export const AIRCRAFT_PREFERENCES: Array<{ key: AircraftPreference; label: string }> = [
  { key: "any", label: "Any Aircraft" },
  { key: "helicopter", label: "Helicopter" },
  { key: "turboprop", label: "Turboprop" },
  { key: "light_jet", label: "Light Jet" },
  { key: "midsize_jet", label: "Midsize Jet" },
  { key: "heavy_jet", label: "Heavy Jet" },
  { key: "luxury_jet", label: "Luxury Jet" },
];

export interface PassengerMix {
  adults: number;
  children: number;
  infants: number;
  pets: number;
  bags: number;
  assistance: boolean;
}

export const DEFAULT_PASSENGERS: PassengerMix = {
  adults: 2, children: 0, infants: 0, pets: 0, bags: 2, assistance: false,
};

export const paxCount = (p: PassengerMix) => p.adults + p.children + p.infants;

export interface SearchCriteria {
  tripType: TripType;
  origin: string;
  destination: string;
  /** Additional legs for multi-city; each is a destination code. */
  legs: string[];
  departDate: string;
  returnDate: string;
  timeBand: TimeBand;
  specificTime: string;
  passengers: PassengerMix;
  preference: AircraftPreference;
  purpose: TravelPurpose | "";
  cabin: CabinClass;
}

export const emptyCriteria = (): SearchCriteria => ({
  tripType: "one_way",
  origin: "",
  destination: "",
  legs: [],
  departDate: "",
  returnDate: "",
  timeBand: "morning",
  specificTime: "",
  passengers: { ...DEFAULT_PASSENGERS },
  preference: "any",
  purpose: "",
  cabin: "standard",
});

/* ------------------------------------------------------------------ */
/* Aircraft presentation — imagery, seat maps, amenities               */
/* ------------------------------------------------------------------ */

export interface SeatMap {
  /** Seats per row in the cabin (excluding crew). */
  layout: number;
  rows: number;
  /** Seat ids the customer can select, in cabin order. */
  seats: string[];
  /** Window seat ids for orientation in the picker. */
  windows: string[];
  note: string;
}

/** Deterministic cabin plan for a category — club-four style for jets. */
export function seatMapFor(aircraft: AircraftCategory): SeatMap {
  const perRow = aircraft.key === "helicopter" ? 2 : aircraft.seats >= 9 ? 2 : 2;
  const rows = Math.max(1, Math.ceil(aircraft.seats / perRow));
  const seats: string[] = [];
  const windows: string[] = [];
  const letters = ["A", "B", "C", "D"];
  for (let r = 1; r <= rows; r += 1) {
    for (let c = 0; c < perRow; c += 1) {
      if (seats.length >= aircraft.seats) break;
      const id = `${r}${letters[c]}`;
      seats.push(id);
      if (c === 0 || c === perRow - 1) windows.push(id);
    }
  }
  return {
    layout: perRow,
    rows,
    seats,
    windows,
    note:
      aircraft.key === "helicopter"
        ? "Forward cabin seats offer the best sightseeing view."
        : "Club-four configuration; forward seats face aft.",
  };
}

const AMENITIES: Record<string, string[]> = {
  helicopter: ["Noise-cancelling headsets", "Panoramic windows", "City helipad access"],
  cessna_172: ["Two-pilot option", "Short strip capable"],
  cessna_206: ["Bush strip capable", "Extra baggage pod"],
  caravan_208b: ["Bush strip capable", "Large cargo door", "Safari configuration"],
  twin_otter: ["STOL performance", "High-capacity cabin", "Cargo convertible"],
  king_air_350: ["Pressurised cabin", "Refreshment centre", "Lavatory"],
  light_jet: ["Pressurised cabin", "Lavatory", "Wi-Fi (route dependent)"],
  midsize_jet: ["Stand-up cabin", "Wi-Fi", "Hot catering", "Lavatory"],
  heavy_jet: ["Stand-up cabin", "Cabin crew", "Hot catering", "Berthable seating", "Wi-Fi"],
};

const IMAGE_SET: Record<string, { exterior: string; interior: string }> = {
  helicopter: { exterior: helicopterImg, interior: jetInterior },
  cessna_172: { exterior: turbopropImg, interior: jetInterior },
  cessna_206: { exterior: turbopropImg, interior: jetInterior },
  caravan_208b: { exterior: turbopropImg, interior: jetInterior },
  twin_otter: { exterior: turbopropImg, interior: jetInterior },
  king_air_350: { exterior: turbopropImg, interior: jetInterior },
  light_jet: { exterior: jetExterior, interior: jetInterior },
  midsize_jet: { exterior: jetExterior, interior: jetInterior },
  heavy_jet: { exterior: jetExterior, interior: jetInterior },
};

export const imagesFor = (key: string) => IMAGE_SET[key] ?? { exterior: jetExterior, interior: jetInterior };

const PREFERENCE_KEYS: Record<AircraftPreference, string[]> = {
  any: AIRCRAFT_CATEGORIES.map((c) => c.key),
  helicopter: ["helicopter"],
  turboprop: ["cessna_172", "cessna_206", "caravan_208b", "twin_otter", "king_air_350"],
  light_jet: ["light_jet"],
  midsize_jet: ["midsize_jet"],
  heavy_jet: ["heavy_jet"],
  luxury_jet: ["midsize_jet", "heavy_jet"],
};

const CABIN_UPLIFT: Record<CabinClass, number> = {
  standard: 0, executive: 0.06, luxury: 0.12, ultra: 0.2, vip: 0.28,
};

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export interface AircraftOption {
  aircraft: AircraftCategory;
  operator: string;
  operatorRating: number;
  images: { exterior: string; interior: string };
  amenities: string[];
  seatMap: SeatMap;
  /** Governed price for this option, including the cabin uplift. */
  price: number;
  currency: "USD";
  breakdown: PriceBreakdown;
  flightTimeLabel: string;
  hours: number;
  seatsAvailable: number;
  emptyLeg: boolean;
  tags: string[];
}

export interface PriceInsight {
  lowest: number;
  bestValue: AircraftOption | null;
  premium: AircraftOption | null;
  fastest: AircraftOption | null;
  /** Indicative price movement across the days around the departure date. */
  nearbyDates: Array<{ date: string; price: number; tier: DemandTier }>;
}

export interface Recommendation {
  option: AircraftOption;
  reason: string;
  suitability: string;
  alternatives: AircraftOption[];
  groundTransport: string;
}

export interface SearchResult {
  from: AirportRecord | null;
  to: AirportRecord | null;
  distanceNm: number;
  options: AircraftOption[];
  insight: PriceInsight;
  recommendation: Recommendation | null;
}

const OPERATORS = [
  { name: "SAFARID Air Charter", rating: 4.9 },
  { name: "Rift Valley Aviation", rating: 4.7 },
  { name: "Savannah Wings", rating: 4.6 },
  { name: "Lakeside Executive Air", rating: 4.5 },
];

const hoursLabel = (h: number) => {
  const w = Math.floor(h);
  const m = Math.round((h - w) * 60);
  return w > 0 ? `${w}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

const demandFor = (dateIso: string): DemandTier => {
  const d = new Date(dateIso || Date.now());
  const day = d.getDay();
  if (day === 5 || day === 0) return "high";
  if (day === 6) return "peak";
  if (day === 1) return "busy";
  return "normal";
};

/** Prices every aircraft category that can carry the party on this route. */
export function searchCharter(criteria: SearchCriteria): SearchResult {
  const from = airportByCode(criteria.origin);
  const to = airportByCode(criteria.destination);
  const pax = Math.max(1, paxCount(criteria.passengers));
  const allowed = new Set(PREFERENCE_KEYS[criteria.preference] ?? PREFERENCE_KEYS.any);
  const demandTier = demandFor(criteria.departDate);
  const roundTrip = criteria.tripType === "return";
  const nightOps = criteria.timeBand === "night";

  const options: AircraftOption[] = AIRCRAFT_CATEGORIES
    .filter((c) => allowed.has(c.key) && c.seats >= pax)
    .map((aircraft, i) => {
      const breakdown = computeAviationPrice({
        aircraftKey: aircraft.key,
        origin: from?.code ?? criteria.origin,
        destination: to?.code ?? criteria.destination,
        passengers: pax,
        roundTrip,
        nightOps,
        demandTier,
        vip: criteria.cabin === "vip",
        corporate: criteria.purpose === "corporate" || criteria.purpose === "government",
        premiumPackage: criteria.cabin === "ultra" || criteria.cabin === "vip",
      });
      const op = OPERATORS[i % OPERATORS.length];
      const price = Math.round(breakdown.customerPrice * (1 + CABIN_UPLIFT[criteria.cabin]));
      const tags: string[] = [];
      if (aircraft.cruiseKts >= 400) tags.push("Fastest class");
      if (from && to && (from.runwayM < 1500 || to.runwayM < 1500) && aircraft.cruiseKts <= 200) {
        tags.push("Short-strip capable");
      }
      if (criteria.passengers.pets > 0 && aircraft.seats >= 6) tags.push("Pet friendly");
      return {
        aircraft,
        operator: op.name,
        operatorRating: op.rating,
        images: imagesFor(aircraft.key),
        amenities: AMENITIES[aircraft.key] ?? [],
        seatMap: seatMapFor(aircraft),
        price,
        currency: "USD" as const,
        breakdown,
        hours: breakdown.time.billableHours,
        flightTimeLabel: hoursLabel(breakdown.time.airborneHours),
        seatsAvailable: aircraft.seats,
        emptyLeg: Boolean(breakdown.emptyLeg),
        tags,
      };
    })
    .sort((x, y) => x.price - y.price);

  const fastest = options.reduce<AircraftOption | null>(
    (best, o) => (!best || o.breakdown.time.airborneHours < best.breakdown.time.airborneHours ? o : best),
    null,
  );
  const bestValue = options.length
    ? options.reduce((best, o) => (o.price / Math.max(1, o.seatsAvailable) < best.price / Math.max(1, best.seatsAvailable) ? o : best))
    : null;
  const premium = options.length ? options[options.length - 1] : null;

  const base = options[0]?.price ?? 0;
  const nearbyDates = buildNearbyDates(criteria.departDate, base);

  const recommendation: Recommendation | null = bestValue
    ? {
        option: bestValue,
        reason:
          bestValue === fastest
            ? "Fastest available aircraft that also carries the lowest cost per seat on this sector."
            : `Best cost per seat for ${pax} passenger${pax === 1 ? "" : "s"} on this route, with capacity in reserve for baggage.`,
        suitability: `${bestValue.aircraft.seats} seats · ${pax} travelling · ${bestValue.flightTimeLabel} airborne`,
        alternatives: options.filter((o) => o !== bestValue).slice(0, 3),
        groundTransport: to
          ? `Chauffeur pickup available at ${to.name}${to.vipLounge ? " with VIP lounge handover" : ""}.`
          : "Chauffeur pickup available on confirmation.",
      }
    : null;

  return {
    from,
    to,
    distanceNm: from && to ? routeInsight(from, to).distanceNm : 0,
    options,
    insight: { lowest: base, bestValue, premium, fastest, nearbyDates },
    recommendation,
  };
}

const TIER_FACTOR: Record<DemandTier, number> = { normal: 1, busy: 1.08, high: 1.16, peak: 1.28 };

/** Indicative price curve for the three days either side of departure. */
export function buildNearbyDates(dateIso: string, basePrice: number) {
  const anchor = dateIso ? new Date(dateIso) : new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() + i - 3);
    const iso = d.toISOString().slice(0, 10);
    const tier = demandFor(iso);
    return { date: iso, price: Math.round(basePrice * TIER_FACTOR[tier]), tier };
  });
}

/* ------------------------------------------------------------------ */
/* Passenger identity validation                                       */
/* ------------------------------------------------------------------ */

export interface PassengerIdentity {
  fullName: string;
  idNumber: string;
  passportNumber: string;
  phone: string;
  email: string;
  seat?: string;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
export const PHONE_RE = /^\+?[0-9][0-9\s-]{7,17}$/;

/**
 * A passenger must carry at least one travel document. Passport is optional on
 * domestic sectors provided a national ID is supplied, and mandatory when the
 * sector crosses a border.
 */
export function validatePassenger(p: PassengerIdentity, international: boolean): string[] {
  const errors: string[] = [];
  if (!p.fullName.trim()) errors.push("Full name is required.");
  if (!p.idNumber.trim() && !p.passportNumber.trim()) {
    errors.push("Provide either a national ID number or a passport number.");
  }
  if (international && !p.passportNumber.trim()) {
    errors.push("A passport number is required for international sectors.");
  }
  if (!PHONE_RE.test(p.phone.trim())) errors.push("Enter a valid telephone number.");
  if (!EMAIL_RE.test(p.email.trim())) errors.push("Enter a valid email address.");
  return errors;
}

/** True when the sector crosses a national border. */
export const isInternational = (from: AirportRecord | null, to: AirportRecord | null) =>
  Boolean(from && to && from.country !== to.country);
