/**
 * LOGISTICS PRODUCTION READINESS — AUTHORITATIVE REGISTERS.
 *
 * These registers hold the NON-CODE evidence requirements of the logistics
 * production gate: legal determinations, operating procedures, goods policy,
 * exception taxonomy, reconciliation controls, commercial/financial acceptance,
 * partner compliance evidence, support model and pilot scenarios.
 *
 * ABSOLUTE RULE: nothing here may be marked satisfied because a file, table,
 * boolean or UI exists. A legal control becomes satisfied only when an
 * authorised human approval is recorded; an operational control only when an
 * approved SOP owner signs off; a pilot control only when the scenario has
 * actually been executed and evidence recorded.
 */

export type ControlStatus =
  | "PASS"
  | "HOLD"
  | "FAIL"
  | "BLOCKED"
  | "NOT_TESTED"
  | "BUSINESS_APPROVAL_REQUIRED"
  | "EXPIRED";

export type Owner =
  | "engineering"
  | "security"
  | "finance"
  | "legal"
  | "operations"
  | "commercial"
  | "support";

/* ------------------------------- legal register ------------------------------ */

export interface LegalControlRecord {
  id: string;
  subject: string;
  /** Authoritative document reference. null = no document of record. */
  document: string | null;
  authority: string | null;
  jurisdiction: string;
  effective_at: string | null;
  expiry_at: string | null;
  owner: Owner;
  legal_approver: string | null;
  approved_at: string | null;
}

/**
 * No legal determination is recorded anywhere in the system of record, so every
 * document/approver field is deliberately null. Software must never decide
 * legal status.
 */
export const LEGAL_REGISTER: LegalControlRecord[] = [
  "Courier / parcel operating licence determination for SAFARID as principal",
  "Transport operator requirements (PSV / commercial goods carriage)",
  "Courier personnel requirements (identity, vetting, right to work)",
  "Vehicle requirements (inspection, roadworthiness, category fitness)",
  "Insurance / protection cover for goods handled by SAFARID",
  "Goods-in-transit cover scope, limits and exclusions",
  "Restricted goods policy approval",
  "Prohibited goods policy approval",
  "Claims handling policy and evidentiary standard",
  "Liability limits and limitation of liability wording",
  "Customer terms of carriage",
  "Partner / courier contractual terms",
  "Privacy notice and lawful basis for shipment personal data",
  "Data handling, retention and cross-border transfer",
  "Cross-border / regional carriage requirements",
].map((subject, i) => ({
  id: `LG-${String(i + 1).padStart(2, "0")}`,
  subject,
  document: null,
  authority: null,
  jurisdiction: "KE",
  effective_at: null,
  expiry_at: null,
  owner: "legal" as Owner,
  legal_approver: null,
  approved_at: null,
}));

export function legalStatus(rec: LegalControlRecord, now = new Date()): ControlStatus {
  if (!rec.document || !rec.legal_approver || !rec.approved_at) return "BUSINESS_APPROVAL_REQUIRED";
  if (rec.expiry_at && new Date(rec.expiry_at) < now) return "EXPIRED";
  return "PASS";
}

/* --------------------------- operations SOP register ------------------------- */

export interface OperationsProcess {
  id: string;
  process: string;
  /** Does an authoritative system capability exist today (code/table/RPC)? */
  system_capability: string;
  sop_document: string | null;
  sop_approved_by: string | null;
  owner: Owner;
  sla: string | null;
  escalation: string | null;
  audit_requirement: string;
  training_completed: boolean;
  exception_procedure: string;
}

const P = (
  process: string,
  system_capability: string,
  owner: Owner,
  audit_requirement: string,
  exception_procedure: string,
): Omit<OperationsProcess, "id"> => ({
  process,
  system_capability,
  sop_document: null,
  sop_approved_by: null,
  owner,
  sla: null,
  escalation: null,
  audit_requirement,
  training_completed: false,
  exception_procedure,
});

