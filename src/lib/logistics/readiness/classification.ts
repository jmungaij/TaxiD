/**
 * READINESS REMEDIATION CLASSIFICATION.
 *
 * Every readiness control is classified so that a blocker answers four
 * questions: WHY is it blocked, WHO must act, WHAT action clears it, WHAT
 * evidence is authoritative. The classification decides which RESOLVE workflow
 * the command centre launches — it never clears a control by itself.
 *
 * There is deliberately no "mark as passed" class: a control is cleared only by
 * its authoritative evidence (approved business record, recorded pilot run, or
 * an execution against a real isolated database).
 */
import type { ReadinessControl } from "./controlPlane";

export type RemediationClass =
  | "BUILDABLE"
  | "CONFIGURABLE"
  | "INTEGRATABLE"
  | "TESTABLE"
  | "EVIDENCE_REQUIRED"
  | "HUMAN_APPROVAL_REQUIRED"
  | "EXTERNAL_INFRASTRUCTURE_REQUIRED"
  | "LEGAL_DETERMINATION_REQUIRED"
  | "BUSINESS_TARGET_REQUIRED"
  | "GENUINE_FAILURE";

/** The workflow the RESOLVE action launches for a class. */
export type ResolutionWorkflow =
  | "ENGINEERING_FIX"
  | "INFRASTRUCTURE_PROVISIONING"
  | "DATABASE_CERTIFICATION"
  | "EVIDENCE_AND_APPROVAL"
  | "LEGAL_REGISTER"
  | "OPERATIONS_CERTIFICATION"
  | "BUSINESS_TARGET"
  | "PILOT_EXECUTION";

export interface ClassificationVerdict {
  control_id: string;
  remediation_class: RemediationClass;
  workflow: ResolutionWorkflow;
  /** Can the platform itself clear this control once the workflow completes? */
  self_clearing: boolean;
  why: string;
  who: string;
  action: string;
  evidence: string;
}

const LEGAL_PREFIXES = ["LG-"];
const OPS_PREFIX = "OP-";
const PILOT_PREFIX = "PL-";
const DB_TRACKS = new Set(["DATABASE_INFRASTRUCTURE"]);

