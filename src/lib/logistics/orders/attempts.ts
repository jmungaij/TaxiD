/**
 * Delivery attempt & exception client layer.
 *
 * Every mutation here is a single server RPC:
 *  - `logistics_record_delivery_attempt` — append-only attempt ledger, package
 *    state transition, automatic exception opening, audit entry, idempotent.
 *  - `logistics_exception_transition` — permission-gated exception state
 *    machine with an append-only event trail.
 *  - `logistics_order_delivery_summary` — package-level (partial) outcomes for
 *    a multi-package order.
 *
 * The client never writes `packages.status`, never invents an attempt number
 * and never closes an exception locally.
 */
import { supabase } from "@/integrations/supabase/client";
import { REASON_CODE_SPECS, type ReasonCode } from "@/lib/logistics/domain/reasonCodes";

export type AttemptOutcome = "delivered" | "failed" | "refused" | "rescheduled" | "returned";

export const ATTEMPT_OUTCOMES: { value: AttemptOutcome; label: string }[] = [
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Failed" },
  { value: "refused", label: "Refused by recipient" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "returned", label: "Returned" },
];

export type ExceptionStatus =
  | "open"
  | "investigating"
  | "waiting_customer"
  | "waiting_partner"
  | "resolved"
  | "cancelled";

export const EXCEPTION_STATUSES: { value: ExceptionStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "waiting_customer", label: "Waiting on customer" },
  { value: "waiting_partner", label: "Waiting on partner" },
  { value: "resolved", label: "Resolved" },
  { value: "cancelled", label: "Cancelled" },
];

/** Terminal statuses cannot be transitioned out of — the server enforces this too. */
export const CLOSED_EXCEPTION_STATUSES: ExceptionStatus[] = ["resolved", "cancelled"];

export interface DeliveryAttempt {
  id: string;
  package_id: string;
  order_id: string | null;
  attempt_number: number;
  outcome: AttemptOutcome;
  reason_code: string | null;
  narrative: string | null;
  recipient_name: string | null;
  driver_id: string | null;
  occurred_at: string;
}