export const OPERATIONS_PROCESSES: OperationsProcess[] = [
  P("ORDER INTAKE", "serviceCatalogue offerings + booking intake", "operations", "intake event per order", "refuse unsupported serviceability"),
  P("QUOTE", "quote.ts immutable snapshot + ratePlan version binding", "commercial", "quote snapshot retained", "manual quote requires approval"),
  P("BOOKING", "booking acceptance bound to accepted quote", "operations", "acceptance event", "cancel with reason code"),
  P("SHIPMENT CREATION", "shipment entity + state machine", "operations", "creation event", "abort with reason code"),
  P("PACKAGE CREATION", "package entity + tracking number uniqueness", "operations", "package ledger", "duplicate tracking refused"),
  P("ROUTE PLANNING", "route plan + stops entities", "operations", "plan version", "replan with reason"),
  P("DISPATCH", "dispatch offers + assignment concurrency guard", "operations", "assignment event", "reoffer on rejection"),
  P("PICKUP", "custody transfer PARTNER→COURIER", "operations", "custody event", "failed pickup exception"),
  P("CUSTODY", "custody.ts chain validation", "operations", "custody chain", "custody break exception"),
  P("IN-TRANSIT", "tracking projection (read-only)", "operations", "tracking events", "tracking failure exception"),
  P("DELIVERY ATTEMPT", "delivery attempt entity + outcome reason codes", "operations", "attempt record", "reattempt policy"),
  P("POD", "POD capture + immutability design", "operations", "POD artefact", "POD failure exception"),
  P("FAILED DELIVERY", "failure reason codes + return decision", "operations", "failure record", "return workflow"),
  P("RETURN", "return lifecycle with custody + financial lineage", "operations", "return chain", "return exception"),
  P("CLAIM", "claim candidate → eligibility → decision", "support", "claim file", "policy-in-force evaluation"),
  P("REFUND", "billing evaluation + refund treatment", "finance", "refund ledger", "manual review"),
  P("RECONCILIATION", "reconciliation chain controls", "finance", "daily reconciliation run", "exception queue"),
  P("SETTLEMENT", "partner payable + settlement lineage", "finance", "settlement batch", "hold on mismatch"),
  P("CUSTOMER SUPPORT", "support ticket states + SLA classes", "support", "ticket audit trail", "escalation matrix"),
  P("PARTNER SUPPORT", "partner ticketing workspace", "support", "ticket audit trail", "escalation matrix"),
  P("INCIDENT MANAGEMENT", "incident severity classes + post-incident review", "operations", "incident record", "P1 escalation"),
].map((p, i) => ({ id: `OP-${String(i + 1).padStart(2, "0")}`, ...p }));

export function operationsStatus(p: OperationsProcess): ControlStatus {
  if (!p.sop_document || !p.sop_approved_by) return "BUSINESS_APPROVAL_REQUIRED";
  if (!p.sla || !p.escalation || !p.training_completed) return "HOLD";
  return "PASS";
}

/* ----------------------------- goods policy engine --------------------------- */

export type GoodsCategory = "PROHIBITED" | "RESTRICTED" | "CONDITIONAL" | "STANDARD";

export interface GoodsPolicy {
  code: string;
  label: string;
  category: GoodsCategory;
  jurisdiction: string;
  requires_documentation: string[];
  requires_approval: boolean;
  handling_requirement: string | null;
  vehicle_requirement: string | null;
  partner_requirement: string | null;
  protection_requirement: string | null;
  escalation: string | null;
  refusal_reason: string | null;
  /** Legal approval of this classification. Null = not legally approved. */
  legal_approval: { approver: string; approved_at: string } | null;
}

