/**
 * DF-10 migration plan — declarative, machine-checkable, NOT executed.
 *
 * The plan is the artefact reviewed at the DF-10 safety gate. Every operation
 * is classified, and `classifyMigrationPlan()` fails the gate if any operation
 * is destructive or changes existing production semantics.
 */

export type MigrationOpKind =
  | "CREATE_TABLE"
  | "CREATE_ENUM"
  | "ADD_COLUMN"
  | "CREATE_INDEX"
  | "CREATE_CONSTRAINT"
  | "CREATE_FOREIGN_KEY"
  | "CREATE_TRIGGER"
  | "CREATE_FUNCTION"
  | "CREATE_VIEW"
  | "GRANT"
  | "ENABLE_RLS"
  | "CREATE_POLICY"
  | "DROP_TABLE"
  | "DROP_COLUMN"
  | "ALTER_COLUMN_TYPE"
  | "DELETE_DATA"
  | "UPDATE_DATA"
  | "RESET_SEQUENCE"
  | "ALTER_EXISTING_POLICY";

export const DESTRUCTIVE_KINDS: MigrationOpKind[] = [
  "DROP_TABLE",
  "DROP_COLUMN",
  "ALTER_COLUMN_TYPE",
  "DELETE_DATA",
  "UPDATE_DATA",
  "RESET_SEQUENCE",
  "ALTER_EXISTING_POLICY",
];

export interface MigrationOp {
  id: string;
  kind: MigrationOpKind;
  object: string;
  /** Existing production object touched, if any. */
  touchesExisting: boolean;
  rationale: string;
}

export interface NewTableSpec {
  table: string;
  purpose: string;
  keys: string[];
  foreignKeys: string[];
  indexes: string[];
  appendOnly: boolean;
  tenantColumn: string | null;
  grants: string[];
  policies: { cmd: "SELECT" | "INSERT" | "UPDATE" | "DELETE"; role: string; predicate: string }[];
}

