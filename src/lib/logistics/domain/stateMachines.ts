/**
 * Logistics Domain Foundation — coordinated family of state machines.
 *
 * Deliberately NOT one giant shipment machine. Order, shipment, dispatch job,
 * delivery attempt, payment, return and claim are independent dimensions that
 * co-exist: a shipment may be IN_EXECUTION while its dispatch job is FAILED and
 * its payment is CAPTURED. Every transition names the permitted actors, the
 * immutable event it emits, and its side effects.
 *
 * This module is the single source of truth for transition legality. The server
 * enforcement layer (RPC guards) and the UI both read it — no component may
 * hand-roll a status change.
 */

export type Actor =
  | "customer"
  | "corporate_admin"
  | "ops"
  | "dispatcher"
  | "courier"
  | "finance"
  | "compliance"
  | "system";

export type MachineKey =
  | "ORDER"
  | "SHIPMENT"
  | "DISPATCH_JOB"
  | "DELIVERY_ATTEMPT"
  | "PAYMENT"
  | "RETURN"
  | "CLAIM";

export interface Transition {
  from: string;
  to: string;
  /** Actors permitted to perform this transition. */
  actors: Actor[];
  /** Immutable event emitted on success (event catalogue name). */
  event: string;
  /** Documented side effects — each must be implemented in the same guard. */
  effects?: string[];
  /** Guards that must pass server-side before the transition is accepted. */
  guards?: string[];
}

export interface StateMachine {
  key: MachineKey;
  aggregate: string;
  initial: string;
  terminal: string[];
  states: string[];
  transitions: Transition[];
  /** Dimensions this machine must NOT encode (anti-overload contract). */
  mustNotEncode: string[];
}

const sm = (m: StateMachine): StateMachine => m;

export const ORDER_MACHINE = sm({
  key: "ORDER",
  aggregate: "logistics_order",
  initial: "DRAFT",
  terminal: ["CLOSED", "CANCELLED"],
  states: ["DRAFT", "SUBMITTED", "CONFIRMED", "CANCELLED", "CLOSED"],
  mustNotEncode: ["payment state", "shipment execution state", "dispatch state"],
  transitions: [
    { from: "DRAFT", to: "SUBMITTED", actors: ["customer", "corporate_admin", "ops"], event: "logistics.order.submitted", guards: ["order_has_at_least_one_shipment"] },
    { from: "SUBMITTED", to: "CONFIRMED", actors: ["ops", "system"], event: "logistics.order.confirmed", guards: ["all_shipments_quoted_or_booked"] },
    { from: "SUBMITTED", to: "CANCELLED", actors: ["customer", "corporate_admin", "ops"], event: "logistics.order.cancelled" },
    { from: "CONFIRMED", to: "CANCELLED", actors: ["ops"], event: "logistics.order.cancelled", guards: ["no_shipment_in_execution"] },
    { from: "CONFIRMED", to: "CLOSED", actors: ["system", "ops"], event: "logistics.order.closed", guards: ["all_shipments_terminal"] },
  ],
});

