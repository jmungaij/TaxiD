/**
 * Premium charter collections.
 *
 * The public charter marketplace no longer lists two dozen near-identical
 * vehicle cards. Fleet is curated into outcome-led collections ("move 48
 * delegates", "run a flawless protocol movement") and the individual assets are
 * revealed only once a visitor has chosen the mission they need to solve.
 *
 * Prices are never hard-coded here: every band still comes from the governed
 * `ROAD_FLEET` registry.
 */
import { ROAD_FLEET, type RoadFleetGroup, type RoadFleetVehicle } from "./assetPricingProfiles";

import coverCorporate from "@/assets/charter/collection-corporate.jpg";
import coverVip from "@/assets/charter/collection-vip.jpg";
import coverSafari from "@/assets/charter/collection-safari.jpg";
import coverEducation from "@/assets/charter/collection-education.jpg";
import coverExecutive from "@/assets/charter/hero-executive-arrival.jpg";

export type AmenityKey = "chauffeur" | "aircon" | "luggage" | "wifi" | "insured" | "tracking" | "washroom" | "guide" | "beltsafe";

export interface CharterCollection {
  id: string;
  title: string;
  tagline: string;
  cover: string;
  groups: RoadFleetGroup[];
  /** Outcome statements — what the buyer is actually trying to achieve. */
  missions: string[];
  amenities: AmenityKey[];
  badge?: string;
}

export const CHARTER_COLLECTIONS: CharterCollection[] = [
  {
    id: "executive",
    title: "Executive Travel",
    tagline: "Arrive composed. Impress before the meeting starts.",
    cover: coverExecutive,
    groups: ["van", "coach"],
    missions: ["Board and client visits", "Hotel and venue transfers", "Executive road tours", "Investor roadshows"],
    amenities: ["chauffeur", "aircon", "wifi", "luggage", "insured"],
    badge: "Most requested",
  },
  {
    id: "corporate",
    title: "Corporate Mobility",
    tagline: "Move whole teams on schedule, on budget, on one invoice.",
    cover: coverCorporate,
    groups: ["shuttle", "minibus"],
    missions: ["Staff shuttles and commuter routes", "Conferences and conventions", "Team building and retreats", "Site and plant visits"],
    amenities: ["tracking", "aircon", "insured", "wifi"],
  },
  {
    id: "vip",
    title: "VIP & Protocol",
    tagline: "Discreet, protocol-ready movement for principals and delegations.",
    cover: coverVip,
    groups: ["double_deck", "coach"],
    missions: ["Government and diplomatic protocol", "International delegations", "Airport VIP transfers", "Ceremonial and state events"],
    amenities: ["chauffeur", "insured", "tracking", "washroom"],
    badge: "Vetted chauffeurs",
  },
  {
    id: "tourism",
    title: "Tourism & Safari",
    tagline: "Unforgettable journeys, safely orchestrated end to end.",
    cover: coverSafari,
    groups: ["tourism"],
    missions: ["Safari circuits and park transfers", "Coast and lake excursions", "Incentive travel groups", "Photographic expeditions"],
    amenities: ["guide", "aircon", "luggage", "insured"],
  },
  {
    id: "education",
    title: "Schools & Universities",
    tagline: "Safety-certified transport parents and boards trust.",
    cover: coverEducation,
    groups: ["school"],
    missions: ["School excursions and field trips", "Sports fixtures and galas", "Campus and hostel shuttles", "Graduation and open days"],
    amenities: ["beltsafe", "tracking", "insured", "aircon"],
  },
];

export const collectionById = (id: string) => CHARTER_COLLECTIONS.find((c) => c.id === id) ?? null;

/** Governed fleet inside a collection, cheapest first. */
export function collectionFleet(collection: CharterCollection): RoadFleetVehicle[] {
  return ROAD_FLEET.filter((v) => collection.groups.includes(v.group)).sort((a, b) => a.baseKes - b.baseKes);
}

/** Indicative "from" figure for a collection, straight out of the governed band. */
export function collectionFromKes(collection: CharterCollection): number {
  const fleet = collectionFleet(collection);
  return fleet.length ? Math.min(...fleet.map((v) => v.minKes)) : 0;
}

export function collectionSeatRange(collection: CharterCollection): string {
  const fleet = collectionFleet(collection);
  if (!fleet.length) return "—";
  const seats = fleet.map((v) => v.seats);
  return `${Math.min(...seats)}–${Math.max(...seats)} seats`;
}

/**
 * Recommends the best-fit collection + asset for a stated mission — the "AI
 * recommendation" surfaced on the marketplace. Deterministic, explainable and
 * always inside the governed band.
 */
export function recommendCharter(input: { passengers: number; days: number; intent?: string }) {
  const intent = (input.intent ?? "").toLowerCase();
  const preferred =
    /safari|tour|park|game/.test(intent) ? "tourism" :
    /school|student|campus|university|pupil/.test(intent) ? "education" :
    /protocol|government|delegation|diplomat|state/.test(intent) ? "vip" :
    /staff|shuttle|commute|conference|retreat|team/.test(intent) ? "corporate" :
    "executive";

  const collection = collectionById(preferred) ?? CHARTER_COLLECTIONS[0];
  const pool = collectionFleet(collection).filter((v) => v.seats >= Math.max(1, input.passengers));
  const fallback = ROAD_FLEET.filter((v) => v.seats >= Math.max(1, input.passengers)).sort((a, b) => a.baseKes - b.baseKes);
  const vehicle = pool[0] ?? fallback[0] ?? ROAD_FLEET[ROAD_FLEET.length - 1];
  const days = Math.max(1, input.days || 1);

  return {
    collection,
    vehicle,
    days,
    reason: pool.length
      ? `Best balance of comfort and cost for ${input.passengers} travellers over ${days} day${days > 1 ? "s" : ""}.`
      : `Closest governed capacity match for ${input.passengers} travellers — a second vehicle may be added.`,
    indicativeFromKes: vehicle.minKes * days,
    indicativeToKes: vehicle.maxKes * days,
  };
}