/** New tables the DF-10 migration would create. Additive only. */
export const NEW_TABLES: NewTableSpec[] = [
  {
    table: "logistics_service_offerings",
    purpose: "Persisted service catalogue with capability truth and public commitment level.",
    keys: ["id", "(code, version)"],
    foreignKeys: [],
    indexes: ["code", "status", "effective_from"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO anon (bookable/informational rows only via view)", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "true" },
      { cmd: "INSERT", role: "service_role", predicate: "service-role only" },
      { cmd: "UPDATE", role: "service_role", predicate: "service-role only" },
      { cmd: "DELETE", role: "service_role", predicate: "service-role only" },
    ],
  },
  {
    table: "logistics_shipments",
    purpose: "Shipment aggregate — custody and execution, no payment/dispatch/POD state encoded.",
    keys: ["id", "shipment_reference"],
    foreignKeys: ["order_id → logistics_orders", "offering_code → logistics_service_offerings"],
    indexes: ["order_id", "status", "corporate_account_id", "created_at"],
    appendOnly: false,
    tenantColumn: "owner_user_id / corporate_account_id",
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "owner_user_id = auth.uid() OR corporate member OR staff role" },
      { cmd: "INSERT", role: "service_role", predicate: "created only through book_shipment RPC" },
      { cmd: "UPDATE", role: "service_role", predicate: "status changes only through transition RPC" },
      { cmd: "DELETE", role: "service_role", predicate: "no client delete" },
    ],
  },
  {
    table: "logistics_orders",
    purpose: "Commercial order aggregate; parent of shipments.",
    keys: ["id", "order_reference"],
    foreignKeys: ["corporate_account_id → corporate_accounts"],
    indexes: ["owner_user_id", "corporate_account_id", "status"],
    appendOnly: false,
    tenantColumn: "owner_user_id / corporate_account_id",
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "owner or corporate member or staff" },
      { cmd: "INSERT", role: "service_role", predicate: "RPC only" },
      { cmd: "UPDATE", role: "service_role", predicate: "RPC only" },
      { cmd: "DELETE", role: "service_role", predicate: "no client delete" },
    ],
  },
  {
    table: "logistics_route_plans",
    purpose: "Route plan per shipment; parent of stops.",
    keys: ["id"],
    foreignKeys: ["shipment_id → logistics_shipments"],
    indexes: ["shipment_id"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [{ cmd: "SELECT", role: "authenticated", predicate: "shipment visible to caller" }],
  },
  {
    table: "logistics_stops",
    purpose: "Ordered stop under a route plan (pickup/hub/delivery).",
    keys: ["id", "(route_plan_id, sequence)"],
    foreignKeys: ["route_plan_id → logistics_route_plans"],
    indexes: ["route_plan_id"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [{ cmd: "SELECT", role: "authenticated", predicate: "parent shipment visible to caller" }],
  },
  {
    table: "logistics_stop_packages",
    purpose: "STOP ↔ PACKAGE many-to-many join (multi-stop, partial and split delivery).",
    keys: ["(stop_id, package_id)"],
    foreignKeys: ["stop_id → logistics_stops", "package_id → logistics_packages"],
    indexes: ["stop_id", "package_id"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [{ cmd: "SELECT", role: "authenticated", predicate: "parent shipment visible to caller" }],
  },
  {
    table: "logistics_packages",
    purpose: "Physical package under a shipment.",
    keys: ["id", "package_reference"],
    foreignKeys: ["shipment_id → logistics_shipments"],
    indexes: ["shipment_id"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [{ cmd: "SELECT", role: "authenticated", predicate: "parent shipment visible to caller" }],
  },
  {
    table: "logistics_dispatch_jobs",
    purpose: "Shipment-level work object with supersedes_job_id history; never overwritten.",
    keys: ["id"],
    foreignKeys: ["shipment_id → logistics_shipments", "supersedes_job_id → logistics_dispatch_jobs", "partner_id → partners"],
    indexes: ["shipment_id", "partner_id", "courier_id", "status", "supersedes_job_id"],
    appendOnly: false,
    tenantColumn: "partner_id / courier_id",
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "assigned courier OR partner member OR ops staff" },
      { cmd: "INSERT", role: "service_role", predicate: "create_dispatch_job RPC only (compliance-gated)" },
      { cmd: "UPDATE", role: "service_role", predicate: "transition RPC only" },
    ],
  },
  {
    table: "logistics_delivery_attempts",
    purpose: "Attempt lifecycle; parent of POD.",
    keys: ["id"],
    foreignKeys: ["dispatch_job_id → logistics_dispatch_jobs", "stop_id → logistics_stops"],
    indexes: ["dispatch_job_id", "status"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [{ cmd: "SELECT", role: "authenticated", predicate: "job visible to caller" }],
  },
  {
    table: "logistics_pod",
    purpose: "Proof of delivery bound to a delivery attempt; evidence in private storage.",
    keys: ["id"],
    foreignKeys: ["delivery_attempt_id → logistics_delivery_attempts"],
    indexes: ["delivery_attempt_id"],
    appendOnly: true,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "INSERT TO service_role", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "shipment owner, assigned courier, or ops staff — never by id guess (uuid + RLS)" },
      { cmd: "INSERT", role: "service_role", predicate: "submit_pod RPC only, idempotent on (attempt_id, idempotency_key)" },
    ],
  },
  {
    table: "logistics_returns",
    purpose: "Return aggregate — sibling of shipment, not a shipment status.",
    keys: ["id"],
    foreignKeys: ["shipment_id → logistics_shipments"],
    indexes: ["shipment_id", "status"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [{ cmd: "SELECT", role: "authenticated", predicate: "shipment visible to caller" }],
  },
  {
    table: "logistics_claims",
    purpose: "Claim aggregate with protection-policy reference.",
    keys: ["id"],
    foreignKeys: ["shipment_id → logistics_shipments", "protection_policy_id → logistics_protection_policies"],
    indexes: ["shipment_id", "status"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [{ cmd: "SELECT", role: "authenticated", predicate: "claimant or ops/finance staff" }],
  },
  {
    table: "logistics_protection_policies",
    purpose: "DF-12 protection policy register (provider, limits, exclusions, eligibility, evidence).",
    keys: ["id", "policy_number"],
    foreignKeys: [],
    indexes: ["status", "expires_at"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "staff roles only (compliance/finance/ops)" },
      { cmd: "INSERT", role: "service_role", predicate: "compliance staff via RPC with evidence reference" },
    ],
  },
  {
    table: "logistics_partner_licences",
    purpose: "DF-11 licence register (number, category, issuer, validity, scope, verification evidence).",
    keys: ["id", "(partner_id, licence_number)"],
    foreignKeys: ["partner_id → partners"],
    indexes: ["partner_id", "status", "expires_at"],
    appendOnly: false,
    tenantColumn: "partner_id",
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "partner member (own) OR compliance staff" },
      { cmd: "UPDATE", role: "service_role", predicate: "verification fields writable by compliance RPC only" },
    ],
  },
  {
    table: "logistics_events",
    purpose: "Append-only canonical event stream for all seven machines.",
    keys: ["id", "(aggregate_type, aggregate_id, sequence)"],
    foreignKeys: [],
    indexes: ["aggregate_id", "event_type", "occurred_at", "idempotency_key (unique)"],
    appendOnly: true,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "aggregate visible to caller" },
      { cmd: "INSERT", role: "service_role", predicate: "append_logistics_event RPC only" },
      { cmd: "UPDATE", role: "service_role", predicate: "BLOCKED by immutability trigger" },
      { cmd: "DELETE", role: "service_role", predicate: "BLOCKED by immutability trigger" },
    ],
  },
  {
    table: "logistics_quotes",
    purpose:
      "First-class QUOTE aggregate with an immutable accepted snapshot (rate-plan version, pricing inputs, tax, surcharges, discounts, validity, commitment level, acceptance).",
    keys: ["id", "quote_reference", "(quote_reference, version)"],
    foreignKeys: ["order_id → logistics_orders (nullable until booking)", "rate_plan_id → logistics_rate_plans", "corporate_account_id → corporate_accounts"],
    indexes: ["owner_user_id", "corporate_account_id", "status", "expires_at", "idempotency_key (unique)"],
    appendOnly: false,
    tenantColumn: "owner_user_id / corporate_account_id",
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "owner or corporate member or commercial staff" },
      { cmd: "INSERT", role: "service_role", predicate: "logistics_quote_issue RPC only" },
      { cmd: "UPDATE", role: "service_role", predicate: "logistics_accept_quote RPC only; snapshot frozen by trigger once ACCEPTED" },
      { cmd: "DELETE", role: "service_role", predicate: "no delete; quotes expire or are superseded" },
    ],
  },
  {
    table: "logistics_rate_plans",
    purpose: "Rate plan header per offering — a first-class commercial object, no longer opaque embedded pricing.",
    keys: ["id", "code"],
    foreignKeys: ["offering_code → logistics_service_offerings"],
    indexes: ["code", "offering_code"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "commercial/finance/ops staff only" },
      { cmd: "INSERT", role: "service_role", predicate: "pricing governance RPC only" },
    ],
  },
  {
    table: "logistics_rate_plan_versions",
    purpose: "Effective-dated, approval-gated rate-plan version; immutable once APPROVED so historic prices can be reconstructed.",
    keys: ["id", "(rate_plan_id, version)"],
    foreignKeys: ["rate_plan_id → logistics_rate_plans"],
    indexes: ["rate_plan_id", "status", "effective_from"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "commercial/finance staff only" },
      { cmd: "UPDATE", role: "service_role", predicate: "BLOCKED by immutability trigger once status = APPROVED" },
    ],
  },
  {
    table: "logistics_rate_components",
    purpose: "Base/surcharge/discount/tax/minimum components of a rate-plan version with basis and rate.",
    keys: ["id", "(rate_plan_version_id, code)"],
    foreignKeys: ["rate_plan_version_id → logistics_rate_plan_versions"],
    indexes: ["rate_plan_version_id"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [{ cmd: "SELECT", role: "authenticated", predicate: "commercial/finance staff only" }],
  },
  {
    table: "logistics_rate_rules",
    purpose: "Applicability predicates binding components to service level, vehicle class, zone or corporate contract.",
    keys: ["id"],
    foreignKeys: ["rate_plan_version_id → logistics_rate_plan_versions"],
    indexes: ["rate_plan_version_id"],
    appendOnly: false,
    tenantColumn: null,
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [{ cmd: "SELECT", role: "authenticated", predicate: "commercial/finance staff only" }],
  },
  {
    table: "logistics_charges",
    purpose:
      "Commercial charge derived from a delivery outcome by the billing engine; carries quote, rate-plan version and breakdown so a delivered package is never automatically a billed package.",
    keys: ["id"],
    foreignKeys: ["shipment_id → logistics_shipments", "package_id → logistics_packages", "quote_id → logistics_quotes"],
    indexes: ["shipment_id", "quote_id", "idempotency_key (unique)"],
    appendOnly: true,
    tenantColumn: "corporate_account_id",
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "owner/corporate member or finance staff" },
      { cmd: "INSERT", role: "service_role", predicate: "billing evaluation RPC only" },
      { cmd: "UPDATE", role: "service_role", predicate: "BLOCKED — corrections are new charge rows" },
    ],
  },
  {
    table: "logistics_invoice_links",
    purpose:
      "Shipment/package/charge → corporate_invoice_items lineage. Answers 'which operational activity produced this invoice line?' without forking invoicing.",
    keys: ["id", "(charge_id, corporate_invoice_item_id)"],
    foreignKeys: [
      "charge_id → logistics_charges",
      "shipment_id → logistics_shipments",
      "corporate_invoice_item_id → corporate_invoice_items",
      "corporate_invoice_id → corporate_invoices",
    ],
    indexes: ["charge_id", "shipment_id", "corporate_invoice_item_id"],
    appendOnly: true,
    tenantColumn: "corporate_account_id",
    grants: ["SELECT TO authenticated", "ALL TO service_role"],
    policies: [
      { cmd: "SELECT", role: "authenticated", predicate: "corporate member (own account) or finance staff" },
      { cmd: "INSERT", role: "service_role", predicate: "invoicing RPC only" },
    ],
  },
];

