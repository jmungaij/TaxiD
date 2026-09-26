/**
 * SmartFare™ popular route intelligence.
 *
 * Indicative mission prices for the corridors East African charter customers
 * search most. Prices are computed by the SmartFare engine — never typed in,
 * never presented as historical invoices or operator tariffs.
 */
import { airportByCode, type AirportRecord } from "./airportRegistry";
import {
  computeMissionFare, smartFareAircraft, type CustomerSegment, type MissionFare, type SmartFareAircraft,
} from "./smartFare";

export type Seasonality = "peak" | "shoulder" | "steady";

export interface PopularRoute {
  id: string;
  fromCode: string;
  toCode: string;
  label: string;
  recommendedAircraftKey: string;
  typicalPassengers: number;
  seasonality: Seasonality;
  /** Why this corridor is efficient — surfaced as a savings opportunity. */
  savingsOpportunity: string;
}

export const POPULAR_ROUTES: PopularRoute[] = [
  { id: "wil-mara", fromCode: "WIL", toCode: "HKKE", label: "Wilson ↔ Maasai Mara", recommendedAircraftKey: "caravan_208b", typicalPassengers: 8, seasonality: "peak", savingsOpportunity: "High empty-leg availability on afternoon returns" },
  { id: "wil-amboseli", fromCode: "WIL", toCode: "ASV", label: "Wilson ↔ Amboseli", recommendedAircraftKey: "caravan_208b", typicalPassengers: 8, seasonality: "peak", savingsOpportunity: "Shared-mission aggregation on morning departures" },
  { id: "wil-diani", fromCode: "WIL", toCode: "UKA", label: "Wilson ↔ Diani", recommendedAircraftKey: "king_air_350", typicalPassengers: 7, seasonality: "peak", savingsOpportunity: "Coastal rotations create frequent repositioning matches" },
  { id: "wil-kisumu", fromCode: "WIL", toCode: "KIS", label: "Wilson ↔ Kisumu", recommendedAircraftKey: "king_air_350", typicalPassengers: 7, seasonality: "steady", savingsOpportunity: "Corporate weekday demand supports shared missions" },
  { id: "wil-eldoret", fromCode: "WIL", toCode: "EDL", label: "Wilson ↔ Eldoret", recommendedAircraftKey: "king_air_350", typicalPassengers: 7, seasonality: "steady", savingsOpportunity: "Flexible departure windows reduce positioning" },
  { id: "wil-lodwar", fromCode: "WIL", toCode: "LOK", label: "Wilson ↔ Lodwar", recommendedAircraftKey: "king_air_350", typicalPassengers: 7, seasonality: "shoulder", savingsOpportunity: "NGO rotations frequently aggregate cargo and pax" },
  { id: "wil-lamu", fromCode: "WIL", toCode: "LAU", label: "Wilson ↔ Lamu", recommendedAircraftKey: "king_air_350", typicalPassengers: 7, seasonality: "peak", savingsOpportunity: "Weekend rotations return empty — high match rate" },
  { id: "wil-zanzibar", fromCode: "WIL", toCode: "ZNZ", label: "Wilson ↔ Zanzibar", recommendedAircraftKey: "cj3", typicalPassengers: 6, seasonality: "peak", savingsOpportunity: "Regional jet rotations via Mombasa reduce positioning" },
  { id: "wil-kigali", fromCode: "WIL", toCode: "KGL", label: "Wilson ↔ Kigali", recommendedAircraftKey: "latitude", typicalPassengers: 8, seasonality: "steady", savingsOpportunity: "Government and NGO framework rates apply" },
  { id: "wil-entebbe", fromCode: "WIL", toCode: "EBB", label: "Wilson ↔ Entebbe", recommendedAircraftKey: "latitude", typicalPassengers: 8, seasonality: "steady", savingsOpportunity: "Frequent corridor — strong aggregation potential" },
];

export interface RouteFare {
  route: PopularRoute;
  from: AirportRecord | null;
  to: AirportRecord | null;
  aircraft: SmartFareAircraft;
  fare: MissionFare;
  /** Indicative "From" price with realistic efficiency savings applied. */
  fromPrice: number;
  flightTimeLabel: string;
  distanceNm: number;
}

const hoursLabel = (h: number) => {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
};

export function priceRoute(route: PopularRoute, segment: CustomerSegment = "retail"): RouteFare {
  const aircraft = smartFareAircraft(route.recommendedAircraftKey);
  const fare = computeMissionFare({
    aircraftKey: route.recommendedAircraftKey,
    fromCode: route.fromCode,
    toCode: route.toCode,
    passengers: route.typicalPassengers,
    segment,
    // "From" prices assume the best realistic efficiency: a matched empty leg
    // and a flexible departure. The booking flow re-prices the real mission.
    emptyLegMatch: true,
    flexibleDeparture: true,
  });
  return {
    route,
    from: airportByCode(route.fromCode),
    to: airportByCode(route.toCode),
    aircraft,
    fare,
    fromPrice: fare.total,
    flightTimeLabel: hoursLabel(fare.blockHours),
    distanceNm: fare.distanceNm,
  };
}

export const pricePopularRoutes = (segment: CustomerSegment = "retail"): RouteFare[] =>
  POPULAR_ROUTES.map((r) => priceRoute(r, segment));

/** Indicative starting mission price for an aircraft on its typical corridor. */
export function startingFromPrice(aircraftKey: string, segment: CustomerSegment = "retail"): number {
  return computeMissionFare({
    aircraftKey,
    fromCode: "WIL",
    toCode: "HKKE",
    passengers: 4,
    segment,
    emptyLegMatch: true,
    flexibleDeparture: true,
  }).total;
}
