/**
 * Hub administration client layer.
 *
 * A hub is the physical node the manifest spine depends on (pickup origin,
 * line-haul destination, cross-dock, returns point). The server owns every
 * mutation: each action below is an RPC that checks its own hub permission
 * (`staff.logistics.hubs.*`), validates the payload and writes an append-only
 * history row. Cross-dock movements additionally write to the existing
 * `package_chain_of_custody` — this module never touches custody directly.
 */
import { supabase } from "@/integrations/supabase/client";

export type HubType = "depot" | "warehouse" | "cross_dock" | "locker" | "agent" | "returns";

export const HUB_TYPES: { value: HubType; label: string }[] = [
  { value: "depot", label: "Depot" },
  { value: "warehouse", label: "Warehouse" },
  { value: "cross_dock", label: "Cross-dock" },
  { value: "locker", label: "Locker point" },
  { value: "agent", label: "Agent counter" },
  { value: "returns", label: "Returns centre" },
];

export type HubStatus = "draft" | "active" | "suspended" | "inactive";

export const HUB_STATUSES: { value: HubStatus; label: string; description: string }[] = [
  { value: "draft", label: "Draft", description: "Being configured — not operational" },
  { value: "active", label: "Active", description: "Accepts manifests, receipts and dispatch" },
  { value: "suspended", label: "Suspended", description: "Temporarily blocked from operations" },
  { value: "inactive", label: "Inactive", description: "Retired from operations" },
];

export type HubCapability =
  | "receiving"
  | "sorting"
  | "staging"
  | "cross_dock"
  | "dispatch"
  | "storage"
  | "returns_processing"
  | "cold_chain";

export const HUB_CAPABILITIES: { value: HubCapability; label: string }[] = [
  { value: "receiving", label: "Receiving" },
  { value: "sorting", label: "Sorting" },
  { value: "staging", label: "Staging" },
  { value: "cross_dock", label: "Cross-dock" },
  { value: "dispatch", label: "Dispatch" },
  { value: "storage", label: "Storage" },
  { value: "returns_processing", label: "Returns processing" },
  { value: "cold_chain", label: "Cold chain" },
];

export type CrossDockStage = "received" | "sorted" | "staged" | "consolidated" | "dispatched";

/** Capability the server requires for each cross-dock stage. */
export const STAGE_CAPABILITY: Record<CrossDockStage, HubCapability> = {
  received: "receiving",
  sorted: "sorting",
  staged: "staging",
  consolidated: "cross_dock",
  dispatched: "dispatch",
};

export const CROSS_DOCK_STAGES: { value: CrossDockStage; label: string }[] = [
  { value: "received", label: "Hub receipt" },
  { value: "sorted", label: "Sorted" },
  { value: "staged", label: "Staged" },
  { value: "consolidated", label: "Consolidated" },
  { value: "dispatched", label: "Outbound dispatch" },
];

