/**
 * RENTAL OPERATIONS & CERTIFICATION — read/write surface for staff.
 *
 * Everything here reads what the database computed. Nothing in this file
 * decides availability, money, readiness or a control verdict; those are
 * owned by the rental orchestration layer in PostgreSQL. A control is only
 * ever as good as the evidence row behind it.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface ControlTower {
  active_bookings: number;
  awaiting_allocation: number;
  change_requests_open: number;
  stale_quote_holds: number;
  escalations_p0: number;
  escalations_p1: number;
  exceptions_open: number;
  refunds_pending: number;
  reconciliation_breaks: number;
  sagas_in_flight: number;
  sagas_escalated: number;
  units_available: number;
  units_under_service: number;
  units_not_ready: number;
  policies_undecided: number;
  failed_platform_events: number;
}

export interface CertificationRow {
  control_code: string;
  domain: string;
  title: string;
  requirement: string;
  evidence_kind: string;
  severity: string;
  mandatory: boolean;
  verdict: string | null;
  environment: string | null;
  executed_at: string | null;
  executed_by: string | null;
  blocked_reason: string | null;
  evidence: Record<string, unknown> | null;
  passed: boolean;
}

export interface CertificationSummary {
  controls: number;
  passed: number;
  failed: number;
  partial: number;
  blocked: number;
  not_tested: number;
  requires_external_action: number;
  certification: string;
}

export interface RentalException {
  id: string;
  exception_code: string;
  subject_type: string;
  subject_ref: string | null;
  state: string;
  severity: string;
  attempts: number;
  detail: Record<string, unknown> | null;
  resolution: string | null;
  opened_at: string;
  correlation_id: string | null;
}

export interface RentalPolicy {
  policy_code: string;
  label: string;
  evaluation_point: string;
  rule_type: string;
  state: string;
  owner_decision: string | null;
  note: string | null;
  config: Record<string, unknown> | null;
}

export interface ReadinessRow {
  unit_id: string;
  plate: string;
  status: string;
  identity_ok: boolean;
  class_ok: boolean;
  capability_ok: boolean;
  seats_ok: boolean;
  branch_ok: boolean;
  evidence_passes: number;
  mandatory_checks: number;
  outstanding_external_checks: string[] | null;
  may_be_activated: boolean;
}

export interface ReadinessCheck {
  check_code: string;
  label: string;
  mandatory: boolean;
  note: string | null;
}

export interface ReconciliationRow {
  booking_reference: string;
  quote_reference: string | null;
  booking_status: string;
  total_kes: number;
  amount_paid_kes: number;
  ledger_cash_kes: number;
  ledger_receivable_kes: number;
  provider_verified_kes: number;
  verified_payment_count: number;
  reconciliation_state: string;
  created_at: string;
}

export interface AuthorityRow {
  domain: string;
  authoritative_store: string;
  owns: string;
  may_not_write: string | null;
  notes: string | null;
}

export interface DomainEvent {
  event_uid: string;
  event_type: string;
  entity_type: string;
  entity_ref: string | null;
  correlation_id: string | null;
  occurred_at: string;
  payload: Record<string, unknown> | null;
}

export interface SagaRun {
  id: string;
  saga: string;
  subject_ref: string | null;
  state: string;
  last_error: string | null;
  started_at: string;
  closed_at: string | null;
}

export interface RefundRow {
  id: string;
  booking_id: string | null;
  amount_kes: number | null;
  reason: string | null;
  state: string;
  policy_basis: string | null;
  notes: string | null;
  created_at: string;
}

const rows = async <T,>(table: string, build: (q: unknown) => unknown): Promise<T[]> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (build(db.from(table)) as any)) as { data: T[] | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return data ?? [];
};

export async function loadControlTower(): Promise<ControlTower | null> {
  const { data, error } = await db.from("v_rental_control_tower").select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ControlTower | null;
}

export async function loadCertification(): Promise<{ controls: CertificationRow[]; summary: CertificationSummary | null }> {
  const [c, s] = await Promise.all([
    db.from("v_rental_certification").select("*").order("control_code"),
    db.from("v_rental_certification_summary").select("*").maybeSingle(),
  ]);
  if (c.error) throw new Error(c.error.message);
  if (s.error) throw new Error(s.error.message);
  return { controls: (c.data ?? []) as CertificationRow[], summary: (s.data ?? null) as CertificationSummary | null };
}

/** Release gates: a gate only clears when every control under it is proven. */
export interface ReleaseGate {
  gate_code: string;
  label: string;
  sort_order: number;
  description: string | null;
  controls: number;
  passed: number;
  failed: number;
  partial: number;
  blocked: number;
  not_tested: number;
  requires_external_action: number;
  gate_status: string;
  outstanding_controls: string[] | null;
  reasons: string[] | null;
}