export const GOODS_POLICIES: GoodsPolicy[] = [
  {
    code: "GEN_MERCH", label: "General merchandise", category: "STANDARD", jurisdiction: "KE",
    requires_documentation: [], requires_approval: false, handling_requirement: null, vehicle_requirement: null,
    partner_requirement: "valid partner compliance evidence", protection_requirement: null, escalation: null,
    refusal_reason: null, legal_approval: null,
  },
  {
    code: "HIGH_VALUE", label: "High-value goods", category: "CONDITIONAL", jurisdiction: "KE",
    requires_documentation: ["declared value", "commercial invoice"], requires_approval: true,
    handling_requirement: "sealed handover, two-person POD", vehicle_requirement: "enclosed vehicle",
    partner_requirement: "vetted partner", protection_requirement: "goods-in-transit cover in force",
    escalation: "operations manager", refusal_reason: "value exceeds approved cover", legal_approval: null,
  },
  {
    code: "PHARMA", label: "Pharmaceuticals", category: "RESTRICTED", jurisdiction: "KE",
    requires_documentation: ["pharmacy licence", "consignment note"], requires_approval: true,
    handling_requirement: "temperature control", vehicle_requirement: "cold chain",
    partner_requirement: "licensed handler", protection_requirement: "cover with pharma endorsement",
    escalation: "compliance", refusal_reason: "handler not licensed", legal_approval: null,
  },
  {
    code: "ALCOHOL", label: "Alcoholic beverages", category: "RESTRICTED", jurisdiction: "KE",
    requires_documentation: ["excise/licence evidence", "recipient age verification"], requires_approval: true,
    handling_requirement: "adult signature POD", vehicle_requirement: null,
    partner_requirement: "licensed distribution partner", protection_requirement: null,
    escalation: "compliance", refusal_reason: "licence evidence missing", legal_approval: null,
  },
  {
    code: "HAZMAT", label: "Dangerous / hazardous goods", category: "PROHIBITED", jurisdiction: "KE",
    requires_documentation: [], requires_approval: false, handling_requirement: null, vehicle_requirement: null,
    partner_requirement: null, protection_requirement: null, escalation: "refuse at intake",
    refusal_reason: "dangerous goods are not carried", legal_approval: null,
  },
  {
    code: "CASH_BULLION", label: "Cash, bullion, bearer instruments", category: "PROHIBITED", jurisdiction: "KE",
    requires_documentation: [], requires_approval: false, handling_requirement: null, vehicle_requirement: null,
    partner_requirement: null, protection_requirement: null, escalation: "refuse at intake",
    refusal_reason: "cash-in-transit is out of scope", legal_approval: null,
  },
  {
    code: "LIVE_ANIMALS", label: "Live animals", category: "PROHIBITED", jurisdiction: "KE",
    requires_documentation: [], requires_approval: false, handling_requirement: null, vehicle_requirement: null,
    partner_requirement: null, protection_requirement: null, escalation: "refuse at intake",
    refusal_reason: "live animals are not carried", legal_approval: null,
  },
  {
    code: "FRAGILE", label: "Fragile goods", category: "CONDITIONAL", jurisdiction: "KE",
    requires_documentation: ["packaging declaration"], requires_approval: false,
    handling_requirement: "fragile handling", vehicle_requirement: null, partner_requirement: null,
    protection_requirement: "damage cover if guaranteed", escalation: "operations",
    refusal_reason: "inadequate packaging", legal_approval: null,
  },
];

export interface GoodsDispatchRequest {
  goods_code: string;
  documents_present: string[];
  approval_recorded: boolean;
  handling_confirmed: boolean;
  vehicle_conforms: boolean;
  partner_conforms: boolean;
  protection_in_force: boolean;
  jurisdiction: string;
}

export interface GoodsDispatchVerdict {
  allowed: boolean;
  category: GoodsCategory | "UNKNOWN";
  refusals: string[];
  escalation: string | null;
}

