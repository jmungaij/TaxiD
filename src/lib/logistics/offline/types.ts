/**
 * PHASE 8 — OFFLINE DRIVER EXECUTION, shared contract.
 *
 * The device journal is a *staging* record, never a source of truth. Server
 * state wins on every reconciliation: the local row only remembers what the
 * device captured and what the server answered.
 */

/** Operations the server accepts offline. Mirrors logistics_offline_command_types. */
export const OFFLINE_OPERATIONS = [
  "delivery.attempt",
  "pod.capture",
  "otp.verify",
  "stop.arrive",
  "stop.depart",
  "stop.complete",
  "return.authorize",
  "exception.transition",
  "package.scan",
  "hub.receive_scan",
  "hub.move",
  "route.deviation",
] as const;

export type OfflineOperation = (typeof OFFLINE_OPERATIONS)[number];

export const OFFLINE_COMMAND_STATES = [
  "QUEUED",
  "SYNCING",
  "ACCEPTED",
  "REJECTED",
  "CONFLICT",
  "RETRYABLE_FAILURE",
  "PERMANENT_FAILURE",
  "REPLAYED",
  "ACKNOWLEDGED",
] as const;

export type OfflineCommandState = (typeof OFFLINE_COMMAND_STATES)[number];

/** States that still need attention, either automatic or operator-led. */
export const OFFLINE_OPEN_STATES: OfflineCommandState[] = [
  "QUEUED",
  "SYNCING",
  "RETRYABLE_FAILURE",
  "CONFLICT",
  "PERMANENT_FAILURE",
  "REJECTED",
];

export const OFFLINE_TERMINAL_OK: OfflineCommandState[] = [
  "ACCEPTED",
  "REPLAYED",
  "ACKNOWLEDGED",
];

export type ConnectivityState = "online" | "offline" | "degraded";

/** Structured error contract — no bare strings anywhere in the offline layer. */
export interface OfflineError {
  code: string;
  category: string;
  message: string;
  retryable: boolean;
  reason?: string | null;
  detail?: Record<string, unknown> | null;
  correlationId?: string | null;
}

/** One captured field action, as journalled on the device. */
export interface LocalCommand {
  /** Client-generated, stable for the life of the command. */
  command_id: string;
  /** Client-generated idempotency key; the server enforces one mutation per key. */
  idempotency_key: string;
  operation: OfflineOperation;
  entity_type: string;
  entity_id: string | null;
  entity_version: number | null;
  /** Monotonic per-device sequence — the server applies in this order. */
  sequence: number;
  payload: Record<string, unknown>;
  payload_hash: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy_m: number | null;
  client_captured_at: string;
  correlation_id: string;
  causation_id: string | null;
  request_id: string;
  /** Local mirror of the last known server verdict. */
  state: OfflineCommandState;
  attempts: number;
  next_attempt_at: string | null;
  last_error: OfflineError | null;
  conflict_reason: string | null;
  /** Server-issued transaction identity, once accepted. */
  transaction_id: string | null;
  server_result: Record<string, unknown> | null;
  /** True once the server has confirmed a terminal verdict for this command. */
  acknowledged: boolean;
  app_version: string;
}

export interface LocalAttachment {
  attachment_key: string;
  command_id: string | null;
  kind: "photo" | "signature" | "audio" | "document";
  content_type: string | null;
  byte_size: number | null;
  sha256: string | null;
  storage_path: string | null;
  state: "QUEUED" | "UPLOADED" | "FAILED";
  captured_at: string;
  attempts: number;
}

/** Operational cache pulled from the server. Never edited locally. */
export interface OfflineCacheSnapshot {
  server_time: string;
  pulled_at: string;
  routes: Record<string, unknown>[];
  stops: Record<string, unknown>[];
  packages: Record<string, unknown>[];
  unresolved_commands: Record<string, unknown>[];
  command_types: Record<string, unknown>[];
}

export interface SyncSummary {
  submitted: number;
  accepted: number;
  rejected: number;
  conflict: number;
  deferred: number;
  duplicates: number;
}

export interface PushResultItem {
  command_id: string;
  ok: boolean;
  code: string;
  category?: string;
  retryable?: boolean;
  duplicate?: boolean;
  state?: OfflineCommandState;
  reason?: string | null;
  detail?: Record<string, unknown> | null;
  message?: string;
  transaction_id?: string | null;
  result?: Record<string, unknown> | null;
  sequence?: number;
}

export interface PushOutcome {
  ok: boolean;
  code?: string;
  message?: string;
  session_id?: string;
  correlation_id?: string;
  server_time?: string;
  clock_skew_ms?: number | null;
  summary?: SyncSummary;
  results?: PushResultItem[];
}

export interface DeviceRegistration {
  id: string;
  device_id: string;
  state: "ACTIVE" | "STALE" | "SUSPENDED" | "RETIRED";
  sync_cursor: number;
  queued: number;
  conflicts: number;
  failed: number;
}

/** Human copy for each conflict the server can report. */
export const CONFLICT_COPY: Record<string, { title: string; guidance: string }> = {
  PACKAGE_ALREADY_DELIVERED: {
    title: "Parcel already delivered",
    guidance:
      "The server recorded a delivery for this parcel while the device was offline. The captured action was not applied — operations must decide whether it was a duplicate.",
  },
  PACKAGE_NOT_DELIVERABLE: {
    title: "Parcel no longer deliverable",
    guidance: "The parcel was cancelled or returned centrally. Raise an exception instead.",
  },
  POD_ALREADY_ATTACHED: {
    title: "Proof of delivery already attached",
    guidance: "The attempt already carries proof. The offline capture was kept for audit only.",
  },
  STOP_ALREADY_COMPLETED: {
    title: "Stop already completed",
    guidance: "Another channel completed this stop. Reordering or a new stop may be required.",
  },
  ROUTE_VERSION_SUPERSEDED: {
    title: "Route version superseded",
    guidance:
      "The route was re-planned while the device was offline. Pull the current version before continuing.",
  },
  DRIVER_NOT_ASSIGNED: {
    title: "No longer the assigned driver",
    guidance: "Assignment changed centrally. Operations must reassign or apply this manually.",
  },
  RETURN_ALREADY_OPEN: {
    title: "Return already open",
    guidance: "A return is already in progress for this parcel.",
  },
  EXCEPTION_ALREADY_RESOLVED: {
    title: "Exception already resolved",
    guidance: "The exception was closed centrally; the offline update was not applied.",
  },
  ENTITY_NOT_FOUND: {
    title: "Record not found on the server",
    guidance:
      "The entity referenced by this capture does not exist server-side. Check the scan or identifier.",
  },
  PRIOR_COMMAND_UNRESOLVED: {
    title: "Earlier capture unresolved",
    guidance: "An earlier action for the same record must be resolved before this one can apply.",
  },
};

export function conflictCopy(reason: string | null | undefined) {
  if (!reason) return null;
  return (
    CONFLICT_COPY[reason] ?? {
      title: reason.replace(/_/g, " ").toLowerCase(),
      guidance: "Operations review required before this capture can be applied.",
    }
  );
}
