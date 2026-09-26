import { formatMoney } from "./catalog";
/**
 * Ground transportation package builder.
 *
 * Shared by the search experience and the booking itinerary so the chauffeur
 * and transfer legs quoted during search are the exact legs (and prices) the
 * customer confirms and pays for.
 */

export type GroundKey = "chauffeur" | "suv" | "airport" | "destination" | "hotel";

export interface GroundService {
  key: GroundKey;
  label: string;
  /** Indicative price in USD for one leg. */
  price: number;
  blurb: string;
  /** Label for the location field shown when the service is selected. */
  locationLabel: string;
  /** Whether a pickup time is meaningful for this leg. */
  timed: boolean;
}

export const GROUND_SERVICES: GroundService[] = [
  {
    key: "chauffeur",
    label: "Chauffeur pickup",
    price: 60,
    blurb: "Vetted chauffeur meets you at your door and drives you to the FBO.",
    locationLabel: "Pickup address",
    timed: true,
  },
  {
    key: "suv",
    label: "Executive SUV",
    price: 120,
    blurb: "Premium SUV with bottled water, Wi-Fi and up to 5 bags.",
    locationLabel: "Pickup address",
    timed: true,
  },
  {
    key: "airport",
    label: "Airport transfer",
    price: 45,
    blurb: "Terminal-to-FBO transfer with airside escort where permitted.",
    locationLabel: "Terminal / FBO",
    timed: true,
  },
  {
    key: "destination",
    label: "Destination transfer",
    price: 75,
    blurb: "Car waiting on arrival to take you to your first appointment.",
    locationLabel: "Drop-off address",
    timed: false,
  },
  {
    key: "hotel",
    label: "Hotel transfer",
    price: 55,
    blurb: "Door-to-door hotel run, luggage handled by the crew.",
    locationLabel: "Hotel name",
    timed: false,
  },
];

export const groundServiceByKey = (key: string): GroundService | undefined =>
  GROUND_SERVICES.find((g) => g.key === key);

/** Per-service pickup detail captured in the itinerary builder. */
export interface GroundDetail {
  location: string;
  time: string;
  passengers: number;
  notes: string;
}

export const emptyGroundDetail = (passengers = 1): GroundDetail => ({
  location: "",
  time: "",
  passengers: Math.max(1, passengers),
  notes: "",
});

export interface GroundSelection {
  key: GroundKey;
  detail: GroundDetail;
}

/** Total price of the selected ground legs, in USD. */
export function groundTotal(keys: string[]): number {
  return keys.reduce((sum, k) => sum + (groundServiceByKey(k)?.price ?? 0), 0);
}

/**
 * A selected leg is complete once its location is filled in, plus a time when
 * the leg is time-critical (pickups). Incomplete legs block confirmation so
 * operations never receives an unactionable transfer request.
 */
export function groundSelectionComplete(keys: string[], details: Record<string, GroundDetail>): boolean {
  return keys.every((k) => {
    const svc = groundServiceByKey(k);
    if (!svc) return false;
    const d = details[k];
    if (!d?.location.trim()) return false;
    return svc.timed ? Boolean(d.time.trim()) : true;
  });
}

/** Human-readable itinerary lines for confirmations and downloadable summaries. */
export function groundSummaryLines(keys: string[], details: Record<string, GroundDetail>): string[] {
  return keys.map((k) => {
    const svc = groundServiceByKey(k);
    if (!svc) return k;
    const d = details[k];
    const bits = [svc.label];
    if (d?.location) bits.push(d.location);
    if (d?.time) bits.push(d.time);
    if (d?.passengers) bits.push(`${d.passengers} pax`);
    return `${bits.join(" · ")} — ${formatMoney(svc.price, "USD")}`;
  });
}

/** Itinerary facts the ground package must stay consistent with. */
export interface ItineraryContext {
  origin: string;
  destination: string;
  /** Departure date (YYYY-MM-DD). */
  date: string;
  /** Number of named passengers on the manifest. */
  manifestPassengers: number;
  /** Cabin capacity of the quoted aircraft. */
  cabinSeats?: number;
}