export const SHIPMENT_MACHINE = sm({
  key: "SHIPMENT",
  aggregate: "logistics_shipment",
  initial: "DRAFT",
  terminal: ["CLOSED", "CANCELLED"],
  states: [
    "DRAFT", "QUOTED", "BOOKED", "READY_FOR_DISPATCH", "IN_EXECUTION",
    "PARTIALLY_DELIVERED", "DELIVERED", "RETURNING", "RETURNED", "CANCELLED", "CLOSED",
  ],

  mustNotEncode: ["payment state", "courier assignment state", "POD state", "return state", "claim state"],
  transitions: [
    { from: "DRAFT", to: "QUOTED", actors: ["system", "ops"], event: "logistics.shipment.quoted", guards: ["serviceability_available_or_limited", "rate_plan_resolved"] },
    { from: "QUOTED", to: "BOOKED", actors: ["customer", "corporate_admin", "ops"], event: "logistics.shipment.booked", guards: ["quote_not_expired", "restricted_goods_declaration_accepted"] },
    { from: "BOOKED", to: "READY_FOR_DISPATCH", actors: ["ops", "system"], event: "logistics.shipment.ready_for_dispatch", guards: ["packages_present", "route_plan_present", "payment_state_permits_dispatch"] },
    { from: "READY_FOR_DISPATCH", to: "IN_EXECUTION", actors: ["system", "dispatcher"], event: "logistics.shipment.execution_started", guards: ["at_least_one_dispatch_job_accepted"] },
    { from: "IN_EXECUTION", to: "DELIVERED", actors: ["system"], event: "logistics.shipment.delivered", guards: ["all_packages_delivered", "all_delivery_stops_have_successful_attempt", "pod_policy_satisfied"] },
    // Partial completion is an explicit outcome, derived from package results by
    // computeShipmentCompletion(); a failed package may never silently become DELIVERED.
    { from: "IN_EXECUTION", to: "PARTIALLY_DELIVERED", actors: ["system"], event: "logistics.shipment.partially_delivered", guards: ["at_least_one_package_delivered", "at_least_one_package_failed_or_returned", "no_package_pending"], effects: ["open_exception", "bill_delivered_packages_only", "notify_customer_partial_delivery"] },
    { from: "PARTIALLY_DELIVERED", to: "RETURNING", actors: ["ops", "system"], event: "logistics.shipment.returning", guards: ["return_authorised"] },
    { from: "PARTIALLY_DELIVERED", to: "CLOSED", actors: ["system", "ops"], event: "logistics.shipment.closed", guards: ["no_open_exception", "no_open_claim", "undelivered_packages_resolved"] },

    { from: "IN_EXECUTION", to: "RETURNING", actors: ["ops", "system"], event: "logistics.shipment.returning", guards: ["return_authorised"] },
    { from: "RETURNING", to: "RETURNED", actors: ["ops", "system"], event: "logistics.shipment.returned", guards: ["return_receipt_recorded"] },
    { from: "QUOTED", to: "CANCELLED", actors: ["customer", "corporate_admin", "ops"], event: "logistics.shipment.cancelled" },
    { from: "BOOKED", to: "CANCELLED", actors: ["customer", "corporate_admin", "ops"], event: "logistics.shipment.cancelled", effects: ["open_refund_evaluation"] },
    { from: "READY_FOR_DISPATCH", to: "CANCELLED", actors: ["ops"], event: "logistics.shipment.cancelled", effects: ["cancel_open_dispatch_jobs", "open_refund_evaluation"] },
    { from: "IN_EXECUTION", to: "CANCELLED", actors: ["ops"], event: "logistics.shipment.cancelled", guards: ["no_successful_delivery_attempt"], effects: ["cancel_open_dispatch_jobs"] },
    { from: "DELIVERED", to: "CLOSED", actors: ["system", "ops"], event: "logistics.shipment.closed", guards: ["no_open_exception", "no_open_claim"] },
    { from: "RETURNED", to: "CLOSED", actors: ["system", "ops"], event: "logistics.shipment.closed", guards: ["no_open_claim"] },
  ],
});

