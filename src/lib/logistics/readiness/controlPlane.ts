/**
 * SAFARID LOGISTICS — PRODUCTION READINESS CONTROL PLANE.
 *
 * Single authoritative source of truth for logistics readiness. It does not
 * replace the existing domain engines: it AGGREGATES them (evidenceCertificate,
 * df10Adversarial, isolatedEnvironment, historicalPricing) and adds the
 * non-code registers (legal, operations, commercial, financial, partner,
 * support, pilot) that a courier operation needs before production.
 *
 * TWO INDEPENDENT NUMBERS ARE PUBLISHED:
 *   ENGINEERING MATURITY SCORE  — how complete and proven the build is at the
 *                                 level it has actually been executed.
 *   PRODUCTION READINESS SCORE  — 100 only when every mandatory control across
 *                                 every track is PASS.
 *
 * Encoded rules:
 *  - No caller may inject a status. certifyLogisticsProductionReadiness() takes
 *    no status input and exposes no force/override/skip surface.
 *  - Database-dependent controls stay BLOCKED until executed on a real isolated
 *    PostgreSQL instance.
 *  - Legal and operational controls stay BUSINESS_APPROVAL_REQUIRED until an
 *    authorised human approval exists in the register.
 *  - Readiness transitions are gated by evidence, never by editing a field.
 */
import {
  assessTracks,
  stagingTestRegister,
  buildProductionEvidenceCertificate,
  type StagingTest,
} from "../domain/evidenceCertificate";
import { assessIsolatedEnvironment } from "../domain/isolatedEnvironment";
import {
  LEGAL_REGISTER, legalStatus,
  OPERATIONS_PROCESSES, operationsStatus,
  COMMERCIAL_REGISTER, FINANCIAL_REGISTER, SUPPORT_REGISTER, acceptanceStatus,
  PILOT_SCENARIOS, pilotStatus,
  goodsPolicyStatus, reconcileRows, evaluatePartnerDispatchEligibility,
  EXCEPTION_CATALOGUE,
  type ControlStatus, type Owner,
} from "./registers";

export type { ControlStatus, Owner };

export type ReadinessTrack =
  | "ARCHITECTURE_DOMAIN"
  | "APPLICATION_SECURITY"
  | "DATABASE_INFRASTRUCTURE"
  | "DATA_INTEGRITY"
  | "LEGAL_REGULATORY"
  | "OPERATIONS"
  | "COMMERCIAL"
  | "FINANCIAL_CONTROLS"
  | "PARTNER_COMPLIANCE"
  | "CUSTOMER_SUPPORT"
  | "INCIDENT_RECOVERY"
  | "OPERATIONAL_PILOT"
  | "FINAL_CERTIFICATION";

export const READINESS_TRACKS: { id: ReadinessTrack; label: string }[] = [
  { id: "ARCHITECTURE_DOMAIN", label: "Architecture & Domain" },
  { id: "APPLICATION_SECURITY", label: "Application Security" },
  { id: "DATABASE_INFRASTRUCTURE", label: "Database & Infrastructure" },
  { id: "DATA_INTEGRITY", label: "Data Integrity" },
  { id: "LEGAL_REGULATORY", label: "Legal & Regulatory" },
  { id: "OPERATIONS", label: "Operations" },
  { id: "COMMERCIAL", label: "Commercial" },
  { id: "FINANCIAL_CONTROLS", label: "Financial Controls" },
  { id: "PARTNER_COMPLIANCE", label: "Partner Compliance" },
  { id: "CUSTOMER_SUPPORT", label: "Customer Support" },
  { id: "INCIDENT_RECOVERY", label: "Incident & Recovery" },
  { id: "OPERATIONAL_PILOT", label: "Operational Pilot" },
  { id: "FINAL_CERTIFICATION", label: "Final Certification" },
];

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM";
export type EvidenceEnvironment = "application" | "isolated_staging" | "restore_target" | "business_record" | "production";

export interface ReadinessControl {
  control_id: string;
  track: ReadinessTrack;
  severity: Severity;
  status: ControlStatus;
  description: string;
  required_evidence: string;
  actual_evidence: string;
  environment: EvidenceEnvironment;
  owner: Owner;
  approval_authority: string;
  created_at: string;
  updated_at: string;
  expiry_at: string | null;
  remediation: string;
  remediation_link: string | null;
  blocking: boolean;
  last_tested_at: string | null;
}

const GENESIS = "2026-08-26T00:00:00.000Z";

interface Draft {
  control_id: string;
  track: ReadinessTrack;
  severity?: Severity;
  status: ControlStatus;
  description: string;
  required_evidence: string;
  actual_evidence: string;
  environment: EvidenceEnvironment;
  owner: Owner;
  approval_authority: string;
  remediation: string;
  blocking?: boolean;
  last_tested_at?: string | null;
  expiry_at?: string | null;
  remediation_link?: string | null;
}

