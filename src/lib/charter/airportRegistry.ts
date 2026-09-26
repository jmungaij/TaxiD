/**
 * SAFARID Air airport registry — the seeded East African airport / airstrip
 * database behind the charter search widget.
 *
 * Pure data + search helpers (no React, no fetch) so the widget, the results
 * page and the pricing engine all resolve geography from one source. Codes and
 * coordinates are the production seed; operator availability is indicative and
 * is overridden by live inventory when a search runs.
 */
import { distanceNm } from "./aviationPricing";
import type { AirPoint } from "./airports";

export type AirportType = "international" | "domestic" | "private" | "airstrip" | "helipad";

export interface AirportRecord {
  /** IATA where one exists, otherwise the ICAO code. Always unique. */
  code: string;
  iata: string | null;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  region: string;
  lat: number;
  lng: number;
  /** Metres. 0 for helipads. */
  runwayM: number;
  type: AirportType;
  customs: boolean;
  nightOps: boolean;
  fuel: boolean;
  vipLounge: boolean;
  groundHandling: boolean;
  /** Indicative number of operators with based or regular capacity. */
  operators: number;
}

const a = (
  iata: string | null,
  icao: string | null,
  name: string,
  city: string,
  country: string,
  region: string,
  lat: number,
  lng: number,
  runwayM: number,
  type: AirportType,
  flags: Partial<Pick<AirportRecord, "customs" | "nightOps" | "fuel" | "vipLounge" | "groundHandling" | "operators">> = {},
): AirportRecord => ({
  code: (iata ?? icao ?? name).toUpperCase(),
  iata,
  icao,
  name,
  city,
  country,
  region,
  lat,
  lng,
  runwayM,
  type,
  customs: flags.customs ?? false,
  nightOps: flags.nightOps ?? false,
  fuel: flags.fuel ?? false,
  vipLounge: flags.vipLounge ?? false,
  groundHandling: flags.groundHandling ?? false,
  operators: flags.operators ?? 2,
});

const FULL = { customs: true, nightOps: true, fuel: true, vipLounge: true, groundHandling: true, operators: 14 };
const REGIONAL = { nightOps: true, fuel: true, groundHandling: true, operators: 6 };
const BUSH = { operators: 3 };

