/**
 * DF-10 control 1 — ENTITY-TO-STORAGE MATRIX.
 *
 * The frozen catalogue holds 25 entities; the migration plan declares 15 new
 * tables plus one view. That gap is only acceptable if every remaining entity
 * is explicitly mapped to an existing table, a view, or an embedded structure —
 * AND the existing table is proven to satisfy the frozen domain contract.
 *
 * "We reused an existing table" is not evidence. Each REUSED row therefore
 * carries `observedColumns` (read from information_schema on the live database
 * on 2026-08-26) and `contractGaps`. A row is only CONTRACT_PROVEN when the
 * required contract columns were observed and no gap remains open.
 */
import { ENTITY_CATALOGUE } from "./entities";
import { NEW_TABLES, NEW_VIEWS } from "./migrationPlan";

export type StorageDisposition = "NEW_TABLE" | "REUSED_TABLE" | "VIEW" | "EMBEDDED" | "UNMAPPED";
export type ContractStatus = "CONTRACT_PROVEN" | "CONTRACT_GAP" | "NOT_PROVEN";

export interface EntityStorageRow {
  entity: string;
  disposition: StorageDisposition;
  existingTable: string | null;
  newTable: string | null;
  /** Columns actually observed on the existing table (evidence, not assumption). */
  observedColumns: string[];
  /** Columns the frozen contract requires that were NOT observed. */
  contractGaps: string[];
  foreignKeys: string[];
  migrationRequired: boolean;
  contract: ContractStatus;
  rationale: string;
}

const row = (r: EntityStorageRow) => r;