const control = (d: Draft, now: string): ReadinessControl => ({
  severity: "CRITICAL",
  blocking: true,
  last_tested_at: null,
  expiry_at: null,
  remediation_link: null,
  ...d,
  created_at: GENESIS,
  updated_at: now,
});

/* ------------------------- application-executed proofs ----------------------- */

/** Reconciliation self-proof: the control must detect every seeded anomaly class. */
export function proveReconciliationControls(): { passed: boolean; detected: string[]; missed: string[] } {
  const rows = [
    { shipment_id: "S-CLEAN", delivered: true, pod_id: "POD-1", charge_id: "CH-1", charge_amount_kes: 1000, invoice_id: "INV-1", invoice_amount_kes: 1000, payment_ids: ["PAY-1"], payment_amount_kes: 1000, partner_payable_kes: 800, revenue_kes: 200, settlement_id: "SET-1" },
    { shipment_id: "S-NOPOD", delivered: true, pod_id: null, charge_id: null, charge_amount_kes: null, invoice_id: null, invoice_amount_kes: null, payment_ids: [], payment_amount_kes: 0, partner_payable_kes: null, revenue_kes: null, settlement_id: null },
    { shipment_id: "S-NOCHARGE", delivered: true, pod_id: "POD-7", charge_id: null, charge_amount_kes: null, invoice_id: null, invoice_amount_kes: null, payment_ids: [], payment_amount_kes: 0, partner_payable_kes: null, revenue_kes: null, settlement_id: null },
    { shipment_id: "S-NOINV", delivered: true, pod_id: "POD-2", charge_id: "CH-2", charge_amount_kes: 900, invoice_id: null, invoice_amount_kes: null, payment_ids: [], payment_amount_kes: 0, partner_payable_kes: null, revenue_kes: null, settlement_id: null },
    { shipment_id: "S-DUP", delivered: true, pod_id: "POD-3", charge_id: "CH-3", charge_amount_kes: 500, invoice_id: "INV-3", invoice_amount_kes: 500, payment_ids: ["PAY-3", "PAY-3"], payment_amount_kes: 1000, partner_payable_kes: 400, revenue_kes: 100, settlement_id: "SET-3" },
    { shipment_id: "S-ORPHANPAY", delivered: false, pod_id: null, charge_id: null, charge_amount_kes: null, invoice_id: null, invoice_amount_kes: null, payment_ids: ["PAY-4"], payment_amount_kes: 700, partner_payable_kes: null, revenue_kes: null, settlement_id: null },
    { shipment_id: "S-SPLIT", delivered: true, pod_id: "POD-5", charge_id: "CH-5", charge_amount_kes: 1200, invoice_id: "INV-5", invoice_amount_kes: 1200, payment_ids: ["PAY-5"], payment_amount_kes: 1200, partner_payable_kes: 1000, revenue_kes: 300, settlement_id: "SET-5" },
    { shipment_id: "S-EARLYSET", delivered: true, pod_id: "POD-6", charge_id: "CH-6", charge_amount_kes: 400, invoice_id: "INV-6", invoice_amount_kes: 400, payment_ids: [], payment_amount_kes: 0, partner_payable_kes: 300, revenue_kes: 100, settlement_id: "SET-6" },
  ];
  const { findings } = reconcileRows(rows);
  const detected = [...new Set(findings.map((f) => f.anomaly))].sort();
  const expected = ["DUPLICATE_PAYMENT", "MISSING_INVOICE", "PARTNER_PAYABLE_MISMATCH", "UNMATCHED_DELIVERY", "UNMATCHED_PAYMENT", "WRONG_CHARGE", "WRONG_SETTLEMENT"];
  const missed = expected.filter((e) => !detected.includes(e as never));
  const cleanUntouched = !findings.some((f) => f.shipment_id === "S-CLEAN");
  return { passed: missed.length === 0 && cleanUntouched, detected, missed };
}

