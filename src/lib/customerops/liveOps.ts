/**
 * Customer Operations — live operations map model.
 *
 * Normalises every moving asset and live exception into one `LiveEntity` so a
 * single map/board can show drivers, vehicles, deliveries, charters,
 * aircraft/boats, active incidents and delayed trips together.
 *
 * Deterministic and dependency-free: the panel fetches rows, this module
 * decides what they mean.
 */

export type LiveKind =
  | "driver"
  | "vehicle"
  | "delivery"
  | "charter"
  | "aircraft"
  | "boat"
  | "incident"
  | "delayed_trip";

export const LIVE_KIND_LABEL: Record<LiveKind, string> = {
  driver: "Drivers",
  vehicle: "Vehicles",
  delivery: "Deliveries",
  charter: "Charters",
  aircraft: "Aircraft",
  boat: "Marine",
  incident: "Active incidents",
  delayed_trip: "Delayed trips",
};

export type LiveState = "healthy" | "attention" | "critical" | "offline";

export interface LiveEntity {
  id: string;
  kind: LiveKind;
  label: string;
  detail: string;
  state: LiveState;
  lat?: number | null;
  lng?: number | null;
  /** ISO timestamp of the last signal we have for this entity. */
  updatedAt: string;
  /** Minutes late where the entity is behind schedule. */
  lateMinutes?: number;
  /** Deep link into the owning workspace. */
  href?: string;
}

const minsSince = (iso: string | null | undefined, now: number): number | null =>
  iso ? Math.round((now - Date.parse(iso)) / 60_000) : null;

/* ------------------------------- drivers -------------------------------- */

export interface DriverLocationRow {
  driver_id: string;
  lat: number | null;
  lng: number | null;
  is_online: boolean | null;
  is_available: boolean | null;
  speed_kph: number | null;
  vehicle_id: string | null;
  battery_pct: number | null;
  updated_at: string;
}