export const AIRPORTS: AirportRecord[] = [
  // ---- Kenya -------------------------------------------------------------
  a("WIL", "HKNW", "Wilson Airport", "Nairobi", "Kenya", "Nairobi", -1.3218, 36.8148, 1463, "domestic", { ...FULL, customs: false, operators: 38 }),
  a("NBO", "HKJK", "Jomo Kenyatta International", "Nairobi", "Kenya", "Nairobi", -1.3192, 36.9278, 4117, "international", { ...FULL, operators: 22 }),
  a("MBA", "HKMO", "Moi International", "Mombasa", "Kenya", "Coast", -4.0348, 39.5942, 3350, "international", { ...FULL, operators: 12 }),
  a("KIS", "HKKI", "Kisumu International", "Kisumu", "Kenya", "Nyanza", -0.0861, 34.7289, 3300, "international", { ...REGIONAL, customs: true, operators: 8 }),
  a("EDL", "HKEL", "Eldoret International", "Eldoret", "Kenya", "Rift Valley", 0.4045, 35.2389, 3475, "international", { ...REGIONAL, customs: true }),
  a("MYD", "HKML", "Malindi Airport", "Malindi", "Kenya", "Coast", -3.2293, 40.1017, 1400, "domestic", REGIONAL),
  a("UKA", "HKUK", "Ukunda (Diani) Airstrip", "Diani", "Kenya", "Coast", -4.2933, 39.5711, 1400, "domestic", { ...REGIONAL, vipLounge: true }),
  a("LAU", "HKLU", "Manda Airport", "Lamu", "Kenya", "Coast", -2.2523, 40.9131, 1300, "domestic", { fuel: true, operators: 5 }),
  a("NYK", "HKNY", "Nanyuki Airfield", "Nanyuki", "Kenya", "Mt Kenya", -0.0624, 37.0411, 1600, "domestic", { fuel: true, operators: 6 }),
  a("ASV", "HKAM", "Amboseli Airstrip", "Amboseli", "Kenya", "Rift Valley", -2.6451, 37.2531, 1500, "airstrip", BUSH),
  a(null, "HKKE", "Keekorok Airstrip", "Maasai Mara", "Kenya", "Rift Valley", -1.5867, 35.2547, 1400, "airstrip", BUSH),
  a(null, "HKOL", "Ol Kiombo Airstrip", "Maasai Mara", "Kenya", "Rift Valley", -1.4333, 35.2833, 1300, "airstrip", BUSH),
  a(null, "HKMN", "Mara North Airstrip", "Maasai Mara", "Kenya", "Rift Valley", -1.2167, 35.2167, 1200, "airstrip", BUSH),
  a(null, "HKMU", "Musiara Airstrip", "Maasai Mara", "Kenya", "Rift Valley", -1.2833, 35.05, 1200, "airstrip", BUSH),
  a(null, "HKMS", "Mara Serena Airstrip", "Maasai Mara", "Kenya", "Rift Valley", -1.4061, 35.0083, 1300, "airstrip", BUSH),
  a("UAS", "HKSB", "Samburu Airstrip", "Samburu", "Kenya", "Northern", 0.5306, 37.5342, 1400, "airstrip", BUSH),
  a(null, "HKLW", "Lewa Downs Airstrip", "Lewa", "Kenya", "Mt Kenya", 0.2033, 37.4167, 1500, "airstrip", { operators: 4 }),
  a("LOK", "HKLO", "Lodwar Airport", "Lodwar", "Kenya", "Turkana", 3.1219, 35.6087, 1800, "domestic", { fuel: true, operators: 4 }),
  a("LKG", "HKLK", "Lokichoggio Airport", "Lokichoggio", "Kenya", "Turkana", 4.2041, 34.3482, 3100, "domestic", { fuel: true, customs: true, operators: 5 }),
  a("WJR", "HKWJ", "Wajir Airport", "Wajir", "Kenya", "Northern", 1.7332, 40.0915, 3400, "domestic", { fuel: true, operators: 3 }),
  a(null, "HKUP", "Upper Hill Helipad", "Nairobi", "Kenya", "Nairobi", -1.2996, 36.8123, 0, "helipad", { operators: 4 }),

  // ---- Uganda ------------------------------------------------------------
  a("EBB", "HUEN", "Entebbe International", "Entebbe", "Uganda", "Central", 0.0424, 32.4435, 3658, "international", { ...FULL, operators: 11 }),
  a(null, "HUKJ", "Kajjansi Airfield", "Kampala", "Uganda", "Central", 0.1972, 32.5528, 1100, "airstrip", { fuel: true, operators: 5 }),
  a("RUA", "HUAR", "Arua Airport", "Arua", "Uganda", "Northern", 3.05, 30.9167, 1500, "domestic", BUSH),
  a("ULU", "HUGU", "Gulu Airport", "Gulu", "Uganda", "Northern", 2.8055, 32.2718, 3100, "domestic", { fuel: true, operators: 3 }),
  a(null, "HUKD", "Kidepo Airstrip", "Kidepo Valley", "Uganda", "Northern", 3.7167, 33.75, 1400, "airstrip", BUSH),

  // ---- Tanzania ----------------------------------------------------------
  a("DAR", "HTDA", "Julius Nyerere International", "Dar es Salaam", "Tanzania", "Coast", -6.8781, 39.2026, 3000, "international", { ...FULL, operators: 13 }),
  a("ARK", "HTAR", "Arusha Airport", "Arusha", "Tanzania", "Northern", -3.3677, 36.6333, 1620, "domestic", { ...REGIONAL, operators: 9 }),
  a("JRO", "HTKJ", "Kilimanjaro International", "Kilimanjaro", "Tanzania", "Northern", -3.4294, 37.0745, 3600, "international", FULL),
  a("ZNZ", "HTZA", "Abeid Amani Karume International", "Zanzibar", "Tanzania", "Zanzibar", -6.2220, 39.2249, 3000, "international", { ...FULL, operators: 10 }),
  a(null, "HTSN", "Seronera Airstrip", "Serengeti", "Tanzania", "Northern", -2.4581, 34.8225, 1600, "airstrip", BUSH),
  a(null, "HTGR", "Grumeti Airstrip", "Serengeti", "Tanzania", "Northern", -2.1167, 34.2, 1400, "airstrip", BUSH),
  a("MWZ", "HTMW", "Mwanza Airport", "Mwanza", "Tanzania", "Lake Zone", -2.4445, 32.9327, 3300, "international", REGIONAL),
  a("DOD", "HTDO", "Dodoma Airport", "Dodoma", "Tanzania", "Central", -6.1704, 35.7526, 2000, "domestic", { fuel: true, operators: 3 }),

  // ---- Rwanda / Burundi / South Sudan / Ethiopia -------------------------
  a("KGL", "HRYR", "Kigali International", "Kigali", "Rwanda", "Kigali", -1.9686, 30.1395, 3500, "international", { ...FULL, operators: 9 }),
  a("KME", "HRZA", "Kamembe Airport", "Kamembe", "Rwanda", "Western", -2.4622, 28.9077, 2000, "domestic", { ...REGIONAL, customs: true }),
  a("BJM", "HBBA", "Bujumbura International", "Bujumbura", "Burundi", "Bujumbura", -3.3240, 29.3185, 3600, "international", { ...REGIONAL, customs: true, vipLounge: true }),
  a("JUB", "HSSJ", "Juba International", "Juba", "South Sudan", "Central Equatoria", 4.8720, 31.6011, 2400, "international", { ...FULL, operators: 7 }),
  a("ADD", "HAAB", "Bole International", "Addis Ababa", "Ethiopia", "Addis Ababa", 8.9779, 38.7993, 3800, "international", { ...FULL, operators: 8 }),
  a("DIR", "HADR", "Dire Dawa Airport", "Dire Dawa", "Ethiopia", "Dire Dawa", 9.6247, 41.8542, 2600, "international", { ...REGIONAL, customs: true }),
];