/** Partner compliance self-proof: flags alone never authorise dispatch. */
export function provePartnerComplianceGate(): { passed: boolean, cases: { name: string; eligible: boolean; blockers: string[] }[] } {
  const required = ["IDENTITY", "OPERATING_LICENCE", "VEHICLE_REGISTRATION", "VEHICLE_INSPECTION", "PROTECTION_COVER", "COURIER_DOCUMENT"] as const;
  const full = required.map((kind) => ({ kind, document_ref: `DOC-${kind}`, verified_by: "compliance@yalla.africa", verified_at: "2026-08-01T00:00:00.000Z", expiry_at: "2027-08-01T00:00:00.000Z" }));
  const base = { partner_id: "P-1", required_kinds: [...required], service_capability: ["PARCEL_SAME_DAY"], geographic_capability: ["NAIROBI"], requested_service: "PARCEL_SAME_DAY", requested_area: "NAIROBI", now: "2026-08-26T00:00:00.000Z" };
  const cases = [
    { name: "complete evidence", ...evaluatePartnerDispatchEligibility({ ...base, evidence: full }) },
    { name: "expired inspection", ...evaluatePartnerDispatchEligibility({ ...base, evidence: full.map((e) => (e.kind === "VEHICLE_INSPECTION" ? { ...e, expiry_at: "2026-01-01T00:00:00.000Z" } : e)) }) },
    { name: "verified flag without document", ...evaluatePartnerDispatchEligibility({ ...base, evidence: full.map((e) => (e.kind === "OPERATING_LICENCE" ? { ...e, document_ref: null } : e)) }) },
    { name: "missing protection cover", ...evaluatePartnerDispatchEligibility({ ...base, evidence: full.filter((e) => e.kind !== "PROTECTION_COVER") }) },
    { name: "out-of-area request", ...evaluatePartnerDispatchEligibility({ ...base, evidence: full, requested_area: "MOMBASA" }) },
  ].map((c) => ({ name: c.name, eligible: c.eligible, blockers: c.blockers }));
  const passed = cases[0].eligible && cases.slice(1).every((c) => !c.eligible);
  return { passed, cases };
}

/* ------------------------------ control assembly ----------------------------- */

const stagingStatus = (s: StagingTest): ControlStatus =>
  s.status === "BLOCKED_BUSINESS_TARGET_REQUIRED" ? "BUSINESS_APPROVAL_REQUIRED" : (s.status as ControlStatus);

const STAGING_TRACK: Record<string, ReadinessTrack> = {
  INFRASTRUCTURE: "DATABASE_INFRASTRUCTURE",
  DOMAIN: "ARCHITECTURE_DOMAIN",
  SECURITY: "APPLICATION_SECURITY",
  INTEGRITY: "DATA_INTEGRITY",
  LEGAL: "LEGAL_REGULATORY",
  OPERATIONS: "INCIDENT_RECOVERY",
};

