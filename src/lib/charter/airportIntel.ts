/**
 * Airport intelligence — the briefing shown when a departure or arrival
 * airfield is selected.
 *
 * Derives imagery, runway capability notes, VIP lounge status, an estimated
 * check-in time and curated nearby hotels from the seeded airport registry so
 * the search results and the booking itinerary read from one source.
 */
import intlImg from "@/assets/charter/airport-international.jpg";
import fboImg from "@/assets/charter/airport-fbo.jpg";
import airstripImg from "@/assets/charter/airport-airstrip.jpg";
import type { AirportRecord } from "./airportRegistry";

export interface HotelSuggestion {
  name: string;
  /** Drive time from the terminal / FBO, in minutes. */
  driveMinutes: number;
  tier: "Luxury" | "Business" | "Lodge";
}

/** Curated partner hotels by city, with a regional fallback. */
const HOTELS: Record<string, HotelSuggestion[]> = {
  Nairobi: [
    { name: "Villa Rosa Kempinski", driveMinutes: 20, tier: "Luxury" },
    { name: "Hemingways Nairobi", driveMinutes: 25, tier: "Luxury" },
    { name: "Radisson Blu Upper Hill", driveMinutes: 15, tier: "Business" },
  ],
  Mombasa: [
    { name: "Serena Beach Resort & Spa", driveMinutes: 35, tier: "Luxury" },
    { name: "PrideInn Paradise Beach", driveMinutes: 30, tier: "Business" },
    { name: "Voyager Beach Resort", driveMinutes: 25, tier: "Business" },
  ],
  Kisumu: [
    { name: "Acacia Premier Hotel", driveMinutes: 12, tier: "Business" },
    { name: "Kisumu Hotel", driveMinutes: 15, tier: "Business" },
  ],
  Eldoret: [{ name: "Boma Inn Eldoret", driveMinutes: 18, tier: "Business" }],
  Diani: [
    { name: "Almanara Luxury Resort", driveMinutes: 10, tier: "Luxury" },
    { name: "Baobab Beach Resort", driveMinutes: 15, tier: "Business" },
  ],
  Zanzibar: [
    { name: "Park Hyatt Zanzibar", driveMinutes: 20, tier: "Luxury" },
    { name: "Zuri Zanzibar", driveMinutes: 55, tier: "Luxury" },
  ],
  Dar: [{ name: "Hyatt Regency Kilimanjaro", driveMinutes: 20, tier: "Luxury" }],
  Kampala: [{ name: "Kampala Serena Hotel", driveMinutes: 45, tier: "Luxury" }],
  Kigali: [{ name: "Kigali Serena Hotel", driveMinutes: 15, tier: "Luxury" }],
};

const LODGE_FALLBACK: HotelSuggestion[] = [
  { name: "Partner safari lodge (concierge assigned)", driveMinutes: 20, tier: "Lodge" },
  { name: "Tented camp transfer on request", driveMinutes: 35, tier: "Lodge" },
];

export function hotelsNear(airport: AirportRecord): HotelSuggestion[] {
  const key = Object.keys(HOTELS).find((c) => airport.city.toLowerCase().includes(c.toLowerCase()));
  return key ? HOTELS[key] : LODGE_FALLBACK;
}

/** Photographic context for the airfield, chosen by facility type. */
export function airportImage(airport: AirportRecord): string {
  if (airport.type === "international") return intlImg;
  if (airport.type === "airstrip" || airport.type === "helipad") return airstripImg;
  return fboImg;
}

export interface RunwayIntel {
  label: string;
  /** Largest aircraft class the runway comfortably accepts. */
  accepts: string;
  surface: string;
}

export function runwayIntel(airport: AirportRecord): RunwayIntel {
  const m = airport.runwayM;
  if (!m) return { label: "Helipad — no runway", accepts: "Helicopters only", surface: "Prepared pad" };
  const accepts =
    m >= 3000 ? "Heavy jets and airliners"
      : m >= 1800 ? "Midsize jets and turboprops"
        : m >= 1200 ? "Light jets and turboprops"
          : "Turboprops and piston aircraft";
  const surface = airport.type === "airstrip" ? "Murram / gravel" : "Asphalt";
  return { label: `${m.toLocaleString()} m runway`, accepts, surface };
}

/**
 * Estimated arrival-before-departure time. Charter check-in is far shorter
 * than scheduled airline travel; borders and bush strips add handling time.
 */
export function checkInMinutes(airport: AirportRecord): number {
  let mins = airport.type === "international" ? 45 : airport.type === "domestic" ? 25 : 15;
  if (airport.customs) mins += 15;
  if (!airport.groundHandling) mins += 10;
  return mins;
}

export interface AirportIntel {
  image: string;
  runway: RunwayIntel;
  vipLounge: boolean;
  loungeNote: string;
  checkInMinutes: number;
  hotels: HotelSuggestion[];
}

export function airportIntel(airport: AirportRecord): AirportIntel {
  return {
    image: airportImage(airport),
    runway: runwayIntel(airport),
    vipLounge: airport.vipLounge,
    loungeNote: airport.vipLounge
      ? "Private VIP lounge with expedited screening"
      : airport.groundHandling
        ? "Handled through the executive apron — no dedicated lounge"
        : "Open-air handling; crew meets you at the aircraft",
    checkInMinutes: checkInMinutes(airport),
    hotels: hotelsNear(airport),
  };
}