/** Classifies a single control from its own authoritative shape — never from a name list. */
export function classifyControl(c: ReadinessControl): ClassificationVerdict {
  const base = { control_id: c.control_id };

  if (c.status === "FAIL") {
    return {
      ...base,
      remediation_class: "GENUINE_FAILURE",
      workflow: "ENGINEERING_FIX",
      self_clearing: true,
      why: `Executed check failed: ${c.actual_evidence}`,
      who: "Engineering",
      action: "Repair the defect, then the control re-evaluates on the next certification run.",
      evidence: c.required_evidence,
    };
  }

  if (c.control_id === "DI-00") {
    return {
      ...base,
      remediation_class: "EXTERNAL_INFRASTRUCTURE_REQUIRED",
      workflow: "INFRASTRUCTURE_PROVISIONING",
      self_clearing: false,
      why: c.actual_evidence,
      who: "SRE Lead",
      action: "Register an isolated staging target and a separate restore target, then verify isolation.",
      evidence: "Two non-production PostgreSQL instances, distinct from each other and from production, seeded with synthetic fixtures only.",
    };
  }

  if (c.control_id.startsWith(PILOT_PREFIX)) {
    return {
      ...base,
      remediation_class: "TESTABLE",
      workflow: "PILOT_EXECUTION",
      self_clearing: true,
      why: "The scenario has not been executed in the controlled pilot. A simulation is not a pilot.",
      who: "Head of Operations",
      action: "Execute the scenario in the controlled environment and record the observed outcome.",
      evidence: c.required_evidence,
    };
  }

  if (DB_TRACKS.has(c.track) && c.environment === "isolated_staging") {
    return {
      ...base,
      remediation_class: "EXTERNAL_INFRASTRUCTURE_REQUIRED",
      workflow: "DATABASE_CERTIFICATION",
      self_clearing: true,
      why: "Database-level evidence cannot be produced by source inspection, simulation or application tests.",
      who: "SRE Lead + Information Security Architect",
      action: "Clear DI-00 first, then execute this test against the isolated instance.",
      evidence: c.required_evidence,
    };
  }

  if (c.environment === "business_record" && LEGAL_PREFIXES.some((p) => c.control_id.startsWith(p))) {
    return {
      ...base,
      remediation_class: "LEGAL_DETERMINATION_REQUIRED",
      workflow: "LEGAL_REGISTER",
      self_clearing: false,
      why: "No legal determination or document of record exists. Software must not decide legal status.",
      who: "General Counsel / external counsel",
      action: "Record the determination or document with issuing authority, jurisdiction, effective and expiry dates, then obtain legal approval.",
      evidence: c.required_evidence,
    };
  }

  if (c.control_id.startsWith(OPS_PREFIX)) {
    return {
      ...base,
      remediation_class: "EVIDENCE_REQUIRED",
      workflow: "OPERATIONS_CERTIFICATION",
      self_clearing: false,
      why: `The system capability exists; SOP, owner, SLA, escalation, training or approval are not evidenced. ${c.actual_evidence}`,
      who: "Head of Operations",
      action: "Attach the approved SOP, name the owner, agree the SLA and escalation, record training, then submit for approval.",
      evidence: c.required_evidence,
    };
  }

  if (c.status === "BUSINESS_APPROVAL_REQUIRED" || c.status === "EXPIRED") {
    const isTarget = /target|threshold|tolerance/i.test(c.required_evidence + c.description);
    return {
      ...base,
      remediation_class: isTarget ? "BUSINESS_TARGET_REQUIRED" : "HUMAN_APPROVAL_REQUIRED",
      workflow: isTarget ? "BUSINESS_TARGET" : "EVIDENCE_AND_APPROVAL",
      self_clearing: false,
      why: c.status === "EXPIRED" ? "The recorded evidence has expired." : c.actual_evidence,
      who: c.approval_authority,
      action: isTarget
        ? "Establish and record the accountable owner's target, then submit it for approval."
        : "Execute the verification, attach the evidence reference and record the accountable owner's acceptance.",
      evidence: c.required_evidence,
    };
  }

  if (c.status === "HOLD" || c.status === "NOT_TESTED" || c.status === "BLOCKED") {
    return {
      ...base,
      remediation_class: "BUILDABLE",
      workflow: "ENGINEERING_FIX",
      self_clearing: true,
      why: c.actual_evidence,
      who: "Engineering",
      action: c.remediation,
      evidence: c.required_evidence,
    };
  }

  return {
    ...base,
    remediation_class: "EVIDENCE_REQUIRED",
    workflow: "EVIDENCE_AND_APPROVAL",
    self_clearing: false,
    why: "Control is satisfied; evidence must stay fresh and unexpired.",
    who: c.approval_authority,
    action: "Re-verify before the freshness window closes.",
    evidence: c.required_evidence,
  };
}

export const CLASS_LABEL: Record<RemediationClass, string> = {
  BUILDABLE: "Buildable — platform can fix",
  CONFIGURABLE: "Configurable — owner supplies configuration",
  INTEGRATABLE: "Integratable — provider credentials required",
  TESTABLE: "Testable — system executes the test",
  EVIDENCE_REQUIRED: "Evidence required — capability exists",
  HUMAN_APPROVAL_REQUIRED: "Human approval required",
  EXTERNAL_INFRASTRUCTURE_REQUIRED: "External infrastructure required",
  LEGAL_DETERMINATION_REQUIRED: "Legal determination required",
  BUSINESS_TARGET_REQUIRED: "Business target required",
  GENUINE_FAILURE: "Genuine engineering failure",
};

/** Which classes may be cleared through the evidence & approval register. */
export const APPROVAL_CLEARABLE: RemediationClass[] = [
  "EVIDENCE_REQUIRED",
  "HUMAN_APPROVAL_REQUIRED",
  "LEGAL_DETERMINATION_REQUIRED",
  "BUSINESS_TARGET_REQUIRED",
];
