/**
 * TaxiD orchestration — platform event taxonomy.
 *
 * TaxiD is a marketplace: DEMAND (riders, groups, corporates, charter,
 * delivery, logistics, rental, leasing customers) is connected to INDEPENDENT
 * SUPPLY (drivers, vehicle/bus/truck/aircraft/equipment owners and operators,
 * rental and leasing providers). TaxiD does not own the supply assets, so every
 * event below describes something that happened to a *transaction between two
 * independent parties*, never to "our fleet".
 *
 * Events are emitted by the portals and by the existing platform engines. They
 * are the ONLY input to the event-to-work engine (see `rules.ts`).
 */

/** Channel the event originated from. */
export const SOURCE_PORTALS = [
  "rider",
  "driver",
  "corporate",
  "charter",
  "delivery_logistics",
  "rental_leasing",
  "super_admin",
  "system",
] as const;
export type SourcePortal = (typeof SOURCE_PORTALS)[number];

/** Canonical entity an event points at. Work items reference these — never copies. */
export const ENTITY_TYPES = [
  "customer",
  "corporate_account",
  "provider",
  "driver",
  "asset",
  "requirement",
  "booking",
  "delivery_order",
  "rental_agreement",
  "lease_agreement",
  "charter_quote",
  "transaction",
  "payment",
  "settlement",
  "document",
  "staff",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Stage of the marketplace chain the event belongs to. */
export const CHAIN_STAGES = [
  "demand",
  "requirement",
  "supply_discovery",
  "eligibility",
  "matching",
  "quotation",
  "booking",
  "fulfilment",
  "payment",
  "settlement",
  "performance",
  "exception",
  "intelligence",
] as const;
export type ChainStage = (typeof CHAIN_STAGES)[number];

export const EVENT_TYPES = [
  // demand + matching
  "demand_captured",
  "demand_unmatched",
  "quote_awaiting_provider_response",
  "high_value_demand",
  "approval_required",
  // fulfilment
  "provider_cancelled",
  "driver_no_show",
  "late_pickup",
  "route_exception",
  "failed_pickup",
  "failed_delivery",
  "pod_dispute",
  "sla_breach_risk",
  "sla_breached",
  "fulfilment_completed",
  // rental & leasing
  "reservation_exception",
  "return_exception",
  "damage_dispute",
  "agreement_approval_required",
  // finance
  "payment_failed",
  "refund_requested",
  "reconciliation_exception",
  "settlement_exception",
  "commission_exception",
  "corporate_invoice_exception",
  // supply & trust
  "provider_onboarding_submitted",
  "compliance_document_expiring",
  "compliance_document_expired",
  "provider_repeat_cancellation",
  "fraud_signal",
  "safety_incident",
  "customer_complaint",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STAGE: Record<EventType, ChainStage> = {
  demand_captured: "demand",
  demand_unmatched: "matching",
  quote_awaiting_provider_response: "quotation",
  high_value_demand: "eligibility",
  approval_required: "eligibility",
  provider_cancelled: "fulfilment",
  driver_no_show: "fulfilment",
  late_pickup: "fulfilment",
  route_exception: "fulfilment",
  failed_pickup: "fulfilment",
  failed_delivery: "fulfilment",
  pod_dispute: "exception",
  sla_breach_risk: "fulfilment",
  sla_breached: "exception",
  fulfilment_completed: "fulfilment",
  reservation_exception: "booking",
  return_exception: "fulfilment",
  damage_dispute: "exception",
  agreement_approval_required: "eligibility",
  payment_failed: "payment",
  refund_requested: "payment",
  reconciliation_exception: "settlement",
  settlement_exception: "settlement",
  commission_exception: "settlement",
  corporate_invoice_exception: "settlement",
  provider_onboarding_submitted: "eligibility",
  compliance_document_expiring: "performance",
  compliance_document_expired: "eligibility",
  provider_repeat_cancellation: "performance",
  fraud_signal: "exception",
  safety_incident: "exception",
  customer_complaint: "performance",
};

/** Service line the transaction belongs to — one model for every product. */
export const SERVICE_LINES = [
  "ride",
  "airport_transfer",
  "corporate_transport",
  "staff_transport",
  "school_transport",
  "bus_charter",
  "parcel_delivery",
  "courier",
  "freight",
  "truck_hire",
  "rental",
  "leasing",
  "air_charter",
  "helicopter_charter",
  "heavy_equipment",
] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

/** Facts the orchestration rules are allowed to reason about. */
export interface OrchestrationSignals {
  /** Replacement independent supply available for the requirement. */
  replacementSupplyAvailable?: boolean;
  /** Customer is actively waiting on this transaction. */
  customerWaiting?: boolean;
  isCorporate?: boolean;
  slaSensitive?: boolean;
  /** Provider cancellations in the trailing window. */
  providerCancellationCount?: number;
  amountKes?: number;
  /** Automated retry/repair already succeeded upstream. */
  autoResolved?: boolean;
  /** Days until a compliance document expires (negative = expired). */
  daysToExpiry?: number;
  repeatIssue?: boolean;
}

export interface PlatformEvent {
  /** Stable event id — used for idempotent work creation. */
  id: string;
  type: EventType;
  sourcePortal: SourcePortal;
  serviceLine?: ServiceLine;
  entityType: EntityType;
  entityId: string;
  occurredAt: string;
  signals?: OrchestrationSignals;
  payload?: Record<string, unknown>;
}

export const EVENT_LABEL: Record<EventType, string> = {
  demand_captured: "Demand captured",
  demand_unmatched: "Demand could not be matched",
  quote_awaiting_provider_response: "Quote awaiting provider response",
  high_value_demand: "High-value demand",
  approval_required: "Approval required",
  provider_cancelled: "Provider cancelled after acceptance",
  driver_no_show: "Driver no-show",
  late_pickup: "Late pickup",
  route_exception: "Route exception",
  failed_pickup: "Failed pickup",
  failed_delivery: "Failed delivery",
  pod_dispute: "Proof-of-delivery dispute",
  sla_breach_risk: "SLA breach risk",
  sla_breached: "SLA breached",
  fulfilment_completed: "Fulfilment completed",
  reservation_exception: "Reservation exception",
  return_exception: "Return exception",
  damage_dispute: "Damage dispute",
  agreement_approval_required: "Agreement approval required",
  payment_failed: "Payment failed",
  refund_requested: "Refund requested",
  reconciliation_exception: "Reconciliation exception",
  settlement_exception: "Settlement exception",
  commission_exception: "Commission exception",
  corporate_invoice_exception: "Corporate invoice exception",
  provider_onboarding_submitted: "Provider onboarding submitted",
  compliance_document_expiring: "Compliance document expiring",
  compliance_document_expired: "Compliance document expired",
  provider_repeat_cancellation: "Provider repeat cancellation",
  fraud_signal: "Fraud signal",
  safety_incident: "Safety incident",
  customer_complaint: "Customer complaint",
};
