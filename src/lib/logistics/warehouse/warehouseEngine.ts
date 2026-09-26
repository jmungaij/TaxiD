/**
 * PHASE 6 — warehouse & fulfilment client API.
 *
 * The console owns NO warehouse logic. Every physical action is a call into an
 * authoritative database operation which records the change against the existing
 * spine: `packages`, `logistics_manifests`, `logistics_hubs`,
 * `package_chain_of_custody`, `logistics_routes` / `logistics_route_stops` and
 * `delivery_dispatch_jobs`. The client may not write to those tables directly,
 * may not decide eligibility, and may not invent a status.
 *
 * Idempotency: every mutating call carries an `operation_key`. Replaying a key
 * returns `duplicate: true` and writes nothing. Scanner clients therefore retry
 * safely, and the offline queue replays with the SAME key it captured.
 */
import { supabase } from "@/integrations/supabase/client";

/* ------------------------------------------------------------------ contracts */

export type ZoneType =
  | "RECEIVING" | "SORTING" | "STORAGE" | "PICKING" | "PACKING"
  | "STAGING" | "CROSS_DOCK" | "RETURNS" | "QUARANTINE" | "COLD_CHAIN";

export type LocationType = "BIN" | "SHELF" | "RACK" | "PALLET" | "FLOOR" | "STAGING_POSITION" | "DOCK";
export type LocationStatus = "ACTIVE" | "BLOCKED" | "FULL" | "RETIRED";
export type DockType = "INBOUND" | "OUTBOUND" | "BOTH";
export type DockStatus = "AVAILABLE" | "OCCUPIED" | "OUT_OF_SERVICE";
export type GateDirection = "ARRIVAL" | "DEPARTURE";

export type WhOperationType =
  | "GATE_IN" | "GATE_OUT" | "RECEIVE" | "SORT" | "PUT_AWAY" | "MOVE"
  | "PICK" | "PACK" | "CONSOLIDATE" | "DECONSOLIDATE"
  | "OUTBOUND_STAGE" | "DISPATCH" | "RETURN_RECEIVE" | "TEMPERATURE";

export interface HubOption {
  id: string;
  code: string;
  name: string;
  city: string | null;
  capabilities: string[];
}

export interface ZoneRow {
  id: string;
  hub_id: string;
  code: string;
  name: string;
  zone_type: ZoneType;
  status: string;
  temperature_min_c: number | null;
  temperature_max_c: number | null;
  notes: string | null;
}

export interface LocationRow {
  id: string;
  hub_id: string;
  zone_id: string | null;
  code: string;
  location_type: LocationType;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  status: LocationStatus;
  max_units: number | null;
  max_weight_kg: number | null;
  occupied_units: number | null;
}

export interface DockRow {
  id: string;
  hub_id: string;
  code: string;
  dock_type: DockType;
  status: DockStatus;
  max_vehicle_length_m: number | null;
}

export interface ReceivingSessionRow {
  id: string;
  hub_id: string;
  manifest_id: string | null;
  dock_id: string | null;
  status: string;
  expected_count: number | null;
  received_count: number | null;
  damaged_count: number | null;
  variance_note: string | null;
  variance_explained: boolean;
  opened_at: string;
  closed_at: string | null;
}

export interface WhOperationRow {
  id: string;
  operation_key: string;
  operation_type: WhOperationType;
  hub_id: string | null;
  package_id: string | null;
  manifest_id: string | null;
  route_id: string | null;
  stop_id: string | null;
  location_id: string | null;
  custody_event_id: string | null;
  stage: string | null;
  reason_code: string | null;
  note: string | null;
  device_id: string | null;
  performed_by: string | null;
  created_at: string;
}

export interface PlacementRow {
  package_id: string;
  hub_id: string;
  location_id: string | null;
  inventory_state: string;
  placed_at: string;
  updated_at: string;
}

export interface PickListRow {
  id: string;
  hub_id: string;
  order_id: string | null;
  picker_id: string | null;
  status: string;
  line_count: number | null;
  picked_count: number | null;
  created_at: string;
}

export interface PickLineRow {
  id: string;
  pick_list_id: string;
  package_id: string;
  location_id: string | null;
  state: string;
  quantity: number | null;
  reason_code: string | null;
}

export interface OfflineQueueRow {
  id: string;
  device_id: string;
  operation_key: string;
  operation_type: string;
  hub_id: string | null;
  captured_at: string;
  replayed_at: string | null;
  state: string;
  failure_reason: string | null;
  payload: Record<string, unknown>;
}