export function driverEntities(rows: DriverLocationRow[], now = Date.now()): LiveEntity[] {
  return rows.map((r) => {
    const stale = minsSince(r.updated_at, now);
    const state: LiveState = !r.is_online
      ? "offline"
      : stale != null && stale > 10
        ? "critical"
        : stale != null && stale > 3
          ? "attention"
          : "healthy";
    return {
      id: `driver:${r.driver_id}`,
      kind: "driver",
      label: `Driver ${r.driver_id.slice(0, 8)}`,
      detail: [
        r.is_online ? (r.is_available ? "online · available" : "online · on trip") : "offline",
        r.speed_kph != null ? `${Math.round(r.speed_kph)} km/h` : null,
        stale != null ? `signal ${stale}m ago` : null,
        r.battery_pct != null ? `battery ${r.battery_pct}%` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      state,
      lat: r.lat,
      lng: r.lng,
      updatedAt: r.updated_at,
      href: `/dashboard/admin/drivers/${r.driver_id}`,
    } satisfies LiveEntity;
  });
}

/* ------------------------------ deliveries ------------------------------- */

export interface DeliveryRow {
  id: string;
  order_number: string;
  status: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  sla_deadline: string | null;
  updated_at: string;
}

const DELIVERY_DONE = new Set(["delivered", "cancelled", "returned", "closed"]);

export function deliveryEntities(rows: DeliveryRow[], now = Date.now()): LiveEntity[] {
  return rows
    .filter((r) => !DELIVERY_DONE.has(r.status))
    .map((r) => {
      const overdue = r.sla_deadline ? Math.round((now - Date.parse(r.sla_deadline)) / 60_000) : null;
      const state: LiveState =
        overdue != null && overdue > 0 ? "critical" : overdue != null && overdue > -30 ? "attention" : "healthy";
      return {
        id: `delivery:${r.id}`,
        kind: "delivery",
        label: r.order_number,
        detail: [
          r.status.replace(/_/g, " "),
          overdue != null ? (overdue > 0 ? `SLA breached ${overdue}m` : `${Math.abs(overdue)}m to SLA`) : "no SLA set",
        ].join(" · "),
        state,
        lat: r.pickup_lat,
        lng: r.pickup_lng,
        updatedAt: r.updated_at,
        lateMinutes: overdue != null && overdue > 0 ? overdue : undefined,
        href: "/dashboard/admin/delivery-operations",
      } satisfies LiveEntity;
    });
}

/* -------------------------------- trips --------------------------------- */

export interface TripRow {
  id: string;
  booking_number: string;
  status: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_eta: string | null;
  scheduled_for: string | null;
  updated_at: string;
}

const TRIP_DONE = new Set(["completed", "cancelled", "no_show", "closed"]);

/** Live trips, flagged `delayed_trip` when past their promised pickup ETA. */
export function tripEntities(rows: TripRow[], now = Date.now()): LiveEntity[] {
  return rows
    .filter((r) => !TRIP_DONE.has(r.status))
    .map((r) => {
      const promise = r.pickup_eta ?? r.scheduled_for;
      const late = promise ? Math.round((now - Date.parse(promise)) / 60_000) : null;
      const delayed = late != null && late > 5;
      const state: LiveState = late == null ? "healthy" : late > 15 ? "critical" : late > 5 ? "attention" : "healthy";
      return {
        id: `trip:${r.id}`,
        kind: delayed ? "delayed_trip" : "vehicle",
        label: r.booking_number,
        detail: [
          r.status.replace(/_/g, " "),
          late == null ? "no ETA" : late > 0 ? `${late}m behind pickup ETA` : `${Math.abs(late)}m to pickup`,
        ].join(" · "),
        state,
        lat: r.pickup_lat,
        lng: r.pickup_lng,
        updatedAt: r.updated_at,
        lateMinutes: delayed ? late! : undefined,
        href: `/dashboard/admin/trips/${r.id}`,
      } satisfies LiveEntity;
    });
}

/* ------------------------------- charters -------------------------------- */

export interface CharterRow {
  id: string;
  reference: string;
  category_slug: string | null;
  asset_name: string | null;
  status: string;
  flight_status: string | null;
  updated_at: string;
}

const CHARTER_DONE = new Set(["completed", "cancelled", "expired", "refunded"]);

const charterKind = (slug: string | null): LiveKind => {
  const s = (slug ?? "").toLowerCase();
  if (s.includes("air") || s.includes("flight") || s.includes("jet") || s.includes("heli")) return "aircraft";
  if (s.includes("marine") || s.includes("boat") || s.includes("yacht") || s.includes("ferry")) return "boat";
  return "charter";
};

export function charterEntities(rows: CharterRow[]): LiveEntity[] {
  return rows
    .filter((r) => !CHARTER_DONE.has(r.status))
    .map((r) => {
      const flight = (r.flight_status ?? "").toLowerCase();
      const state: LiveState =
        flight.includes("delay") || flight.includes("divert")
          ? "critical"
          : r.status === "pending" || r.status === "awaiting_payment"
            ? "attention"
            : "healthy";
      return {
        id: `charter:${r.id}`,
        kind: charterKind(r.category_slug),
        label: r.reference,
        detail: [r.asset_name ?? r.category_slug ?? "charter", r.status.replace(/_/g, " "), r.flight_status ?? null]
          .filter(Boolean)
          .join(" · "),
        state,
        updatedAt: r.updated_at,
        href: "/dashboard/admin/road-approval-queue",
      } satisfies LiveEntity;
    });
}

/* ------------------------------- incidents ------------------------------- */

export interface IncidentRow {
  id: string;
  incident_number: string;
  service_name: string | null;
  title: string;
  severity: string;
  status: string;
  detected_at: string | null;
  resolved_at: string | null;
  updated_at: string;
}

export function incidentEntities(rows: IncidentRow[]): LiveEntity[] {
  return rows
    .filter((r) => !r.resolved_at)
    .map((r) => ({
      id: `incident:${r.id}`,
      kind: "incident" as LiveKind,
      label: `${r.incident_number} · ${r.title}`,
      detail: [r.service_name ?? "platform", `severity ${r.severity}`, r.status.replace(/_/g, " ")].join(" · "),
      state: (r.severity === "sev1" || r.severity === "critical" ? "critical" : "attention") as LiveState,
      updatedAt: r.updated_at,
      href: "/dashboard/admin/noc-incidents",
    }));
}

/* ------------------------------ aggregation ------------------------------ */

export interface LiveKindSummary {
  kind: LiveKind;
  label: string;
  total: number;
  critical: number;
  attention: number;
  offline: number;
}

export function liveSummary(entities: LiveEntity[]): LiveKindSummary[] {
  const order: LiveKind[] = [
    "driver", "vehicle", "delayed_trip", "delivery", "charter", "aircraft", "boat", "incident",
  ];
  return order.map((kind) => {
    const list = entities.filter((e) => e.kind === kind);
    return {
      kind,
      label: LIVE_KIND_LABEL[kind],
      total: list.length,
      critical: list.filter((e) => e.state === "critical").length,
      attention: list.filter((e) => e.state === "attention").length,
      offline: list.filter((e) => e.state === "offline").length,
    };
  });
}

/** Exceptions first — what the operations desk must act on right now. */
export function exceptionFeed(entities: LiveEntity[], limit = 25): LiveEntity[] {
  const rank: Record<LiveState, number> = { critical: 0, attention: 1, offline: 2, healthy: 3 };
  return [...entities]
    .filter((e) => e.state !== "healthy")
    .sort(
      (a, b) =>
        rank[a.state] - rank[b.state] ||
        (b.lateMinutes ?? 0) - (a.lateMinutes ?? 0) ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )
    .slice(0, limit);
}

export const LIVE_STATE_TONE: Record<LiveState, string> = {
  healthy: "border-status-success/40 text-status-success",
  attention: "border-status-warning/40 text-status-warning",
  critical: "border-destructive/40 text-destructive",
  offline: "border-border text-muted-foreground",
};

/** Bounds for a simple projected map, or null when nothing is geo-located. */
export function geoBounds(entities: LiveEntity[]) {
  const pts = entities.filter(
    (e): e is LiveEntity & { lat: number; lng: number } =>
      typeof e.lat === "number" && typeof e.lng === "number",
  );
  if (pts.length === 0) return null;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    points: pts,
  };
}

/** Projects a point into 0-100 percentage coordinates for the map canvas. */
export function projectPoint(
  bounds: NonNullable<ReturnType<typeof geoBounds>>,
  lat: number,
  lng: number,
): { x: number; y: number } {
  const latSpan = bounds.maxLat - bounds.minLat || 1;
  const lngSpan = bounds.maxLng - bounds.minLng || 1;
  const pad = 8;
  const x = pad + ((lng - bounds.minLng) / lngSpan) * (100 - pad * 2);
  const y = pad + ((bounds.maxLat - lat) / latSpan) * (100 - pad * 2);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}
