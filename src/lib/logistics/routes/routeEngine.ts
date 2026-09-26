/**
 * Route / route-version / stop execution client layer (Phase 2).
 *
 * The planned route is a distinct aggregate: `delivery_route_segments` stays the
 * GPS/telemetry trace layer and is only *linked* to a route, never repurposed.
 * Every mutation below is a server-authoritative RPC that checks the logistics
 * permission, validates the state transition and writes an append-only event.
 * Nothing here rewrites hub, manifest, custody or dispatch domains — routes link
 * to existing `delivery_dispatch_jobs` and existing `packages`.
 */
import { supabase } from "@/integrations/supabase/client";

const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type RouteStatus =
  | "DRAFT" | "PLANNED" | "ASSIGNED" | "READY" | "IN_PROGRESS"
  | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED";

export type StopStatus =
  | "PLANNED" | "ASSIGNED" | "EN_ROUTE" | "ARRIVED" | "SERVICE_STARTED"
  | "COMPLETED" | "FAILED" | "SKIPPED" | "CANCELLED";

export type RouteType = "delivery" | "pickup" | "mixed" | "linehaul" | "returns" | "shuttle";
export type StopType = "pickup" | "delivery" | "return" | "hub" | "waypoint";
export type PackageRole = "pickup" | "delivery" | "return";

export const ROUTE_TYPES: { value: RouteType; label: string }[] = [
  { value: "delivery", label: "Delivery round" },
  { value: "pickup", label: "Pickup round" },
  { value: "mixed", label: "Mixed pickup/delivery" },
  { value: "linehaul", label: "Line-haul" },
  { value: "returns", label: "Returns sweep" },
  { value: "shuttle", label: "Hub shuttle" },
];

export const STOP_TYPES: { value: StopType; label: string }[] = [
  { value: "pickup", label: "Pickup" },
  { value: "delivery", label: "Delivery" },
  { value: "return", label: "Return" },
  { value: "hub", label: "Hub" },
  { value: "waypoint", label: "Waypoint" },
];

