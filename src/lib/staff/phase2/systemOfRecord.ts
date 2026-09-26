/**
 * Phase 2 — System of Record.
 *
 * One canonical definition per business entity: which domain owns it, which
 * department is accountable, which existing SAFARID table is authoritative, and
 * which lifecycle governs its state. There are deliberately NO competing
 * duplicate entities: if a concept already exists in the platform schema, the
 * registry points at that table rather than inventing a parallel one.
 *
 * `table: null` means the entity is defined but not yet backed by a system of
 * record — it is reported as DATA NOT AVAILABLE and becomes a readiness gap,
 * never a fabricated figure.
 */

export const RECORD_DOMAINS = [
  "organisation",
  "commercial",
  "marketplace",
  "operations",
  "financial",
  "human_capital",
  "governance",
] as const;

export type RecordDomain = (typeof RECORD_DOMAINS)[number];

export const DOMAIN_LABEL: Record<RecordDomain, string> = {
  organisation: "Organisation",
  commercial: "Commercial",
  marketplace: "Marketplace",
  operations: "Operations",
  financial: "Financial",
  human_capital: "Human capital",
  governance: "Governance",
};

export interface CanonicalEntity {
  key: string;
  label: string;
  domain: RecordDomain;
  /** Accountable department (owner of the data, not merely its consumer). */
  owner: string;
  /** Authoritative table in the SAFARID platform schema, or null when absent. */
  table: string | null;
  /** Lifecycle key from lifecycles.ts governing this entity's state. */
  lifecycle?: string;
  /** Short note on the record's role, kept factual. */
  note?: string;
}

