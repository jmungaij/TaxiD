/**
 * Logistics Domain Foundation — canonical entity catalogue.
 *
 * Design-first artefact: this catalogue is frozen and reviewed BEFORE any
 * migration is written. It deliberately rejects the conceptual journey diagram
 * as a literal parent-child hierarchy:
 *   - STOP belongs to a ROUTE_PLAN, never to a PACKAGE.
 *   - DISPATCH_JOB is an operational work object referencing shipment, stops,
 *     courier and vehicle — not a child of STOP.
 *   - POD belongs to a DELIVERY_ATTEMPT.
 *   - PAYMENT / RETURN / CLAIM are sibling aggregates, never shipment statuses.
 */

export type DomainOwner =
  | "logistics"
  | "dispatch"
  | "partners"
  | "identity"
  | "payments"
  | "compliance"
  | "commercial";

export interface EntitySpec {
  entity: string;
  /** Proposed physical table (additive; existing tables reused where noted). */
  table: string;
  purpose: string;
  primaryKey: string;
  foreignKeys: string[];
  /** Cardinality statements this entity must support. */
  cardinality: string[];
  owner: DomainOwner;
  /** State machine key, or "none" for reference/evidence entities. */
  lifecycle: string;
  auditRequirements: string[];
  /** Existing table this reuses or supersedes, when applicable. */
  reuses?: string;
}

