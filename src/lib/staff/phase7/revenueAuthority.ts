/**
 * Phase 7 — TaxiD Revenue Data Authority Register.
 *
 * This module exists to stop the Revenue Tree being built on a guess. It does
 * NOT designate a revenue table. It declares the canonical commercial event
 * model, registers every candidate source with its revenue *meaning*, and
 * classifies each one by authority level. A source only becomes authoritative
 * when a controlled recognition layer is populated with traceable LIVE records.
 *
 * Deliberate refusals encoded here:
 *   • bookings are not revenue          • payments are not revenue
 *   • invoices are not revenue unless the accounting model recognises them
 *   • GMV / transaction value is not TaxiD revenue
 *   • modelled or simulated values may never populate the authoritative tree
 *
 * Because TaxiD is a marketplace, the register separates gross marketplace
 * transaction value, service-provider entitlement, taxes, refunds and
 * adjustments, cash collected, and TaxiD recognised revenue.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

/* ------------------------------------------------- canonical revenue events */

export const REVENUE_EVENT_MODEL = [
  "lead", "opportunity", "quote", "contract", "customer_activation",
  "booking", "confirmation", "fulfilment", "completion",
  "invoice", "payment", "settlement", "revenue",
] as const;
export type RevenueEventStage = (typeof REVENUE_EVENT_MODEL)[number];

export const REVENUE_EVENT_LABEL: Record<RevenueEventStage, string> = {
  lead: "Lead", opportunity: "Opportunity", quote: "Quote", contract: "Contract",
  customer_activation: "Customer activation", booking: "Booking",
  confirmation: "Confirmation", fulfilment: "Fulfilment", completion: "Completion",
  invoice: "Invoice", payment: "Payment", settlement: "Settlement", revenue: "Revenue",
};

/* -------------------------------------------------------- marketplace layers */

export const REVENUE_LAYERS = [
  "gross_marketplace_transaction_value",
  "service_provider_entitlement",
  "taxes",
  "refunds_and_adjustments",
  "cash_collected",
  "yalla_recognised_revenue",
] as const;
export type RevenueLayer = (typeof REVENUE_LAYERS)[number];

export const REVENUE_LAYER_LABEL: Record<RevenueLayer, string> = {
  gross_marketplace_transaction_value: "Gross marketplace transaction value",
  service_provider_entitlement: "Service provider entitlement",
  taxes: "Taxes",
  refunds_and_adjustments: "Refunds & adjustments",
  cash_collected: "Cash collected",
  yalla_recognised_revenue: "TaxiD recognised revenue",
};

/* --------------------------------------------------------- authority levels */

/**
 * `authoritative` — may populate the Revenue Tree once LIVE.
 * `recognition_candidate` — designated recognition layer, not yet populated.
 * `evidence` — traceable support around the truth, never the truth itself.
 * `forbidden` — must never be presented as TaxiD revenue.
 */
export type AuthorityLevel = "authoritative" | "recognition_candidate" | "evidence" | "forbidden";

export const AUTHORITY_LABEL: Record<AuthorityLevel, string> = {
  authoritative: "AUTHORITATIVE",
  recognition_candidate: "RECOGNITION CANDIDATE",
  evidence: "EVIDENCE ONLY",
  forbidden: "FORBIDDEN AS REVENUE",
};

export type DataStatus = "LIVE" | "MODELLED" | "SIMULATED" | "INCOMPLETE" | "UNREADABLE";

export interface RegisterEntry {
  /** Metric or quantity this source could support. */
  metric: string;
  layer: RevenueLayer;
  stage: RevenueEventStage;
  sourceTable: string;
  sourceField: string;
  primaryKey: string;
  /** Field that traces the row back to a transaction/booking. */
  transactionKey: string | null;
  /** What the number actually means in TaxiD's commercial model. */
  revenueMeaning: string;
  calculation: string;
  reconciliationSource: string | null;
  owner: string;
  authority: AuthorityLevel;
  /** Why this authority level was assigned — the refusal is explicit. */
  authorityReason: string;
}

