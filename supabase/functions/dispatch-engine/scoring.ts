// Pure scoring functions for the dispatch engine.
// No I/O; fully unit-testable.

export interface DriverContext {
  driver_id: string;
  distance_m: number;
  eta_seconds: number;
  rating: number; // 0..5
  acceptance_rate: number; // 0..1
  completion_rate: number; // 0..1
  idle_seconds: number;
  vehicle_category: string | null;
}

export interface RequestContext {
  vehicle_category?: string | null;
  surge_multiplier: number;
}

export type FactorName =
  | "proximity"
  | "eta"
  | "driver_rating"
  | "acceptance_rate"
  | "completion_rate"
  | "idle_time"
  | "vehicle_match"
  | "surge_alignment";

export type Weights = Record<FactorName, number>;

export const DEFAULT_WEIGHTS: Weights = {
  proximity: 0.25,
  eta: 0.2,
  driver_rating: 0.1,
  acceptance_rate: 0.15,
  completion_rate: 0.1,
  idle_time: 0.1,
  vehicle_match: 0.05,
  surge_alignment: 0.05,
};

export interface FactorBreakdown {
  factor: FactorName;
  weight: number;
  value: number;
  contribution: number;
}

export interface ScoreResult {
  score: number;
  breakdown: FactorBreakdown[];
  hard_filter_failed?: string;
}

/** Distance decay: 1.0 at 0m, ~0 at 10km. */
export function proximityValue(distance_m: number): number {
  return Math.max(0, Math.exp(-distance_m / 4000));
}

/** ETA decay: 1.0 at 0s, ~0 at 15min. */
export function etaValue(eta_seconds: number): number {
  return Math.max(0, Math.exp(-eta_seconds / 600));
}

export function ratingValue(rating: number): number {
  return Math.max(0, Math.min(1, rating / 5));
}

export function idleValue(idle_seconds: number): number {
  // Fairness: longer idle → higher score, saturating at 30min.
  return Math.min(1, idle_seconds / 1800);
}

export function vehicleMatchValue(
  driverCat: string | null,
  requestCat: string | null | undefined,
): number {
  if (!requestCat) return 1;
  if (!driverCat) return 0;
  return driverCat === requestCat ? 1 : 0;
}

export function surgeAlignmentValue(
  surge_multiplier: number,
  idle_seconds: number,
): number {
  // Reward idle drivers willing to take surge trips.
  if (surge_multiplier <= 1) return 0.5;
  return Math.min(1, 0.5 + idleValue(idle_seconds) / 2);
}

export function scoreCandidate(
  driver: DriverContext,
  request: RequestContext,
  weights: Weights = DEFAULT_WEIGHTS,
): ScoreResult {
  // Hard filter: vehicle category mismatch.
  if (request.vehicle_category && driver.vehicle_category &&
      driver.vehicle_category !== request.vehicle_category) {
    return {
      score: 0,
      breakdown: [],
      hard_filter_failed: "vehicle_category",
    };
  }

  const values: Record<FactorName, number> = {
    proximity: proximityValue(driver.distance_m),
    eta: etaValue(driver.eta_seconds),
    driver_rating: ratingValue(driver.rating),
    acceptance_rate: clamp01(driver.acceptance_rate),
    completion_rate: clamp01(driver.completion_rate),
    idle_time: idleValue(driver.idle_seconds),
    vehicle_match: vehicleMatchValue(driver.vehicle_category, request.vehicle_category),
    surge_alignment: surgeAlignmentValue(request.surge_multiplier, driver.idle_seconds),
  };

  const breakdown: FactorBreakdown[] = (Object.keys(weights) as FactorName[]).map(
    (factor) => {
      const w = weights[factor];
      const v = values[factor];
      return { factor, weight: w, value: v, contribution: round4(w * v) };
    },
  );

  const score = round4(breakdown.reduce((s, b) => s + b.contribution, 0));
  return { score, breakdown };
}

export function rankCandidates<T extends { score: number }>(cands: T[]): T[] {
  return [...cands].sort((a, b) => b.score - a.score);
}

/** Great-circle distance in metres. */
export function haversineMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Naive ETA at 30 km/h average. */
export function estimateEtaSeconds(distance_m: number, speed_kph = 30): number {
  return Math.round((distance_m / 1000) / speed_kph * 3600);
}

export function validateWeights(w: Weights): boolean {
  const sum = Object.values(w).reduce((s, v) => s + v, 0);
  return Math.abs(sum - 1) < 1e-6;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