export const AIRPORT_TYPE_LABEL: Record<AirportType, string> = {
  international: "International",
  domestic: "Domestic",
  private: "Private",
  airstrip: "Airstrip",
  helipad: "Helipad",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Airport lookup by IATA, ICAO, name, city, region or country. */
export function searchAirports(query: string, limit = 8): AirportRecord[] {
  const q = norm(query);
  if (!q) return AIRPORTS.filter((x) => x.type === "international" || x.operators >= 10).slice(0, limit);
  const score = (x: AirportRecord) => {
    if (norm(x.iata ?? "") === q || norm(x.icao ?? "") === q) return 0;
    if (norm(x.city) === q || norm(x.name) === q) return 1;
    if (norm(x.city).startsWith(q) || norm(x.name).startsWith(q)) return 2;
    if (norm(x.name).includes(q) || norm(x.city).includes(q)) return 3;
    if (norm(x.region).includes(q) || norm(x.country).includes(q)) return 4;
    return 99;
  };
  return AIRPORTS.map((x) => ({ x, s: score(x) }))
    .filter((r) => r.s < 99)
    .sort((p, n) => p.s - n.s || n.x.operators - p.x.operators)
    .slice(0, limit)
    .map((r) => r.x);
}

/** Exact resolution of a stored code (IATA or ICAO) to a registry record. */
export function airportByCode(code: string | null | undefined): AirportRecord | null {
  if (!code) return null;
  const u = code.trim().toUpperCase();
  return AIRPORTS.find((x) => x.code === u || x.iata === u || x.icao === u) ?? null;
}

export const airportLabel = (x: AirportRecord) =>
  `${x.city} · ${x.name}${x.iata ? ` (${x.iata})` : ""}`;

/** Registry record projected onto the map/pricing `AirPoint` shape. */
export const toAirPoint = (x: AirportRecord): AirPoint => ({
  code: x.code, name: x.city, country: x.country, lat: x.lat, lng: x.lng,
});

export interface RouteInsight {
  distanceNm: number;
  distanceKm: number;
  /** Indicative block time in hours at a 240kt planning speed. */
  hours: number;
  label: string;
}

/** Indicative distance + flight time shown in the destination picker. */
export function routeInsight(from: AirportRecord, to: AirportRecord, cruiseKts = 240): RouteInsight {
  const nm = Math.round(distanceNm(toAirPoint(from), toAirPoint(to)));
  const hours = nm / cruiseKts + 0.25;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return {
    distanceNm: nm,
    distanceKm: Math.round(nm * 1.852),
    hours: Math.round(hours * 100) / 100,
    label: h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`,
  };
}