export interface GroundIssue {
  key: string;
  field: "location" | "time" | "passengers" | "package";
  message: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validates the ground package against the itinerary that was quoted.
 *
 * Beyond completeness we check the conflicts operations actually sees:
 * pickups scheduled after an arrival-side leg, more ground passengers than the
 * manifest (or the cabin) can carry, duplicate/contradictory legs, and pickup
 * locations that contradict the flown sector.
 */
export function validateGroundPackage(
  keys: string[],
  details: Record<string, GroundDetail>,
  ctx: ItineraryContext,
): GroundIssue[] {
  const issues: GroundIssue[] = [];
  if (!keys.length) return issues;

  const cap = Math.max(1, ctx.cabinSeats ?? ctx.manifestPassengers ?? 1);
  const departureLegs = keys.filter((k) => k === "chauffeur" || k === "suv" || k === "airport");
  if (departureLegs.length > 1) {
    issues.push({
      key: departureLegs[1],
      field: "package",
      message: "Only one departure-side pickup can be dispatched — remove the duplicate leg.",
    });
  }

  const times: Array<{ key: string; time: string }> = [];

  for (const k of keys) {
    const svc = groundServiceByKey(k);
    if (!svc) {
      issues.push({ key: k, field: "package", message: "Unknown ground service." });
      continue;
    }
    const d = details[k];
    const location = (d?.location ?? "").trim();
    const time = (d?.time ?? "").trim();
    const pax = Number(d?.passengers ?? 0);

    if (!location) {
      issues.push({ key: k, field: "location", message: `${svc.locationLabel} is required.` });
    } else if (location.length < 3) {
      issues.push({ key: k, field: "location", message: `${svc.locationLabel} is too short to dispatch a driver.` });
    }

    if (svc.timed) {
      if (!time) issues.push({ key: k, field: "time", message: "A pickup time is required for this leg." });
      else if (!HHMM.test(time)) issues.push({ key: k, field: "time", message: "Use a 24-hour pickup time (HH:MM)." });
      else times.push({ key: k, time });
    }

    if (!Number.isFinite(pax) || pax < 1) {
      issues.push({ key: k, field: "passengers", message: "At least one passenger must travel on this leg." });
    } else if (pax > cap) {
      issues.push({
        key: k,
        field: "passengers",
        message: `Ground passengers (${pax}) exceed the cabin capacity of ${cap}.`,
      });
    } else if (ctx.manifestPassengers > 0 && pax > ctx.manifestPassengers) {
      issues.push({
        key: k,
        field: "passengers",
        message: `Ground passengers (${pax}) exceed the ${ctx.manifestPassengers} named passenger(s) on the manifest.`,
      });
    }

    // Arrival-side legs must reference the destination, not the origin city.
    if ((k === "destination" || k === "hotel") && location && ctx.origin &&
        location.trim().toLowerCase() === ctx.origin.trim().toLowerCase()) {
      issues.push({
        key: k,
        field: "location",
        message: "Arrival transfers must be at the destination, not the departure airfield.",
      });
    }
    if (k === "airport" && location && ctx.destination &&
        location.trim().toLowerCase() === ctx.destination.trim().toLowerCase()) {
      issues.push({
        key: k,
        field: "location",
        message: "The airport transfer is a departure-side leg — use the origin terminal or FBO.",
      });
    }
  }

  // Departure pickups must precede any other timed leg on the same day.
  if (times.length > 1) {
    const sorted = [...times].sort((a, b) => a.time.localeCompare(b.time));
    const first = sorted[0];
    if (first.key !== "chauffeur" && first.key !== "suv" && times.some((t) => t.key === "chauffeur" || t.key === "suv")) {
      issues.push({
        key: first.key,
        field: "time",
        message: "This leg is scheduled before the chauffeur pickup — reorder the pickup times.",
      });
    }
  }

  if (!ctx.date) {
    issues.push({ key: keys[0], field: "package", message: "Set a departure date before adding ground transport." });
  }

  return issues;
}

/** Convenience wrapper — the package is bookable when there are no issues. */
export const groundPackageValid = (
  keys: string[],
  details: Record<string, GroundDetail>,
  ctx: ItineraryContext,
) => validateGroundPackage(keys, details, ctx).length === 0;