export const REVENUE_DATA_AUTHORITY_REGISTER: readonly RegisterEntry[] = [
  {
    metric: "TaxiD recognised revenue",
    layer: "yalla_recognised_revenue",
    stage: "revenue",
    sourceTable: "revenue_events",
    sourceField: "gross_amount_cents / recognized_at / status",
    primaryKey: "id",
    transactionKey: "source_ref",
    revenueMeaning:
      "Declared canonical revenue recognition event: the point at which TaxiD's own earned revenue is recognised, linked to a journal.",
    calculation:
      "SUM over revenue_allocations of the TaxiD-entitlement allocation kinds for events where recognized_at IS NOT NULL — never gross amount alone.",
    reconciliationSource: "journals / journal_lines via revenue_events.journal_id",
    owner: "Finance",
    authority: "recognition_candidate",
    authorityReason:
      "Structurally correct recognition layer and the only table modelling a revenue event, but it must be populated by a controlled derivation with full traceability before it may be treated as authoritative.",
  },
  {
    metric: "Revenue allocation by account code",
    layer: "yalla_recognised_revenue",
    stage: "revenue",
    sourceTable: "revenue_allocations",
    sourceField: "kind / amount_cents / account_code",
    primaryKey: "id",
    transactionKey: "event_id",
    revenueMeaning:
      "Splits a recognised revenue event into its components (TaxiD entitlement, partner entitlement, tax, adjustment), which is what makes marketplace revenue separable.",
    calculation: "SUM(amount_cents) grouped by kind for the events in scope.",
    reconciliationSource: "revenue_events",
    owner: "Finance",
    authority: "recognition_candidate",
    authorityReason: "Depends entirely on revenue_events; inherits its authority level.",
  },
  {
    metric: "Posted accounting truth",
    layer: "yalla_recognised_revenue",
    stage: "revenue",
    sourceTable: "journal_lines",
    sourceField: "amount_cents / direction / account_id",
    primaryKey: "id",
    transactionKey: "transaction_id",
    revenueMeaning:
      "Double-entry postings against the chart of accounts — the accounting record that a recognition event must reconcile to.",
    calculation:
      "SUM(base_amount_cents) on revenue-side accounts for POSTED journals, credits less debits.",
    reconciliationSource: "journals.status = POSTED, ledger_entries hash chain",
    owner: "Finance",
    authority: "recognition_candidate",
    authorityReason:
      "Correct accounting substrate, but current contents are digital-twin seeded (TWIN-prefixed references), so it cannot yet carry a production revenue claim.",
  },
  {
    metric: "Gross marketplace transaction value",
    layer: "gross_marketplace_transaction_value",
    stage: "completion",
    sourceTable: "charter_bookings",
    sourceField: "total price fields",
    primaryKey: "id",
    transactionKey: "id",
    revenueMeaning:
      "Value transacted through the marketplace for charter missions. This is customer spend, most of which belongs to independent service providers.",
    calculation: "SUM of completed booking value — reported as GMV, never as revenue.",
    reconciliationSource: "charter_payment_events",
    owner: "Service Operations",
    authority: "forbidden",
    authorityReason: "Bookings are demand records. GMV is not TaxiD revenue.",
  },
  {
    metric: "Delivery marketplace transaction value",
    layer: "gross_marketplace_transaction_value",
    stage: "completion",
    sourceTable: "delivery_orders",
    sourceField: "order value fields",
    primaryKey: "id",
    transactionKey: "id",
    revenueMeaning: "Value transacted for parcel, courier and freight jobs.",
    calculation: "SUM of delivered order value — GMV only.",
    reconciliationSource: "delivery_dispatch_jobs",
    owner: "Logistics Operations",
    authority: "forbidden",
    authorityReason: "Fulfilment records are not a revenue recognition source.",
  },
  {
    metric: "Billed amount",
    layer: "yalla_recognised_revenue",
    stage: "invoice",
    sourceTable: "corporate_invoices",
    sourceField: "total / status",
    primaryKey: "id",
    transactionKey: "billing period / account reference",
    revenueMeaning:
      "Amount billed to a corporate account for a period. Billing is an obligation, not recognition, and includes pass-through partner value and tax.",
    calculation: "SUM(total) by status — presented as billed, never as revenue.",
    reconciliationSource: "corporate_invoice_items, corporate_invoice_taxes",
    owner: "Finance",
    authority: "evidence",
    authorityReason:
      "Usable as traceable evidence for a recognition event; may only become a recognition source if the accounting model explicitly establishes invoice-based recognition.",
  },
  {
    metric: "Tax charged",
    layer: "taxes",
    stage: "invoice",
    sourceTable: "corporate_invoice_taxes",
    sourceField: "tax amount",
    primaryKey: "id",
    transactionKey: "invoice_id",
    revenueMeaning: "Tax collected on behalf of the revenue authority. Never TaxiD income.",
    calculation: "SUM of tax amount by invoice.",
    reconciliationSource: "etims_invoices",
    owner: "Finance",
    authority: "evidence",
    authorityReason: "Must be excluded from recognised revenue and reconciled to the eTIMS record.",
  },
  {
    metric: "Cash collected",
    layer: "cash_collected",
    stage: "payment",
    sourceTable: "mpesa_transactions",
    sourceField: "amount / status",
    primaryKey: "id",
    transactionKey: "reference",
    revenueMeaning:
      "Money actually received. Collection timing is independent of revenue recognition and includes funds owed onward to partners.",
    calculation: "SUM(amount) for confirmed callbacks.",
    reconciliationSource: "payment_attempts, charter_wallet_ledger",
    owner: "Finance",
    authority: "forbidden",
    authorityReason: "Cash receipts are a treasury fact, not revenue.",
  },
  {
    metric: "Partner settlement",
    layer: "service_provider_entitlement",
    stage: "settlement",
    sourceTable: "settlement_batches",
    sourceField: "total_amount_cents / status",
    primaryKey: "id",
    transactionKey: "batch_ref",
    revenueMeaning:
      "Value paid out to independent service providers — the portion of GMV that was never TaxiD's to recognise.",
    calculation: "SUM(total_amount_cents) for closed batches.",
    reconciliationSource: "journal_lines via treasury account",
    owner: "Finance",
    authority: "evidence",
    authorityReason: "Required to derive TaxiD entitlement from GMV; not itself revenue.",
  },
  {
    metric: "Refunds and adjustments",
    layer: "refunds_and_adjustments",
    stage: "revenue",
    sourceTable: "refund_requests",
    sourceField: "amount / status",
    primaryKey: "id",
    transactionKey: "booking / payment reference",
    revenueMeaning: "Reductions to previously recognised or billed value.",
    calculation: "SUM(amount) for approved refunds, applied as a negative adjustment.",
    reconciliationSource: "corporate_invoice_adjustments, chargebacks",
    owner: "Revenue Assurance",
    authority: "evidence",
    authorityReason: "Must reduce recognised revenue rather than being reported separately as a metric.",
  },
];

