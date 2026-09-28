/**
 * Phase 9 §7-§11 — the TaxiD Matching Engine.
 *
 * "Nearest available provider" is explicitly rejected as the universal
 * algorithm. Matching is a constrained optimisation: hard constraints eliminate
 * candidates, then a weighted objective ranks the survivors, and every score is
 * returned with its contributing terms so an employee can explain the match.
 *
 * Each product category carries its own weights and its own hard constraints —
 * an airport transfer is not a parcel and must not be matched as one.
 */
import { clamp } from "../phase8/provenance";
import type { ServiceLine } from "../phase8/customerEconomics";

export const MATCH_CATEGORIES = [
  "ride_hailing", "airport", "corporate", "charter", "aircraft", "delivery", "rentals", "leasing",
] as const;
export type MatchCategory = (typeof MATCH_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<MatchCategory, string> = {
  ride_hailing: "Ride-hailing (real-time matching)",
  airport: "Airport (flight-aware advance matching)",
  corporate: "Corporate (policy + schedule + capacity optimisation)",
  charter: "Charter (capability + itinerary + price)",
  aircraft: "Air mobility (class + route + operator approvals)",
  delivery: "Delivery (shipment + vehicle + route + time window)",
  rentals: "Rentals (asset availability + eligibility + protection)",
  leasing: "Leasing (long-duration capacity + commercial terms)",
};

export const SERVICE_TO_CATEGORY: Record<ServiceLine, MatchCategory> = {
  individual_mobility: "ride_hailing",
  corporate_mobility: "corporate",
  airport: "airport",
  delivery: "delivery",
  logistics: "delivery",
  charter: "charter",
  air_mobility: "aircraft",
  rentals: "rentals",
  leasing: "leasing",
};

/* ------------------------------------------------------ objective terms */

export const OBJECTIVE_TERMS = [
  "customer_fit", "availability", "eta", "quality", "reliability", "price",
  "operator_economics", "sla", "distance", "future_availability",
  "cancellation_risk", "strategic_value",
] as const;
export type ObjectiveTerm = (typeof OBJECTIVE_TERMS)[number];

export const TERM_LABEL: Record<ObjectiveTerm, string> = {
  customer_fit: "Customer fit",
  availability: "Availability",
  eta: "ETA",
  quality: "Quality",
  reliability: "Reliability",
  price: "Price",
  operator_economics: "Operator economics",
  sla: "SLA headroom",
  distance: "Distance",
  future_availability: "Future availability",
  cancellation_risk: "Cancellation risk",
  strategic_value: "Strategic value",
};

type Weights = Record<ObjectiveTerm, number>;

function w(partial: Partial<Weights>): Weights {
  const base = Object.fromEntries(OBJECTIVE_TERMS.map((t) => [t, 0])) as Weights;
  return { ...base, ...partial };
}

/**
 * Category-specific weights. They deliberately differ: a charter buyer cares
 * about capability and price, a ride-hailing rider cares about ETA, and a
 * corporate scheduler cares about policy fit and reliability.
 */
export const CATEGORY_WEIGHTS: Record<MatchCategory, Weights> = {
  ride_hailing: w({ eta: 0.3, availability: 0.18, reliability: 0.14, quality: 0.1, cancellation_risk: 0.1, distance: 0.08, operator_economics: 0.06, price: 0.04 }),
  airport: w({ reliability: 0.24, eta: 0.18, quality: 0.16, sla: 0.14, cancellation_risk: 0.12, customer_fit: 0.08, operator_economics: 0.08 }),
  corporate: w({ customer_fit: 0.24, reliability: 0.2, sla: 0.16, quality: 0.12, price: 0.1, future_availability: 0.08, operator_economics: 0.06, cancellation_risk: 0.04 }),
  charter: w({ customer_fit: 0.26, price: 0.18, quality: 0.16, reliability: 0.14, availability: 0.12, operator_economics: 0.08, strategic_value: 0.06 }),
  aircraft: w({ customer_fit: 0.28, reliability: 0.22, quality: 0.18, availability: 0.14, price: 0.1, operator_economics: 0.08 }),
  delivery: w({ customer_fit: 0.2, sla: 0.2, eta: 0.16, reliability: 0.14, price: 0.12, distance: 0.1, operator_economics: 0.08 }),
  rentals: w({ availability: 0.24, customer_fit: 0.2, quality: 0.18, price: 0.16, reliability: 0.12, strategic_value: 0.1 }),
  leasing: w({ future_availability: 0.26, customer_fit: 0.2, price: 0.18, operator_economics: 0.16, quality: 0.12, strategic_value: 0.08 }),
};

/* -------------------------------------------------- request / candidate */

export interface MatchRequest {
  id: string;
  category: MatchCategory;
  location: string;
  /** ISO pickup / start time; null for immediate demand. */
  startAt: string | null;
  /** Required category capability, e.g. "executive_sedan", "3t_truck". */
  requiredCapability: string;
  /** Passengers, seats, kilos or units — whatever the category measures. */
  requiredUnits: number;
  /** Customer-facing price already quoted, KES; null when still open. */
  quotedPrice: number | null;
  slaMinutes: number | null;
  /** Corporate policy constraints that a candidate must satisfy. */
  policyRequirements: string[];
  /** Airport specifics (§9). */
  flight?: {
    number: string;
    scheduledArrival: string;
    estimatedArrival: string | null;
    terminal: string | null;
    meetAndGreet: boolean;
    freeWaitingMinutes: number;
  };
}

export interface MatchCandidate {
  id: string;
  operatorId: string;
  operatorName: string;
  capabilities: string[];
  unitCapacity: number;
  available: boolean;
  compliant: boolean;
  /** Compliance/eligibility items that failed, for explainability. */
  complianceFailures: string[];
  policySatisfied: string[];
  etaMinutes: number | null;
  distanceKm: number | null;
  qualityScore: number | null;       // 0-100
  reliabilityScore: number | null;   // 0-100
  cancellationRate: number | null;   // 0-1
  /** Operator payout for this job, KES. */
  payout: number | null;
  /** Hours the candidate remains available after this job. */
  futureAvailabilityHours: number | null;
  strategicValue: number | null;     // 0-100, e.g. new operator being developed
}

export interface HardConstraintResult {
  constraint: string;
  passed: boolean;
  detail: string;
}

export interface ScoredCandidate {
  candidateId: string;
  operatorName: string;
  eligible: boolean;
  hardConstraints: HardConstraintResult[];
  /** 0-100 objective score; null when ineligible. */
  score: number | null;
  terms: { term: ObjectiveTerm; weight: number; normalised: number | null; observed: string }[];
  /** TaxiD take for this match, KES; null when price or payout unknown. */
  expectedTake: number | null;
  explanation: string;
}

export interface MatchResult {
  requestId: string;
  category: MatchCategory;
  ranked: ScoredCandidate[];
  /** Best eligible candidate, or null when none survives the constraints. */
  recommended: ScoredCandidate | null;
  /** Why no match exists — a supply signal, not a UI error. */
  noMatchReason: string | null;
  /** §9 recomputed operational timing for airport work. */
  airportTiming: AirportTiming | null;
}

function hardConstraints(req: MatchRequest, c: MatchCandidate): HardConstraintResult[] {
  const out: HardConstraintResult[] = [
    { constraint: "availability", passed: c.available, detail: c.available ? "Available in the requested window" : "Not available in the requested window" },
    { constraint: "capability", passed: c.capabilities.includes(req.requiredCapability), detail: c.capabilities.includes(req.requiredCapability) ? `Holds ${req.requiredCapability}` : `Lacks required capability ${req.requiredCapability}` },
    { constraint: "capacity", passed: c.unitCapacity >= req.requiredUnits, detail: `${c.unitCapacity} units capacity vs ${req.requiredUnits} required` },
    { constraint: "compliance", passed: c.compliant, detail: c.compliant ? "Compliance current" : `Compliance failures: ${c.complianceFailures.join(", ") || "unspecified"}` },
  ];
  if (req.policyRequirements.length) {
    const missing = req.policyRequirements.filter((p) => !c.policySatisfied.includes(p));
    out.push({ constraint: "corporate_policy", passed: missing.length === 0, detail: missing.length ? `Policy not satisfied: ${missing.join(", ")}` : "All policy requirements satisfied" });
  }
  if (req.slaMinutes !== null && c.etaMinutes !== null) {
    out.push({ constraint: "sla", passed: c.etaMinutes <= req.slaMinutes, detail: `${c.etaMinutes} min ETA vs ${req.slaMinutes} min SLA` });
  }
  return out;
}

/** Normalise every term to 0-100 where higher is always better. */
function normalise(req: MatchRequest, c: MatchCandidate): { term: ObjectiveTerm; normalised: number | null; observed: string }[] {
  const take = (req.quotedPrice !== null && c.payout !== null) ? req.quotedPrice - c.payout : null;
  const rows: { term: ObjectiveTerm; normalised: number | null; observed: string }[] = [
    { term: "customer_fit", normalised: c.capabilities.includes(req.requiredCapability) ? clamp(60 + (c.unitCapacity >= req.requiredUnits ? 40 : 0), 0, 100) : 0, observed: c.capabilities.join(", ") || "no capability record" },
    { term: "availability", normalised: c.available ? 100 : 0, observed: c.available ? "available" : "unavailable" },
    { term: "eta", normalised: c.etaMinutes === null ? null : clamp(100 - c.etaMinutes * 2.5, 0, 100), observed: c.etaMinutes === null ? "no ETA telemetry" : `${c.etaMinutes} min` },
    { term: "quality", normalised: c.qualityScore, observed: c.qualityScore === null ? "no quality signal" : `${c.qualityScore}/100` },
    { term: "reliability", normalised: c.reliabilityScore, observed: c.reliabilityScore === null ? "no reliability signal" : `${c.reliabilityScore}/100` },
    { term: "price", normalised: (req.quotedPrice !== null && c.payout !== null && req.quotedPrice > 0) ? clamp((1 - c.payout / req.quotedPrice) * 200, 0, 100) : null, observed: c.payout === null ? "no payout basis" : `payout KES ${c.payout.toLocaleString()}` },
    { term: "operator_economics", normalised: c.payout === null ? null : clamp((c.payout / Math.max(1, (req.quotedPrice ?? c.payout))) * 100, 0, 100), observed: c.payout === null ? "no payout basis" : `operator retains ${(100 * c.payout / Math.max(1, req.quotedPrice ?? c.payout)).toFixed(0)}%` },
    { term: "sla", normalised: (req.slaMinutes !== null && c.etaMinutes !== null) ? clamp(((req.slaMinutes - c.etaMinutes) / Math.max(1, req.slaMinutes)) * 100, 0, 100) : null, observed: req.slaMinutes === null ? "no SLA defined" : `${req.slaMinutes} min SLA` },
    { term: "distance", normalised: c.distanceKm === null ? null : clamp(100 - c.distanceKm * 4, 0, 100), observed: c.distanceKm === null ? "no distance signal" : `${c.distanceKm} km` },
    { term: "future_availability", normalised: c.futureAvailabilityHours === null ? null : clamp(c.futureAvailabilityHours * 10, 0, 100), observed: c.futureAvailabilityHours === null ? "unknown" : `${c.futureAvailabilityHours} h remaining` },
    { term: "cancellation_risk", normalised: c.cancellationRate === null ? null : clamp(100 - c.cancellationRate * 300, 0, 100), observed: c.cancellationRate === null ? "no cancellation history" : `${(c.cancellationRate * 100).toFixed(1)}% cancellation` },
    { term: "strategic_value", normalised: c.strategicValue, observed: c.strategicValue === null ? "not assessed" : `${c.strategicValue}/100 strategic value` },
  ];
  return rows.map((t) => ({ ...t, observed: t.term === "price" && take !== null ? `${t.observed} · TaxiD take KES ${take.toLocaleString()}` : t.observed }));
}

export function scoreCandidate(req: MatchRequest, c: MatchCandidate): ScoredCandidate {
  const constraints = hardConstraints(req, c);
  const eligible = constraints.every((x) => x.passed);
  const weights = CATEGORY_WEIGHTS[req.category];
  const normalised = normalise(req, c);

  const terms = normalised
    .map((n) => ({ term: n.term, weight: weights[n.term], normalised: n.normalised, observed: n.observed }))
    .filter((t) => t.weight > 0);

  const usable = terms.filter((t) => t.normalised !== null);
  const weightAvailable = usable.reduce((a, t) => a + t.weight, 0);
  const score = !eligible || usable.length === 0
    ? null
    : usable.reduce((a, t) => a + (t.normalised ?? 0) * t.weight, 0) / weightAvailable;

  const take = (req.quotedPrice !== null && c.payout !== null) ? req.quotedPrice - c.payout : null;
  const top = [...usable].sort((a, b) => (b.normalised ?? 0) * b.weight - (a.normalised ?? 0) * a.weight).slice(0, 3);

  return {
    candidateId: c.id,
    operatorName: c.operatorName,
    eligible,
    hardConstraints: constraints,
    score,
    terms,
    expectedTake: take,
    explanation: eligible
      ? `Ranked on ${top.map((t) => `${TERM_LABEL[t.term]} (${t.observed})`).join(", ")}. Objective weights are the ${CATEGORY_LABEL[req.category]} profile, normalised over the ${usable.length} readable terms.`
      : `Excluded by hard constraint: ${constraints.filter((x) => !x.passed).map((x) => x.detail).join("; ")}.`,
  };
}

export function matchRequest(req: MatchRequest, candidates: readonly MatchCandidate[]): MatchResult {
  const ranked = candidates
    .map((c) => scoreCandidate(req, c))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return (b.score ?? -1) - (a.score ?? -1);
    });

  const recommended = ranked.find((r) => r.eligible && r.score !== null) ?? null;
  const failedOn = new Map<string, number>();
  for (const r of ranked.filter((x) => !x.eligible)) {
    for (const hc of r.hardConstraints.filter((x) => !x.passed)) {
      failedOn.set(hc.constraint, (failedOn.get(hc.constraint) ?? 0) + 1);
    }
  }
  const dominant = [...failedOn.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    requestId: req.id,
    category: req.category,
    ranked,
    recommended,
    noMatchReason: recommended
      ? null
      : candidates.length === 0
        ? "No candidate supply was discovered for this request — this is an undersupply signal, not a system error."
        : `No candidate cleared the hard constraints; the dominant blocker is ${dominant?.[0] ?? "unknown"} (${dominant?.[1] ?? 0} candidate(s)).`,
    airportTiming: req.category === "airport" ? computeAirportTiming(req) : null,
  };
}