export interface LogisticsException {
  id: string;
  exception_number: string;
  order_id: string | null;
  package_id: string | null;
  attempt_id: string | null;
  kind: string;
  severity: "low" | "medium" | "high" | "critical";
  owner_role: string;
  status: ExceptionStatus;
  reason_code: string | null;
  narrative: string | null;
  sla_due_at: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface ExceptionEvent {
  id: string;
  exception_id: string;
  event_name: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
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

/** Reason codes that require a narrative in addition to the code. */
export function narrativeRequired(code: string | null | undefined): boolean {
  if (!code) return false;
  return REASON_CODE_SPECS.find((s) => s.code === code)?.requiresNarrative ?? false;
}

export function retryable(code: string | null | undefined): boolean {
  if (!code) return false;
  return REASON_CODE_SPECS.find((s) => s.code === code)?.retryable ?? false;
}

export function claimEligible(code: string | null | undefined): boolean {
  if (!code) return false;
  return REASON_CODE_SPECS.find((s) => s.code === code)?.claimEligible ?? false;
}

export interface AttemptValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Client-side pre-flight only — it mirrors the server rules so an operator gets
 * an instant message. The server re-validates everything.
 */
export function validateAttempt(input: {
  outcome: AttemptOutcome | "";
  reasonCode?: string | null;
  narrative?: string | null;
}): AttemptValidation {
  const errors: string[] = [];
  if (!input.outcome) errors.push("Select an outcome.");
  if (input.outcome && input.outcome !== "delivered" && !input.reasonCode) {
    errors.push("A reason code is required for a non-delivered outcome.");
  }
  if (narrativeRequired(input.reasonCode) && !(input.narrative ?? "").trim()) {
    errors.push("This reason code requires a written explanation.");
  }
  return { valid: errors.length === 0, errors };
}

export interface RecordAttemptInput {
  packageId: string;
  outcome: AttemptOutcome;
  idempotencyKey: string;
  reasonCode?: ReasonCode | string | null;
  narrative?: string | null;
  recipientName?: string | null;
  lat?: number | null;
  lng?: number | null;
  evidence?: Record<string, unknown>;
}

export interface RecordAttemptResult extends Record<string, unknown> {
  attempt_id: string;
  attempt_number: number;
  outcome: AttemptOutcome;
  exception_id: string | null;
  replayed: boolean;
}

export async function recordDeliveryAttempt(
  input: RecordAttemptInput,
): Promise<RpcResult<RecordAttemptResult>> {
  const { data, error } = await supabase.rpc("logistics_record_delivery_attempt", {
    _package_id: input.packageId,
    _outcome: input.outcome,
    _idempotency_key: input.idempotencyKey,
    _reason_code: input.reasonCode ?? null,
    _narrative: input.narrative ?? null,
    _recipient_name: input.recipientName ?? null,
    _location_lat: input.lat ?? null,
    _location_lng: input.lng ?? null,
    _evidence: (input.evidence ?? {}) as never,
  });
  if (error) return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  return envelope<RecordAttemptResult>(data);
}

export async function transitionException(input: {
  exceptionId: string;
  toStatus: ExceptionStatus;
  note?: string | null;
  resolution?: string | null;
  severity?: LogisticsException["severity"] | null;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("logistics_exception_transition", {
    _exception_id: input.exceptionId,
    _to_status: input.toStatus,
    _note: input.note ?? null,
    _resolution: input.resolution ?? null,
    _severity: input.severity ?? null,
  });
  if (error) return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  return envelope(data);
}

export interface OrderDeliverySummary extends Record<string, unknown> {
  order_id: string;
  total: number;
  delivered: number;
  failed: number;
  returned: number;
  cancelled: number;
  in_progress: number;
  packages: { id: string; tracking_number: string; status: string }[];
}

export async function loadOrderDeliverySummary(orderId: string): Promise<RpcResult<OrderDeliverySummary>> {
  const { data, error } = await supabase.rpc("logistics_order_delivery_summary", { _order_id: orderId });
  if (error) return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  return envelope<OrderDeliverySummary>(data);
}

/**
 * Classifies a multi-package order: an order is only fully delivered when every
 * package is delivered. Anything else is explicitly partial — never collapsed
 * into a single misleading DELIVERED state.
 */
export type OrderFulfilment = "not_started" | "in_progress" | "partial" | "delivered" | "failed";

export function classifyFulfilment(s: {
  total: number;
  delivered: number;
  failed: number;
  returned: number;
  in_progress: number;
}): OrderFulfilment {
  if (s.total === 0) return "not_started";
  if (s.delivered === s.total) return "delivered";
  if (s.in_progress === s.total) return "not_started";
  if (s.delivered === 0 && s.in_progress === 0) return "failed";
  if (s.delivered > 0 && (s.failed > 0 || s.returned > 0 || s.in_progress > 0)) return "partial";
  return "in_progress";
}

export function slaState(exception: Pick<LogisticsException, "sla_due_at" | "status">, now = Date.now()) {
  if (CLOSED_EXCEPTION_STATUSES.includes(exception.status)) return { label: "Closed", breached: false, dueInMs: 0 };
  if (!exception.sla_due_at) return { label: "No SLA", breached: false, dueInMs: 0 };
  const dueInMs = new Date(exception.sla_due_at).getTime() - now;
  if (dueInMs <= 0) return { label: "SLA breached", breached: true, dueInMs };
  const hours = Math.floor(dueInMs / 3_600_000);
  const minutes = Math.floor((dueInMs % 3_600_000) / 60_000);
  return { label: hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`, breached: false, dueInMs };
}

export async function loadExceptions(filters: {
  status?: ExceptionStatus | "all";
  severity?: LogisticsException["severity"] | "all";
  limit?: number;
}): Promise<{ rows: LogisticsException[]; error: string | null }> {
  let query = supabase
    .from("logistics_exceptions")
    .select(
      "id,exception_number,order_id,package_id,attempt_id,kind,severity,owner_role,status,reason_code,narrative,sla_due_at,resolution,resolved_at,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.severity && filters.severity !== "all") query = query.eq("severity", filters.severity);
  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as LogisticsException[], error: null };
}

export async function loadExceptionEvents(exceptionId: string): Promise<ExceptionEvent[]> {
  const { data } = await supabase
    .from("logistics_exception_events")
    .select("id,exception_id,event_name,from_status,to_status,note,created_at")
    .eq("exception_id", exceptionId)
    .order("created_at", { ascending: true });
  return (data ?? []) as ExceptionEvent[];
}

export async function loadPackageAttempts(packageId: string): Promise<DeliveryAttempt[]> {
  const { data } = await supabase
    .from("logistics_delivery_attempts")
    .select("id,package_id,order_id,attempt_number,outcome,reason_code,narrative,recipient_name,driver_id,occurred_at")
    .eq("package_id", packageId)
    .order("attempt_number", { ascending: true });
  return (data ?? []) as DeliveryAttempt[];
}