export interface BusinessDecision {
  policy_code: string;
  label: string;
  evaluation_point: string;
  state: string;
  owner_decision: string | null;
  note: string | null;
  blocks_gate: string;
  blocks_control: string;
}

export interface ExternalEvidenceRow {
  control_code: string;
  title: string;
  severity: string;
  evidence_kind: string;
  verdict: string | null;
  blocked_reason: string | null;
  evidence_source: string;
}

export const loadReleaseGates = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows<ReleaseGate>("v_rental_release_gates", (q) => (q as any).select("*").order("sort_order"));

export const loadBusinessDecisions = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows<BusinessDecision>("v_rental_business_decisions", (q) => (q as any).select("*").order("policy_code"));

/** Catalogue roll-up: how each control group stands. */
export interface CatalogueGroup {
  control_group: string;
  controls: number;
  passed: number;
  failed: number;
  partial: number;
  blocked: number;
  not_tested: number;
  requires_external_action: number;
  open_p0: number;
}

export const loadCatalogueGroups = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows<CatalogueGroup>("v_rental_catalogue_groups", (q) => (q as any).select("*").order("control_group"));

export const GROUP_LABEL: Record<string, string> = {
  ARCHITECTURE: "Architecture",
  SECURITY: "Security & access",
  INVENTORY: "Fleet & inventory",
  BOOKING: "Bookings",
  PAYMENTS: "Payments",
  FINANCIAL: "Financial control",
  POLICY: "Rules & policy",
  OPERATIONS: "Operations",
  PARTNER: "Providers & partners",
  OBSERVABILITY: "Monitoring",
  RESILIENCE: "Resilience & recovery",
  COMPLIANCE: "Compliance",
  DATA_GOVERNANCE: "Data governance",
};

export const loadExternalEvidence = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows<ExternalEvidenceRow>("v_rental_external_evidence", (q) => (q as any).select("*").order("control_code"));

/** Proves the certification totals add up and every control sits in a gate. */
export async function loadCertificationConsistency(): Promise<{
  controls: number;
  verdict_sum: number;
  verdicts_add_up: boolean;
  controls_total: number;
  controls_in_a_gate: number;
  every_control_gated: boolean;
  certification: string;
  consistent: boolean;
} | null> {
  const { data, error } = await db.rpc("rental_certification_consistency");
  if (error) throw new Error(error.message);
  return (data ?? null) as never;
}

export const GATE_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PASS: "default",
  FAILED: "destructive",
  BLOCKED: "secondary",
  REQUIRES_EXTERNAL_ACTION: "outline",
  INCOMPLETE: "outline",
};

export const GATE_LABEL: Record<string, string> = {
  PASS: "Cleared",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  REQUIRES_EXTERNAL_ACTION: "Needs outside evidence",
  INCOMPLETE: "Not yet tested",
};

export const loadExceptions = () =>
  rows<RentalException>("rental_exceptions", (q) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).select("*").order("opened_at", { ascending: false }).limit(200));

export const loadPolicies = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows<RentalPolicy>("rental_policies", (q) => (q as any).select("*").order("policy_code"));

export const loadReadiness = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows<ReadinessRow>("v_rental_unit_readiness", (q) => (q as any).select("*").order("plate"));

export const loadReadinessChecks = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows<ReadinessCheck>("rental_unit_readiness_checks", (q) => (q as any).select("*").order("check_code"));

export const loadReconciliation = () =>
  rows<ReconciliationRow>("v_rental_reconciliation", (q) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).select("*").order("created_at", { ascending: false }).limit(200));

export const loadAuthority = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows<AuthorityRow>("rental_domain_authority", (q) => (q as any).select("*").order("domain"));

export const loadDomainEvents = () =>
  rows<DomainEvent>("rental_domain_events", (q) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).select("event_uid,event_type,entity_type,entity_ref,correlation_id,occurred_at,payload")
      .order("occurred_at", { ascending: false }).limit(100));

