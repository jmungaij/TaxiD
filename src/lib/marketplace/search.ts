/**
 * MARKETPLACE SEARCH — one search across the capacity operators have published.
 *
 * Two sources, both real and both approved:
 *   1. Provider capacity — what drivers, fleet operators, charter operators and
 *      logistics operators submitted through the provider portal and staff
 *      approved. Covers all four service families.
 *   2. Charter inventory — the existing governed charter fleet.
 *
 * Nothing is ever invented. Where no capacity has been approved for a family,
 * the result set is empty and the page says so, routing the customer into the
 * governed request pipeline instead.
 */
import { supabase } from "@/integrations/supabase/client";
import { vehicleImageFor } from "@/lib/charter/vehicleImages";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const SERVICE_FAMILIES = ["ride", "charter", "rental", "logistics"] as const;
export type ServiceFamily = (typeof SERVICE_FAMILIES)[number];

export const FAMILY_LABEL: Record<ServiceFamily, string> = {
  ride: "Rides",
  charter: "Charter",
  rental: "Rental & leasing",
  logistics: "Delivery & logistics",
};

export const FAMILY_BLURB: Record<ServiceFamily, string> = {
  ride: "Everyday rides, airport transfers and scheduled journeys.",
  charter: "Ground, air and marine charter for groups, projects and events.",
  rental: "Vehicles, equipment and machinery on hire or long-term lease.",
  logistics: "Parcels, courier work, freight and distribution movements.",
};

/** Vehicle types offered per family, in the customer's words. */
export const VEHICLE_TYPES: Record<ServiceFamily, string[]> = {
  ride: ["Any vehicle", "Taxi", "Comfort", "Executive saloon", "SUV", "Van"],
  charter: ["Any vehicle", "Bus or coach", "Van or shuttle", "Aircraft", "Helicopter", "Boat or vessel"],
  rental: ["Any vehicle", "Car", "SUV", "Van", "Truck or hauler", "Heavy machinery", "Event equipment"],
  logistics: ["Any vehicle", "Motorcycle", "Van", "Pickup", "Truck", "Container hauler"],
};

/** Charter inventory category slugs mapped to the marketplace vehicle wording. */
const CHARTER_CATEGORY: Record<string, string[]> = {
  "bus-charter": ["Bus or coach", "Van or shuttle"],
  "aircraft-charter": ["Aircraft", "Helicopter"],
  "marine-charter": ["Boat or vessel"],
};

export interface CapacityListing {
  id: string;
  /** Present for operator-published capacity; used to record the enquiry. */
  capacityId?: string;
  family: ServiceFamily;
  name: string;
  operator: string;
  base: string;
  capacity: string | null;
  spec: string | null;
  /** Operator-uploaded photograph paths in the capacity-photos bucket. */
  photoPaths: string[];
  /** Governed fleet photograph, used only for the charter fleet source. */
  fleetImage: string | null;
  seats: number | null;
  units: number;
  coverage: string | null;
  registration: string | null;
  notes: string | null;
  rate: number | null;
  rateBasis: string;
  currency: string;
  status: string;
  availableFrom: string | null;
  availableTo: string | null;
  category: string;
  /** True when the operator flagged this as a test listing, not real capacity. */
  isTest: boolean;
  source: "provider" | "charter_fleet";
}


export interface MarketplaceQuery {
  family: ServiceFamily;
  city: string;
  date: string;
  vehicleType: string;
}

export const EMPTY_QUERY: MarketplaceQuery = {
  family: "charter",
  city: "",
  date: "",
  vehicleType: "Any vehicle",
};

function matchesVehicle(slug: string, vehicleType: string): boolean {
  if (!vehicleType || vehicleType === "Any vehicle") return true;
  return (CHARTER_CATEGORY[slug] ?? []).includes(vehicleType);
}

const RATE_BASIS_LABEL: Record<string, string> = {
  per_trip: "per trip",
  per_hour: "per hour",
  per_day: "per day",
  per_km: "per km",
  per_tonne: "per tonne",
  on_request: "on request",
};

export const rateBasisLabel = (b: string) => RATE_BASIS_LABEL[b] ?? b;