/** Read projections. Views only — no role receives a write grant. */
export interface NewViewSpec {
  view: string;
  over: string;
  purpose: string;
  grants: string[];
}

export const NEW_VIEWS: NewViewSpec[] = [
  {
    view: "v_logistics_public_catalogue",
    over: "logistics_service_offerings",
    purpose: "Public projection filtered by effective commitment level; the only anon-readable catalogue surface.",
    grants: ["SELECT TO anon", "SELECT TO authenticated"],
  },
  {
    view: "v_logistics_tracking_events",
    over: "logistics_events",
    purpose: "Customer-facing tracking projection: redacted, read-only, derived from the immutable event stream.",
    grants: ["SELECT TO authenticated", "SELECT TO anon (tracking-number scoped)"],
  },
  {
    view: "v_logistics_exceptions",
    over: "logistics_events (failure events with reason codes)",
    purpose: "Operational exception projection for ops/support/compliance; never a writable exception register.",
    grants: ["SELECT TO authenticated"],
  },
];


/** New SECURITY DEFINER RPCs and their authorisation obligations. */
export interface RpcSpec {
  name: string;
  securityDefiner: boolean;
  searchPathPinned: boolean;
  validatesCaller: boolean;
  validatesTenant: boolean;
  validatesTransition: boolean;
  idempotent: boolean;
  grantedTo: string[];
}

