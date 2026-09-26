/**
 * Live fleet intelligence.
 *
 * Turns vehicle, driver and trip rows into an operational picture: capacity by
 * state, utilisation, availability forecast, maintenance exposure and
 * compliance risk. Pure functions so the control tower, alerts and tests share
 * exactly one definition of "available".
 */

export type FleetState =
  | "available" | "en_route" | "on_trip" | "idle" | "maintenance" | "offline" | "compliance_hold";

export interface FleetVehicle {
  id: string;
  code: string;
  type: string;
  plate: string;
  seats: number;
  state: FleetState;
  region?: string | null;
  /** Trips completed in the reporting window. */
  tripsInWindow?: number;
  /** Revenue attributed in the reporting window, KES. */
  revenueKes?: number;
  /** Hours the vehicle was engaged on trips in the window. */
  engagedHours?: number;
  /** Hours the vehicle was rostered for service in the window. */
  rosteredHours?: number;
  odometerKm?: number;
  nextServiceKm?: number | null;
  insuranceExpiry?: string | null;
  inspectionExpiry?: string | null;
  licenceExpiry?: string | null;
}

export const FLEET_STATE_LABEL: Record<FleetState, string> = {
  available: "Available",
  en_route: "En route to pickup",
  on_trip: "On trip",
  idle: "Idle",
  maintenance: "Maintenance",
  offline: "Offline",
  compliance_hold: "Compliance hold",
};

/** Deployable capacity — states that can accept or are serving demand. */
const DEPLOYABLE: FleetState[] = ["available", "en_route", "on_trip", "idle"];

export interface CapacitySnapshot {
  total: number;
  byState: Record<FleetState, number>;
  deployable: number;
  seatsAvailable: number;
  /** Vehicles serving demand right now / deployable, 0..100. */
  utilisationPct: number;
  /** Deployable / total, 0..100. */
  readinessPct: number;
  outOfService: number;
}

export function capacitySnapshot(vehicles: FleetVehicle[]): CapacitySnapshot {
  const byState = Object.keys(FLEET_STATE_LABEL).reduce((acc, k) => {
    acc[k as FleetState] = vehicles.filter((v) => v.state === k).length;
    return acc;
  }, {} as Record<FleetState, number>);
  const deployable = DEPLOYABLE.reduce((s, k) => s + byState[k], 0);
  const engaged = byState.en_route + byState.on_trip;
  return {
    total: vehicles.length,
    byState,
    deployable,
    seatsAvailable: vehicles.filter((v) => v.state === "available").reduce((s, v) => s + (v.seats || 0), 0),
    utilisationPct: deployable ? Math.round((engaged / deployable) * 1000) / 10 : 0,
    readinessPct: vehicles.length ? Math.round((deployable / vehicles.length) * 1000) / 10 : 0,
    outOfService: byState.maintenance + byState.offline + byState.compliance_hold,
  };
}

export interface UtilisationRow {
  id: string;
  code: string;
  type: string;
  trips: number;
  revenueKes: number;
  /** Engaged hours / rostered hours, 0..100. */
  utilisationPct: number;
  revenuePerTripKes: number;
  idleHours: number;
}

export function utilisationByVehicle(vehicles: FleetVehicle[]): UtilisationRow[] {
  return vehicles
    .map((v) => {
      const rostered = v.rosteredHours ?? 0;
      const engaged = Math.min(v.engagedHours ?? 0, rostered || (v.engagedHours ?? 0));
      const trips = v.tripsInWindow ?? 0;
      const revenue = v.revenueKes ?? 0;
      return {
        id: v.id,
        code: v.code,
        type: v.type,
        trips,
        revenueKes: revenue,
        utilisationPct: rostered ? Math.round((engaged / rostered) * 1000) / 10 : 0,
        revenuePerTripKes: trips ? Math.round(revenue / trips) : 0,
        idleHours: Math.max(0, Math.round((rostered - engaged) * 10) / 10),
      };
    })
    .sort((a, b) => b.utilisationPct - a.utilisationPct);
}

export interface FleetTypeCapacity {
  type: string;
  total: number;
  available: number;
  engaged: number;
  outOfService: number;
  utilisationPct: number;
  seatsAvailable: number;
}

export function capacityByType(vehicles: FleetVehicle[]): FleetTypeCapacity[] {
  const types = [...new Set(vehicles.map((v) => v.type))].sort();
  return types.map((type) => {
    const rows = vehicles.filter((v) => v.type === type);
    const snap = capacitySnapshot(rows);
    return {
      type,
      total: rows.length,
      available: snap.byState.available,
      engaged: snap.byState.en_route + snap.byState.on_trip,
      outOfService: snap.outOfService,
      utilisationPct: snap.utilisationPct,
      seatsAvailable: snap.seatsAvailable,
    };
  });
}