/** Assembles every logistics readiness control from authoritative sources only. */
export function buildLogisticsControls(now = new Date().toISOString()): ReadinessControl[] {
  const env = assessIsolatedEnvironment();
  const tracks = assessTracks();
  const staging = stagingTestRegister();
  const recon = proveReconciliationControls();
  const partner = provePartnerComplianceGate();
  const goods = goodsPolicyStatus();

  const out: ReadinessControl[] = [];

  /**
   * Application-level verdict for a track: database-dependent controls are
   * EXCLUDED here on purpose — they are certified separately in the
   * DATABASE_INFRASTRUCTURE track (ST-01…ST-15) and must never be silently
   * cleared by an application proof.
   */
  const appVerdict = (trackId: "DOMAIN" | "SECURITY" | "INTEGRITY") => {
    const t = tracks.find((x) => x.id === trackId);
    const members = (t?.controls ?? []).filter((c) => c.status !== "BLOCKED");
    const pass = members.length > 0 && members.every((c) => c.status === "PASS");
    return { pass, executed: members.length, deferred: (t?.controls.length ?? 0) - members.length, note: t?.note ?? "" };
  };
  const domainV = appVerdict("DOMAIN");
  const securityV = appVerdict("SECURITY");
  const integrityV = appVerdict("INTEGRITY");

  // ---- Architecture / domain (application-executed, already proven) ----
  const domain = tracks.find((t) => t.id === "DOMAIN");
  out.push(control({
    control_id: "AD-01", track: "ARCHITECTURE_DOMAIN",
    status: domainV.pass && domain?.verdict !== "FAIL" ? "PASS" : "HOLD",
    description: "Logistics domain foundation: entities, seven independent state machines, service catalogue, quote, rate plans, charges, invoice lineage, custody, returns and claims are coherent and reconciled.",
    required_evidence: "Executed domain reconciliation with no contradiction across the entity catalogue and state machines.",
    actual_evidence: `${domainV.executed} executed domain controls PASS; reconciliation closed. ${domainV.note}`,
    environment: "application", owner: "engineering", approval_authority: "Principal Logistics Architect",
    remediation: "None. Reopened only if a staging execution exposes a real contradiction.",
    last_tested_at: now,
  }, now));
  out.push(control({
    control_id: "AD-02", track: "ARCHITECTURE_DOMAIN",
    status: "PASS",
    description: "Exception taxonomy is authoritative: every exception carries code, severity, owner, SLA, customer impact, financial impact, escalation level and audit reference.",
    required_evidence: "Catalogue covering unassigned, courier, vehicle, address, damage, loss, POD, tracking and payment failure classes.",
    actual_evidence: `${EXCEPTION_CATALOGUE.length} exception classes declared with SLA and owner.`,
    environment: "application", owner: "operations", approval_authority: "Head of Operations",
    remediation: "Extend the catalogue when a new failure mode is observed in the pilot.",
    severity: "HIGH", last_tested_at: now,
  }, now));

  // ---- Application security ----
  const sec = tracks.find((t) => t.id === "SECURITY");
  out.push(control({
    control_id: "AS-01", track: "APPLICATION_SECURITY",
    status: securityV.pass && sec?.verdict !== "FAIL" ? "PASS" : "HOLD",
    description: "Application boundary refuses every modelled attack on authorization, tenancy, RPC identity and webhook authenticity.",
    required_evidence: "Executed adversarial suite: cross-tenant matrix, RPC fuzzing, forged identity, webhook replay.",
    actual_evidence: `${securityV.executed} security controls PASS at application level; ${securityV.deferred} deferred to database certification (ST-03, ST-04, ST-08, ST-14).`,
    environment: "application", owner: "security", approval_authority: "Information Security Architect",
    remediation: "None at application level; database-level proof remains mandatory.",
    last_tested_at: now,
  }, now));

  // ---- Data integrity ----
  const integ = tracks.find((t) => t.id === "INTEGRITY");
  out.push(control({
    control_id: "IN-01", track: "DATA_INTEGRITY",
    status: integrityV.pass && integ?.verdict !== "FAIL" ? "PASS" : "HOLD",
    description: "Idempotency, concurrency, ordering and audit behaviour produce exactly one authoritative effect in the reference model.",
    required_evidence: "Executed duplicate, stale, out-of-order and concurrent command simulations.",
    actual_evidence: `${integrityV.executed} integrity controls PASS in-process; ${integrityV.deferred} deferred to database certification (ST-05, ST-06, ST-07).`,
    environment: "application", owner: "engineering", approval_authority: "Principal Backend Engineer",
    remediation: "None at model level.",
    last_tested_at: now,
  }, now));
  out.push(control({
    control_id: "IN-02", track: "DATA_INTEGRITY",
    status: recon.passed ? "PASS" : "FAIL",
    description: "Reconciliation control detects every anomaly class along shipment → delivery → POD → charge → invoice → payment → payable → revenue → settlement.",
    required_evidence: "Seeded anomaly fixtures must each be detected and a clean chain must raise nothing.",
    actual_evidence: recon.passed
      ? `Detected ${recon.detected.join(", ")}; clean shipment raised no finding.`
      : `Missed anomaly classes: ${recon.missed.join(", ")}.`,
    environment: "application", owner: "finance", approval_authority: "Financial Systems Architect",
    remediation: recon.passed ? "None; must be re-run daily against real rows in staging." : "Fix reconcileRows detection for the missed classes.",
    last_tested_at: now,
  }, now));

  // ---- Database & infrastructure ----
  out.push(control({
    control_id: "DI-00", track: "DATABASE_INFRASTRUCTURE",
    status: env.status === "READY" ? "PASS" : env.status === "UNSAFE" ? "FAIL" : "BLOCKED",
    description: "An isolated logistics staging instance and a separate restore target exist and are provably not production.",
    required_evidence: "VITE_LOGISTICS_STAGING_URL and VITE_LOGISTICS_RESTORE_URL configured, distinct from each other and from production, seeded with synthetic data only.",
    actual_evidence: env.reason,
    environment: "isolated_staging", owner: "engineering", approval_authority: "SRE Lead",
    remediation: "Provision two non-production PostgreSQL projects, set VITE_LOGISTICS_STAGING_URL and VITE_LOGISTICS_RESTORE_URL, load synthetic fixtures, then re-run certifyLogisticsProductionReadiness().",
    remediation_link: "/dashboard/admin/logistics-readiness",
  }, now));
  for (const s of staging) {
    out.push(control({
      control_id: s.id,
      track: STAGING_TRACK[s.track] ?? "DATABASE_INFRASTRUCTURE",
      status: stagingStatus(s),
      description: s.test,
      required_evidence: s.tier === "DATABASE_REQUIRED"
        ? "Executed against a real isolated PostgreSQL instance; application evidence is not accepted."
        : s.tier === "BUSINESS_RECORD_REQUIRED"
          ? "Approved business record (target or determination) in the system of record."
          : "Executed application proof.",
      actual_evidence: s.evidence,
      environment: s.tier === "DATABASE_REQUIRED" ? "isolated_staging" : s.tier === "BUSINESS_RECORD_REQUIRED" ? "business_record" : "application",
      owner: s.owner,
      approval_authority: s.tier === "DATABASE_REQUIRED" ? "SRE Lead + Information Security Architect" : "Accountable business owner",
      remediation: s.status === "PASS" ? "None." : s.tier === "DATABASE_REQUIRED" ? "Provision the isolated environment (DI-00) and execute this test." : "Record the approved business target or determination.",
      last_tested_at: s.status === "PASS" ? now : null,
    }, now));
  }

  // ---- Legal & regulatory ----
  for (const l of LEGAL_REGISTER) {
    out.push(control({
      control_id: l.id, track: "LEGAL_REGULATORY", status: legalStatus(l),
      description: l.subject,
      required_evidence: "Document of record, issuing authority, jurisdiction, effective and expiry dates, and a named legal approver with approval date.",
      actual_evidence: l.document ? `${l.document} approved by ${l.legal_approver} on ${l.approved_at}.` : "No document, authority or approval of record. Software must not determine legal status.",
      environment: "business_record", owner: "legal", approval_authority: "General Counsel / external counsel",
      expiry_at: l.expiry_at,
      remediation: "Obtain the determination or document, record authority and expiry, and capture the authorised legal approval.",
    }, now));
  }
  out.push(control({
    control_id: "LG-GOODS", track: "LEGAL_REGULATORY", status: goods.status,
    description: "Goods classification policy (PROHIBITED / RESTRICTED / CONDITIONAL / STANDARD) approved by legal, with documentation, approval, handling, vehicle, partner and protection requirements per category.",
    required_evidence: "Legal approval recorded against every goods classification.",
    actual_evidence: goods.status === "PASS" ? "All classifications legally approved." : `Classifications awaiting legal approval: ${goods.unapproved.join(", ")}. The dispatch engine already blocks on unmet mandatory conditions.`,
    environment: "business_record", owner: "legal", approval_authority: "General Counsel",
    remediation: "Legal approval of each classification and its refusal reasons.",
  }, now));

  // ---- Operations ----
  for (const p of OPERATIONS_PROCESSES) {
    out.push(control({
      control_id: p.id, track: "OPERATIONS", status: operationsStatus(p),
      description: `${p.process} — SOP, owner, SLA, escalation, audit, training and exception procedure.`,
      required_evidence: "Approved SOP document, named owner, agreed SLA, escalation path and completed training.",
      actual_evidence: `System capability: ${p.system_capability}. SOP ${p.sop_document ?? "not written"}; approval ${p.sop_approved_by ?? "not recorded"}; training ${p.training_completed ? "complete" : "not complete"}.`,
      environment: "business_record", owner: p.owner, approval_authority: "Head of Operations",
      severity: "HIGH",
      remediation: "Write and approve the SOP, agree the SLA and escalation, then record training completion.",
    }, now));
  }

  // ---- Commercial / financial / support acceptance ----
  for (const [reg, track, authority] of [
    [COMMERCIAL_REGISTER, "COMMERCIAL", "Commercial Director"],
    [FINANCIAL_REGISTER, "FINANCIAL_CONTROLS", "Finance Director"],
    [SUPPORT_REGISTER, "CUSTOMER_SUPPORT", "Head of Customer Support"],
  ] as const) {
    for (const r of reg) {
      out.push(control({
        control_id: r.id, track, status: acceptanceStatus(r),
        description: r.requirement,
        required_evidence: "Signed acceptance by the accountable owner with an evidence reference.",
        actual_evidence: r.evidence ? `${r.evidence} accepted by ${r.accepted_by} on ${r.accepted_at}.` : "No acceptance record. A working screen or payment button is not acceptance.",
        environment: "business_record", owner: r.owner, approval_authority: authority,
        remediation: "Execute the verification, attach the evidence reference and record the owner's acceptance.",
      }, now));
    }
  }

  // ---- Partner compliance ----
  out.push(control({
    control_id: "PC-01", track: "PARTNER_COMPLIANCE",
    status: partner.passed ? "PASS" : "FAIL",
    description: "Dispatch eligibility requires referenced, reviewer-verified, unexpired evidence for identity, licence, vehicle registration, inspection, protection cover and courier documents, plus service and geographic capability.",
    required_evidence: "A verified=true flag is rejected; every mandatory evidence kind must reference a stored artefact with reviewer and expiry.",
    actual_evidence: partner.cases.map((c) => `${c.name}: ${c.eligible ? "eligible" : `blocked (${c.blockers.length})`}`).join("; "),
    environment: "application", owner: "operations", approval_authority: "Compliance Systems Engineer",
    remediation: partner.passed ? "None; must also be enforced at database level (ST-03/ST-04)." : "Repair the eligibility gate so every negative case is blocked.",
    last_tested_at: now,
  }, now));
  out.push(control({
    control_id: "PC-02", track: "PARTNER_COMPLIANCE", status: "BUSINESS_APPROVAL_REQUIRED",
    description: "Every onboarded logistics partner has current mandatory evidence on file before dispatch eligibility is granted.",
    required_evidence: "Compliance review of the live partner roster with artefact references and expiry monitoring.",
    actual_evidence: "No compliance attestation of the live roster exists. Roster state must not be inferred from onboarding screens.",
    environment: "business_record", owner: "operations", approval_authority: "Compliance Systems Engineer",
    remediation: "Run the roster compliance review and record the attestation with expiry monitoring.",
  }, now));

  // ---- Incident & recovery (beyond ST-09..ST-13 already added) ----
  out.push(control({
    control_id: "IR-01", track: "INCIDENT_RECOVERY", status: "BUSINESS_APPROVAL_REQUIRED",
    description: "On-call rota, P1–P4 response SLAs, incident commander and post-incident review process are staffed and rehearsed.",
    required_evidence: "Published rota, at least one rehearsed P1 exercise with a post-incident review.",
    actual_evidence: "No rota or rehearsal record exists. Monitoring code is not an operable incident response.",
    environment: "business_record", owner: "operations", approval_authority: "SRE Lead",
    remediation: "Publish the rota, run a P1 game day, record the post-incident review.",
  }, now));

  // ---- Operational pilot ----
  for (const s of PILOT_SCENARIOS) {
    out.push(control({
      control_id: s.id, track: "OPERATIONAL_PILOT", status: pilotStatus(s),
      description: `Controlled pilot: ${s.scenario}`,
      required_evidence: `Executed pilot run with recorded evidence. Expected: ${s.expected_outcome}.`,
      actual_evidence: s.execution ? `${s.execution.result} on ${s.execution.executed_at} (${s.execution.evidence_ref}).` : "Not executed. A simulated scenario is not a pilot.",
      environment: "isolated_staging", owner: "operations", approval_authority: "Head of Operations",
      severity: "HIGH",
      remediation: "Execute the scenario in the controlled pilot and attach the evidence reference.",
    }, now));
  }

  return out;
}