/* ------------------------------------------ §9 airport mobility engine */

export interface AirportTiming {
  flightNumber: string;
  scheduledArrival: string;
  estimatedArrival: string | null;
  delayMinutes: number | null;
  /** Recalculated driver on-site time. */
  driverOnSiteAt: string | null;
  /** When free waiting expires and waiting charges begin. */
  freeWaitingExpiresAt: string | null;
  /** When the booking may be treated as a no-show. */
  noShowAt: string | null;
  terminal: string | null;
  meetAndGreet: boolean;
  notes: string[];
}

/** Meet & greet needs longer lead time than kerbside pickup. */
const LEAD_MINUTES = { meetAndGreet: 45, kerbside: 20 } as const;

export function computeAirportTiming(req: MatchRequest): AirportTiming | null {
  const f = req.flight;
  if (!f) return null;
  const sched = new Date(f.scheduledArrival).getTime();
  const est = f.estimatedArrival ? new Date(f.estimatedArrival).getTime() : null;
  const effective = est ?? sched;
  const lead = f.meetAndGreet ? LEAD_MINUTES.meetAndGreet : LEAD_MINUTES.kerbside;
  const delay = est === null ? null : Math.round((est - sched) / 60_000);

  const notes: string[] = [];
  if (est === null) notes.push("No live flight estimate — timing is anchored to the scheduled arrival and must be re-checked before dispatch.");
  if (delay !== null && delay > 0) notes.push(`Flight is ${delay} min late; driver on-site time has been moved accordingly and no waiting charge applies for the delay.`);
  if (delay !== null && delay < -10) notes.push(`Flight is ${Math.abs(delay)} min early; supply must be pulled forward or the passenger will wait.`);
  if (!f.terminal) notes.push("Terminal unknown — meet & greet instructions cannot be issued yet.");

  return {
    flightNumber: f.number,
    scheduledArrival: f.scheduledArrival,
    estimatedArrival: f.estimatedArrival,
    delayMinutes: delay,
    driverOnSiteAt: new Date(effective - lead * 60_000).toISOString(),
    freeWaitingExpiresAt: new Date(effective + f.freeWaitingMinutes * 60_000).toISOString(),
    noShowAt: new Date(effective + (f.freeWaitingMinutes + 30) * 60_000).toISOString(),
    terminal: f.terminal,
    meetAndGreet: f.meetAndGreet,
    notes,
  };
}