/* ------------------------------------------------------------------ probing */

export interface RegisterProbe {
  table: string;
  rows: number | null;
  error: string | null;
  /** True when the contents carry digital-twin / seed markers. */
  simulated: boolean;
  simulationEvidence: string | null;
  checkedAt: string;
}

export type RegisterCoverage = Record<string, RegisterProbe>;

/** Tables whose contents can be recognised as seeded rather than transacted. */
const SIMULATION_MARKERS: Record<string, { field: string; prefix: string }> = {
  journals: { field: "reference", prefix: "TWIN-" },
  journal_lines: { field: "memo", prefix: "TWIN-" },
};

 
const db = () => untypedDb;

async function probeTable(table: string): Promise<RegisterProbe> {
  const checkedAt = new Date().toISOString();
  try {
    const { count, error } = await db().from(table).select("*", { count: "exact", head: true });
    if (error) return { table, rows: null, error: error.message, simulated: false, simulationEvidence: null, checkedAt };
    const rows = count ?? 0;
    const marker = SIMULATION_MARKERS[table];
    if (rows > 0 && marker) {
      const { count: seeded } = await db()
        .from(table)
        .select("*", { count: "exact", head: true })
        .like(marker.field, `${marker.prefix}%`);
      if ((seeded ?? 0) > 0) {
        return {
          table, rows, error: null, simulated: (seeded ?? 0) === rows,
          simulationEvidence: `${seeded}/${rows} rows carry ${marker.field} prefix ${marker.prefix}`,
          checkedAt,
        };
      }
    }
    return { table, rows, error: null, simulated: false, simulationEvidence: null, checkedAt };
  } catch (e) {
    return {
      table, rows: null, error: e instanceof Error ? e.message : "probe failed",
      simulated: false, simulationEvidence: null, checkedAt,
    };
  }
}