export const loadSagas = () =>
  rows<SagaRun>("rental_saga_runs", (q) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).select("*").order("started_at", { ascending: false }).limit(100));

export const loadRefunds = () =>
  rows<RefundRow>("rental_refunds", (q) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).select("*").order("created_at", { ascending: false }).limit(100));

const call = async (fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; message?: string; body?: Record<string, unknown> }> => {
  const { data, error } = await db.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  const body = (data ?? {}) as Record<string, unknown>;
  if (body.ok === false) {
    const code = String(body.reason_code ?? body.reason ?? "REFUSED");
    return { ok: false, message: HUMAN[code] ?? code.split("_").join(" ").toLowerCase(), body };
  }
  return { ok: true, body };
};

const HUMAN: Record<string, string> = {
  NOT_AUTHORISED: "You do not have permission for this.",
  RENTAL_UNIT_READINESS_INCOMPLETE: "This vehicle has not passed every readiness check yet.",
  RECORD_HANDOVER_EVIDENCE_FIRST: "Record the handover details before changing the booking.",
  POLICY_REQUIRED: "This needs a written policy decision from you first.",
  REFUND_AMOUNT_REQUIRED: "Set the refund amount and the policy it rests on.",
  BOOKING_NOT_FOUND: "That booking no longer exists.",
};

/** Resolve an exception a human had to judge. */
export const resolveException = (id: string, resolution: string) =>
  call("rental_exception_staff_resolve", { _exception_id: id, _resolution: resolution });

/** Capture the physical handover: this is what unlocks pickup and return. */
export const recordHandover = (input: {
  bookingReference: string;
  direction: "PICKUP" | "RETURN";
  location: string;
  odometerKm: number;
  fuelLevel: string;
  conditionNote: string;
  customerName: string;
  damageFound: boolean;
}) =>
  call("rental_record_handover", {
    _booking_reference: input.bookingReference,
    _direction: input.direction,
    _location: input.location,
    _odometer_km: input.odometerKm,
    _fuel_level: input.fuelLevel,
    _condition_note: input.conditionNote,
    _customer_name: input.customerName,
    _damage_found: input.damageFound,
  });

export const decideRefund = (input: {
  refundId: string;
  decision: "AUTHORISE" | "DECLINE";
  amountKes?: number;
  policyBasis?: string;
  note?: string;
}) =>
  call("rental_refund_decide", {
    _refund_id: input.refundId,
    _decision: input.decision,
    _amount_kes: input.amountKes ?? null,
    _policy_basis: input.policyBasis ?? null,
    _note: input.note ?? null,
  });

/** Record one readiness check result against a vehicle. */
export async function recordReadinessEvidence(input: {
  unitId: string;
  checkCode: string;
  verdict: "PASS" | "FAIL";
  evidence: string;
  documentRef?: string;
  validUntil?: string;
}): Promise<{ ok: boolean; message?: string }> {
  const { data: me } = await supabase.auth.getUser();
  const { error } = await db.from("rental_unit_readiness_evidence").insert({
    unit_id: input.unitId,
    check_code: input.checkCode,
    verdict: input.verdict,
    evidence: input.evidence,
    document_ref: input.documentRef || null,
    valid_until: input.validUntil || null,
    recorded_by: me?.user?.id ?? null,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export const VERDICT_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PASS: "default",
  PARTIAL: "secondary",
  BLOCKED: "secondary",
  NOT_TESTED: "outline",
  REQUIRES_EXTERNAL_ACTION: "outline",
  FAIL: "destructive",
};

export const VERDICT_LABEL: Record<string, string> = {
  PASS: "Proven",
  PARTIAL: "Partly proven",
  BLOCKED: "Blocked",
  NOT_TESTED: "Not tested yet",
  REQUIRES_EXTERNAL_ACTION: "Needs outside evidence",
  FAIL: "Failed",
};

/* ============================================================
 * POLICY GOVERNANCE — versioned, effective-dated, approval-gated
 * ============================================================ */
export interface PolicyVersion {
  id: string;
  policy_code: string;
  version: number;
  rule_type: string;
  scope: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  effective_from: string;
  effective_to: string | null;
  state: "PENDING_BUSINESS_APPROVAL" | "ACTIVE" | "SUPERSEDED" | "REJECTED";
  proposed_basis: string | null;
  approval_authority: string | null;
  approved_at: string | null;
  approval_note: string | null;
  created_at: string;
}

export interface PolicyDecision {
  id: string;
  evaluation_point: string;
  policy_code: string;
  policy_version: number | null;
  version_state: string | null;
  rule_type: string | null;
  subject_type: string | null;
  subject_ref: string | null;
  input: Record<string, unknown> | null;
  decision: string;
  reason: string | null;
  binding: boolean;
  actor_kind: string;
  decided_at: string;
}

export const POLICY_STATE_LABEL: Record<string, string> = {
  PENDING_BUSINESS_APPROVAL: "Awaiting your approval",
  ACTIVE: "In force",
  SUPERSEDED: "Replaced",
  REJECTED: "Rejected",
};

export const loadPolicyVersions = () =>
  rows<PolicyVersion>("rental_policy_versions", (q) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).select("*").order("policy_code").order("version", { ascending: false }));

export const loadPolicyDecisions = () =>
  rows<PolicyDecision>("rental_policy_decisions", (q) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).select("*").order("decided_at", { ascending: false }).limit(200));