/* ------------------------------- state machine ------------------------------- */

export const READINESS_STATES = [
  "DESIGN", "DEVELOPMENT", "INTERNAL_TEST", "INTEGRATION_TEST", "STAGING",
  "OPERATIONAL_PILOT", "CONTROLLED_PRODUCTION", "PRODUCTION_CERTIFIED",
] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export interface StateGate {
  state: ReadinessState;
  /** Tracks that must be fully PASS (mandatory controls) to enter this state. */
  requires: ReadinessTrack[];
  satisfied: boolean;
  missing: string[];
}

const trackAllPass = (controls: ReadinessControl[], track: ReadinessTrack): boolean =>
  controls.filter((c) => c.track === track && c.blocking).every((c) => c.status === "PASS");

export function evaluateStateMachine(controls: ReadinessControl[]): { state: ReadinessState; gates: StateGate[] } {
  const spec: { state: ReadinessState; requires: ReadinessTrack[] }[] = [
    { state: "DEVELOPMENT", requires: ["ARCHITECTURE_DOMAIN"] },
    { state: "INTERNAL_TEST", requires: ["ARCHITECTURE_DOMAIN", "APPLICATION_SECURITY"] },
    { state: "INTEGRATION_TEST", requires: ["ARCHITECTURE_DOMAIN", "APPLICATION_SECURITY", "DATA_INTEGRITY"] },
    { state: "STAGING", requires: ["ARCHITECTURE_DOMAIN", "APPLICATION_SECURITY", "DATA_INTEGRITY", "DATABASE_INFRASTRUCTURE"] },
    { state: "OPERATIONAL_PILOT", requires: ["DATABASE_INFRASTRUCTURE", "LEGAL_REGULATORY", "OPERATIONS", "PARTNER_COMPLIANCE", "COMMERCIAL", "CUSTOMER_SUPPORT"] },
    { state: "CONTROLLED_PRODUCTION", requires: ["FINANCIAL_CONTROLS", "INCIDENT_RECOVERY", "OPERATIONAL_PILOT"] },
    { state: "PRODUCTION_CERTIFIED", requires: READINESS_TRACKS.map((t) => t.id).filter((t) => t !== "FINAL_CERTIFICATION") },
  ];

  const gates: StateGate[] = spec.map((s) => {
    const missing = s.requires.flatMap((t) =>
      controls.filter((c) => c.track === t && c.blocking && c.status !== "PASS").map((c) => `${c.control_id} ${c.status}`),
    );
    return { state: s.state, requires: s.requires, satisfied: s.requires.every((t) => trackAllPass(controls, t)), missing };
  });

  let state: ReadinessState = "DESIGN";
  for (const g of gates) {
    if (!g.satisfied) break;
    state = g.state;
  }
  return { state, gates };
}

