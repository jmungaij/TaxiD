/**
 * Manifest engine client layer.
 *
 * The manifest is the operational grouping between packages and dispatch:
 * open → closed → assigned → dispatched → received → reconciled.
 *
 * Every mutation is a single server RPC. The server owns the lifecycle,
 * enforces that a package sits on at most one active manifest, rejects
 * mutations on a closed manifest, recognises duplicate scans, writes a custody
 * record per scan and refuses reconciliation while a line is unaccounted for.
 * This module only shapes requests and reads back the result.
 */
import { supabase } from "@/integrations/supabase/client";

export type ManifestType =
  | "pickup_run"
  | "line_haul"
  | "delivery_run"
  | "hub_inbound"
  | "hub_outbound"
  | "return_run";

export type ManifestStatus =
  | "open"
  | "closed"
  | "assigned"
  | "dispatched"
  | "received"
  | "reconciled"
  | "cancelled";

export type ScanState = "expected" | "loaded" | "received" | "missing" | "damaged" | "rejected";

export const MANIFEST_TYPES: { value: ManifestType; label: string }[] = [
  { value: "pickup_run", label: "Pickup run" },
  { value: "line_haul", label: "Line haul" },
  { value: "delivery_run", label: "Delivery run" },
  { value: "hub_inbound", label: "Hub inbound" },
  { value: "hub_outbound", label: "Hub outbound" },
  { value: "return_run", label: "Return run" },
];

export const MANIFEST_STATUS_LABELS: Record<ManifestStatus, string> = {
  open: "Open",
  closed: "Closed",
  assigned: "Assigned",
  dispatched: "Dispatched",
  received: "Received",
  reconciled: "Reconciled",
  cancelled: "Cancelled",
};

/**
 * Mirror of the server's transition table. The console only offers what the
 * server would accept — it is never the authority for the move itself.
 */
export const MANIFEST_TRANSITIONS: Record<ManifestStatus, ManifestStatus[]> = {
  open: ["closed", "cancelled"],
  closed: ["assigned", "cancelled"],
  assigned: ["dispatched", "assigned", "cancelled"],
  dispatched: ["received"],
  received: ["reconciled"],
  reconciled: [],
  cancelled: [],
};

export function allowedTransitions(status: ManifestStatus): ManifestStatus[] {
  return MANIFEST_TRANSITIONS[status] ?? [];
}

/** Scan states an operator may submit at a given manifest status. */
export function allowedScanStates(status: ManifestStatus): ScanState[] {
  if (status === "open") return ["loaded"];
  if (status === "dispatched" || status === "received") return ["received", "missing", "damaged", "rejected"];
  return [];
}

export interface Manifest {
  id: string;
  manifest_number: string;
  manifest_type: ManifestType;
  status: ManifestStatus;
  origin_hub_id: string | null;
  destination_hub_id: string | null;
  assigned_driver_id: string | null;
  planned_departure: string | null;
  notes: string | null;
  created_at: string;
}

export interface ManifestLine {
  id: string;
  manifest_id: string;
  package_id: string;
  tracking_number: string;
  scan_state: ScanState;
  exception_note: string | null;
  loaded_at: string | null;
  received_at: string | null;
}

export interface ManifestEvent {
  id: string;
  event_name: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
}

export interface Hub {
  id: string;
  code: string;
  name: string;
  hub_type: string;
  city: string | null;
  active: boolean;
}

export interface RpcResult<T = Record<string, unknown>> {
  ok: boolean;
  code?: string;
  message?: string;
  data?: T;
}

function envelope<T extends Record<string, unknown>>(raw: unknown): RpcResult<T> {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (value.ok === true) return { ok: true, data: value as T };
  return {
    ok: false,
    code: typeof value.code === "string" ? value.code : "PROVIDER_ERROR",
    message: typeof value.message === "string" ? value.message : "The operation failed.",
  };
}

export async function createManifest(input: {
  type: ManifestType;
  originHubId?: string | null;
  destinationHubId?: string | null;
  plannedDeparture?: string | null;
  notes?: string | null;
}): Promise<RpcResult<{ manifest_id: string; manifest_number: string }>> {
  const { data, error } = await supabase.rpc("logistics_manifest_create", {
    _manifest_type: input.type,
    _origin_hub_id: input.originHubId ?? null,
    _destination_hub_id: input.destinationHubId ?? null,
    _planned_departure: input.plannedDeparture ?? null,
    _notes: input.notes ?? null,
  });
  if (error) return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  return envelope(data);
}

export interface ScanResult extends Record<string, unknown> {
  duplicate: boolean;
  package_id: string;
  tracking_number: string;
  scan_state: ScanState;
}