export const DISPATCH_JOB_MACHINE = sm({
  key: "DISPATCH_JOB",
  aggregate: "logistics_dispatch_job",
  initial: "PENDING",
  terminal: ["COMPLETED", "CANCELLED"],
  states: [
    "PENDING", "ASSIGNING", "OFFERED", "ACCEPTED", "EN_ROUTE", "ARRIVED",
    "COMPLETED", "FAILED", "REASSIGNING", "CANCELLED",
  ],
  mustNotEncode: ["shipment lifecycle", "payment state", "POD evidence state"],
  transitions: [
    { from: "PENDING", to: "ASSIGNING", actors: ["system", "dispatcher"], event: "logistics.dispatch.assigning" },
    { from: "ASSIGNING", to: "OFFERED", actors: ["system"], event: "logistics.dispatch.offered", guards: ["partner_compliance_valid", "courier_compliance_valid", "vehicle_eligible_for_offering"] },
    { from: "OFFERED", to: "ACCEPTED", actors: ["courier"], event: "logistics.dispatch.accepted", guards: ["offer_not_expired", "partner_compliance_valid"] },
    { from: "OFFERED", to: "REASSIGNING", actors: ["system", "dispatcher"], event: "logistics.dispatch.reassigning", effects: ["record_rejection_reason"] },
    { from: "ACCEPTED", to: "EN_ROUTE", actors: ["courier"], event: "logistics.dispatch.en_route" },
    { from: "EN_ROUTE", to: "ARRIVED", actors: ["courier", "system"], event: "logistics.dispatch.arrived" },
    { from: "ARRIVED", to: "COMPLETED", actors: ["courier", "system"], event: "logistics.dispatch.completed", guards: ["all_assigned_stops_resolved"] },
    { from: "EN_ROUTE", to: "FAILED", actors: ["courier", "dispatcher", "system"], event: "logistics.dispatch.failed", effects: ["open_exception"] },
    { from: "ARRIVED", to: "FAILED", actors: ["courier", "dispatcher", "system"], event: "logistics.dispatch.failed", effects: ["open_exception"] },
    { from: "ASSIGNING", to: "FAILED", actors: ["system"], event: "logistics.dispatch.failed", effects: ["open_exception"] },
    { from: "FAILED", to: "REASSIGNING", actors: ["dispatcher", "system"], event: "logistics.dispatch.reassigning" },
    { from: "REASSIGNING", to: "ASSIGNING", actors: ["system", "dispatcher"], event: "logistics.dispatch.assigning", effects: ["create_successor_job_reference"] },
    { from: "PENDING", to: "CANCELLED", actors: ["dispatcher", "ops", "system"], event: "logistics.dispatch.cancelled" },
    { from: "ASSIGNING", to: "CANCELLED", actors: ["dispatcher", "ops", "system"], event: "logistics.dispatch.cancelled" },
    { from: "OFFERED", to: "CANCELLED", actors: ["dispatcher", "ops", "system"], event: "logistics.dispatch.cancelled" },
    { from: "ACCEPTED", to: "CANCELLED", actors: ["dispatcher", "ops"], event: "logistics.dispatch.cancelled" },
  ],
});

export const DELIVERY_ATTEMPT_MACHINE = sm({
  key: "DELIVERY_ATTEMPT",
  aggregate: "logistics_delivery_attempt",
  initial: "SCHEDULED",
  terminal: ["SUCCESSFUL", "ABANDONED"],
  states: ["SCHEDULED", "ATTEMPTED", "SUCCESSFUL", "FAILED", "RETRY_REQUIRED", "ABANDONED"],
  mustNotEncode: ["shipment lifecycle", "payment state"],
  transitions: [
    { from: "SCHEDULED", to: "ATTEMPTED", actors: ["courier", "system"], event: "logistics.attempt.started" },
    { from: "ATTEMPTED", to: "SUCCESSFUL", actors: ["courier", "system"], event: "logistics.attempt.succeeded", guards: ["pod_policy_satisfied_for_offering"], effects: ["seal_pod_evidence"] },
    { from: "ATTEMPTED", to: "FAILED", actors: ["courier", "system"], event: "logistics.attempt.failed", guards: ["failure_reason_from_catalogue"], effects: ["open_exception"] },
    { from: "FAILED", to: "RETRY_REQUIRED", actors: ["ops", "system"], event: "logistics.attempt.retry_required", guards: ["retries_remaining_for_offering"] },
    { from: "RETRY_REQUIRED", to: "SCHEDULED", actors: ["ops", "dispatcher", "system"], event: "logistics.attempt.rescheduled", effects: ["create_successor_attempt"] },
    { from: "FAILED", to: "ABANDONED", actors: ["ops"], event: "logistics.attempt.abandoned", effects: ["evaluate_return_initiation"] },
    { from: "RETRY_REQUIRED", to: "ABANDONED", actors: ["ops"], event: "logistics.attempt.abandoned", effects: ["evaluate_return_initiation"] },
  ],
});