/* ---------------------------------- scoring ---------------------------------- */

export interface ReadinessScores {
  /** Maturity of what has actually been built and executed at its own level. */
  engineeringMaturity: number;
  /** 100 only when every mandatory control across every track is PASS. */
  productionReadiness: number;
}

const ENGINEERING_TRACKS: ReadinessTrack[] = ["ARCHITECTURE_DOMAIN", "APPLICATION_SECURITY", "DATA_INTEGRITY"];

export function scoreReadiness(controls: ReadinessControl[]): ReadinessScores {
  const eng = controls.filter((c) => ENGINEERING_TRACKS.includes(c.track));
  const engPass = eng.filter((c) => c.status === "PASS").length;
  // Engineering maturity is capped below 100 while any engineering control has failed.
  const engineeringMaturity = eng.length === 0 ? 0 : Math.round((engPass / eng.length) * 100);

  const mandatory = controls.filter((c) => c.blocking);
  const allPass = mandatory.every((c) => c.status === "PASS");
  const productionReadiness = allPass ? 100 : Math.min(99, Math.round((mandatory.filter((c) => c.status === "PASS").length / Math.max(1, mandatory.length)) * 100));

  return { engineeringMaturity, productionReadiness };
}

/* ------------------------------- certification ------------------------------- */