export const ENTITY_CATALOGUE: EntitySpec[] = [
  {
    entity: "CUSTOMER",
    table: "profiles",
    reuses: "profiles",
    purpose: "Natural person who books or receives logistics services.",
    primaryKey: "id (auth user id)",
    foreignKeys: [],
    cardinality: ["one customer → many orders"],
    owner: "identity",
    lifecycle: "none",
    auditRequirements: ["PII access logged", "no public read"],
  },
  {
    entity: "ORGANISATION",
    table: "corporate_accounts",
    reuses: "corporate_accounts",
    purpose: "Corporate/e-commerce account that owns billing and policy context.",
    primaryKey: "id",
    foreignKeys: [],
    cardinality: ["one organisation → many customers", "one organisation → many orders"],
    owner: "commercial",
    lifecycle: "none",
    auditRequirements: ["KYB document state referenced, never duplicated"],
  },
  {
    entity: "ORDER",
    table: "logistics_orders",
    purpose: "Commercial intent: what the customer asked for, and its commercial context.",
    primaryKey: "id",
    foreignKeys: ["customer_id → profiles.id", "organisation_id → corporate_accounts.id (nullable)"],
    cardinality: ["one order → many shipments", "one order → one commercial context"],
    owner: "logistics",
    lifecycle: "ORDER",
    auditRequirements: ["append-only event stream", "actor + source on every transition"],
  },
  {
    entity: "SHIPMENT",
    table: "logistics_shipments",
    purpose: "Physical movement obligation under one service offering.",
    primaryKey: "id",
    foreignKeys: ["order_id → logistics_orders.id", "service_offering_code → logistics_service_offerings.code"],
    cardinality: [
      "one shipment → many packages",
      "one shipment → one or many route plans",
      "one shipment → many dispatch jobs",
      "one shipment → many tracking events",
      "one shipment → many delivery attempts",
      "one shipment → zero or many exceptions / returns / claims",
    ],
    owner: "logistics",
    lifecycle: "SHIPMENT",
    auditRequirements: ["status changes only via guarded RPC", "immutable event per transition"],
  },
  {
    entity: "PACKAGE",
    table: "logistics_packages",
    purpose: "A discrete handled item with weight, dimensions and declared value.",
    primaryKey: "id",
    foreignKeys: ["shipment_id → logistics_shipments.id"],
    cardinality: ["one shipment → many packages", "one package → many custody events"],
    owner: "logistics",
    lifecycle: "none",
    auditRequirements: ["declared value immutable after BOOKED", "restricted-goods declaration retained"],
  },
  {
    entity: "ROUTE_PLAN",
    table: "logistics_route_plans",
    purpose: "Ordered plan of stops (pickup, delivery, hub, cross-dock, return) for a shipment.",
    primaryKey: "id",
    foreignKeys: ["shipment_id → logistics_shipments.id"],
    cardinality: ["one shipment → one or many route plans (replans are new versions)", "one route plan → many stops"],
    owner: "logistics",
    lifecycle: "none",
    auditRequirements: ["replan creates a new version; prior plan retained"],
  },
  {
    entity: "STOP",
    table: "logistics_stops",
    purpose: "A geographic task within a route plan. NOT a child of PACKAGE.",
    primaryKey: "id",
    foreignKeys: ["route_plan_id → logistics_route_plans.id"],
    cardinality: [
      "one route plan → many stops",
      "one stop → many packages (via logistics_stop_packages)",
      "one package → many stops (pickup, hub, delivery, return)",
    ],
    owner: "logistics",
    lifecycle: "none",
    auditRequirements: ["stop_type and sequence immutable once executed"],
  },
  {
    entity: "STOP_PACKAGE",
    table: "logistics_stop_packages",
    purpose: "Join table resolving the many-to-many between stops and packages.",
    primaryKey: "id",
    foreignKeys: ["stop_id → logistics_stops.id", "package_id → logistics_packages.id"],
    cardinality: ["many stops ↔ many packages"],
    owner: "logistics",
    lifecycle: "none",
    auditRequirements: ["custody direction (load/unload) recorded"],
  },
  {
    entity: "DISPATCH_JOB",
    table: "logistics_dispatch_jobs",
    purpose: "Operational assignment of stops to a courier + vehicle. Reassignable without corrupting shipment history.",
    primaryKey: "id",
    foreignKeys: [
      "shipment_id → logistics_shipments.id",
      "courier_id → drivers.id (nullable until accepted)",
      "vehicle_id → vehicles.id (nullable)",
      "partner_id → partners.id (nullable)",
      "supersedes_job_id → logistics_dispatch_jobs.id (nullable)",
    ],
    cardinality: ["one shipment → many dispatch jobs", "one dispatch job → many stops (via logistics_dispatch_job_stops)"],
    owner: "dispatch",
    lifecycle: "DISPATCH_JOB",
    auditRequirements: ["compliance snapshot captured at OFFERED", "rejection/failure reason mandatory"],
  },
  {
    entity: "COURIER",
    table: "drivers",
    reuses: "drivers",
    purpose: "Person executing dispatch jobs; compliance state lives in document/compliance tables.",
    primaryKey: "id",
    foreignKeys: ["partner_id → partners.id (nullable)"],
    cardinality: ["one courier → many dispatch jobs"],
    owner: "dispatch",
    lifecycle: "none",
    auditRequirements: ["`verified` flag is NOT a compliance substitute"],
  },
  {
    entity: "VEHICLE",
    table: "vehicles",
    reuses: "vehicles",
    purpose: "Asset used for fulfilment; class determines offering eligibility.",
    primaryKey: "id",
    foreignKeys: [],
    cardinality: ["one vehicle → many dispatch jobs"],
    owner: "fleet" as DomainOwner,
    lifecycle: "none",
    auditRequirements: ["inspection + insurance validity referenced at dispatch time"],
  },
  {
    entity: "PARTNER",
    table: "partners",
    reuses: "partners",
    purpose: "Licensed courier operator or carrier supplying capacity.",
    primaryKey: "id",
    foreignKeys: [],
    cardinality: ["one partner → many couriers, vehicles, dispatch jobs"],
    owner: "partners",
    lifecycle: "none",
    auditRequirements: ["licence + insurance validity windows required for dispatch eligibility"],
  },
  {
    entity: "TRACKING_EVENT",
    table: "logistics_tracking_events",
    purpose: "Immutable, customer-visible movement/state event for a shipment.",
    primaryKey: "id",
    foreignKeys: ["shipment_id → logistics_shipments.id", "dispatch_job_id (nullable)", "stop_id (nullable)"],
    cardinality: ["one shipment → many tracking events"],
    owner: "logistics",
    lifecycle: "none",
    auditRequirements: ["append-only", "idempotency_key unique", "payload_hash stored"],
  },
  {
    entity: "DELIVERY_ATTEMPT",
    table: "logistics_delivery_attempts",
    purpose: "One execution attempt at a stop, with outcome and failure reason. Never free text on the shipment.",
    primaryKey: "id",
    foreignKeys: [
      "shipment_id → logistics_shipments.id",
      "stop_id → logistics_stops.id",
      "dispatch_job_id → logistics_dispatch_jobs.id",
      "courier_id → drivers.id",
    ],
    cardinality: ["one shipment → many attempts", "one attempt → zero or many POD evidence items"],
    owner: "logistics",
    lifecycle: "DELIVERY_ATTEMPT",
    auditRequirements: ["failure_reason from controlled vocabulary", "location + device captured"],
  },
  {
    entity: "POD",
    table: "logistics_pod_evidence",
    purpose: "Proof-of-delivery evidence bound to a delivery attempt, per POD policy.",
    primaryKey: "id",
    foreignKeys: ["delivery_attempt_id → logistics_delivery_attempts.id"],
    cardinality: ["one attempt → zero, one or many evidence items depending on POD policy"],
    owner: "logistics",
    lifecycle: "none",
    auditRequirements: ["private storage only, signed URLs", "hash sealed at capture", "verification method + result stored"],
  },
  {
    entity: "EXCEPTION",
    table: "logistics_exceptions",
    purpose: "Operational deviation (recipient unavailable, address issue, damage, delay) on a shipment.",
    primaryKey: "id",
    foreignKeys: ["shipment_id → logistics_shipments.id", "delivery_attempt_id (nullable)", "dispatch_job_id (nullable)"],
    cardinality: ["one shipment → many exceptions"],
    owner: "logistics",
    lifecycle: "none",
    auditRequirements: ["open/close actor + timestamps", "shipment closure blocked while open"],
  },
  {
    entity: "RETURN",
    table: "logistics_returns",
    purpose: "Return-to-sender or RTO flow as its own aggregate.",
    primaryKey: "id",
    foreignKeys: ["shipment_id → logistics_shipments.id", "return_dispatch_job_id (nullable)"],
    cardinality: ["one shipment → zero or many returns"],
    owner: "logistics",
    lifecycle: "RETURN",
    auditRequirements: ["policy basis recorded", "custody handover on receipt"],
  },
  {
    entity: "CLAIM",
    table: "logistics_claims",
    purpose: "Loss/damage claim with liability basis. Makes no insurance-cover assertion.",
    primaryKey: "id",
    foreignKeys: ["shipment_id → logistics_shipments.id", "package_id (nullable)"],
    cardinality: ["one shipment → zero or many claims"],
    owner: "compliance",
    lifecycle: "CLAIM",
    auditRequirements: ["four-eyes on approval and settlement", "liability basis mandatory"],
  },
  {
    entity: "SERVICE_FAMILY",
    table: "logistics_service_families",
    purpose: "Top-level product family (parcel, courier, express, freight, warehousing, fulfilment, corporate).",
    primaryKey: "code",
    foreignKeys: [],
    cardinality: ["one family → many offerings"],
    owner: "commercial",
    lifecycle: "none",
    auditRequirements: ["change requires commercial approval"],
  },
  {
    entity: "SERVICE_OFFERING",
    table: "logistics_service_offerings",
    purpose: "Versioned, effective-dated commercial offering carrying all operational policy.",
    primaryKey: "code + version",
    foreignKeys: ["family_code → logistics_service_families.code"],
    cardinality: ["one offering → many rate plans, one SLA/POD/return/claim/compliance policy per version"],
    owner: "commercial",
    lifecycle: "none",
    auditRequirements: ["effective_from/until immutable once live", "capability truth recorded per offering"],
  },
  {
    entity: "RATE_PLAN",
    table: "logistics_rate_plans",
    purpose: "Versioned pricing configuration referenced by quotes.",
    primaryKey: "id",
    foreignKeys: ["service_offering_code → logistics_service_offerings.code"],
    cardinality: ["one offering → many rate plans (by zone/effective window)"],
    owner: "commercial",
    lifecycle: "none",
    auditRequirements: ["quote stores rate_plan_id + snapshot"],
  },
  {
    entity: "QUOTE",
    table: "logistics_quotes",
    purpose: "Priced offer with expiry; immutable snapshot of inputs and rate plan.",
    primaryKey: "id",
    foreignKeys: ["shipment_id → logistics_shipments.id", "rate_plan_id → logistics_rate_plans.id"],
    cardinality: ["one shipment → many quotes (latest wins)"],
    owner: "commercial",
    lifecycle: "none",
    auditRequirements: ["immutable after issue", "expiry enforced server-side"],
  },
  {
    entity: "PAYMENT",
    table: "logistics_payments",
    purpose: "Financial state of an order/shipment, independent of shipment lifecycle.",
    primaryKey: "id",
    foreignKeys: ["order_id → logistics_orders.id", "shipment_id (nullable)"],
    cardinality: ["one order → many payments"],
    owner: "payments",
    lifecycle: "PAYMENT",
    auditRequirements: ["provider callback verification required", "journal entry on capture/refund"],
  },
  {
    entity: "INVOICE",
    table: "corporate_invoices",
    reuses: "corporate_invoices",
    purpose: "Billing document; eTIMS submission state tracked separately.",
    primaryKey: "id",
    foreignKeys: ["corporate_id → corporate_accounts.id"],
    cardinality: ["one organisation → many invoices"],
    owner: "payments",
    lifecycle: "none",
    auditRequirements: ["no tax-compliance claim without stored KRA acknowledgement"],
  },
  {
    entity: "SETTLEMENT",
    table: "partner_settlements",
    reuses: "partner_settlements",
    purpose: "Partner/courier payout for completed work.",
    primaryKey: "id",
    foreignKeys: ["partner_id → partners.id"],
    cardinality: ["one partner → many settlements"],
    owner: "payments",
    lifecycle: "none",
    auditRequirements: ["shipment completion does not imply settlement"],
  },
];