/** Blocks dispatch whenever a mandatory condition of the goods policy is unmet. */
export function evaluateGoodsDispatch(req: GoodsDispatchRequest): GoodsDispatchVerdict {
  const policy = GOODS_POLICIES.find((g) => g.code === req.goods_code);
  if (!policy) {
    return { allowed: false, category: "UNKNOWN", refusals: ["Unclassified goods: manual review required before dispatch."], escalation: "compliance" };
  }
  const refusals: string[] = [];
  if (policy.category === "PROHIBITED") refusals.push(policy.refusal_reason ?? "Prohibited goods.");
  if (policy.jurisdiction !== req.jurisdiction) refusals.push(`No approved classification for jurisdiction ${req.jurisdiction}.`);
  for (const doc of policy.requires_documentation) {
    if (!req.documents_present.includes(doc)) refusals.push(`Missing mandatory document: ${doc}.`);
  }
  if (policy.requires_approval && !req.approval_recorded) refusals.push("Approval not recorded.");
  if (policy.handling_requirement && !req.handling_confirmed) refusals.push(`Handling requirement unmet: ${policy.handling_requirement}.`);
  if (policy.vehicle_requirement && !req.vehicle_conforms) refusals.push(`Vehicle requirement unmet: ${policy.vehicle_requirement}.`);
  if (policy.partner_requirement && !req.partner_conforms) refusals.push(`Partner requirement unmet: ${policy.partner_requirement}.`);
  if (policy.protection_requirement && !req.protection_in_force) refusals.push(`Protection requirement unmet: ${policy.protection_requirement}.`);
  return { allowed: refusals.length === 0, category: policy.category, refusals, escalation: refusals.length ? policy.escalation : null };
}

/** A goods policy is only production-ready once legal has approved the classification. */
export function goodsPolicyStatus(): { status: ControlStatus; unapproved: string[] } {
  const unapproved = GOODS_POLICIES.filter((g) => !g.legal_approval).map((g) => g.code);
  return { status: unapproved.length === 0 ? "PASS" : "BUSINESS_APPROVAL_REQUIRED", unapproved };
}

/* ---------------------------- exception framework ---------------------------- */

export type ExceptionSeverity = "S1" | "S2" | "S3";

export interface ExceptionSpec {
  exception_code: string;
  severity: ExceptionSeverity;
  detected_by: "system" | "courier" | "customer" | "partner" | "agent";
  owner: Owner;
  sla_minutes: number;
  customer_impact: string;
  financial_impact: string;
  escalation_level: 1 | 2 | 3;
  audit_requirement: string;
}

export const EXCEPTION_CATALOGUE: ExceptionSpec[] = [
  { exception_code: "UNASSIGNED_SHIPMENT", severity: "S2", detected_by: "system", owner: "operations", sla_minutes: 30, customer_impact: "pickup delay", financial_impact: "none until SLA breach", escalation_level: 2, audit_requirement: "dispatch attempts logged" },
  { exception_code: "COURIER_REJECTED", severity: "S3", detected_by: "courier", owner: "operations", sla_minutes: 15, customer_impact: "none if reoffered", financial_impact: "none", escalation_level: 1, audit_requirement: "rejection reason code" },
  { exception_code: "COURIER_NO_SHOW", severity: "S2", detected_by: "system", owner: "operations", sla_minutes: 20, customer_impact: "pickup delay", financial_impact: "possible SLA credit", escalation_level: 2, audit_requirement: "no-show evidence" },
  { exception_code: "VEHICLE_FAILURE", severity: "S2", detected_by: "courier", owner: "operations", sla_minutes: 30, customer_impact: "delivery delay", financial_impact: "reassignment cost", escalation_level: 2, audit_requirement: "incident record" },
  { exception_code: "PICKUP_DELAY", severity: "S3", detected_by: "system", owner: "operations", sla_minutes: 30, customer_impact: "delay notice", financial_impact: "none", escalation_level: 1, audit_requirement: "timestamped attempts" },
  { exception_code: "WRONG_ADDRESS", severity: "S2", detected_by: "courier", owner: "support", sla_minutes: 30, customer_impact: "redelivery", financial_impact: "additional attempt charge", escalation_level: 2, audit_requirement: "address correction trail" },
  { exception_code: "CUSTOMER_UNAVAILABLE", severity: "S3", detected_by: "courier", owner: "support", sla_minutes: 60, customer_impact: "reattempt", financial_impact: "reattempt charge policy", escalation_level: 1, audit_requirement: "attempt evidence" },
  { exception_code: "DAMAGED_PACKAGE", severity: "S1", detected_by: "courier", owner: "support", sla_minutes: 60, customer_impact: "claim candidate", financial_impact: "claim exposure", escalation_level: 3, audit_requirement: "photo evidence + custody chain" },
  { exception_code: "LOST_PACKAGE", severity: "S1", detected_by: "system", owner: "support", sla_minutes: 120, customer_impact: "claim candidate", financial_impact: "claim exposure", escalation_level: 3, audit_requirement: "last custody holder" },
  { exception_code: "FAILED_DELIVERY", severity: "S2", detected_by: "courier", owner: "operations", sla_minutes: 60, customer_impact: "return decision", financial_impact: "return cost", escalation_level: 2, audit_requirement: "failure reason code" },
  { exception_code: "TRACKING_FAILURE", severity: "S3", detected_by: "system", owner: "engineering", sla_minutes: 60, customer_impact: "visibility loss", financial_impact: "none", escalation_level: 1, audit_requirement: "projection lag metric" },
  { exception_code: "POD_FAILURE", severity: "S1", detected_by: "system", owner: "operations", sla_minutes: 60, customer_impact: "delivery disputed", financial_impact: "billing blocked", escalation_level: 3, audit_requirement: "POD artefact audit" },
  { exception_code: "PAYMENT_FAILURE", severity: "S2", detected_by: "system", owner: "finance", sla_minutes: 30, customer_impact: "booking blocked", financial_impact: "revenue at risk", escalation_level: 2, audit_requirement: "callback ledger" },
];

