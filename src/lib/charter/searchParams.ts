/**
 * URL serialisation for a charter search brief. Keeping this beside the search
 * engine lets the widget, the results page and shared links agree on one
 * canonical query-string shape.
 */
import { DEFAULT_PASSENGERS, emptyCriteria, type SearchCriteria } from "./flightSearch";

export {
  AIRCRAFT_PREFERENCES, CABIN_CLASSES, DEFAULT_PASSENGERS, TIME_BANDS, TRAVEL_PURPOSES, TRIP_TYPES,
  emptyCriteria, paxCount, searchCharter, seatMapFor, imagesFor, validatePassenger, isInternational,
} from "./flightSearch";
export type {
  AircraftOption, AircraftPreference, CabinClass, PassengerIdentity, PassengerMix, PriceInsight,
  Recommendation, SearchCriteria, SearchResult, TimeBand, TravelPurpose, TripType,
} from "./flightSearch";

export function criteriaToParams(c: SearchCriteria): URLSearchParams {
  const p = new URLSearchParams({
    trip: c.tripType,
    from: c.origin,
    to: c.destination,
    depart: c.departDate,
    time: c.timeBand,
    adults: String(c.passengers.adults),
    pref: c.preference,
    cabin: c.cabin,
  });
  if (c.legs.filter(Boolean).length) p.set("legs", c.legs.filter(Boolean).join(","));
  if (c.returnDate) p.set("return", c.returnDate);
  if (c.specificTime) p.set("at", c.specificTime);
  if (c.passengers.children) p.set("children", String(c.passengers.children));
  if (c.passengers.infants) p.set("infants", String(c.passengers.infants));
  if (c.passengers.pets) p.set("pets", String(c.passengers.pets));
  if (c.passengers.bags !== DEFAULT_PASSENGERS.bags) p.set("bags", String(c.passengers.bags));
  if (c.passengers.assistance) p.set("assist", "1");
  if (c.purpose) p.set("purpose", c.purpose);
  return p;
}

const num = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function paramsToCriteria(p: URLSearchParams): SearchCriteria {
  const base = emptyCriteria();
  return {
    ...base,
    tripType: (p.get("trip") as SearchCriteria["tripType"]) ?? base.tripType,
    origin: p.get("from") ?? "",
    destination: p.get("to") ?? "",
    legs: (p.get("legs") ?? "").split(",").filter(Boolean),
    departDate: p.get("depart") ?? "",
    returnDate: p.get("return") ?? "",
    timeBand: (p.get("time") as SearchCriteria["timeBand"]) ?? base.timeBand,
    specificTime: p.get("at") ?? "",
    passengers: {
      adults: Math.max(1, num(p.get("adults"), 1)),
      children: num(p.get("children"), 0),
      infants: num(p.get("infants"), 0),
      pets: num(p.get("pets"), 0),
      bags: num(p.get("bags"), DEFAULT_PASSENGERS.bags),
      assistance: p.get("assist") === "1",
    },
    preference: (p.get("pref") as SearchCriteria["preference"]) ?? base.preference,
    purpose: (p.get("purpose") as SearchCriteria["purpose"]) ?? "",
    cabin: (p.get("cabin") as SearchCriteria["cabin"]) ?? base.cabin,
  };
}