/* -------------------------- §10 corporate scheduled mobility optimisation */

export interface CorporateTripDemand {
  id: string;
  employeeId: string;
  eligible: boolean;
  pickup: string;
  dropoff: string;
  /** Minutes from midnight. */
  windowStart: number;
  windowEnd: number;
  seats: number;
  safetyEscortRequired: boolean;
}

export interface CorporateVehicle {
  id: string;
  seats: number;
  /** Minutes from midnight the vehicle is on shift. */
  shiftStart: number;
  shiftEnd: number;
  escortCapable: boolean;
}

export interface RosterAssignment {
  vehicleId: string;
  tripIds: string[];
  seatsUsed: number;
  utilisation: number;
}

export interface RosterPlan {
  assignments: RosterAssignment[];
  unassigned: { tripId: string; reason: string }[];
  /** Share of demand placed on a compliant vehicle. */
  coverage: number;
  /** Mean seat utilisation across used vehicles. */
  seatUtilisation: number;
  method: string;
}

/**
 * Capacitated scheduling with time windows, solved greedily by tightest window
 * first (a defensible heuristic, and honest about being one). Eligibility,
 * seats, shift windows and escort requirements are hard constraints.
 */
export function planCorporateRoster(
  demand: readonly CorporateTripDemand[],
  vehicles: readonly CorporateVehicle[],
): RosterPlan {
  const assignments: RosterAssignment[] = vehicles.map((v) => ({ vehicleId: v.id, tripIds: [], seatsUsed: 0, utilisation: 0 }));
  const unassigned: { tripId: string; reason: string }[] = [];

  const ordered = [...demand].sort((a, b) => (a.windowEnd - a.windowStart) - (b.windowEnd - b.windowStart));

  for (const t of ordered) {
    if (!t.eligible) { unassigned.push({ tripId: t.id, reason: "Employee is not eligible under corporate policy" }); continue; }
    const idx = vehicles.findIndex((v, i) => {
      const a = assignments[i];
      const withinShift = v.shiftStart <= t.windowStart && v.shiftEnd >= t.windowEnd;
      const seatsOk = a.seatsUsed + t.seats <= v.seats;
      const escortOk = !t.safetyEscortRequired || v.escortCapable;
      return withinShift && seatsOk && escortOk;
    });
    if (idx === -1) {
      const anyShift = vehicles.some((v) => v.shiftStart <= t.windowStart && v.shiftEnd >= t.windowEnd);
      unassigned.push({
        tripId: t.id,
        reason: !anyShift
          ? "No vehicle is on shift for the requested time window"
          : t.safetyEscortRequired
            ? "No escort-capable vehicle has remaining seats in the window"
            : "No vehicle has remaining seats in the window",
      });
      continue;
    }
    assignments[idx].tripIds.push(t.id);
    assignments[idx].seatsUsed += t.seats;
  }

  for (let i = 0; i < assignments.length; i++) {
    assignments[i].utilisation = vehicles[i].seats ? assignments[i].seatsUsed / vehicles[i].seats : 0;
  }
  const used = assignments.filter((a) => a.tripIds.length > 0);
  const placed = assignments.reduce((a, x) => a + x.tripIds.length, 0);

  return {
    assignments,
    unassigned,
    coverage: demand.length ? Math.round((placed / demand.length) * 100) : 0,
    seatUtilisation: used.length ? used.reduce((a, x) => a + x.utilisation, 0) / used.length : 0,
    method: "Tightest-window-first greedy heuristic with hard eligibility, seat, shift and escort constraints. Declared as a heuristic, not an optimal MILP solution.",
  };
}