/** Relationships that the physical model MUST support (review matrix). */
export const RELATIONSHIP_MATRIX: string[] = [
  "ORDER 1..* SHIPMENT",
  "SHIPMENT 1..* PACKAGE",
  "SHIPMENT 1..* ROUTE_PLAN",
  "ROUTE_PLAN 1..* STOP",
  "STOP *..* PACKAGE (via STOP_PACKAGE)",
  "SHIPMENT 1..* DISPATCH_JOB",
  "DISPATCH_JOB 0..1 COURIER",
  "DISPATCH_JOB 0..1 VEHICLE",
  "DISPATCH_JOB 1..* STOP",
  "SHIPMENT 1..* TRACKING_EVENT",
  "SHIPMENT 1..* DELIVERY_ATTEMPT",
  "DELIVERY_ATTEMPT 0..* POD",
  "SHIPMENT 0..* EXCEPTION",
  "SHIPMENT 0..* RETURN",
  "SHIPMENT 0..* CLAIM",
  "SHIPMENT 1..* QUOTE",
  "ORDER 1..* PAYMENT",
];

/** Forbidden modelling shortcuts — asserted by the domain foundation tests. */
export const FORBIDDEN_MODELLING: string[] = [
  "STOP as a child of PACKAGE",
  "DISPATCH_JOB as a child of STOP",
  "POD attached directly to SHIPMENT instead of DELIVERY_ATTEMPT",
  "payment state stored in shipment.status",
  "returns or claims stored as shipment status strings",
  "delivery attempts stored as free text in shipment notes",
];

/** Identifier strategy — human-readable, collision-safe, non-guessable where public. */
export const IDENTIFIER_STRATEGY = {
  order: "ORD-<YYMM>-<base32(6)>",
  shipment: "SHP-<YYMM>-<base32(6)>",
  package: "PKG-<YYMM>-<base32(8)>",
  trackingNumber: "YL<check-digit><base32(10)> — public, non-sequential",
  dispatchJob: "DSP-<YYMM>-<base32(6)>",
  attempt: "ATT-<shipment>-<n>",
  claim: "CLM-<YYMM>-<base32(6)>",
  rule: "Surrogate uuid primary keys; business identifiers unique + immutable.",
} as const;

export function entity(name: string): EntitySpec | undefined {
  return ENTITY_CATALOGUE.find((e) => e.entity === name);
}