/** Uniform result of a warehouse operation. */
export interface WhResult {
  ok: boolean;
  duplicate?: boolean;
  code?: string;
  message?: string;
  operation_id?: string;
  custody_event_id?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ helpers */

/**
 * Operation keys are deterministic per (device, action, subject, minute-bucket)
 * so an accidental double-tap collapses into one operation while a deliberate
 * later repeat is a new one.
 */
export function operationKey(parts: {
  device: string;
  action: string;
  subject: string;
  bucketMs?: number;
}): string {
  const bucket = Math.floor(Date.now() / (parts.bucketMs ?? 60_000));
  return `${parts.device}:${parts.action}:${parts.subject}:${bucket}`;
}

function asResult(data: unknown, error: { message: string } | null): WhResult {
  if (error) return { ok: false, code: "RPC_ERROR", message: error.message };
  if (data && typeof data === "object") return data as WhResult;
  return { ok: true };
}

/* ------------------------------------------------------------------ reads */

export async function listWarehouseHubs(): Promise<HubOption[]> {
  const { data } = await supabase
    .from("logistics_hubs")
    .select("id, code, name, city, capabilities")
    .eq("status", "active")
    .order("code");
  return (data ?? []) as HubOption[];
}

export async function listZones(hubId: string): Promise<ZoneRow[]> {
  const { data } = await supabase
    .from("logistics_hub_zones")
    .select("*")
    .eq("hub_id", hubId)
    .order("code");
  return (data ?? []) as unknown as ZoneRow[];
}

export async function listLocations(hubId: string): Promise<LocationRow[]> {
  const { data } = await supabase
    .from("logistics_hub_locations")
    .select("*")
    .eq("hub_id", hubId)
    .order("code");
  return (data ?? []) as unknown as LocationRow[];
}

export async function listDocks(hubId: string): Promise<DockRow[]> {
  const { data } = await supabase
    .from("logistics_hub_docks")
    .select("*")
    .eq("hub_id", hubId)
    .order("code");
  return (data ?? []) as unknown as DockRow[];
}

export async function listReceivingSessions(hubId: string): Promise<ReceivingSessionRow[]> {
  const { data } = await supabase
    .from("logistics_receiving_sessions")
    .select("*")
    .eq("hub_id", hubId)
    .order("opened_at", { ascending: false })
    .limit(50);
  return (data ?? []) as unknown as ReceivingSessionRow[];
}

export async function listOperations(hubId: string, limit = 100): Promise<WhOperationRow[]> {
  const { data } = await supabase
    .from("logistics_wh_operations")
    .select("*")
    .eq("hub_id", hubId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as WhOperationRow[];
}

export async function listPlacements(hubId: string): Promise<PlacementRow[]> {
  const { data } = await supabase
    .from("logistics_package_placement")
    .select("*")
    .eq("hub_id", hubId)
    .order("updated_at", { ascending: false })
    .limit(200);
  return (data ?? []) as unknown as PlacementRow[];
}

export async function listPickLists(hubId: string): Promise<PickListRow[]> {
  const { data } = await supabase
    .from("logistics_pick_lists")
    .select("*")
    .eq("hub_id", hubId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as unknown as PickListRow[];
}

export async function listPickLines(pickListId: string): Promise<PickLineRow[]> {
  const { data } = await supabase
    .from("logistics_pick_list_lines")
    .select("*")
    .eq("pick_list_id", pickListId);
  return (data ?? []) as unknown as PickLineRow[];
}

export async function listOfflineQueue(limit = 100): Promise<OfflineQueueRow[]> {
  const { data } = await supabase
    .from("logistics_wh_offline_queue")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as OfflineQueueRow[];
}

export interface OpenManifestOption {
  id: string;
  manifest_number: string;
  manifest_type: string;
  status: string;
}

export async function listOutboundManifests(hubId: string): Promise<OpenManifestOption[]> {
  const { data } = await supabase
    .from("logistics_manifests")
    .select("id, manifest_number, manifest_type, status")
    .eq("origin_hub_id", hubId)
    .in("status", ["open", "sealed", "loading"])
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as OpenManifestOption[];
}

export interface PackageLookup {
  id: string;
  tracking_number: string;
  status: string;
  recipient_name: string | null;
  weight_kg: number | null;
}

/** Identity lookup only — never a decision. */
export async function findPackage(identifier: string): Promise<PackageLookup | null> {
  const term = identifier.trim();
  if (!term) return null;
  const { data } = await supabase
    .from("packages")
    .select("id, tracking_number, status, recipient_name, weight_kg")
    .eq("tracking_number", term)
    .maybeSingle();
  return (data ?? null) as PackageLookup | null;
}

/* ------------------------------------------------------------------ configuration */

export async function upsertZone(input: {
  id?: string | null;
  hubId: string;
  code: string;
  name: string;
  zoneType: ZoneType;
  status?: string;
  temperatureMinC?: number | null;
  temperatureMaxC?: number | null;
  notes?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_zone_upsert", {
    _id: input.id ?? null,
    _hub_id: input.hubId,
    _code: input.code,
    _name: input.name,
    _zone_type: input.zoneType,
    _status: input.status ?? "ACTIVE",
    _temperature_min_c: input.temperatureMinC ?? null,
    _temperature_max_c: input.temperatureMaxC ?? null,
    _notes: input.notes ?? null,
  });
  if (error) return { ok: false, code: "RPC_ERROR", message: error.message };
  return { ok: true, ...(data as object) };
}

export async function upsertLocation(input: {
  id?: string | null;
  hubId: string;
  zoneId: string | null;
  code: string;
  locationType: LocationType;
  aisle?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  status?: LocationStatus;
  maxUnits?: number | null;
  maxWeightKg?: number | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_location_upsert", {
    _id: input.id ?? null,
    _hub_id: input.hubId,
    _zone_id: input.zoneId,
    _code: input.code,
    _location_type: input.locationType,
    _aisle: input.aisle ?? null,
    _rack: input.rack ?? null,
    _shelf: input.shelf ?? null,
    _bin: input.bin ?? null,
    _status: input.status ?? "ACTIVE",
    _max_units: input.maxUnits ?? null,
    _max_weight_kg: input.maxWeightKg ?? null,
  });
  if (error) return { ok: false, code: "RPC_ERROR", message: error.message };
  return { ok: true, ...(data as object) };
}

export async function setLocationStatus(
  id: string, status: LocationStatus, reason?: string,
): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_location_set_status", {
    _id: id, _status: status, _reason: reason ?? null,
  });
  if (error) return { ok: false, code: "RPC_ERROR", message: error.message };
  return { ok: true, ...(data as object) };
}