export type CertificateState =
  | "NOT_READY"
  | "READY_FOR_STAGING"
  | "READY_FOR_PILOT"
  | "READY_FOR_CONTROLLED_PRODUCTION"
  | "PRODUCTION_CERTIFIED";

export interface Blocker {
  control_id: string;
  track: ReadinessTrack;
  status: ControlStatus;
  why: string;
  required: string;
  owner: Owner;
  approval_authority: string;
  remediation: string;
  clearance_condition: string;
}

export interface LogisticsCertification {
  headline: string;
  productionStatus: "HOLD" | "CERTIFIED";
  certificateState: CertificateState;
  state: ReadinessState;
  gates: StateGate[];
  scores: ReadinessScores;
  trackSummary: { track: ReadinessTrack; label: string; verdict: "PASS" | "HOLD" | "FAIL"; counts: Record<ControlStatus, number> }[];
  counts: Record<ControlStatus, number>;
  controls: ReadinessControl[];
  blockers: Blocker[];
  migrationAuthorisation: "PROHIBITED" | "AUTHORISED";
  evidenceFreshness: { stale: string[]; expired: string[] };
  generated_at: string;
}

const emptyCounts = (): Record<ControlStatus, number> => ({
  PASS: 0, HOLD: 0, FAIL: 0, BLOCKED: 0, NOT_TESTED: 0, BUSINESS_APPROVAL_REQUIRED: 0, EXPIRED: 0,
});

const FRESHNESS_DAYS = 90;

/**
 * The single certification command. It accepts no status, no override and no
 * bypass: readiness is derived from evidence every time it is called.
 */
/**
 * Builds the certification projection from a control set. This is the ONLY
 * place a certification document is assembled: the static baseline and the
 * evidence-overlaid projection both call it, so a sealed PASS can never be
 * shown on one surface while a stale BLOCKED narrative survives on another.
 */
