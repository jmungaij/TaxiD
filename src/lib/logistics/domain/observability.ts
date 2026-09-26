/**
 * DF-10 controls 9, 10, 11, 17 — event stream, audit log, correlation ID,
 * observability contract.
 *
 * The event stream answers "what happened to the shipment?".
 * The audit log answers "who changed what, when, from where, under what
 * authority, and why?". They are separate stores with separate contracts and
 * must never be merged.
 */

/* ------------------------------ correlation ------------------------------ */

/** CORR-<yyyy>-<8 uppercase base32 chars>. Minted once per customer transaction. */
const CORRELATION_RE = /^CORR-20\d{2}-[0-9A-HJKMNP-TV-Z]{8}$/;

export function isValidCorrelationId(id: string): boolean {
  return CORRELATION_RE.test(id);
}

export function mintCorrelationId(year: number, random: string): string {
  return `CORR-${year}-${random.toUpperCase().slice(0, 8)}`;
}

/**
 * Known hops. This is a VOCABULARY, not a fixed length: a transaction may touch
 * 5 hops or 27 depending on whether pricing, payment, maps, notifications,
 * partner APIs, tax and settlement participate. The invariant is that ONE
 * correlation_id survives the complete lifecycle across every participating
 * service — never "exactly ten hops".
 */
export const CORRELATION_HOPS = [
  "request",
  "quote",
  "order",
  "booking",
  "pricing",
  "payment",
  "shipment",
  "dispatch",
  "maps",
  "tracking",
  "attempt",
  "pod",
  "exception",
  "return",
  "claim",
  "notification",
  "partner_api",
  "invoice",
  "tax",
  "settlement",
  "reconciliation",
] as const;

export type CorrelationHop = (typeof CORRELATION_HOPS)[number];

/** Actor identity works for humans AND asynchronous service identities. */
export type ActorType = "USER" | "STAFF" | "SERVICE" | "WORKER" | "WEBHOOK" | "SCHEDULER";

export interface ActorContext {
  actor_type: ActorType;
  actor_id: string;
  actor_role: string;
  /** Null for non-interactive actors — workers, webhooks, schedulers. */
  session_id: string | null;
  /** Mandatory for non-interactive actors. */
  service_identity: string | null;
  correlation_id: string;
  /** Event that caused this one. */
  causation_id: string | null;
}

const NON_INTERACTIVE: ActorType[] = ["SERVICE", "WORKER", "WEBHOOK", "SCHEDULER"];

export function actorContextErrors(a: ActorContext): string[] {
  const errors: string[] = [];
  if (!a.actor_type) errors.push("actor_type required");
  if (!a.actor_id) errors.push("actor_id required");
  if (!a.actor_role) errors.push("actor_role required");
  if (!a.correlation_id) errors.push("correlation_id required");
  if (NON_INTERACTIVE.includes(a.actor_type)) {
    if (!a.service_identity) errors.push("service_identity required for non-interactive actors");
  } else if (!a.session_id) {
    errors.push("session_id required for interactive actors");
  }
  return errors;
}

export interface TraceRecord {
  hop: CorrelationHop;
  correlation_id: string;
  aggregate_id: string;
  occurred_at: string;
}

export interface TraceReconstruction {
  complete: boolean;
  hopsObserved: number;
  missingHops: CorrelationHop[];
  brokenCorrelation: string[];
}

/**
 * Proves one correlation_id reconstructs the whole journey. `participating` is
 * the set of hops this transaction actually invoked — arbitrary length.
 */
export function reconstructTrace(
  correlationId: string,
  records: TraceRecord[],
  participating: readonly CorrelationHop[] = records.map((r) => r.hop),
): TraceReconstruction {
  const broken = records.filter((r) => r.correlation_id !== correlationId).map((r) => r.hop);
  const present = new Set(records.filter((r) => r.correlation_id === correlationId).map((r) => r.hop));
  const missingHops = [...new Set(participating)].filter((h) => !present.has(h));
  return {
    complete: missingHops.length === 0 && broken.length === 0 && present.size > 0,
    hopsObserved: present.size,
    missingHops,
    brokenCorrelation: broken,
  };
}


/* ------------------------------ event stream ------------------------------ */

export const EVENT_REQUIRED_FIELDS = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "actor_id",
  "actor_role",
  "source",
  "correlation_id",
  "idempotency_key",
  "version",
  "payload",
] as const;

/** Business events that must exist in the operational trail (not just errors). */
export const BUSINESS_EVENT_CATALOGUE = [
  "ORDER_CREATED",
  "QUOTE_CREATED",
  "BOOKING_CONFIRMED",
  "SHIPMENT_CREATED",
  "DISPATCH_CREATED",
  "DISPATCH_OFFERED",
  "DISPATCH_ACCEPTED",
  "DISPATCH_FAILED",
  "DISPATCH_REASSIGNED",
  "COURIER_ARRIVED",
  "PICKUP_CONFIRMED",
  "IN_TRANSIT",
  "DELIVERY_ATTEMPTED",
  "DELIVERY_FAILED",
  "DELIVERY_COMPLETED",
  "POD_CREATED",
  "RETURN_REQUESTED",
  "CLAIM_OPENED",
  "PAYMENT_AUTHORIZED",
  "PAYMENT_CAPTURED",
  "PAYMENT_FAILED",
] as const;