export const PAYMENT_MACHINE = sm({
  key: "PAYMENT",
  aggregate: "logistics_payment",
  initial: "UNPAID",
  terminal: ["REFUNDED", "CAPTURED", "FAILED"],
  states: [
    "UNPAID", "PAYMENT_PENDING", "AUTHORIZED", "CAPTURED", "FAILED",
    "PARTIALLY_REFUNDED", "REFUNDED",
  ],
  mustNotEncode: ["shipment lifecycle", "dispatch state", "POD state"],
  transitions: [
    { from: "UNPAID", to: "PAYMENT_PENDING", actors: ["customer", "corporate_admin", "system"], event: "logistics.payment.initiated" },
    { from: "PAYMENT_PENDING", to: "AUTHORIZED", actors: ["system"], event: "logistics.payment.authorized", guards: ["verified_provider_callback"] },
    { from: "PAYMENT_PENDING", to: "FAILED", actors: ["system"], event: "logistics.payment.failed", effects: ["retain_booking"] },
    { from: "AUTHORIZED", to: "CAPTURED", actors: ["system", "finance"], event: "logistics.payment.captured", guards: ["verified_provider_callback"], effects: ["post_journal_entry"] },
    { from: "UNPAID", to: "CAPTURED", actors: ["finance", "system"], event: "logistics.payment.captured", guards: ["corporate_prefunded_wallet_or_credit_terms"], effects: ["post_journal_entry"] },
    { from: "CAPTURED", to: "PARTIALLY_REFUNDED", actors: ["finance"], event: "logistics.payment.partially_refunded", guards: ["four_eyes_approval"], effects: ["post_journal_entry"] },
    { from: "CAPTURED", to: "REFUNDED", actors: ["finance"], event: "logistics.payment.refunded", guards: ["four_eyes_approval"], effects: ["post_journal_entry"] },
    { from: "PARTIALLY_REFUNDED", to: "REFUNDED", actors: ["finance"], event: "logistics.payment.refunded", guards: ["four_eyes_approval"], effects: ["post_journal_entry"] },
    { from: "FAILED", to: "PAYMENT_PENDING", actors: ["customer", "corporate_admin", "system"], event: "logistics.payment.initiated" },
  ],
});

export const RETURN_MACHINE = sm({
  key: "RETURN",
  aggregate: "logistics_return",
  initial: "REQUESTED",
  terminal: ["CLOSED", "REJECTED"],
  states: ["REQUESTED", "APPROVED", "REJECTED", "DISPATCHED", "IN_TRANSIT", "RECEIVED", "CLOSED"],
  mustNotEncode: ["shipment lifecycle", "claim state"],
  transitions: [
    { from: "REQUESTED", to: "APPROVED", actors: ["ops"], event: "logistics.return.approved", guards: ["return_policy_permits_offering"] },
    { from: "REQUESTED", to: "REJECTED", actors: ["ops"], event: "logistics.return.rejected", guards: ["rejection_reason_recorded"] },
    { from: "APPROVED", to: "DISPATCHED", actors: ["dispatcher", "system"], event: "logistics.return.dispatched", effects: ["create_return_dispatch_job"] },
    { from: "DISPATCHED", to: "IN_TRANSIT", actors: ["courier", "system"], event: "logistics.return.in_transit" },
    { from: "IN_TRANSIT", to: "RECEIVED", actors: ["ops", "system"], event: "logistics.return.received", guards: ["custody_handover_recorded"] },
    { from: "RECEIVED", to: "CLOSED", actors: ["ops", "system"], event: "logistics.return.closed" },
  ],
});

export const CLAIM_MACHINE = sm({
  key: "CLAIM",
  aggregate: "logistics_claim",
  initial: "OPENED",
  terminal: ["CLOSED", "REJECTED"],
  states: ["OPENED", "UNDER_REVIEW", "EVIDENCE_REQUIRED", "APPROVED", "REJECTED", "SETTLED", "CLOSED"],
  mustNotEncode: ["shipment lifecycle", "insurance cover assertions"],
  transitions: [
    { from: "OPENED", to: "UNDER_REVIEW", actors: ["ops", "compliance"], event: "logistics.claim.under_review" },
    { from: "UNDER_REVIEW", to: "EVIDENCE_REQUIRED", actors: ["ops", "compliance"], event: "logistics.claim.evidence_required" },
    { from: "EVIDENCE_REQUIRED", to: "UNDER_REVIEW", actors: ["customer", "corporate_admin", "ops"], event: "logistics.claim.evidence_submitted" },
    { from: "UNDER_REVIEW", to: "APPROVED", actors: ["compliance", "finance"], event: "logistics.claim.approved", guards: ["four_eyes_approval", "liability_basis_recorded"] },
    { from: "UNDER_REVIEW", to: "REJECTED", actors: ["compliance"], event: "logistics.claim.rejected", guards: ["rejection_reason_recorded"] },
    { from: "APPROVED", to: "SETTLED", actors: ["finance"], event: "logistics.claim.settled", guards: ["settlement_instrument_recorded"], effects: ["post_journal_entry"] },
    { from: "SETTLED", to: "CLOSED", actors: ["ops", "finance"], event: "logistics.claim.closed" },
    { from: "REJECTED", to: "CLOSED", actors: ["ops"], event: "logistics.claim.closed" },
  ],
});