export const CANONICAL_ENTITIES: readonly CanonicalEntity[] = [
  /* organisation */
  { key: "company", label: "Company", domain: "organisation", owner: "Executive Office", table: null, note: "Single-company model; held in configuration, not a table." },
  { key: "division", label: "Division", domain: "organisation", owner: "Executive Office", table: null, note: "Defined in organisation.ts DIVISIONS." },
  { key: "department", label: "Department", domain: "organisation", owner: "People & Culture", table: "corporate_departments" },
  { key: "position", label: "Position", domain: "organisation", owner: "People & Culture", table: "corporate_designations", lifecycle: "position" },
  { key: "employee", label: "Employee", domain: "organisation", owner: "People & Culture", table: "corporate_employees", lifecycle: "employee" },
  { key: "authority", label: "Authority", domain: "organisation", owner: "Governance & Risk", table: "corporate_admin_permission_grants" },
  { key: "cost_centre", label: "Cost centre", domain: "organisation", owner: "Finance", table: "cost_centers" },

  /* commercial */
  { key: "customer", label: "Customer / account", domain: "commercial", owner: "Corporate Sales", table: "corporate_accounts", lifecycle: "customer_activation" },
  { key: "lead", label: "Lead", domain: "commercial", owner: "Corporate Sales", table: "contact_submissions", lifecycle: "sales" },
  { key: "opportunity", label: "Opportunity", domain: "commercial", owner: "Corporate Sales", table: null, note: "No opportunity table yet — Phase 3 integration item." },
  { key: "quote", label: "Quote / proposal", domain: "commercial", owner: "Corporate Sales", table: "charter_quotes", lifecycle: "sales" },
  { key: "contract", label: "Contract", domain: "commercial", owner: "Legal & Compliance", table: "corporate_documents" },
  { key: "customer_success", label: "Customer lifecycle state", domain: "commercial", owner: "Customer Success", table: "client_journey_events", lifecycle: "customer_success" },

  /* marketplace */
  { key: "partner", label: "Partner / operator", domain: "marketplace", owner: "Marketplace Supply", table: "charter_partner_applications", lifecycle: "partner_activation" },
  { key: "resource", label: "Resource (vehicle / asset)", domain: "marketplace", owner: "Marketplace Supply", table: "charter_inventory", lifecycle: "resource_supply" },
  { key: "verification", label: "Resource verification", domain: "marketplace", owner: "Compliance", table: "charter_document_registry" },
  { key: "marketplace_txn", label: "Marketplace transaction", domain: "marketplace", owner: "Marketplace Supply", table: "charter_bookings", lifecycle: "revenue" },

  /* operations */
  { key: "booking", label: "Booking / charter mission", domain: "operations", owner: "Service Operations", table: "charter_bookings", lifecycle: "revenue" },
  { key: "order", label: "Delivery order / shipment", domain: "operations", owner: "Logistics Operations", table: "delivery_orders", lifecycle: "revenue" },
  { key: "assignment", label: "Assignment / dispatch", domain: "operations", owner: "Dispatch", table: "dispatch_assignments" },
  { key: "airport_transfer", label: "Airport transfer", domain: "operations", owner: "Service Operations", table: "airport_bookings" },
  { key: "rental", label: "Rental reservation / lease", domain: "operations", owner: "Rentals & Leasing", table: null, note: "Rental reservations are not yet a system of record." },

  /* financial */
  { key: "invoice", label: "Invoice", domain: "financial", owner: "Finance", table: "corporate_invoices", lifecycle: "revenue" },
  { key: "transaction", label: "Payment transaction", domain: "financial", owner: "Finance", table: "charter_payment_events" },
  { key: "ledger", label: "Revenue / wallet ledger", domain: "financial", owner: "Finance", table: "charter_wallet_ledger" },
  { key: "settlement", label: "Partner settlement", domain: "financial", owner: "Finance", table: "charter_wallet_finance_actions" },
  { key: "reconciliation", label: "Reconciliation finding", domain: "financial", owner: "Revenue Assurance", table: "charter_wallet_reconciliation_findings", lifecycle: "reconciliation" },
  { key: "chargeback", label: "Refund / chargeback", domain: "financial", owner: "Revenue Assurance", table: "chargebacks" },

  /* human capital */
  { key: "capability", label: "Capability", domain: "human_capital", owner: "People & Culture", table: "capabilities" },
  { key: "goal_kpi", label: "Goal / KPI", domain: "human_capital", owner: "People & Culture", table: null, note: "Performance goals not yet persisted." },
  { key: "learning", label: "Learning programme / certification", domain: "human_capital", owner: "SAFARID Academy", table: "certification_workflows" },

  /* governance */
  { key: "task", label: "Task (Work Engine)", domain: "governance", owner: "Each department", table: "staff_follow_up_tasks", lifecycle: "task" },
  { key: "approval", label: "Approval request", domain: "governance", owner: "Governance & Risk", table: "approval_requests", lifecycle: "approval" },
  { key: "policy", label: "Policy", domain: "governance", owner: "Governance & Risk", table: "corporate_policy_rules" },
  { key: "incident", label: "Incident", domain: "governance", owner: "Service Operations", table: "alerts_events" },
  { key: "decision", label: "Decision record", domain: "governance", owner: "Executive Office", table: "approval_decisions", lifecycle: "memory_loop" },
  { key: "audit_event", label: "Audit event", domain: "governance", owner: "Governance & Risk", table: "audit_logs" },
  { key: "insight_feedback", label: "AI insight feedback", domain: "governance", owner: "Data & AI", table: "staff_insight_feedback" },
];

export function entitiesByDomain(domain: RecordDomain): CanonicalEntity[] {
  return CANONICAL_ENTITIES.filter((e) => e.domain === domain);
}

/** Entities defined without an authoritative table — the record gap list. */
export function unbackedEntities(): CanonicalEntity[] {
  return CANONICAL_ENTITIES.filter((e) => !e.table);
}

/** Distinct tables to probe for coverage, de-duplicated. */
export function recordTables(): string[] {
  return [...new Set(CANONICAL_ENTITIES.map((e) => e.table).filter((t): t is string => !!t))];
}