/** Mirrors the server state machine so the UI only offers legal moves. */
export const ROUTE_TRANSITIONS: Record<RouteStatus, RouteStatus[]> = {
  DRAFT: ["PLANNED", "CANCELLED"],
  PLANNED: ["ASSIGNED", "DRAFT", "CANCELLED"],
  ASSIGNED: ["READY", "PLANNED", "CANCELLED"],
  READY: ["IN_PROGRESS", "ASSIGNED", "CANCELLED"],
  IN_PROGRESS: ["PAUSED", "COMPLETED", "FAILED", "CANCELLED"],
  PAUSED: ["IN_PROGRESS", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export const STOP_TRANSITIONS: Record<StopStatus, StopStatus[]> = {
  PLANNED: ["ASSIGNED", "SKIPPED", "CANCELLED"],
  ASSIGNED: ["EN_ROUTE", "PLANNED", "SKIPPED", "CANCELLED"],
  EN_ROUTE: ["ARRIVED", "FAILED", "SKIPPED", "CANCELLED"],
  ARRIVED: ["SERVICE_STARTED", "FAILED", "SKIPPED"],
  SERVICE_STARTED: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: ["EN_ROUTE", "SKIPPED", "CANCELLED"],
  SKIPPED: [],
  CANCELLED: [],
};

/** Transitions the server refuses without a reason. */
export const REASON_REQUIRED: (RouteStatus | StopStatus)[] = ["FAILED", "SKIPPED", "CANCELLED"];

export type EligibilityReason =
  | "ELIGIBLE" | "INELIGIBLE" | "CAPACITY_EXCEEDED" | "OUTSIDE_SERVICE_AREA"
  | "DRIVER_UNAVAILABLE" | "VEHICLE_UNAVAILABLE" | "VEHICLE_TYPE_MISMATCH"
  | "COMPLIANCE_REQUIRED" | "ALREADY_ASSIGNED";

export const ELIGIBILITY_COPY: Record<string, string> = {
  ELIGIBLE: "Eligible",
  INELIGIBLE: "Not eligible",
  CAPACITY_EXCEEDED: "Planned load exceeds the route capacity",
  OUTSIDE_SERVICE_AREA: "Outside the configured service area",
  DRIVER_UNAVAILABLE: "Driver is not active",
  VEHICLE_UNAVAILABLE: "Vehicle is not available",
  VEHICLE_TYPE_MISMATCH: "Vehicle type does not match the route requirement",
  COMPLIANCE_REQUIRED: "Driver verification/compliance incomplete",
  ALREADY_ASSIGNED: "Driver already holds an open route",
};

export interface LogisticsRoute {
  id: string;
  route_number: string;
  organization_id: string | null;
  route_type: RouteType;
  status: RouteStatus;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  driver_user_id: string | null;
  vehicle_id: string | null;
  origin_hub_id: string | null;
  destination_hub_id: string | null;
  origin_label: string | null;
  destination_label: string | null;
  planned_distance_km: number | null;
  actual_distance_km: number | null;
  estimated_duration_min: number | null;
  actual_duration_min: number | null;
  service_window_start: string | null;
  service_window_end: string | null;
  required_capacity_kg: number | null;
  required_vehicle_type: string | null;
  optimization_status: string;
  current_version: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RouteVersion {
  id: string;
  route_id: string;
  version_number: number;
  parent_version_id: string | null;
  change_reason: string | null;
  optimization_source: string;
  manual_override: boolean;
  created_at: string;
  superseded_at: string | null;
}

export interface RouteStop {
  id: string;
  route_id: string;
  route_version_id: string;
  sequence: number;
  stop_type: StopType;
  hub_id: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  instructions: string | null;
  service_window_start: string | null;
  service_window_end: string | null;
  planned_arrival: string | null;
  eta: string | null;
  eta_source: string | null;
  eta_revised_at: string | null;
  actual_arrival: string | null;
  departed_at: string | null;
  status: StopStatus;
  exception_id: string | null;
}

export interface StopPackageLink {
  link_id: string;
  role: PackageRole;
  package: {
    id: string;
    tracking_number: string;
    status: string;
    recipient_name: string | null;
    recipient_phone: string | null;
    dropoff_address: string | null;
    pickup_address: string | null;
    weight_kg: number | null;
  };
}

export interface RouteDeviation {
  id: string;
  route_id: string;
  stop_id: string | null;
  kind: "route_deviation" | "missed_stop" | "unexpected_stop" | "sequence_violation" | "route_abandonment";
  severity: "low" | "medium" | "high";
  narrative: string | null;
  distance_m: number | null;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  detected_at: string;
}

export interface OptimizationRun {
  id: string;
  route_id: string;
  route_version_id: string | null;
  result_version_id: string | null;
  provider_key: string;
  status: "pending" | "succeeded" | "failed" | "skipped";
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RouteEvent {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface RouteDetail {
  route: LogisticsRoute;
  current_version_id: string;
  versions: RouteVersion[];
  stops: { stop: RouteStop; packages: StopPackageLink[] }[];
  deviations: RouteDeviation[];
  dispatch_jobs: { link: { id: string; stop_id: string | null }; job: Record<string, unknown> }[];
  optimization_runs: OptimizationRun[];
  events: RouteEvent[];
}

export interface EligibilityResult {
  status: "ELIGIBLE" | "INELIGIBLE";
  reasons: string[];
  planned_load_kg: number;
  evaluated_at: string;
}

/* ------------------------------- reads ------------------------------- */

export async function listRoutes(filter?: { status?: RouteStatus | "all"; search?: string }) {
  let q = supabase
    .from("logistics_routes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter?.status && filter.status !== "all") q = q.eq("status", filter.status);
  if (filter?.search) q = q.ilike("route_number", `%${filter.search}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LogisticsRoute[];
}

export const getRouteDetail = (routeId: string) =>
  call<RouteDetail>("logistics_route_detail", { _route_id: routeId });

export async function listHubOptions() {
  const { data, error } = await supabase
    .from("logistics_hubs")
    .select("id, code, name, city, status")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; code: string; name: string; city: string | null; status: string }[];
}

export async function listEligibleDrivers(search?: string) {
  const data = await call<{ user_id: string; full_name: string; driver_type: string }[]>(
    "logistics_eligible_drivers",
    { _search: search ?? null, _limit: 50 },
  );
  return data ?? [];
}

export async function listVehicleOptions() {
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, vehicle_code, number_plate, vehicle_type, vehicle_status")
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; vehicle_code: string; number_plate: string; vehicle_type: string; vehicle_status: string }[];
}

export async function listAssignablePackages(search?: string) {
  let q = supabase
    .from("packages")
    .select("id, tracking_number, status, recipient_name, dropoff_address, pickup_address, weight_kg")
    .order("created_at", { ascending: false })
    .limit(50);
  if (search) q = q.ilike("tracking_number", `%${search}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; tracking_number: string; status: string; recipient_name: string | null; dropoff_address: string | null; pickup_address: string | null; weight_kg: number | null }[];
}

export async function listRouteProviders() {
  const { data, error } = await supabase
    .from("logistics_route_providers")
    .select("*")
    .order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as {
    id: string; provider_key: string; display_name: string; enabled: boolean;
    base_url: string | null; credential_secret_name: string | null;
    health_status: string; health_detail: string | null; last_checked_at: string | null;
  }[];
}

export async function saveRouteProvider(input: {
  id: string; enabled: boolean; base_url?: string | null; credential_secret_name?: string | null;
  health_status?: string; health_detail?: string | null;
}) {
  const { error } = await supabase
    .from("logistics_route_providers")
    .update({
      enabled: input.enabled,
      base_url: input.base_url ?? null,
      credential_secret_name: input.credential_secret_name ?? null,
      health_status: input.health_status ?? (input.enabled ? "unknown" : "unconfigured"),
      health_detail: input.health_detail ?? null,
      last_checked_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
}

/* ------------------------------ mutations ------------------------------ */

export const upsertRoute = (routeId: string | null, payload: Record<string, unknown>, reason?: string) =>
  call<LogisticsRoute>("logistics_route_upsert", { _route_id: routeId, _payload: payload, _reason: reason ?? null });

export const createRouteVersion = (routeId: string, reason: string, source = "manual", manualOverride = true) =>
  call<RouteVersion>("logistics_route_new_version", {
    _route_id: routeId, _reason: reason, _optimization_source: source, _manual_override: manualOverride,
  });

export const upsertStop = (stopId: string | null, routeId: string, payload: Record<string, unknown>) =>
  call<RouteStop>("logistics_stop_upsert", { _stop_id: stopId, _route_id: routeId, _payload: payload });

export const removeStop = (stopId: string, reason: string) =>
  call<boolean>("logistics_stop_remove", { _stop_id: stopId, _reason: reason });

export const reorderStops = (routeId: string, stopIds: string[], reason: string) =>
  call<RouteStop[]>("logistics_route_reorder_stops", { _route_id: routeId, _stop_ids: stopIds, _reason: reason });

export const attachPackage = (stopId: string, packageId: string, role: PackageRole) =>
  call<unknown>("logistics_stop_attach_package", { _stop_id: stopId, _package_id: packageId, _role: role });

export const detachPackage = (linkId: string, reason: string) =>
  call<boolean>("logistics_stop_detach_package", { _link_id: linkId, _reason: reason });

export const evaluateEligibility = (routeId: string, driverUserId: string, vehicleId?: string | null) =>
  call<EligibilityResult>("logistics_route_eligibility", {
    _route_id: routeId, _driver_user_id: driverUserId, _vehicle_id: vehicleId ?? null,
  });

export const assignRoute = (
  routeId: string, driverUserId: string, vehicleId: string | null, reason: string, force = false,
) =>
  call<LogisticsRoute>("logistics_route_assign", {
    _route_id: routeId, _driver_user_id: driverUserId, _vehicle_id: vehicleId, _reason: reason, _force: force,
  });

export const transitionRoute = (routeId: string, to: RouteStatus, reason?: string) =>
  call<LogisticsRoute>("logistics_route_transition", { _route_id: routeId, _to_status: to, _reason: reason ?? null });

export const transitionStop = (
  stopId: string, to: StopStatus, reason?: string, lat?: number | null, lng?: number | null,
) =>
  call<RouteStop>("logistics_stop_transition", {
    _stop_id: stopId, _to_status: to, _reason: reason ?? null, _lat: lat ?? null, _lng: lng ?? null,
  });

export const linkDispatchJob = (routeId: string, stopId: string | null, dispatchJobId: string) =>
  call<unknown>("logistics_route_link_dispatch_job", {
    _route_id: routeId, _stop_id: stopId, _dispatch_job_id: dispatchJobId,
  });

export const recordDeviation = (input: {
  routeId: string; stopId?: string | null; kind: RouteDeviation["kind"];
  severity?: RouteDeviation["severity"]; narrative: string; distanceM?: number | null;
}) =>
  call<RouteDeviation>("logistics_route_record_deviation", {
    _route_id: input.routeId, _stop_id: input.stopId ?? null, _kind: input.kind,
    _severity: input.severity ?? "medium", _narrative: input.narrative, _distance_m: input.distanceM ?? null,
  });

export const resolveDeviation = (deviationId: string, status: "acknowledged" | "resolved" | "dismissed", note?: string) =>
  call<RouteDeviation>("logistics_route_resolve_deviation", {
    _deviation_id: deviationId, _status: status, _note: note ?? null,
  });

export const requestOptimization = (routeId: string, providerKey: string, request: Record<string, unknown> = {}) =>
  call<{ run_id: string; status: string; reason?: string; fallback?: string }>("logistics_route_optimize", {
    _route_id: routeId, _provider_key: providerKey, _request: request,
  });

export const applyOptimization = (
  runId: string, orderedStopIds: string[] | null, response: Record<string, unknown>, reason: string,
) =>
  call<{ run_id: string; status: string; route_version_id: string; version: number }>(
    "logistics_route_optimization_apply",
    { _run_id: runId, _ordered_stop_ids: orderedStopIds, _response: response, _reason: reason },
  );

/* ------------------------------ derivations ------------------------------ */

/** Local, provider-neutral nearest-neighbour plan used by the manual fallback. */
export function manualNearestNeighbourOrder(
  stops: { id: string; lat: number | null; lng: number | null }[],
  origin?: { lat: number | null; lng: number | null },
): string[] {
  const remaining = [...stops];
  const ordered: string[] = [];
  let cursor = { lat: origin?.lat ?? null, lng: origin?.lng ?? null };
  const dist = (a: { lat: number | null; lng: number | null }, b: { lat: number | null; lng: number | null }) => {
    if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return Number.POSITIVE_INFINITY;
    return Math.hypot(a.lat - b.lat, a.lng - b.lng);
  };
  while (remaining.length) {
    let bestIdx = 0;
    let best = Number.POSITIVE_INFINITY;
    remaining.forEach((s, i) => {
      const d = dist(cursor, s);
      if (d < best) { best = d; bestIdx = i; }
    });
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next.id);
    cursor = { lat: next.lat, lng: next.lng };
  }
  return ordered;
}

/** Straight-line plan distance in km — labelled as an estimate, never as a provider result. */
export function estimatePlanDistanceKm(
  stops: { lat: number | null; lng: number | null }[],
  origin?: { lat: number | null; lng: number | null },
): number | null {
  const points = [origin, ...stops].filter(
    (p): p is { lat: number; lng: number } => !!p && p.lat != null && p.lng != null,
  );
  if (points.length < 2) return null;
  let km = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    km += 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return Math.round(km * 100) / 100;
}

/** Blocking work that stops a route from completing — mirrors the server rule. */
export function routeCompletionBlockers(stops: { stop: RouteStop }[]): string[] {
  const open = stops.filter((s) =>
    ["PLANNED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "SERVICE_STARTED"].includes(s.stop.status));
  const failedWithoutException = stops.filter((s) => s.stop.status === "FAILED" && !s.stop.exception_id);
  const blockers: string[] = [];
  if (open.length) blockers.push(`${open.length} stop(s) still open`);
  if (failedWithoutException.length) blockers.push(`${failedWithoutException.length} failed stop(s) without an exception`);
  return blockers;
}