/* -------------------------- reconciliation controls -------------------------- */

export const RECONCILIATION_CHAIN = [
  "SHIPMENT", "DELIVERY", "POD", "CHARGE", "INVOICE", "PAYMENT", "PARTNER_PAYABLE", "YALLA_REVENUE", "SETTLEMENT",
] as const;

export interface ReconciliationRow {
  shipment_id: string;
  delivered: boolean;
  pod_id: string | null;
  charge_id: string | null;
  charge_amount_kes: number | null;
  invoice_id: string | null;
  invoice_amount_kes: number | null;
  payment_ids: string[];
  payment_amount_kes: number;
  partner_payable_kes: number | null;
  revenue_kes: number | null;
  settlement_id: string | null;
}

export type ReconciliationAnomaly =
  | "MISSING_INVOICE"
  | "DUPLICATE_PAYMENT"
  | "UNMATCHED_PAYMENT"
  | "UNMATCHED_DELIVERY"
  | "WRONG_CHARGE"
  | "WRONG_SETTLEMENT"
  | "PARTNER_PAYABLE_MISMATCH"
  | "REVENUE_MISMATCH";

export interface ReconciliationFinding {
  shipment_id: string;
  anomaly: ReconciliationAnomaly;
  detail: string;
}

/** Daily reconciliation control — traceable forwards and backwards along the chain. */
export function reconcileRows(rows: ReconciliationRow[]): { findings: ReconciliationFinding[]; clean: boolean } {
  const findings: ReconciliationFinding[] = [];
  const add = (shipment_id: string, anomaly: ReconciliationAnomaly, detail: string) =>
    findings.push({ shipment_id, anomaly, detail });

  for (const r of rows) {
    if (r.delivered && !r.pod_id) add(r.shipment_id, "UNMATCHED_DELIVERY", "Delivered without a POD reference.");
    if (r.delivered && r.pod_id && !r.charge_id) add(r.shipment_id, "WRONG_CHARGE", "POD exists but no charge was raised.");
    if (r.charge_id && !r.invoice_id) add(r.shipment_id, "MISSING_INVOICE", "Charge is not linked to an invoice.");
    if (r.charge_amount_kes !== null && r.invoice_amount_kes !== null && r.charge_amount_kes !== r.invoice_amount_kes) {
      add(r.shipment_id, "WRONG_CHARGE", `Charge ${r.charge_amount_kes} ≠ invoice ${r.invoice_amount_kes}.`);
    }
    if (new Set(r.payment_ids).size !== r.payment_ids.length) add(r.shipment_id, "DUPLICATE_PAYMENT", "Repeated payment identifier on one invoice.");
    if (r.payment_amount_kes > 0 && !r.invoice_id) add(r.shipment_id, "UNMATCHED_PAYMENT", "Payment received with no invoice.");
    if (r.invoice_amount_kes !== null && r.payment_amount_kes > r.invoice_amount_kes) {
      add(r.shipment_id, "DUPLICATE_PAYMENT", `Paid ${r.payment_amount_kes} against invoice ${r.invoice_amount_kes}.`);
    }
    if (r.invoice_amount_kes !== null && r.partner_payable_kes !== null && r.revenue_kes !== null) {
      const sum = Math.round((r.partner_payable_kes + r.revenue_kes) * 100) / 100;
      if (sum !== r.invoice_amount_kes) add(r.shipment_id, "PARTNER_PAYABLE_MISMATCH", `Payable + revenue ${sum} ≠ invoice ${r.invoice_amount_kes}.`);
      if (r.revenue_kes < 0) add(r.shipment_id, "REVENUE_MISMATCH", "Negative revenue on a delivered shipment.");
    }
    if (r.settlement_id && r.payment_amount_kes === 0) add(r.shipment_id, "WRONG_SETTLEMENT", "Settled without a received payment.");
  }
  return { findings, clean: findings.length === 0 };
}