/* ------------------------------------- §11 delivery commerce lifecycle */

export const DELIVERY_STAGES = [
  "order", "classification", "pickup", "dispatch", "route", "tracking",
  "pod", "exception", "delivery", "billing", "settlement", "analytics",
] as const;
export type DeliveryStage = (typeof DELIVERY_STAGES)[number];

export interface ShipmentState {
  shipmentId: string;
  stage: DeliveryStage;
  /** Stages already evidenced by a record. */
  evidenced: DeliveryStage[];
  /** Physical assets are third-party — TaxiD coordinates, never owns. */
  operatorId: string | null;
  exception: string | null;
}

export function deliveryLifecycleGaps(s: ShipmentState): string[] {
  const idx = DELIVERY_STAGES.indexOf(s.stage);
  const expected = DELIVERY_STAGES.slice(0, idx);
  const gaps = expected.filter((st) => !s.evidenced.includes(st));
  const out = gaps.map((g) => `Shipment reached ${s.stage} without an evidenced ${g} record.`);
  if (!s.operatorId) out.push("No fulfilling operator linked — TaxiD does not own the vehicle, so an unlinked shipment has no accountable party.");
  if (s.stage === "billing" && !s.evidenced.includes("pod")) out.push("Billing without proof of delivery — revenue is not collectable evidence.");
  return out;
}