export async function upsertDock(input: {
  id?: string | null;
  hubId: string;
  code: string;
  dockType?: DockType;
  status?: DockStatus;
  maxVehicleLengthM?: number | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_dock_upsert", {
    _id: input.id ?? null,
    _hub_id: input.hubId,
    _code: input.code,
    _dock_type: input.dockType ?? "BOTH",
    _status: input.status ?? "AVAILABLE",
    _max_vehicle_length_m: input.maxVehicleLengthM ?? null,
  });
  if (error) return { ok: false, code: "RPC_ERROR", message: error.message };
  return { ok: true, ...(data as object) };
}

/* ------------------------------------------------------------------ inbound */

export async function recordGateEvent(input: {
  hubId: string;
  direction: GateDirection;
  operationKey: string;
  manifestId?: string | null;
  vehicleRegistration?: string | null;
  dockId?: string | null;
  sealId?: string | null;
  sealIntact?: boolean | null;
  declaredPackageCount?: number | null;
  notes?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_gate_event", {
    _hub_id: input.hubId,
    _direction: input.direction,
    _operation_key: input.operationKey,
    _manifest_id: input.manifestId ?? null,
    _vehicle_registration: input.vehicleRegistration ?? null,
    _dock_id: input.dockId ?? null,
    _seal_id: input.sealId ?? null,
    _seal_intact: input.sealIntact ?? null,
    _declared_package_count: input.declaredPackageCount ?? null,
    _notes: input.notes ?? null,
  });
  return asResult(data, error);
}

export async function receiveScan(input: {
  sessionId: string;
  identifier: string;
  operationKey: string;
  condition?: string;
  deviceId?: string | null;
  locationId?: string | null;
  note?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_receive_scan", {
    _session_id: input.sessionId,
    _identifier: input.identifier,
    _operation_key: input.operationKey,
    _condition: input.condition ?? "GOOD",
    _device_id: input.deviceId ?? null,
    _location_id: input.locationId ?? null,
    _note: input.note ?? null,
  });
  return asResult(data, error);
}

export async function reconcileReceiving(input: {
  sessionId: string;
  varianceNote?: string | null;
  close?: boolean;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_receiving_reconcile", {
    _session_id: input.sessionId,
    _variance_note: input.varianceNote ?? null,
    _close: input.close ?? false,
  });
  return asResult(data, error);
}