export const NEW_RPCS: RpcSpec[] = [
  { name: "logistics_book_shipment", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: true, idempotent: true, grantedTo: ["authenticated"] },
  { name: "logistics_create_dispatch_job", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: true, idempotent: true, grantedTo: ["authenticated"] },
  { name: "logistics_accept_dispatch_job", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: true, idempotent: true, grantedTo: ["authenticated"] },
  { name: "logistics_transition", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: true, idempotent: true, grantedTo: ["authenticated"] },
  { name: "logistics_submit_pod", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: true, idempotent: true, grantedTo: ["authenticated"] },
  { name: "logistics_append_event", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: false, idempotent: true, grantedTo: ["service_role"] },
  { name: "logistics_evaluate_dispatch_eligibility", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: false, idempotent: true, grantedTo: ["authenticated"] },
  { name: "logistics_quote_issue", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: true, idempotent: true, grantedTo: ["authenticated"] },
  { name: "logistics_accept_quote", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: true, idempotent: true, grantedTo: ["authenticated"] },
  { name: "logistics_open_return", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: true, idempotent: true, grantedTo: ["authenticated"] },
  { name: "logistics_open_claim", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: true, idempotent: true, grantedTo: ["authenticated"] },
  { name: "logistics_evaluate_billing", securityDefiner: true, searchPathPinned: true, validatesCaller: true, validatesTenant: true, validatesTransition: false, idempotent: true, grantedTo: ["authenticated"] },
];