/* ------------------------- commercial / financial regs ----------------------- */

export interface AcceptanceRecord {
  id: string;
  requirement: string;
  owner: Owner;
  /** Signed acceptance by the accountable owner. Null = not accepted. */
  accepted_by: string | null;
  accepted_at: string | null;
  evidence: string | null;
}

const acc = (id: string, requirement: string, owner: Owner): AcceptanceRecord => ({
  id, requirement, owner, accepted_by: null, accepted_at: null, evidence: null,
});

export const COMMERCIAL_REGISTER: AcceptanceRecord[] = [
  acc("CM-01", "Service catalogue: every BOOKABLE offering has an approved commercial owner", "commercial"),
  acc("CM-02", "Rate plans and versions approved with effective dates", "commercial"),
  acc("CM-03", "Pricing rules and serviceability approved per offering", "commercial"),
  acc("CM-04", "Customer terms published and referenced at booking", "legal"),
  acc("CM-05", "Partner pricing, commission and settlement model approved", "commercial"),
  acc("CM-06", "Refund, cancellation and claims financial treatment approved", "finance"),
  acc("CM-07", "No unsupported service is exposed as BOOKABLE", "commercial"),
];

export const FINANCIAL_REGISTER: AcceptanceRecord[] = [
  acc("FN-01", "M-Pesa collection verified end-to-end in staging with callback ledger", "finance"),
  acc("FN-02", "Card / corporate account collection verified", "finance"),
  acc("FN-03", "Invoice issuance and immutable lineage verified", "finance"),
  acc("FN-04", "Refund path verified with audit trail", "finance"),
  acc("FN-05", "Payment failure and duplicate callback handling verified", "finance"),
  acc("FN-06", "Daily reconciliation control operating with owned exception queue", "finance"),
  acc("FN-07", "Partner payable and SAFARID revenue split reconciled", "finance"),
  acc("FN-08", "Settlement batch approval and audit verified", "finance"),
];

export const SUPPORT_REGISTER: AcceptanceRecord[] = [
  acc("SP-01", "Support states OPEN→CLOSED operating with owners", "support"),
  acc("SP-02", "P1–P4 incident classes with response SLAs staffed", "support"),
  acc("SP-03", "Escalation and customer communication templates approved", "support"),
  acc("SP-04", "Post-incident review process operating", "operations"),
];

export function acceptanceStatus(r: AcceptanceRecord): ControlStatus {
  return r.accepted_by && r.accepted_at && r.evidence ? "PASS" : "BUSINESS_APPROVAL_REQUIRED";
}

/* --------------------------- support / incident model ------------------------ */

export const SUPPORT_STATES = [
  "OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ESCALATED", "WAITING_CUSTOMER", "WAITING_PARTNER", "RESOLVED", "CLOSED",
] as const;

export const INCIDENT_CLASSES = [
  { code: "P1", response_minutes: 15, description: "Service down, money at risk, or safety exposure" },
  { code: "P2", response_minutes: 60, description: "Major degradation with customer impact" },
  { code: "P3", response_minutes: 240, description: "Single-shipment or partial impact" },
  { code: "P4", response_minutes: 1440, description: "Cosmetic or informational" },
] as const;