/* ------------------------------------------------------------------ movement */

export async function sortPackage(input: {
  packageId: string;
  hubId: string;
  operationKey: string;
  destinationHubId?: string | null;
  routeId?: string | null;
  stopId?: string | null;
  serviceLevel?: string | null;
  deviceId?: string | null;
  note?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_sort", {
    _package_id: input.packageId,
    _hub_id: input.hubId,
    _operation_key: input.operationKey,
    _destination_hub_id: input.destinationHubId ?? null,
    _route_id: input.routeId ?? null,
    _stop_id: input.stopId ?? null,
    _service_level: input.serviceLevel ?? null,
    _device_id: input.deviceId ?? null,
    _note: input.note ?? null,
  });
  return asResult(data, error);
}

export async function putAway(input: {
  packageId: string;
  hubId: string;
  locationId: string;
  operationKey: string;
  deviceId?: string | null;
  note?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_put_away", {
    _package_id: input.packageId,
    _hub_id: input.hubId,
    _location_id: input.locationId,
    _operation_key: input.operationKey,
    _device_id: input.deviceId ?? null,
    _note: input.note ?? null,
  });
  return asResult(data, error);
}

export async function movePackage(input: {
  packageId: string;
  toLocationId: string;
  operationKey: string;
  reasonCode?: string | null;
  note?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_move", {
    _package_id: input.packageId,
    _to_location_id: input.toLocationId,
    _operation_key: input.operationKey,
    _reason_code: input.reasonCode ?? null,
    _note: input.note ?? null,
  });
  return asResult(data, error);
}

/* ------------------------------------------------------------------ fulfilment */

export async function createPickList(input: {
  hubId: string;
  packageIds: string[];
  orderId?: string | null;
  pickerId?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_pick_list_create", {
    _hub_id: input.hubId,
    _package_ids: input.packageIds,
    _order_id: input.orderId ?? null,
    _picker_id: input.pickerId ?? null,
  });
  if (error) return { ok: false, code: "RPC_ERROR", message: error.message };
  return { ok: true, ...(data as object) };
}

export async function pickLine(input: {
  lineId: string;
  operationKey: string;
  quantity?: number;
  reasonCode?: string | null;
  narrative?: string | null;
  deviceId?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_pick", {
    _line_id: input.lineId,
    _operation_key: input.operationKey,
    _quantity: input.quantity ?? 1,
    _reason_code: input.reasonCode ?? null,
    _narrative: input.narrative ?? null,
    _device_id: input.deviceId ?? null,
  });
  return asResult(data, error);
}

export async function packPackage(input: {
  packageId: string;
  hubId: string;
  operationKey: string;
  stationCode?: string | null;
  packagingType?: string | null;
  weightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  labelReference?: string | null;
  labelKind?: string;
  deviceId?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_pack", {
    _package_id: input.packageId,
    _hub_id: input.hubId,
    _operation_key: input.operationKey,
    _station_code: input.stationCode ?? null,
    _packaging_type: input.packagingType ?? null,
    _weight_kg: input.weightKg ?? null,
    _length_cm: input.lengthCm ?? null,
    _width_cm: input.widthCm ?? null,
    _height_cm: input.heightCm ?? null,
    _label_reference: input.labelReference ?? null,
    _label_kind: input.labelKind ?? "SHIPPING",
    _device_id: input.deviceId ?? null,
  });
  return asResult(data, error);
}

/* ------------------------------------------------------------------ outbound */

export async function consolidate(input: {
  packageId: string;
  hubId: string;
  manifestId: string;
  operationKey: string;
  deviceId?: string | null;
  note?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_consolidate", {
    _package_id: input.packageId,
    _hub_id: input.hubId,
    _manifest_id: input.manifestId,
    _operation_key: input.operationKey,
    _device_id: input.deviceId ?? null,
    _note: input.note ?? null,
  });
  return asResult(data, error);
}

export async function deconsolidate(input: {
  packageId: string;
  manifestId: string;
  reasonCode: string;
  operationKey: string;
  narrative?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_deconsolidate", {
    _package_id: input.packageId,
    _manifest_id: input.manifestId,
    _reason_code: input.reasonCode,
    _operation_key: input.operationKey,
    _narrative: input.narrative ?? null,
  });
  return asResult(data, error);
}