export async function probeRegister(
  entries: readonly RegisterEntry[] = REVENUE_DATA_AUTHORITY_REGISTER,
): Promise<RegisterCoverage> {
  const tables = [...new Set(entries.map((e) => e.sourceTable))];
  const probes = await Promise.all(tables.map(probeTable));
  return Object.fromEntries(probes.map((p) => [p.table, p]));
}

/* ---------------------------------------------------------- classification */

export interface AssessedEntry extends RegisterEntry {
  status: DataStatus;
  rows: number | null;
  statusReason: string;
  lastVerified: string | null;
  /** May this entry populate the authoritative Revenue Tree? */
  admissible: boolean;
}

export function classifyStatus(probe: RegisterProbe | undefined): { status: DataStatus; reason: string } {
  if (!probe) return { status: "UNREADABLE", reason: "Source was not probed" };
  if (probe.error) return { status: "UNREADABLE", reason: probe.error };
  if (probe.rows === 0) return { status: "INCOMPLETE", reason: "Source exists but holds no records" };
  if (probe.simulated) return { status: "SIMULATED", reason: probe.simulationEvidence ?? "Seeded contents detected" };
  return { status: "LIVE", reason: `${probe.rows} records readable` };
}

export function assessRegister(
  coverage: RegisterCoverage,
  entries: readonly RegisterEntry[] = REVENUE_DATA_AUTHORITY_REGISTER,
): AssessedEntry[] {
  return entries.map((e) => {
    const probe = coverage[e.sourceTable];
    const { status, reason } = classifyStatus(probe);
    return {
      ...e,
      status,
      rows: probe?.rows ?? null,
      statusReason: reason,
      lastVerified: probe?.checkedAt ?? null,
      // Only an authoritative source carrying LIVE data may feed the tree.
      admissible: e.authority === "authoritative" && status === "LIVE",
    };
  });
}

/* ------------------------------------------------------------ tree gatekeeper */

export interface RevenueTreeGate {
  /** May the authoritative Revenue Tree be built and shown as fact? */
  cleared: boolean;
  verdict: string;
  blockers: string[];
  admissibleSources: string[];
  /** Work required before the gate can clear, in dependency order. */
  requiredWork: string[];
}

/**
 * The Revenue Tree is blocked until at least one authoritative source carries
 * LIVE data. This function is intentionally conservative: an empty result is a
 * blocker, never a zero.
 */
export function revenueTreeGate(assessed: readonly AssessedEntry[]): RevenueTreeGate {
  const admissible = assessed.filter((a) => a.admissible);
  const blockers: string[] = [];

  const recognition = assessed.filter((a) => a.authority === "recognition_candidate");
  for (const r of recognition) {
    if (r.status !== "LIVE") {
      blockers.push(`${r.sourceTable} is the designated recognition layer but reports ${r.status} — ${r.statusReason}`);
    }
  }
  if (admissible.length === 0) {
    blockers.push("No source is classified authoritative, so no number may be presented as TaxiD revenue");
  }
  const forbidden = assessed.filter((a) => a.authority === "forbidden").map((a) => a.sourceTable);
  if (forbidden.length > 0) {
    blockers.push(`Sources that must never be substituted for revenue: ${forbidden.join(", ")}`);
  }

  return {
    cleared: blockers.length === 0,
    verdict: blockers.length === 0
      ? "Revenue Tree cleared: an authoritative LIVE recognition source exists."
      : "Revenue Tree BLOCKED: no authoritative LIVE revenue recognition source exists.",
    blockers,
    admissibleSources: admissible.map((a) => a.sourceTable),
    requiredWork: [
      "Confirm with Finance which accounting event constitutes TaxiD revenue recognition (completion, invoice or settlement).",
      "Build a controlled canonical revenue derivation that writes revenue_events + revenue_allocations from completed transactions, invoices, payments, settlements, refunds and adjustments, retaining source_ref traceability on every row.",
      "Reconcile every derived revenue_event to a POSTED journal and surface discrepancies as findings rather than suppressing them.",
      "Separate GMV, partner entitlement, taxes, refunds, cash collected and TaxiD recognised revenue as distinct measures in every presentation.",
      "Re-run this register; only then promote revenue_events to authority level `authoritative` and build the Revenue Tree on it.",
    ],
  };
}

/** Traceability chain every Revenue Tree number must be able to walk. */
export const TRACE_CHAIN = [
  "Metric", "Revenue event", "Transaction", "Booking", "Customer",
  "Service", "Invoice", "Payment / settlement",
] as const;