export interface HubRecord {
  id: string;
  code: string;
  name: string;
  hub_type: string;
  status: HubStatus;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  region: string | null;
  country_code: string;
  timezone: string;
  capabilities: string[] | null;
  capacity_unit: string;
  max_capacity: number | null;
  current_capacity: number;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  responsible_operator_id: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type AreaType = "radius" | "polygon" | "city" | "region" | "corridor";

export interface HubServiceArea {
  id: string;
  hub_id: string;
  area_type: AreaType;
  label: string | null;
  city: string | null;
  region: string | null;
  corridor_code: string | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_km: number | null;
  polygon: unknown;
  active: boolean;
}

export interface HubOperatingHour {
  id?: string;
  hub_id?: string;
  weekday: number;
  opens: string | null;
  closes: string | null;
  closed: boolean;
}

export interface HubClosure {
  id: string;
  hub_id: string;
  closure_date: string;
  reason: string | null;
  closed: boolean;
  opens: string | null;
  closes: string | null;
}

export interface HubContact {
  id: string;
  hub_id: string;
  name: string;
  contact_role: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
  active: boolean;
}

export interface HubStageRow {
  id: string;
  hub_id: string;
  package_id: string;
  stage: CrossDockStage;
  inbound_manifest_id: string | null;
  outbound_manifest_id: string | null;
  custody_event_id: string | null;
  notes: string | null;
  updated_at: string;
}

export interface HubAuditEntry {
  id: string;
  hub_id: string;
  action: string;
  actor_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

export const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export interface HubInput {
  id?: string | null;
  code: string;
  name: string;
  hubType: HubType | string;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  region?: string | null;
  countryCode?: string;
  timezone?: string;
  capabilities?: string[];
  capacityUnit?: string;
  maxCapacity?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  responsibleOperatorId?: string | null;
  notes?: string | null;
}

/** Readiness classification — engineered vs actually configured and operable. */
export type HubReadiness =
  | "OWNER_CONFIGURATION_REQUIRED"
  | "CONFIGURED"
  | "ACTIVE"
  | "OPERATIONAL";

/**
 * Observational only: reports what the configuration actually proves. A hub that
 * merely exists is never reported operational.
 */
export function hubReadiness(
  hub: HubRecord,
  facts: { areas: number; hours: number; contacts: number; movements: number },
): HubReadiness {
  const configured =
    (hub.capabilities ?? []).length > 0 && facts.areas > 0 && facts.hours > 0 && facts.contacts > 0;
  if (!configured) return "OWNER_CONFIGURATION_REQUIRED";
  if (hub.status !== "active") return "CONFIGURED";
  return facts.movements > 0 ? "OPERATIONAL" : "ACTIVE";
}

export function availableCapacity(hub: HubRecord): number | null {
  if (hub.max_capacity === null || hub.max_capacity === undefined) return null;
  return Math.max(0, Number(hub.max_capacity) - Number(hub.current_capacity ?? 0));
}

/* --------------------------------- reads ---------------------------------- */

export async function loadHubs(includeInactive = true): Promise<HubRecord[]> {
  let query = supabase.from("logistics_hubs").select("*").order("name", { ascending: true });
  if (!includeInactive) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HubRecord[];
}

export async function loadServiceAreas(hubId: string): Promise<HubServiceArea[]> {
  const { data, error } = await supabase
    .from("logistics_hub_service_areas")
    .select("*")
    .eq("hub_id", hubId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HubServiceArea[];
}

export async function loadOperatingHours(hubId: string): Promise<HubOperatingHour[]> {
  const { data, error } = await supabase
    .from("logistics_hub_operating_hours")
    .select("id,hub_id,weekday,opens,closes,closed")
    .eq("hub_id", hubId)
    .order("weekday", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HubOperatingHour[];
}

export async function loadClosures(hubId: string): Promise<HubClosure[]> {
  const { data, error } = await supabase
    .from("logistics_hub_closures")
    .select("*")
    .eq("hub_id", hubId)
    .order("closure_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HubClosure[];
}

export async function loadContacts(hubId: string): Promise<HubContact[]> {
  const { data, error } = await supabase
    .from("logistics_hub_contacts")
    .select("*")
    .eq("hub_id", hubId)
    .order("is_primary", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HubContact[];
}

export async function loadStageRows(hubId: string, limit = 100): Promise<HubStageRow[]> {
  const { data, error } = await supabase
    .from("logistics_hub_package_stage")
    .select("id,hub_id,package_id,stage,inbound_manifest_id,outbound_manifest_id,custody_event_id,notes,updated_at")
    .eq("hub_id", hubId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HubStageRow[];
}

export async function loadHubAudit(hubId: string, limit = 50): Promise<HubAuditEntry[]> {
  const { data, error } = await supabase
    .from("logistics_hub_audit")
    .select("id,hub_id,action,actor_id,before_state,after_state,created_at")
    .eq("hub_id", hubId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HubAuditEntry[];
}

/* -------------------------------- mutations -------------------------------- */

function rpc(name: string, args: Record<string, unknown>) {
  // Casts are needed because generated types lag behind newly added RPCs.
  return supabase.rpc(name as never, args as never);
}

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function saveHub(input: HubInput): Promise<HubRecord> {
  return callRpc<HubRecord>("logistics_hub_upsert", {
    _id: input.id ?? null,
    _code: input.code,
    _name: input.name,
    _hub_type: input.hubType,
    _city: input.city ?? null,
    _address: input.address ?? null,
    _lat: input.lat ?? null,
    _lng: input.lng ?? null,
    _region: input.region ?? null,
    _country_code: input.countryCode ?? "KE",
    _timezone: input.timezone ?? "Africa/Nairobi",
    _capabilities: input.capabilities ?? [],
    _capacity_unit: input.capacityUnit ?? "parcels",
    _max_capacity: input.maxCapacity ?? null,
    _contact_name: input.contactName ?? null,
    _contact_phone: input.contactPhone ?? null,
    _contact_email: input.contactEmail ?? null,
    _responsible_operator_id: input.responsibleOperatorId ?? null,
    _notes: input.notes ?? null,
  });
}

export function setHubStatus(id: string, status: HubStatus): Promise<HubRecord> {
  return callRpc<HubRecord>("logistics_hub_set_status", { _id: id, _status: status });
}

export function setHubCapacity(
  id: string,
  maxCapacity: number | null,
  currentCapacity: number,
  unit?: string,
): Promise<HubRecord> {
  return callRpc<HubRecord>("logistics_hub_set_capacity", {
    _id: id,
    _max_capacity: maxCapacity,
    _current_capacity: currentCapacity,
    _capacity_unit: unit ?? null,
  });
}

export function setHubCapabilities(id: string, capabilities: string[]): Promise<HubRecord> {
  return callRpc<HubRecord>("logistics_hub_set_capabilities", {
    _id: id,
    _capabilities: capabilities,
  });
}

export function assignOperator(id: string, operatorId: string | null): Promise<HubRecord> {
  return callRpc<HubRecord>("logistics_hub_assign_operator", {
    _id: id,
    _operator_id: operatorId,
  });
}

export interface AreaInput {
  id?: string | null;
  hubId: string;
  areaType: AreaType;
  label?: string | null;
  city?: string | null;
  region?: string | null;
  corridorCode?: string | null;
  centerLat?: number | null;
  centerLng?: number | null;
  radiusKm?: number | null;
  polygon?: number[][] | null;
  active?: boolean;
}

export function saveServiceArea(input: AreaInput): Promise<HubServiceArea> {
  return callRpc<HubServiceArea>("logistics_hub_area_upsert", {
    _id: input.id ?? null,
    _hub_id: input.hubId,
    _area_type: input.areaType,
    _label: input.label ?? null,
    _city: input.city ?? null,
    _region: input.region ?? null,
    _corridor_code: input.corridorCode ?? null,
    _center_lat: input.centerLat ?? null,
    _center_lng: input.centerLng ?? null,
    _radius_km: input.radiusKm ?? null,
    _polygon: input.polygon ?? null,
    _active: input.active ?? true,
  });
}

export function deleteServiceArea(id: string): Promise<boolean> {
  return callRpc<boolean>("logistics_hub_area_delete", { _id: id });
}

export function setOperatingHours(
  hubId: string,
  hours: HubOperatingHour[],
): Promise<HubOperatingHour[]> {
  return callRpc<HubOperatingHour[]>("logistics_hub_hours_set", {
    _hub_id: hubId,
    _hours: hours.map((h) => ({
      weekday: h.weekday,
      opens: h.closed ? null : h.opens,
      closes: h.closed ? null : h.closes,
      closed: h.closed,
    })),
  });
}

export function saveClosure(
  hubId: string,
  closureDate: string,
  reason: string | null,
  closed = true,
  opens: string | null = null,
  closes: string | null = null,
): Promise<HubClosure> {
  return callRpc<HubClosure>("logistics_hub_closure_upsert", {
    _hub_id: hubId,
    _closure_date: closureDate,
    _reason: reason,
    _closed: closed,
    _opens: opens,
    _closes: closes,
  });
}

export function deleteClosure(id: string): Promise<boolean> {
  return callRpc<boolean>("logistics_hub_closure_delete", { _id: id });
}

export interface ContactInput {
  id?: string | null;
  hubId: string;
  name: string;
  contactRole?: string | null;
  phone?: string | null;
  email?: string | null;
  isPrimary?: boolean;
  active?: boolean;
}

export function saveContact(input: ContactInput): Promise<HubContact> {
  return callRpc<HubContact>("logistics_hub_contact_upsert", {
    _id: input.id ?? null,
    _hub_id: input.hubId,
    _name: input.name,
    _contact_role: input.contactRole ?? null,
    _phone: input.phone ?? null,
    _email: input.email ?? null,
    _is_primary: input.isPrimary ?? false,
    _active: input.active ?? true,
  });
}

export function retireContact(id: string): Promise<boolean> {
  return callRpc<boolean>("logistics_hub_contact_retire", { _id: id });
}

export function processPackage(
  hubId: string,
  packageId: string,
  stage: CrossDockStage,
  manifestId?: string | null,
  notes?: string | null,
): Promise<HubStageRow> {
  return callRpc<HubStageRow>("logistics_hub_process_package", {
    _hub_id: hubId,
    _package_id: packageId,
    _stage: stage,
    _manifest_id: manifestId ?? null,
    _notes: notes ?? null,
  });
}

/** Server-authoritative serviceability answer for a hub + location. */
export function hubServesLocation(
  hubId: string,
  opts: { lat?: number; lng?: number; city?: string; region?: string; corridor?: string },
): Promise<boolean> {
  return callRpc<boolean>("logistics_hub_serves_location", {
    _hub_id: hubId,
    _lat: opts.lat ?? null,
    _lng: opts.lng ?? null,
    _city: opts.city ?? null,
    _region: opts.region ?? null,
    _corridor: opts.corridor ?? null,
  });
}

/** Server-authoritative open/closed answer in the hub's own timezone. */
export function hubOpenAt(hubId: string, at?: Date): Promise<boolean> {
  return callRpc<boolean>("logistics_hub_open_at", {
    _hub_id: hubId,
    _at: (at ?? new Date()).toISOString(),
  });
}

/** Human-readable diff of a history entry, field by field. */
export function auditDiff(entry: HubAuditEntry): { field: string; from: string; to: string }[] {
  const before = entry.before_state ?? {};
  const after = entry.after_state ?? {};
  const skip = new Set(["updated_at", "created_at", "id"]);
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const fmt = (v: unknown) =>
    v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return keys
    .filter((k) => !skip.has(k))
    .map((k) => ({ field: k, from: fmt(before[k]), to: fmt(after[k]) }))
    .filter((d) => d.from !== d.to);
}