export async function stageOutbound(input: {
  packageId: string;
  hubId: string;
  operationKey: string;
  locationId?: string | null;
  manifestId?: string | null;
  stopId?: string | null;
  deviceId?: string | null;
  note?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_stage_outbound", {
    _package_id: input.packageId,
    _hub_id: input.hubId,
    _operation_key: input.operationKey,
    _location_id: input.locationId ?? null,
    _manifest_id: input.manifestId ?? null,
    _stop_id: input.stopId ?? null,
    _device_id: input.deviceId ?? null,
    _note: input.note ?? null,
  });
  return asResult(data, error);
}

export async function dispatchManifest(input: {
  manifestId: string;
  hubId: string;
  operationKey: string;
  routeId?: string | null;
  dockId?: string | null;
  sealId?: string | null;
  note?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_dispatch", {
    _manifest_id: input.manifestId,
    _hub_id: input.hubId,
    _operation_key: input.operationKey,
    _route_id: input.routeId ?? null,
    _dock_id: input.dockId ?? null,
    _seal_id: input.sealId ?? null,
    _note: input.note ?? null,
  });
  return asResult(data, error);
}

/* ------------------------------------------------------------------ returns, cold chain, offline */

export async function receiveReturn(input: {
  returnId: string;
  hubId: string;
  operationKey: string;
  condition?: string;
  sealState?: string | null;
  sealId?: string | null;
  scannedReference?: string | null;
  notes?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_return_receive", {
    _return_id: input.returnId,
    _hub_id: input.hubId,
    _operation_key: input.operationKey,
    _condition: input.condition ?? "good",
    _seal_state: input.sealState ?? null,
    _seal_id: input.sealId ?? null,
    _scanned_reference: input.scannedReference ?? null,
    _notes: input.notes ?? null,
  });
  return asResult(data, error);
}

export async function recordTemperature(input: {
  hubId: string;
  readingC: number;
  zoneId?: string | null;
  packageId?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_temperature_record", {
    _hub_id: input.hubId,
    _reading_c: input.readingC,
    _zone_id: input.zoneId ?? null,
    _package_id: input.packageId ?? null,
  });
  return asResult(data, error);
}

/** Queue a scan captured while the device was offline. Replays with its own key. */
export async function enqueueOffline(input: {
  deviceId: string;
  operationKey: string;
  operationType: string;
  capturedAt: string;
  payload: Record<string, unknown>;
  hubId?: string | null;
}): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_offline_enqueue", {
    _device_id: input.deviceId,
    _operation_key: input.operationKey,
    _operation_type: input.operationType,
    _captured_at: input.capturedAt,
    _payload: input.payload as Record<string, never>,
    _hub_id: input.hubId ?? null,
  });
  return asResult(data, error);
}

export async function reconcileOffline(limit = 50): Promise<WhResult> {
  const { data, error } = await supabase.rpc("wh_offline_reconcile", { _limit: limit });
  return asResult(data, error);
}

/* ------------------------------------------------------------------ trace */

export interface PackageTrace {
  package?: Record<string, unknown>;
  custody?: Record<string, unknown>[];
  warehouse_operations?: Record<string, unknown>[];
  manifests?: Record<string, unknown>[];
  stops?: Record<string, unknown>[];
  placement?: Record<string, unknown> | null;
}

export async function tracePackage(packageId: string): Promise<PackageTrace | null> {
  const { data, error } = await supabase.rpc("wh_package_trace", { _package_id: packageId });
  if (error || !data) return null;
  return data as PackageTrace;
}

/* ------------------------------------------------------------------ presentation */

export const ZONE_TYPES: ZoneType[] = [
  "RECEIVING", "SORTING", "STORAGE", "PICKING", "PACKING",
  "STAGING", "CROSS_DOCK", "RETURNS", "QUARANTINE", "COLD_CHAIN",
];

export const LOCATION_TYPES: LocationType[] = [
  "BIN", "SHELF", "RACK", "PALLET", "FLOOR", "STAGING_POSITION", "DOCK",
];

/** Capability a hub must hold before an action is offered. Server re-checks. */
export const ACTION_CAPABILITY: Record<string, string> = {
  gate: "gate",
  receive: "receiving",
  sort: "sorting",
  put_away: "storage",
  pick: "pick",
  pack: "pack",
  consolidate: "cross_dock",
  stage: "staging",
  dispatch: "dispatch",
  return_receive: "returns_processing",
};

export function hubSupports(hub: HubOption | null, action: keyof typeof ACTION_CAPABILITY): boolean {
  if (!hub) return false;
  return (hub.capabilities ?? []).includes(ACTION_CAPABILITY[action]);
}