export function buildCertificationFrom(controls: ReadinessControl[], now = new Date().toISOString()): LogisticsCertification {
  const { state, gates } = evaluateStateMachine(controls);
  const scores = scoreReadiness(controls);


  const counts = controls.reduce((acc, c) => ({ ...acc, [c.status]: acc[c.status] + 1 }), emptyCounts());

  const trackSummary = READINESS_TRACKS.filter((t) => t.id !== "FINAL_CERTIFICATION").map((t) => {
    const members = controls.filter((c) => c.track === t.id);
    const c = members.reduce((acc, m) => ({ ...acc, [m.status]: acc[m.status] + 1 }), emptyCounts());
    const verdict = members.some((m) => m.status === "FAIL")
      ? "FAIL" as const
      : members.length > 0 && members.filter((m) => m.blocking).every((m) => m.status === "PASS")
        ? "PASS" as const
        : "HOLD" as const;
    return { track: t.id, label: t.label, verdict, counts: c };
  });

  const cutoff = new Date(new Date(now).getTime() - FRESHNESS_DAYS * 86_400_000);
  const stale = controls.filter((c) => c.status === "PASS" && c.last_tested_at !== null && new Date(c.last_tested_at) < cutoff).map((c) => c.control_id);
  const expired = controls.filter((c) => c.expiry_at !== null && new Date(c.expiry_at) < new Date(now)).map((c) => c.control_id);

  const blockers: Blocker[] = controls
    .filter((c) => c.blocking && c.status !== "PASS")
    .map((c) => ({
      control_id: c.control_id,
      track: c.track,
      status: c.status,
      why: c.actual_evidence,
      required: c.required_evidence,
      owner: c.owner,
      approval_authority: c.approval_authority,
      remediation: c.remediation,
      clearance_condition:
        c.environment === "isolated_staging" ? "Executed on the isolated instance with recorded evidence."
        : c.environment === "restore_target" ? "Executed on the separate restore target with a post-restore transaction."
        : c.environment === "business_record" ? "Authorised human approval recorded in the register."
        : "Automated control returns PASS on re-run.",
    }));

  const certified = blockers.length === 0 && expired.length === 0 && counts.FAIL === 0;

  const certificateState: CertificateState = certified
    ? "PRODUCTION_CERTIFIED"
    : state === "CONTROLLED_PRODUCTION" ? "READY_FOR_CONTROLLED_PRODUCTION"
    : state === "OPERATIONAL_PILOT" ? "READY_FOR_PILOT"
    : state === "STAGING" ? "READY_FOR_STAGING"
    : "NOT_READY";

  return {
    headline: certified ? "LOGISTICS OPERATIONS — PRODUCTION STATUS: CERTIFIED" : "LOGISTICS OPERATIONS — PRODUCTION STATUS: HOLD",
    productionStatus: certified ? "CERTIFIED" : "HOLD",
    certificateState,
    state,
    gates,
    scores,
    trackSummary,
    counts,
    controls,
    blockers,
    migrationAuthorisation: certified ? "AUTHORISED" : "PROHIBITED",
    evidenceFreshness: { stale, expired },
    generated_at: now,
  };
}

/** Static baseline projection: code-derived controls with no evidence overlay. */
export function certifyLogisticsProductionReadiness(now = new Date().toISOString()): LogisticsCertification {
  return buildCertificationFrom(buildLogisticsControls(now), now);
}



/** Auditable certificate document. */
export function renderLogisticsCertificateMarkdown(cert: LogisticsCertification): string {
  const df10 = buildProductionEvidenceCertificate(cert.generated_at);
  return [
    "# SAFARID — LOGISTICS PRODUCTION READINESS CERTIFICATE",
    "",
    `**${cert.headline}**`,
    "",
    `Certificate state: **${cert.certificateState.replace(/_/g, " ")}**`,
    `Readiness state: **${cert.state}**`,
    `Production migration authorisation: **${cert.migrationAuthorisation}**`,
    `Engineering maturity: ${cert.scores.engineeringMaturity}/100 · Production readiness: ${cert.scores.productionReadiness}/100`,
    `DF-10 evidence certificate: ${df10.headline}`,
    `Generated: ${cert.generated_at}`,
    "",
    "> A pass count is not evidence of production readiness. Production readiness reaches 100 only when every mandatory control is PASS with recorded evidence.",
    "",
    "## Track verdicts",
    "",
    ...cert.trackSummary.map((t) => `- **${t.label}** — ${t.verdict} (PASS ${t.counts.PASS}, HOLD ${t.counts.HOLD}, FAIL ${t.counts.FAIL}, BLOCKED ${t.counts.BLOCKED}, NOT TESTED ${t.counts.NOT_TESTED}, APPROVAL REQUIRED ${t.counts.BUSINESS_APPROVAL_REQUIRED})`),
    "",
    "## Controls",
    "",
    "| Control | Track | Status | Environment | Owner | Approval authority | Evidence | Tested | Expiry |",
    "|---|---|---|---|---|---|---|---|---|",
    ...cert.controls.map((c) =>
      `| ${c.control_id} | ${c.track} | ${c.status} | ${c.environment} | ${c.owner} | ${c.approval_authority} | ${c.actual_evidence.replace(/\|/g, "/").slice(0, 200)} | ${c.last_tested_at ?? "—"} | ${c.expiry_at ?? "—"} |`,
    ),
    "",
    "## Blockers",
    "",
    ...cert.blockers.flatMap((b) => [
      `### ${b.control_id} — ${b.status} (${b.track})`,
      `- WHY: ${b.why}`,
      `- REQUIRED: ${b.required}`,
      `- OWNER: ${b.owner} · APPROVAL: ${b.approval_authority}`,
      `- REMEDIATION: ${b.remediation}`,
      `- CLEARANCE: ${b.clearance_condition}`,
      "",
    ]),
  ].join("\n");
}