export async function scanOntoManifest(input: {
  manifestId: string;
  identifier: string;
  scanState?: ScanState;
  note?: string | null;
}): Promise<RpcResult<ScanResult>> {
  const { data, error } = await supabase.rpc("logistics_manifest_scan", {
    _manifest_id: input.manifestId,
    _identifier: input.identifier,
    _scan_state: input.scanState ?? "loaded",
    _note: input.note ?? null,
  });
  if (error) return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  return envelope<ScanResult>(data);
}

export async function removeFromManifest(input: {
  manifestId: string;
  packageId: string;
  reason?: string | null;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("logistics_manifest_remove_package", {
    _manifest_id: input.manifestId,
    _package_id: input.packageId,
    _reason: input.reason ?? null,
  });
  if (error) return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  return envelope(data);
}

export async function transitionManifest(input: {
  manifestId: string;
  toStatus: ManifestStatus;
  driverId?: string | null;
  note?: string | null;
}): Promise<RpcResult<{ status: ManifestStatus; lines: number }>> {
  const { data, error } = await supabase.rpc("logistics_manifest_transition", {
    _manifest_id: input.manifestId,
    _to_status: input.toStatus,
    _driver_id: input.driverId ?? null,
    _note: input.note ?? null,
  });
  if (error) return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  return envelope(data);
}

export interface ManifestReconciliation extends Record<string, unknown> {
  manifest_id: string;
  status: ManifestStatus;
  total: number;
  expected: number;
  loaded: number;
  received: number;
  missing: number;
  damaged: number;
  rejected: number;
  lines: { package_id: string; tracking_number: string; scan_state: ScanState; exception_note: string | null }[];
}

export async function loadReconciliation(manifestId: string): Promise<RpcResult<ManifestReconciliation>> {
  const { data, error } = await supabase.rpc("logistics_manifest_reconciliation", { _manifest_id: manifestId });
  if (error) return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  return envelope<ManifestReconciliation>(data);
}

/**
 * Whether a manifest may be reconciled: every line must be accounted for.
 * The server enforces the same rule — this only keeps the button honest.
 */
export function reconcilable(r: Pick<ManifestReconciliation, "total" | "expected" | "loaded">): boolean {
  return r.total > 0 && r.expected === 0 && r.loaded === 0;
}

export interface ReconciliationVerdict {
  clean: boolean;
  shortfall: number;
  discrepancies: string[];
}

/** Physical-vs-system verdict for a received manifest. */
export function reconciliationVerdict(r: ManifestReconciliation): ReconciliationVerdict {
  const discrepancies: string[] = [];
  if (r.missing > 0) discrepancies.push(`${r.missing} missing`);
  if (r.damaged > 0) discrepancies.push(`${r.damaged} damaged`);
  if (r.rejected > 0) discrepancies.push(`${r.rejected} rejected`);
  if (r.expected + r.loaded > 0) discrepancies.push(`${r.expected + r.loaded} never received`);
  return {
    clean: discrepancies.length === 0 && r.total > 0,
    shortfall: r.missing + r.expected + r.loaded,
    discrepancies,
  };
}

export async function loadManifests(status: ManifestStatus | "all"): Promise<{ rows: Manifest[]; error: string | null }> {
  let query = supabase
    .from("logistics_manifests")
    .select(
      "id,manifest_number,manifest_type,status,origin_hub_id,destination_hub_id,assigned_driver_id,planned_departure,notes,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as Manifest[], error: null };
}

export async function loadManifestLines(manifestId: string): Promise<ManifestLine[]> {
  const { data } = await supabase
    .from("logistics_manifest_lines")
    .select("id,manifest_id,package_id,tracking_number,scan_state,exception_note,loaded_at,received_at")
    .eq("manifest_id", manifestId)
    .order("tracking_number", { ascending: true });
  return (data ?? []) as ManifestLine[];
}

export async function loadManifestEvents(manifestId: string): Promise<ManifestEvent[]> {
  const { data } = await supabase
    .from("logistics_manifest_events")
    .select("id,event_name,from_status,to_status,note,created_at")
    .eq("manifest_id", manifestId)
    .order("created_at", { ascending: true });
  return (data ?? []) as ManifestEvent[];
}

export async function loadHubs(): Promise<Hub[]> {
  const { data } = await supabase
    .from("logistics_hubs")
    .select("id,code,name,hub_type,city,active")
    .eq("active", true)
    .order("name", { ascending: true });
  return (data ?? []) as Hub[];
}

export interface EligibleDriver {
  user_id: string;
  full_name: string;
  driver_type: string | null;
}

/**
 * Drivers the server would actually accept for an assignment (active +
 * verified). The console offers nothing outside this list, so it can never
 * present an assignment that the backend rejects.
 */
export async function loadEligibleDrivers(search?: string): Promise<EligibleDriver[]> {
  const { data, error } = await supabase.rpc("logistics_eligible_drivers", {
    _search: search ?? null,
    _limit: 100,
  });
  if (error) return [];
  return (data ?? []) as EligibleDriver[];
}