export const MIGRATION_OPS: MigrationOp[] = [
  ...NEW_TABLES.map<MigrationOp>((t, i) => ({
    id: `OP-T${String(i + 1).padStart(2, "0")}`,
    kind: "CREATE_TABLE",
    object: t.table,
    touchesExisting: false,
    rationale: t.purpose,
  })),
  ...NEW_TABLES.map<MigrationOp>((t, i) => ({
    id: `OP-G${String(i + 1).padStart(2, "0")}`,
    kind: "GRANT",
    object: t.table,
    touchesExisting: false,
    rationale: `Least-privilege Data API grants: ${t.grants.join("; ")}`,
  })),
  ...NEW_TABLES.map<MigrationOp>((t, i) => ({
    id: `OP-R${String(i + 1).padStart(2, "0")}`,
    kind: "ENABLE_RLS",
    object: t.table,
    touchesExisting: false,
    rationale: "RLS enabled immediately after grants, before policies.",
  })),
  ...NEW_TABLES.flatMap<MigrationOp>((t, i) =>
    t.policies.map((p, j) => ({
      id: `OP-P${String(i + 1).padStart(2, "0")}-${j + 1}`,
      kind: "CREATE_POLICY" as MigrationOpKind,
      object: `${t.table}.${p.cmd.toLowerCase()}`,
      touchesExisting: false,
      rationale: `${p.role}: ${p.predicate}`,
    })),
  ),
  {
    id: "OP-E01",
    kind: "CREATE_ENUM",
    object: "logistics_order_status, logistics_shipment_status, logistics_dispatch_status, logistics_attempt_status, logistics_return_status, logistics_claim_status, logistics_commitment_level",
    touchesExisting: false,
    rationale: "New enum types; no existing enum is altered.",
  },
  {
    id: "OP-F01",
    kind: "CREATE_FUNCTION",
    object: NEW_RPCS.map((r) => r.name).join(", "),
    touchesExisting: false,
    rationale: "Guarded transition/eligibility RPCs; all SECURITY DEFINER with pinned search_path.",
  },
  {
    id: "OP-TR1",
    kind: "CREATE_TRIGGER",
    object: "logistics_events immutability, logistics_pod immutability, updated_at touch triggers",
    touchesExisting: false,
    rationale: "Append-only enforcement and timestamp maintenance on new tables only.",
  },
  ...NEW_VIEWS.map<MigrationOp>((v, i) => ({
    id: `OP-V${String(i + 1).padStart(2, "0")}`,
    kind: "CREATE_VIEW" as MigrationOpKind,
    object: v.view,
    touchesExisting: false,
    rationale: `${v.purpose} Grants: ${v.grants.join("; ")} — read-only, no write grant to any role.`,
  })),
  {
    id: "OP-TR2",
    kind: "CREATE_TRIGGER",
    object: "logistics_quotes snapshot freeze, logistics_rate_plan_versions approval immutability, logistics_charges append-only",
    touchesExisting: false,
    rationale: "An ACCEPTED quote snapshot and an APPROVED rate-plan version can never be edited; charge corrections are new rows.",
  },
];


export interface MigrationClassification {
  additive: boolean;
  nonDestructive: boolean;
  backwardCompatible: boolean;
  destructiveOps: MigrationOp[];
  existingObjectsTouched: MigrationOp[];
  counts: Record<string, number>;
}

export function classifyMigrationPlan(ops: MigrationOp[] = MIGRATION_OPS): MigrationClassification {
  const destructiveOps = ops.filter((o) => DESTRUCTIVE_KINDS.includes(o.kind));
  const existingObjectsTouched = ops.filter((o) => o.touchesExisting);
  const counts = ops.reduce<Record<string, number>>((acc, o) => {
    acc[o.kind] = (acc[o.kind] ?? 0) + 1;
    return acc;
  }, {});
  return {
    additive: destructiveOps.length === 0,
    nonDestructive: destructiveOps.length === 0,
    backwardCompatible: existingObjectsTouched.length === 0,
    destructiveOps,
    existingObjectsTouched,
    counts,
  };
}

/** Existing-data impact: the plan intentionally contains no backfill. */
export const EXISTING_DATA_IMPACT = {
  existingTablesModified: [] as string[],
  existingRowsUpdated: 0,
  existingRowsDeleted: 0,
  sequencesReset: [] as string[],
  approvedBackfills: [] as string[],
  foreignKeysReferencingExisting: ["partners", "corporate_accounts", "auth.users (via owner_user_id, no FK)"],
  note:
    "New tables reference existing partner/corporate records read-only through foreign keys. No existing operational row is written by this migration.",
};