const DAY = 86_400_000;

export interface ComplianceRisk {
  id: string;
  code: string;
  /** Which document is at risk. */
  document: "insurance" | "inspection" | "licence";
  expiresAt: string;
  daysToExpiry: number;
  severity: "expired" | "critical" | "warning";
}

/** Documents expiring inside the horizon (default 30 days) or already expired. */
export function complianceRisks(vehicles: FleetVehicle[], horizonDays = 30, now = Date.now()): ComplianceRisk[] {
  const out: ComplianceRisk[] = [];
  const check = (v: FleetVehicle, document: ComplianceRisk["document"], value?: string | null) => {
    if (!value) return;
    const d = Math.floor((new Date(value).getTime() - now) / DAY);
    if (d > horizonDays) return;
    out.push({
      id: v.id, code: v.code, document, expiresAt: value, daysToExpiry: d,
      severity: d < 0 ? "expired" : d <= 7 ? "critical" : "warning",
    });
  };
  for (const v of vehicles) {
    check(v, "insurance", v.insuranceExpiry);
    check(v, "inspection", v.inspectionExpiry);
    check(v, "licence", v.licenceExpiry);
  }
  return out.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
}

export interface MaintenanceDue {
  id: string;
  code: string;
  odometerKm: number;
  nextServiceKm: number;
  kmRemaining: number;
  severity: "overdue" | "due_soon";
}

export function maintenanceDue(vehicles: FleetVehicle[], warnKm = 1_000): MaintenanceDue[] {
  return vehicles
    .filter((v) => typeof v.odometerKm === "number" && typeof v.nextServiceKm === "number")
    .map((v) => {
      const remaining = (v.nextServiceKm as number) - (v.odometerKm as number);
      return {
        id: v.id, code: v.code,
        odometerKm: v.odometerKm as number,
        nextServiceKm: v.nextServiceKm as number,
        kmRemaining: remaining,
        severity: remaining <= 0 ? ("overdue" as const) : ("due_soon" as const),
      };
    })
    .filter((r) => r.kmRemaining <= warnKm)
    .sort((a, b) => a.kmRemaining - b.kmRemaining);
}

export interface DemandWindow {
  /** ISO timestamp for the start of the window. */
  at: string;
  /** Vehicles required to serve booked demand in this window. */
  vehiclesRequired: number;
}

export interface AvailabilityForecastRow extends DemandWindow {
  vehiclesAvailable: number;
  surplus: number;
  /** Required / available, 0..n as a percentage. */
  loadPct: number;
  status: "healthy" | "tight" | "shortfall";
}

/**
 * Projects deployable capacity against booked demand per window so ops can see
 * a shortfall before it becomes a failed booking.
 */
export function availabilityForecast(
  vehicles: FleetVehicle[],
  demand: DemandWindow[],
): AvailabilityForecastRow[] {
  const deployable = capacitySnapshot(vehicles).deployable;
  return demand.map((w) => {
    const surplus = deployable - w.vehiclesRequired;
    const loadPct = deployable ? Math.round((w.vehiclesRequired / deployable) * 1000) / 10 : 0;
    return {
      ...w,
      vehiclesAvailable: deployable,
      surplus,
      loadPct,
      status: surplus < 0 ? "shortfall" : loadPct >= 85 ? "tight" : "healthy",
    };
  });
}

/** Maps a `vehicles` row plus live trip state into the intelligence model. */
export function fleetVehicleFromRow(row: {
  id: string;
  vehicle_code?: string | null;
  number_plate?: string | null;
  vehicle_type?: string | null;
  seating_capacity?: number | null;
  vehicle_status?: string | null;
}, live?: { onTrip?: boolean; enRoute?: boolean }): FleetVehicle {
  const status = (row.vehicle_status ?? "").toLowerCase();
  const state: FleetState =
    live?.onTrip ? "on_trip"
    : live?.enRoute ? "en_route"
    : status === "maintenance" ? "maintenance"
    : status === "suspended" || status === "retired" ? "offline"
    : status === "draft" || status === "pending_verification" ? "compliance_hold"
    : status === "active" ? "available"
    : "idle";
  return {
    id: row.id,
    code: row.vehicle_code ?? row.number_plate ?? row.id.slice(0, 8),
    type: row.vehicle_type ?? "unclassified",
    plate: row.number_plate ?? "—",
    seats: row.seating_capacity ?? 0,
    state,
  };
}
