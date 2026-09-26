/**
 * Vehicle-to-trip matching for charter price estimates.
 *
 * A price estimate is only trustworthy when the vehicle can actually carry the
 * mission. These helpers read the seat count out of the inventory label, decide
 * how many units a party needs, and explain in one sentence why a category does
 * or does not match — so the estimate always reflects a workable vehicle.
 */

export interface TripNeeds {
  passengers: number;
  /** Cabin bags plus hold luggage pieces. */
  luggagePieces?: number;
  /** Wheelchair access or step-free boarding required. */
  accessibility?: boolean;
  /** One-way distance in kilometres, when known. */
  distanceKm?: number;
}

export interface VehicleOption {
  name: string;
  /** Free-text capacity label from inventory, e.g. "Up to 14 passengers". */
  capacity?: string | null;
  rate: number;
}

const SEAT_HINTS: Array<[RegExp, number]> = [
  [/\bcoach\b|\bbus\b/i, 49],
  [/\bminibus\b|\bmatatu\b/i, 25],
  [/\bvan\b|\bhiace\b|\bshuttle\b/i, 14],
  [/\bsuv\b|\blandcruiser\b|\bprado\b/i, 7],
  [/\bsedan\b|\bexecutive\b/i, 4],
];

/** Best-effort seat count: explicit numbers win, then vehicle-type hints. */
export function vehicleSeats(option: VehicleOption): number {
  const text = `${option.capacity ?? ""} ${option.name}`;
  const numbers = [...text.matchAll(/(\d{1,3})\s*(?:pax|passenger|seat)/gi)].map((m) => Number(m[1]));
  const trailing = [...option.name.matchAll(/(\d{1,3})\s*$/g)].map((m) => Number(m[1]));
  const found = [...numbers, ...trailing].filter((n) => n >= 2 && n <= 80);
  if (found.length) return Math.max(...found);
  for (const [re, seats] of SEAT_HINTS) if (re.test(text)) return seats;
  return 4;
}

/** Luggage pieces a vehicle absorbs before a second unit is needed. */
export const vehicleLuggage = (option: VehicleOption) => Math.max(2, Math.round(vehicleSeats(option) * 0.8));

export interface VehicleMatch {
  option: VehicleOption;
  seats: number;
  /** Units required to seat the whole party. */
  unitsRequired: number;
  fits: boolean;
  /** Why this vehicle does or does not suit the mission. */
  reason: string;
}

/** Evaluates one vehicle against the stated trip needs. */
export function matchVehicle(option: VehicleOption, needs: TripNeeds): VehicleMatch {
  const seats = vehicleSeats(option);
  const pax = Math.max(1, Math.round(needs.passengers || 1));
  const unitsRequired = Math.max(1, Math.ceil(pax / seats));
  const luggagePerUnit = vehicleLuggage(option);
  const luggageOk = (needs.luggagePieces ?? 0) <= luggagePerUnit * unitsRequired;
  const accessibilityOk = !needs.accessibility || seats >= 7;

  if (!luggageOk) {
    return {
      option, seats, unitsRequired, fits: false,
      reason: `Holds about ${luggagePerUnit * unitsRequired} luggage pieces — your party lists ${needs.luggagePieces}.`,
    };
  }
  if (!accessibilityOk) {
    return {
      option, seats, unitsRequired, fits: false,
      reason: "Step-free boarding needs a van, minibus or coach.",
    };
  }
  if (unitsRequired > 1) {
    return {
      option, seats, unitsRequired, fits: true,
      reason: `${seats} seats each — ${unitsRequired} vehicles needed for ${pax} passengers.`,
    };
  }
  return {
    option, seats, unitsRequired, fits: true,
    reason: `${seats} seats · comfortably carries ${pax} passenger${pax === 1 ? "" : "s"}.`,
  };
}

/** Only the vehicles that can actually run the mission, cheapest first. */
export function matchingVehicles(options: VehicleOption[], needs: TripNeeds): VehicleMatch[] {
  return options
    .map((o) => matchVehicle(o, needs))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.unitsRequired - b.unitsRequired || a.option.rate - b.option.rate);
}

/**
 * Units the estimate should bill: derived from the party size and the selected
 * vehicle, so the quantity can never contradict the trip details.
 */
export const requiredUnits = (option: VehicleOption, needs: TripNeeds) =>
  matchVehicle(option, needs).unitsRequired;