export type BusinessEvent = (typeof BUSINESS_EVENT_CATALOGUE)[number];

export function eventEnvelopeErrors(event: Record<string, unknown>): string[] {
  const errors = EVENT_REQUIRED_FIELDS.filter((f) => event[f] === undefined || event[f] === null).map(
    (f) => `missing ${f}`,
  );
  const corr = event.correlation_id;
  if (typeof corr === "string" && !isValidCorrelationId(corr)) errors.push("correlation_id malformed");
  return errors;
}

/** Event immutability contract — enforced by trigger, asserted here for tests. */
export const EVENT_IMMUTABILITY = {
  table: "logistics_events",
  appendOnly: true,
  blockedCommands: ["UPDATE", "DELETE", "TRUNCATE"] as const,
  enforcement: "BEFORE UPDATE OR DELETE trigger raising exception + no UPDATE/DELETE grant to any client role",
  clientRolesWithWrite: [] as string[],
  uniqueIndexes: ["(aggregate_type, aggregate_id, idempotency_key)"],
} as const;

/* -------------------------------- audit log -------------------------------- */

export const AUDIT_REQUIRED_FIELDS = [
  "actor_id",
  "actor_role",
  "action",
  "entity",
  "entity_id",
  "old_value",
  "new_value",
  "reason",
  "correlation_id",
  "occurred_at",
] as const;

/** Actions where the audit record must additionally capture session context. */
export const AUDIT_SESSION_CONTEXT_ACTIONS = [
  "compliance_determination_recorded",
  "partner_approved",
  "partner_suspended",
  "dispatch_override",
  "pricing_override",
  "claim_decision",
  "refund_issued",
  "settlement_approved",
  "administrative_data_correction",
] as const;

export function auditRecordErrors(record: Record<string, unknown>): string[] {
  const errors = AUDIT_REQUIRED_FIELDS.filter((f) => record[f] === undefined).map((f) => `missing ${f}`);
  const action = String(record.action ?? "");
  if ((AUDIT_SESSION_CONTEXT_ACTIONS as readonly string[]).includes(action)) {
    for (const f of ["ip_address", "session_id", "device"]) {
      if (record[f] === undefined) errors.push(`missing ${f} for sensitive action ${action}`);
    }
    if (!String(record.reason ?? "").trim()) errors.push(`reason mandatory for sensitive action ${action}`);
  }
  return errors;
}

/* ------------------------------ observability ------------------------------ */

export type ObservabilityStatus = "INSTRUMENTED" | "NOT_INSTRUMENTED";

export interface ObservabilitySignal {
  signal: string;
  sink: string;
  correlated: boolean;
  status: ObservabilityStatus;
  evidence: string;
}

/**
 * Declared observability surface. Statuses are honest: nothing is INSTRUMENTED
 * until the migration exists, because the sinks are the new tables.
 */
export const OBSERVABILITY_SIGNALS: ObservabilitySignal[] = [
  { signal: "state_transitions", sink: "logistics_events", correlated: true, status: "NOT_INSTRUMENTED", evidence: "Emitted by logistics_transition RPC; table does not exist yet." },
  { signal: "authorization_failures", sink: "authorization_decisions", correlated: true, status: "NOT_INSTRUMENTED", evidence: "Existing table available; logistics RPCs not yet wired to it." },
  { signal: "rls_denials", sink: "access_denials", correlated: true, status: "NOT_INSTRUMENTED", evidence: "Existing denial ledger; logistics predicates not yet emitting." },
  { signal: "rpc_failures", sink: "ops_event_outbox", correlated: true, status: "NOT_INSTRUMENTED", evidence: "Requires the new RPCs." },
  { signal: "dispatch_failures", sink: "logistics_events + alerts_events", correlated: true, status: "NOT_INSTRUMENTED", evidence: "Reason-coded failure events defined; sink pending migration." },
  { signal: "payment_failures", sink: "payment_attempts (correlation_id present)", correlated: true, status: "INSTRUMENTED", evidence: "payment_attempts already carries correlation_id and idempotency_key (observed on live schema 2026-08-26)." },
  { signal: "pod_failures", sink: "logistics_events", correlated: true, status: "NOT_INSTRUMENTED", evidence: "Pending migration." },
  { signal: "event_write_failures", sink: "alert_dispatch_dlq", correlated: true, status: "NOT_INSTRUMENTED", evidence: "DLQ exists; logistics producer not yet built." },
  { signal: "integration_failures", sink: "ops_event_outbox", correlated: true, status: "NOT_INSTRUMENTED", evidence: "Pending migration." },
];

export function observabilityGaps(): ObservabilitySignal[] {
  return OBSERVABILITY_SIGNALS.filter((s) => s.status !== "INSTRUMENTED" || !s.correlated);
}