/* --------------------------- partner compliance gate ------------------------- */

export interface PartnerEvidence {
  kind:
    | "IDENTITY"
    | "OPERATING_LICENCE"
    | "VEHICLE_REGISTRATION"
    | "VEHICLE_INSPECTION"
    | "PROTECTION_COVER"
    | "COURIER_DOCUMENT";
  /** Reference to the stored artefact. A boolean flag is never sufficient. */
  document_ref: string | null;
  verified_by: string | null;
  verified_at: string | null;
  expiry_at: string | null;
}

export interface PartnerDispatchEligibilityInput {
  partner_id: string;
  evidence: PartnerEvidence[];
  required_kinds: PartnerEvidence["kind"][];
  service_capability: string[];
  geographic_capability: string[];
  requested_service: string;
  requested_area: string;
  now?: string;
}

export interface PartnerDispatchEligibility {
  eligible: boolean;
  blockers: string[];
}

/** Missing, unverified or expired mandatory evidence must prevent dispatch. */
export function evaluatePartnerDispatchEligibility(i: PartnerDispatchEligibilityInput): PartnerDispatchEligibility {
  const now = new Date(i.now ?? new Date().toISOString());
  const blockers: string[] = [];
  for (const kind of i.required_kinds) {
    const e = i.evidence.find((x) => x.kind === kind);
    if (!e) { blockers.push(`${kind}: no evidence on record.`); continue; }
    if (!e.document_ref) blockers.push(`${kind}: verification flag without a document reference.`);
    if (!e.verified_by || !e.verified_at) blockers.push(`${kind}: not verified by an accountable reviewer.`);
    if (e.expiry_at && new Date(e.expiry_at) < now) blockers.push(`${kind}: expired on ${e.expiry_at}.`);
  }
  if (!i.service_capability.includes(i.requested_service)) blockers.push(`Service capability missing: ${i.requested_service}.`);
  if (!i.geographic_capability.includes(i.requested_area)) blockers.push(`Geographic capability missing: ${i.requested_area}.`);
  return { eligible: blockers.length === 0, blockers };
}

/* ------------------------------ pilot scenarios ------------------------------ */

export interface PilotScenario {
  id: string;
  scenario: string;
  expected_outcome: string;
  /** Recorded evidence of an executed pilot run. Null = never executed. */
  execution: { executed_at: string; evidence_ref: string; result: "PASS" | "FAIL" } | null;
}

export const PILOT_SCENARIOS: PilotScenario[] = [
  ["normal delivery", "delivered, POD captured, charge → invoice → payment reconciled"],
  ["failed pickup", "pickup exception raised, reoffer or cancellation with reason code"],
  ["failed delivery", "failure reason recorded, return decision taken"],
  ["customer unavailable", "reattempt policy applied, customer notified"],
  ["wrong address", "address correction trail, redelivery charge policy applied"],
  ["damaged package", "claim candidate opened with photo and custody evidence"],
  ["lost package", "claim candidate opened against last custody holder"],
  ["return", "return custody and financial lineage retained to closure"],
  ["claim", "eligibility evaluated against the policy in force, decision audited"],
  ["refund", "refund issued with immutable lineage to the original payment"],
  ["payment failure", "booking blocked, no shipment created, retry succeeds"],
  ["duplicate payment", "exactly one authoritative payment effect"],
  ["courier cancellation", "reassignment without duplicate authoritative assignment"],
  ["vehicle failure", "incident raised, shipment reassigned, SLA impact recorded"],
  ["network outage", "queued events reconcile with no duplicate side effects"],
  ["tracking interruption", "projection lag detected and alerted, no state corruption"],
  ["POD failure", "billing blocked until POD is resolved"],
].map(([scenario, expected_outcome], i) => ({
  id: `PL-${String(i + 1).padStart(2, "0")}`,
  scenario,
  expected_outcome,
  execution: null,
}));

export function pilotStatus(s: PilotScenario): ControlStatus {
  if (!s.execution) return "NOT_TESTED";
  return s.execution.result === "PASS" ? "PASS" : "FAIL";
}