export const decidePolicyVersion = (policyCode: string, version: number, decision: "APPROVE" | "REJECT", note?: string) =>
  call("rental_policy_version_decide", {
    _policy_code: policyCode, _version: version, _decision: decision, _note: note ?? null,
  });

/* ============================================================
 * EXCEPTION SLA — class, owner, deadline, escalation
 * ============================================================ */
export interface ExceptionSla {
  id: string;
  exception_code: string;
  label: string | null;
  severity: string;
  decision_class: string | null;
  state: string;
  subject_type: string;
  subject_ref: string | null;
  owner_role: string | null;
  escalated_to: string | null;
  opened_at: string;
  sla_due_at: string | null;
  resolved_at: string | null;
  sla_status: string;
  minutes_remaining: number | null;
  minutes_to_resolve: number | null;
  detail: Record<string, unknown> | null;
  resolution: string | null;
}

export const DECISION_CLASS_LABEL: Record<string, string> = {
  AUTOMATED: "System resolves",
  HUMAN_REVIEW: "Needs a person",
  APPROVAL_REQUIRED: "Needs approval",
  SYSTEM_EXCEPTION: "System cannot continue",
};

export const SLA_LABEL: Record<string, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  BREACHED: "Past deadline",
  RESOLVED: "Resolved",
  NO_SLA: "No deadline set",
};

export const loadExceptionSla = () =>
  rows<ExceptionSla>("v_rental_exception_sla", (q) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).select("*").order("opened_at", { ascending: false }).limit(200));

/* ============================================================
 * CORPORATE CONTROL — exposure, credit, approvals
 * ============================================================ */
export interface CorporateExposure {
  account_id: string;
  account_code: string;
  legal_name: string;
  status: string;
  credit_state: string;
  credit_limit_kes: number;
  payment_terms_days: number;
  auto_approve_below_kes: number | null;
  elevated_approval_above_kes: number | null;
  outstanding_kes: number;
  available_credit_kes: number;
  overdue_kes: number;
  bookings: number;
  pending_approvals: number;
}

export interface CorporateApproval {
  id: string;
  account_id: string;
  quote_reference: string | null;
  booking_reference: string | null;
  amount_kes: number;
  required_level: string;
  state: string;
  reason: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

export const APPROVAL_LEVEL_LABEL: Record<string, string> = {
  AUTO_APPROVED: "Within policy",
  DESIGNATED_APPROVER: "Company approver",
  ELEVATED_APPROVAL: "Elevated approval",
};

export const loadCorporateExposure = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows<CorporateExposure>("v_rental_corporate_exposure", (q) => (q as any).select("*").order("legal_name"));

export const loadCorporateApprovals = () =>
  rows<CorporateApproval>("rental_corporate_approvals", (q) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).select("*").order("created_at", { ascending: false }).limit(100));

export const decideCorporateApproval = (approvalId: string, decision: "APPROVE" | "REJECT", note?: string) =>
  call("rental_corporate_approval_decide", {
    _approval_id: approvalId, _decision: decision, _note: note ?? null,
  });

/* ============================================================
 * BOOKING TRUTH — one authoritative read of a single booking
 * ============================================================ */
export async function loadBookingTruth(reference: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db.rpc("rental_booking_truth", { _reference: reference });
  if (error) throw new Error(error.message);
  return (data ?? null) as Record<string, unknown> | null;
}