/** Approved operator capacity, from the provider portal. All four families. */
async function providerCapacity(q: MarketplaceQuery): Promise<CapacityListing[]> {
  const { data, error } = await db.rpc("marketplace_capacity_search", {
    p: {
      family: q.family,
      city: q.city.trim(),
      date: q.date || "",
      vehicle_type: q.vehicleType === "Any vehicle" ? "" : q.vehicleType,
    },
  });
  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: `pc:${String(r.id)}`,
    capacityId: String(r.id),
    family: String(r.family) as ServiceFamily,
    name: String(r.title),
    operator: String(r.provider_name),
    base: String(r.base_city),
    capacity:
      r.seats && Number(r.seats) > 0
        ? `${Number(r.seats)} seats${Number(r.units) > 1 ? ` · ${Number(r.units)} vehicles` : ""}`
        : Number(r.units) > 1
          ? `${Number(r.units)} vehicles`
          : null,
    spec: [r.vehicle_type ? String(r.vehicle_type) : null, r.spec ? String(r.spec) : null]
      .filter(Boolean)
      .join(" · ") || null,
    photoPaths: Array.isArray(r.photo_paths) ? (r.photo_paths as string[]).map(String) : [],
    fleetImage: null,
    seats: r.seats === null || r.seats === undefined ? null : Number(r.seats),
    units: Number(r.units ?? 1),
    coverage: r.coverage_area ? String(r.coverage_area) : null,
    registration: r.registration_ref ? String(r.registration_ref) : null,
    notes: r.notes ? String(r.notes) : null,
    rate: r.rate_amount === null || r.rate_amount === undefined ? null : Number(r.rate_amount),
    rateBasis: String(r.rate_basis ?? "per_day"),
    currency: String(r.currency ?? "KES"),
    status: "available",
    availableFrom: r.available_from ? String(r.available_from) : null,
    availableTo: r.available_to ? String(r.available_to) : null,
    category: String(r.vehicle_type ?? ""),
    isTest: r.is_test === true,
    source: "provider" as const,
  }));

}

/** The existing governed charter fleet. */
async function charterFleet(q: MarketplaceQuery): Promise<CapacityListing[]> {
  const { data, error } = await db
    .from("charter_inventory")
    .select(
      "id, category_slug, name, spec, capacity, base_rate, currency, status, operator_name, home_base, available_from, available_to",
    )
    .eq("active", true)
    .order("base_rate", { ascending: true });

  if (error) throw new Error(error.message);

  const city = q.city.trim().toLowerCase();

  return ((data ?? []) as Record<string, unknown>[])
    .filter((r) => matchesVehicle(String(r.category_slug), q.vehicleType))
    .filter((r) => !city || String(r.home_base ?? "").toLowerCase().includes(city))
    .filter((r) => {
      if (!q.date) return true;
      const from = r.available_from ? String(r.available_from) : null;
      const to = r.available_to ? String(r.available_to) : null;
      if (from && q.date < from) return false;
      if (to && q.date > to) return false;
      return true;
    })
    .map((r) => ({
      id: `ci:${String(r.id)}`,
      family: "charter" as ServiceFamily,
      name: String(r.name),
      operator: String(r.operator_name ?? "Participating operator"),
      base: String(r.home_base ?? "Base not stated"),
      capacity: r.capacity ? String(r.capacity) : null,
      spec: r.spec ? String(r.spec) : null,
      photoPaths: [],
      fleetImage: vehicleImageFor(String(r.name), r.spec ? String(r.spec) : null),
      seats: null,
      units: 1,
      coverage: null,
      registration: null,
      notes: null,
      rate: r.base_rate === null || r.base_rate === undefined ? null : Number(r.base_rate),
      rateBasis: "per_day",

      currency: String(r.currency ?? "USD"),
      status: String(r.status ?? "available"),
      availableFrom: r.available_from ? String(r.available_from) : null,
      availableTo: r.available_to ? String(r.available_to) : null,
      category: String(r.category_slug),
      isTest: false,
      source: "charter_fleet" as const,
    }));
}

/**
 * Returns the approved capacity that matches the brief, operator capacity first
 * and the charter fleet after it. An empty list is a truthful answer.
 */
export async function searchMarketplace(q: MarketplaceQuery): Promise<CapacityListing[]> {
  const [provider, fleet] = await Promise.all([
    providerCapacity(q),
    q.family === "charter" ? charterFleet(q) : Promise.resolve([] as CapacityListing[]),
  ]);
  return [...provider, ...fleet];
}

/** Cities the published capacity is actually based in — never a made-up list. */
export function basesFrom(listings: CapacityListing[]): string[] {
  return Array.from(new Set(listings.map((l) => l.base))).sort();
}

/**
 * Hands the brief to the governed request pipeline. The customer portal request
 * form reads these parameters, so nothing is retyped.
 */
export function requestHandoffPath(q: MarketplaceQuery, listing?: CapacityListing): string {
  const p = new URLSearchParams();
  p.set("family", q.family);
  if (q.city) p.set("city", q.city);
  if (q.date) p.set("date", q.date);
  if (q.vehicleType && q.vehicleType !== "Any vehicle") p.set("vehicle", q.vehicleType);
  if (listing) {
    p.set("capacity", `${listing.name} — ${listing.operator}`);
    if (listing.capacityId) p.set("capacity_id", listing.capacityId);
    if (listing.base) p.set("city", listing.base);
  }
  return `/dashboard/service-requests?${p.toString()}`;
}