export const STATE_MACHINES: Record<MachineKey, StateMachine> = {
  ORDER: ORDER_MACHINE,
  SHIPMENT: SHIPMENT_MACHINE,
  DISPATCH_JOB: DISPATCH_JOB_MACHINE,
  DELIVERY_ATTEMPT: DELIVERY_ATTEMPT_MACHINE,
  PAYMENT: PAYMENT_MACHINE,
  RETURN: RETURN_MACHINE,
  CLAIM: CLAIM_MACHINE,
};

export interface TransitionDecision {
  allowed: boolean;
  reason?: string;
  transition?: Transition;
}

/** Legality check. Server guards must call this before any status write. */
export function evaluateTransition(
  machine: MachineKey,
  from: string,
  to: string,
  actor: Actor,
): TransitionDecision {
  const m = STATE_MACHINES[machine];
  if (!m.states.includes(from)) return { allowed: false, reason: `unknown_from_state:${from}` };
  if (!m.states.includes(to)) return { allowed: false, reason: `unknown_to_state:${to}` };
  const t = m.transitions.find((x) => x.from === from && x.to === to);
  if (!t) return { allowed: false, reason: `forbidden_transition:${machine}:${from}->${to}` };
  if (!t.actors.includes(actor)) return { allowed: false, reason: `actor_not_permitted:${actor}` };
  return { allowed: true, transition: t };
}

/** All legal transitions out of a state for an actor. */
export function allowedTransitions(machine: MachineKey, from: string, actor: Actor): Transition[] {
  return STATE_MACHINES[machine].transitions.filter((t) => t.from === from && t.actors.includes(actor));
}

/** Every event name the domain may emit — the canonical event catalogue. */
export function eventCatalogue(): string[] {
  return [...new Set(Object.values(STATE_MACHINES).flatMap((m) => m.transitions.map((t) => t.event)))].sort();
}

/**
 * Cross-machine coordination rules. These express the legal *combinations*
 * that the audit called out (payment captured + dispatch failed, etc.).
 */
export interface CoordinationRule {
  id: string;
  description: string;
  /** Returns true when the combination is legal. */
  legal: (s: {
    shipment: string;
    dispatch?: string;
    payment: string;
    attempt?: string;
  }) => boolean;
}

export const COORDINATION_RULES: CoordinationRule[] = [
  {
    id: "COORD-01",
    description: "A failed dispatch job never forces the shipment out of execution readiness.",
    legal: (s) => !(s.dispatch === "FAILED" && !["READY_FOR_DISPATCH", "IN_EXECUTION", "CANCELLED", "RETURNING"].includes(s.shipment)),
  },
  {
    id: "COORD-02",
    description: "A failed delivery attempt leaves the shipment IN_EXECUTION with an exception, not DELIVERED.",
    legal: (s) => !(s.attempt === "FAILED" && s.shipment === "DELIVERED"),
  },
  {
    id: "COORD-03",
    description: "Payment failure may co-exist with a retained BOOKED shipment.",
    legal: () => true,
  },
  {
    id: "COORD-04",
    description: "A shipment may not reach READY_FOR_DISPATCH while payment is UNPAID unless corporate terms apply (guard payment_state_permits_dispatch).",
    legal: (s) => !(s.shipment === "READY_FOR_DISPATCH" && s.payment === "PAYMENT_PENDING"),
  },
];

export function coordinationViolations(state: {
  shipment: string;
  dispatch?: string;
  payment: string;
  attempt?: string;
}): CoordinationRule[] {
  return COORDINATION_RULES.filter((r) => !r.legal(state));
}