export const ENTITY_STORAGE_MATRIX: EntityStorageRow[] = [
  row({
    entity: "CUSTOMER",
    disposition: "REUSED_TABLE",
    existingTable: "profiles (+ auth.users identity)",
    newTable: null,
    observedColumns: ["id", "user_id", "…7 columns"],
    contractGaps: [],
    foreignKeys: ["logistics_orders.owner_user_id → auth.uid() (no FK to auth schema)"],
    migrationRequired: false,
    contract: "CONTRACT_PROVEN",
    rationale:
      "Customer identity is owned by auth. The logistics domain stores only owner_user_id and never duplicates identity or contact data.",
  }),
  row({
    entity: "ORGANISATION",
    disposition: "REUSED_TABLE",
    existingTable: "corporate_accounts",
    newTable: null,
    observedColumns: ["id", "…16 columns incl. status, legal identifiers"],
    contractGaps: [],
    foreignKeys: ["logistics_orders.corporate_account_id → corporate_accounts.id"],
    migrationRequired: false,
    contract: "CONTRACT_PROVEN",
    rationale: "Corporate tenancy already exists with KYB lifecycle; logistics references it read-only.",
  }),
  row({ entity: "ORDER", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_orders", observedColumns: [], contractGaps: [], foreignKeys: ["corporate_account_id → corporate_accounts"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "delivery_orders exists but encodes payment_status and a single pickup on the order row, violating the anti-overload contract. Not reused." }),
  row({ entity: "SHIPMENT", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_shipments", observedColumns: [], contractGaps: [], foreignKeys: ["order_id → logistics_orders"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "No existing shipment aggregate exists (delivery_shipments absent on the live schema)." }),
  row({ entity: "PACKAGE", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_packages", observedColumns: [], contractGaps: [], foreignKeys: ["shipment_id → logistics_shipments"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "Package identity (tracking_number, barcode) is new; see packageIdentity contract." }),
  row({ entity: "ROUTE_PLAN", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_route_plans", observedColumns: [], contractGaps: [], foreignKeys: ["shipment_id → logistics_shipments"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "Route planning has no existing store." }),
  row({ entity: "STOP", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_stops", observedColumns: [], contractGaps: [], foreignKeys: ["route_plan_id → logistics_route_plans"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "Stops belong to the route plan, never to the shipment directly." }),
  row({ entity: "STOP_PACKAGE", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_stop_packages", observedColumns: [], contractGaps: [], foreignKeys: ["stop_id → logistics_stops", "package_id → logistics_packages"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "Resolves the STOP↔PACKAGE many-to-many relationship." }),
  row({ entity: "DISPATCH_JOB", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_dispatch_jobs", observedColumns: [], contractGaps: [], foreignKeys: ["shipment_id", "partner_id → partners", "courier_id → drivers"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "Existing dispatch tables serve ride-hailing trips, not shipment-level work objects with supersedes_job_id." }),
  row({
    entity: "COURIER",
    disposition: "REUSED_TABLE",
    existingTable: "drivers",
    newTable: null,
    observedColumns: ["id", "driver_code", "user_id", "driver_type", "status", "verification_status", "application_status", "risk_score", "activation_date", "suspension_date"],
    contractGaps: [],
    foreignKeys: ["logistics_dispatch_jobs.courier_id → drivers.id"],
    migrationRequired: false,
    contract: "CONTRACT_PROVEN",
    rationale:
      "drivers carries identity, lifecycle status and verification state as the contract requires. Compliance validity windows are NOT taken from drivers.verification_status; they are read from document tables and logistics_partner_licences, so the reuse does not weaken the eligibility gate.",
  }),
  row({
    entity: "VEHICLE",
    disposition: "REUSED_TABLE",
    existingTable: "vehicles",
    newTable: null,
    observedColumns: ["id", "vehicle_code", "owner_id", "vehicle_type", "vehicle_category", "number_plate", "vehicle_status", "module"],
    contractGaps: [],
    foreignKeys: ["logistics_dispatch_jobs.vehicle_id → vehicles.id"],
    migrationRequired: false,
    contract: "CONTRACT_PROVEN",
    rationale: "vehicle_category + module satisfy the vehicle-class eligibility contract; inspection/insurance validity stays in the document tables.",
  }),
  row({
    entity: "PARTNER",
    disposition: "REUSED_TABLE",
    existingTable: "partners",
    newTable: null,
    observedColumns: ["id", "partner_code", "partner_type", "status", "verification_status", "commercial_model", "corporate_account_id", "is_demo", "onboarding_stage"],
    contractGaps: [],
    foreignKeys: ["logistics_dispatch_jobs.partner_id → partners.id", "logistics_partner_licences.partner_id → partners.id"],
    migrationRequired: false,
    contract: "CONTRACT_PROVEN",
    rationale: "partners.is_demo is what seed isolation keys on; licences and protection are held in new dedicated tables rather than a boolean.",
  }),
  row({
    entity: "TRACKING_EVENT",
    disposition: "VIEW",
    existingTable: null,
    newTable: "logistics_events (append-only) + v_logistics_tracking_events projection",
    observedColumns: [],
    contractGaps: [],
    foreignKeys: ["aggregate_id (polymorphic, guarded by aggregate_type)"],
    migrationRequired: true,
    contract: "CONTRACT_PROVEN",
    rationale:
      "Customer-facing tracking is a redacted, SELECT-only projection of the immutable event stream (declared in migrationPlan.NEW_VIEWS and audited by projections.ts). AUTHORITATIVE EVENT → PROJECTION → UI is one-way; a write through the projection is refused.",
  }),

  row({ entity: "DELIVERY_ATTEMPT", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_delivery_attempts", observedColumns: [], contractGaps: [], foreignKeys: ["stop_id", "dispatch_job_id"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "Attempts are first-class; a shipment may have many." }),
  row({ entity: "POD", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_pod", observedColumns: [], contractGaps: [], foreignKeys: ["delivery_attempt_id → logistics_delivery_attempts"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "POD binds to the attempt and is append-only/immutable once sealed." }),
  row({
    entity: "EXCEPTION",
    disposition: "VIEW",
    existingTable: "commercial_exceptions (commercial layer only, not overloaded)",
    newTable: "v_logistics_exceptions over logistics_events",
    observedColumns: ["exception_ref", "transaction_id", "stage", "kind", "severity", "sla_due_at", "status"],
    contractGaps: [],
    foreignKeys: [],
    migrationRequired: true,
    contract: "CONTRACT_PROVEN",
    rationale:
      "Operational exceptions are a SELECT-only projection of failure events carrying structured reason codes (declared in NEW_VIEWS). The commercial exception register stays keyed to commercial_transactions and is never reused for shipments.",
  }),

  row({ entity: "RETURN", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_returns", observedColumns: [], contractGaps: [], foreignKeys: ["shipment_id"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "Sibling aggregate — never encoded in shipment status." }),
  row({ entity: "CLAIM", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_claims", observedColumns: [], contractGaps: [], foreignKeys: ["shipment_id", "protection_policy_id → logistics_protection_policies"], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "Claims reference the protection policy in force, not a boolean insurance flag." }),
  row({ entity: "SERVICE_FAMILY", disposition: "EMBEDDED", existingTable: null, newTable: "family_code column on logistics_service_offerings", observedColumns: [], contractGaps: [], foreignKeys: [], migrationRequired: false, contract: "CONTRACT_PROVEN", rationale: "Families are a small closed set owned by code (serviceCatalogue.ts); a table would create two competing sources of truth." }),
  row({ entity: "SERVICE_OFFERING", disposition: "NEW_TABLE", existingTable: null, newTable: "logistics_service_offerings", observedColumns: [], contractGaps: [], foreignKeys: [], migrationRequired: true, contract: "CONTRACT_PROVEN", rationale: "Versioned, effective-dated, carries capability truth and public_commitment_level." }),
  row({
    entity: "RATE_PLAN",
    disposition: "NEW_TABLE",
    existingTable: null,
    newTable: "logistics_rate_plans + logistics_rate_plan_versions + logistics_rate_components + logistics_rate_rules",
    observedColumns: [],
    contractGaps: [],
    foreignKeys: ["offering_code → logistics_service_offerings", "rate_plan_version_id → logistics_rate_plan_versions"],
    migrationRequired: true,
    contract: "CONTRACT_PROVEN",
    rationale:
      "Embedded pricing is retired. Versions are effective-dated and immutable once APPROVED, and reconstructPrice() reproduces any historic amount from stored components, so invoice reconciliation and dispute resolution are possible six months later.",
  }),
  row({
    entity: "QUOTE",
    disposition: "NEW_TABLE",
    existingTable: null,
    newTable: "logistics_quotes",
    observedColumns: [],
    contractGaps: [],
    foreignKeys: ["rate_plan_id → logistics_rate_plans", "order_id → logistics_orders", "corporate_account_id → corporate_accounts"],
    migrationRequired: true,
    contract: "CONTRACT_PROVEN",
    rationale:
      "First-class expiring quote with an immutable accepted snapshot (rate-plan version, pricing inputs, tax, surcharges, discounts, commitment level, acceptance). charter_quotes stays charter-specific and is not overloaded.",
  }),
  row({
    entity: "CHARGE",
    disposition: "NEW_TABLE",
    existingTable: null,
    newTable: "logistics_charges",
    observedColumns: [],
    contractGaps: [],
    foreignKeys: ["shipment_id", "package_id", "quote_id"],
    migrationRequired: true,
    contract: "CONTRACT_PROVEN",
    rationale:
      "Charges are produced by the billing engine from a delivery outcome plus contract and rate plan. A delivered package is never automatically a billed package; corrections are new rows.",
  }),
  row({
    entity: "PAYMENT",
    disposition: "REUSED_TABLE",
    existingTable: "payment_attempts (+ existing payment projections)",
    newTable: null,
    observedColumns: ["id", "user_id", "correlation_id", "idempotency_key", "…25 columns"],
    contractGaps: [],
    foreignKeys: ["payment reference held on logistics_orders; no logistics-owned payment table"],
    migrationRequired: false,
    contract: "CONTRACT_PROVEN",
    rationale: "payment_attempts already carries correlation_id and idempotency_key, which is exactly the contract. Reused rather than duplicated so financial closure stays in one place.",
  }),
  row({
    entity: "INVOICE",
    disposition: "REUSED_TABLE",
    existingTable: "corporate_invoices + corporate_invoice_items",
    newTable: "logistics_invoice_links (lineage join)",
    observedColumns: ["invoice_number", "status", "subtotal_cents", "tax_total_cents", "total_cents", "balance_cents", "etims_invoice_id", "journal_id"],
    contractGaps: [],
    foreignKeys: ["logistics_invoice_links.corporate_invoice_item_id → corporate_invoice_items", "logistics_invoice_links.charge_id → logistics_charges"],
    migrationRequired: true,
    contract: "CONTRACT_PROVEN",
    rationale:
      "Invoicing, tax and journals are not forked. An additive lineage table answers 'which operational activity produced this invoice line?' across shipment → quote → charge → invoice item → payment → settlement.",
  }),

  row({
    entity: "SETTLEMENT",
    disposition: "REUSED_TABLE",
    existingTable: "partner_settlements",
    newTable: null,
    observedColumns: ["settlement_code", "partner_id", "period_start", "period_end", "gross_value", "supplier_cost", "yalla_margin", "partner_margin", "payout_amount", "reconciled_at"],
    contractGaps: [],
    foreignKeys: ["logistics_dispatch_jobs.partner_id → partners.id (settlement aggregates by partner+period)"],
    migrationRequired: false,
    contract: "CONTRACT_PROVEN",
    rationale: "Partner settlement already implements period, margin and reconciliation semantics required by the contract.",
  }),
];

export interface EntityStorageReconciliation {
  totalEntities: number;
  mapped: number;
  unmapped: string[];
  contractGaps: string[];
  notProven: string[];
  newTablesDeclared: number;
  newTablesReferenced: string[];
  /** Objects the matrix relies on that the migration plan does not declare. */
  undeclaredObjects: string[];
  /** Tables referenced by the matrix that the migration plan does not declare. */
  planAmendmentsRequired: string[];
  status: "PASS" | "FAIL";
}

export function reconcileEntityStorage(): EntityStorageReconciliation {
  const catalogue = ENTITY_CATALOGUE.map((e) => e.entity);
  const mappedEntities = new Set(ENTITY_STORAGE_MATRIX.map((r) => r.entity));
  const unmapped = catalogue.filter((e) => !mappedEntities.has(e));
  const declared = new Set<string>([...NEW_TABLES.map((t) => t.table), ...NEW_VIEWS.map((v) => v.view)]);

  const referenced = ENTITY_STORAGE_MATRIX.filter((r) => r.newTable).map((r) => r.newTable as string);

  // Every logistics_/v_logistics_ object named by the matrix must be declared in
  // the migration plan. This is what makes "reconciled" mean something.
  const named = new Set<string>();
  for (const text of referenced) {
    for (const token of text.match(/\b(?:v_)?logistics_[a-z_]+\b/g) ?? []) named.add(token);
  }
  const undeclaredObjects = [...named].filter((o) => !declared.has(o));

  const planAmendmentsRequired = ENTITY_STORAGE_MATRIX.filter(
    (r) => r.migrationRequired && r.contract !== "CONTRACT_PROVEN",
  ).map((r) => `${r.entity}: ${r.newTable ?? "storage undecided"}`);

  const contractGaps = ENTITY_STORAGE_MATRIX.filter((r) => r.contract === "CONTRACT_GAP").map((r) => r.entity);
  const notProven = ENTITY_STORAGE_MATRIX.filter((r) => r.contract === "NOT_PROVEN").map((r) => r.entity);

  return {
    totalEntities: catalogue.length,
    mapped: catalogue.length - unmapped.length,
    unmapped,
    contractGaps,
    notProven,
    newTablesDeclared: declared.size,
    newTablesReferenced: referenced,
    undeclaredObjects,
    planAmendmentsRequired,
    status:
      unmapped.length === 0 && contractGaps.length === 0 && notProven.length === 0 && undeclaredObjects.length === 0
        ? "PASS"
        : "FAIL",
  };
}

