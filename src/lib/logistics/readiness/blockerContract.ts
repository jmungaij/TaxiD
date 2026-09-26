/**
 * BLOCKER CONTRACT ENGINE — "no dead-end blockers".
 *
 * Every outstanding readiness control is converted into an authoritative
 * BlockerRecord that always answers: WHY, WHO owns it, WHAT action clears it,
 * WHAT it depends on, WHAT evidence is authoritative, WHAT the next step is and
 * WHAT the clearance condition is.
 *
 * INTEGRITY RULES
 *  1. This module is READ-ONLY over the control plane. It classifies and routes;
 *     it never sets, forces or infers a PASS.
 *  2. Where the taxonomy cannot determine an owner, an action or the evidence,
 *     it does NOT invent one — it emits an explicit meta-task
 *     (OWNER_ASSIGNMENT_REQUIRED / ACTION_DEFINITION_REQUIRED /
 *     EVIDENCE_DEFINITION_REQUIRED) so the gap itself becomes actionable.
 *  3. Dependencies are derived from the certification order encoded in the
 *     control plane, never hand-maintained per control.
 */
import type { CommandCenterControl } from "./execution";
import type { RemediationClass } from "./classification";
import type { ReadinessTrack, Severity } from "./controlPlane";

/* --------------------------------- taxonomy -------------------------------- */

export type BlockerType =
  | "BUILD_BLOCKER"
  | "CONFIGURATION_BLOCKER"
  | "INTEGRATION_BLOCKER"
  | "DATA_BLOCKER"
  | "ENVIRONMENT_BLOCKER"
  | "EVIDENCE_BLOCKER"
  | "APPROVAL_BLOCKER"
  | "LEGAL_BLOCKER"
  | "COMMERCIAL_BLOCKER"
  | "FINANCIAL_BLOCKER"
  | "OPERATIONS_BLOCKER"
  | "PARTNER_BLOCKER"
  | "SUPPORT_BLOCKER"
  | "INCIDENT_BLOCKER"
  | "EXECUTION_BLOCKER"
  | "CERTIFICATION_BLOCKER";

/** Who is capable of clearing a blocker — the four clearance families. */
export type ClearanceFamily = "SYSTEM_CLEARABLE" | "HUMAN_CLEARABLE" | "EXTERNAL_CLEARABLE" | "EXECUTION_CLEARABLE" | "CERTIFICATION_CLEARABLE";

export type MetaTask = "OWNER_ASSIGNMENT_REQUIRED" | "ACTION_DEFINITION_REQUIRED" | "EVIDENCE_DEFINITION_REQUIRED";

export const BLOCKER_TYPE_FAMILY: Record<BlockerType, ClearanceFamily> = {
  BUILD_BLOCKER: "SYSTEM_CLEARABLE",
  CONFIGURATION_BLOCKER: "SYSTEM_CLEARABLE",
  INTEGRATION_BLOCKER: "SYSTEM_CLEARABLE",
  DATA_BLOCKER: "SYSTEM_CLEARABLE",
  ENVIRONMENT_BLOCKER: "EXTERNAL_CLEARABLE",
  EVIDENCE_BLOCKER: "HUMAN_CLEARABLE",
  APPROVAL_BLOCKER: "HUMAN_CLEARABLE",
  LEGAL_BLOCKER: "EXTERNAL_CLEARABLE",
  COMMERCIAL_BLOCKER: "HUMAN_CLEARABLE",
  FINANCIAL_BLOCKER: "HUMAN_CLEARABLE",
  OPERATIONS_BLOCKER: "HUMAN_CLEARABLE",
  PARTNER_BLOCKER: "EXTERNAL_CLEARABLE",
  SUPPORT_BLOCKER: "HUMAN_CLEARABLE",
  INCIDENT_BLOCKER: "HUMAN_CLEARABLE",
  EXECUTION_BLOCKER: "EXECUTION_CLEARABLE",
  CERTIFICATION_BLOCKER: "CERTIFICATION_CLEARABLE",
};

export const FAMILY_LABEL: Record<ClearanceFamily, string> = {
  SYSTEM_CLEARABLE: "System-clearable — build / configure / integrate / prepare",
  HUMAN_CLEARABLE: "Human-clearable — accountable owner decision",
  EXTERNAL_CLEARABLE: "External-clearable — third party, authority or credential",
  EXECUTION_CLEARABLE: "Execution-clearable — authorised execution then evidence",
  CERTIFICATION_CLEARABLE: "Certification-gated — prerequisites must exist first",
};

/* ------------------------------ owner routing ------------------------------ */

const OWNER_ROLE: Record<string, string> = {
  engineering: "Engineering Lead",
  security: "Information Security Architect",
  finance: "Head of Finance",
  legal: "General Counsel",
  operations: "Head of Operations",
  commercial: "Commercial Director",
  support: "Head of Customer Support",
};

const TRACK_TAB: Record<ReadinessTrack, string> = {
  ARCHITECTURE_DOMAIN: "engineering",
  APPLICATION_SECURITY: "engineering",
  DATABASE_INFRASTRUCTURE: "infrastructure",
  DATA_INTEGRITY: "engineering",
  LEGAL_REGULATORY: "legal",
  OPERATIONS: "operations",
  COMMERCIAL: "approvals",
  FINANCIAL_CONTROLS: "approvals",
  PARTNER_COMPLIANCE: "approvals",
  CUSTOMER_SUPPORT: "approvals",
  INCIDENT_RECOVERY: "approvals",
  OPERATIONAL_PILOT: "pilot",
  FINAL_CERTIFICATION: "certification",
};

const EVIDENCE_TRACK_TYPE: Partial<Record<ReadinessTrack, BlockerType>> = {
  OPERATIONS: "OPERATIONS_BLOCKER",
  FINANCIAL_CONTROLS: "FINANCIAL_BLOCKER",
  COMMERCIAL: "COMMERCIAL_BLOCKER",
  PARTNER_COMPLIANCE: "PARTNER_BLOCKER",
  CUSTOMER_SUPPORT: "SUPPORT_BLOCKER",
  INCIDENT_RECOVERY: "INCIDENT_BLOCKER",
  DATA_INTEGRITY: "DATA_BLOCKER",
};

export function blockerTypeFor(c: CommandCenterControl): BlockerType {
  const cls: RemediationClass = c.classification.remediation_class;
  if (c.track === "FINAL_CERTIFICATION") return "CERTIFICATION_BLOCKER";
  if (cls === "GENUINE_FAILURE" || cls === "BUILDABLE") return "BUILD_BLOCKER";
  if (cls === "CONFIGURABLE") return "CONFIGURATION_BLOCKER";
  if (cls === "INTEGRATABLE") return "INTEGRATION_BLOCKER";
  if (cls === "LEGAL_DETERMINATION_REQUIRED") return "LEGAL_BLOCKER";
  if (cls === "BUSINESS_TARGET_REQUIRED") return "COMMERCIAL_BLOCKER";
  if (cls === "TESTABLE") return "EXECUTION_BLOCKER";
  if (cls === "EXTERNAL_INFRASTRUCTURE_REQUIRED") {
    return c.control_id === "DI-00" ? "ENVIRONMENT_BLOCKER" : "EXECUTION_BLOCKER";
  }
  if (cls === "HUMAN_APPROVAL_REQUIRED") return EVIDENCE_TRACK_TYPE[c.track] ?? "APPROVAL_BLOCKER";
  return EVIDENCE_TRACK_TYPE[c.track] ?? "EVIDENCE_BLOCKER";
}

/* ------------------------------ blocker record ----------------------------- */

export interface BlockerRecord {
  control_id: string;
  control_name: string;
  control_category: ReadinessTrack;
  severity: Severity;
  priority: number;
  current_state: string;
  blocker_type: BlockerType;
  clearance_family: ClearanceFamily;
  root_cause: string;
  parent_dependency: string | null;
  child_dependencies: string[];
  owner: string;
  accountable_owner: string;
  required_action: string;
  system_action: string | null;
  human_action: string | null;
  external_action: string | null;
  execution_required: boolean;
  evidence_required: string;
  evidence_status: "MISSING" | "UPLOADED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED";
  approval_required: boolean;
  approval_status: "NOT_REQUIRED" | "NOT_SUBMITTED" | "AWAITING_DECISION" | "APPROVED" | "REJECTED" | "REVISION_REQUESTED" | "EXPIRED";
  deadline: string | null;
  expiry: string | null;
  activation_impact: string;
  production_impact: string;
  next_action: string;
  clearance_condition: string;
  route: string;
  meta_tasks: MetaTask[];
}

const SEVERITY_WEIGHT: Record<Severity, number> = { CRITICAL: 0, HIGH: 100, MEDIUM: 200 };

function evidenceStatus(c: CommandCenterControl): BlockerRecord["evidence_status"] {
  const rec = c.evidence_record;
  if (c.status === "EXPIRED") return "EXPIRED";
  if (!rec) return c.pilot_run ? "UPLOADED" : "MISSING";
  switch (rec.workflow_state) {
    case "APPROVED":
      return "ACCEPTED";
    case "REJECTED":
      return "REJECTED";
    case "REVISION_REQUESTED":
      return "REJECTED";
    case "SUPERSEDED":
      return "SUPERSEDED";
    case "SUBMITTED":
    case "UNDER_REVIEW":
      return "UNDER_REVIEW";
    default:
      return "UPLOADED";
  }
}

function approvalStatus(c: CommandCenterControl, required: boolean): BlockerRecord["approval_status"] {
  if (!required) return "NOT_REQUIRED";
  const rec = c.evidence_record;
  if (c.status === "EXPIRED") return "EXPIRED";
  if (!rec) return "NOT_SUBMITTED";
  if (rec.workflow_state === "APPROVED") return "APPROVED";
  if (rec.workflow_state === "REJECTED") return "REJECTED";
  if (rec.workflow_state === "REVISION_REQUESTED") return "REVISION_REQUESTED";
  return "AWAITING_DECISION";
}

/**
 * Parent dependency, derived from the encoded certification order:
 * infrastructure → database assurance → operations → pilot → certification.
 */
export function parentDependencyFor(c: CommandCenterControl, infraReady: boolean): string | null {
  if (c.control_id === "DI-00") return null;
  if (c.track === "DATABASE_INFRASTRUCTURE") return infraReady ? null : "DI-00";
  if (c.track === "OPERATIONAL_PILOT") return infraReady ? null : "DI-00";
  if (c.track === "FINAL_CERTIFICATION") return "ALL_MANDATORY_CONTROLS";
  return null;
}

export interface BlockerRegister {
  blockers: BlockerRecord[];
  byFamily: { family: ClearanceFamily; count: number; controls: string[] }[];
  byType: { blocker_type: BlockerType; count: number }[];
  /** Controls whose parent dependency is unmet — cannot be worked yet. */
  gatedByParent: string[];
  /** Controls that can be worked right now (parent satisfied). */
  actionableNow: string[];
  /** Invariant: every blocker has owner + action + evidence + next step. */
  deadEnds: string[];
  metaTasks: { control_id: string; task: MetaTask }[];
  graph: DependencyNode[];
}

export interface DependencyNode {
  control_id: string;
  blocked_by: string[];
  waiting_for: string[];
  unlocks: string[];
}

export function buildBlockerRegister(
  controls: CommandCenterControl[],
  infraReady: boolean,
): BlockerRegister {
  const outstanding = controls.filter((c) => c.blocking && c.status !== "PASS");
  const outstandingIds = new Set(outstanding.map((c) => c.control_id));

  const children = (id: string) =>
    outstanding.filter((c) => parentDependencyFor(c, infraReady) === id).map((c) => c.control_id);

  const blockers: BlockerRecord[] = outstanding.map((c) => {
    const type = blockerTypeFor(c);
    const family = BLOCKER_TYPE_FAMILY[type];
    const parent = parentDependencyFor(c, infraReady);
    const execution = family === "EXECUTION_CLEARABLE";
    const approvalRequired = family === "HUMAN_CLEARABLE" || family === "EXTERNAL_CLEARABLE" || execution;

    const owner = OWNER_ROLE[c.owner] ?? "";
    const accountable = c.approval_authority?.trim() ?? "";
    const action = c.classification.action?.trim() ?? "";
    const evidence = c.required_evidence?.trim() ?? "";

    const meta: MetaTask[] = [];
    if (!owner && !accountable) meta.push("OWNER_ASSIGNMENT_REQUIRED");
    if (!action) meta.push("ACTION_DEFINITION_REQUIRED");
    if (!evidence) meta.push("EVIDENCE_DEFINITION_REQUIRED");

    const systemAction =
      family === "SYSTEM_CLEARABLE"
        ? c.remediation || action
        : execution
          ? "Prepare fixtures, identities and the execution window; capture the raw result as evidence."
          : "Present the evidence workspace, validate the submission and re-evaluate on approval.";
    const humanAction =
      family === "HUMAN_CLEARABLE" || execution
        ? `${accountable || owner || "OWNER_ASSIGNMENT_REQUIRED"} must ${execution ? "authorise the execution window and accept the recorded result" : "review the evidence and record a decision"}.`
        : null;
    const externalAction =
      family === "EXTERNAL_CLEARABLE"
        ? type === "ENVIRONMENT_BLOCKER"
          ? "Provision a non-production PostgreSQL instance plus a separate restore target and register both."
          : type === "LEGAL_BLOCKER"
            ? "Obtain the determination or document from the issuing authority / external counsel."
            : "Obtain the third-party document, credential or attestation and file it against this control."
        : null;

    const nextAction =
      parent && outstandingIds.has(parent)
        ? `Blocked by ${parent} — clear the parent dependency first.`
        : meta.length > 0
          ? `Resolve ${meta.join(", ").toLowerCase().split("_").join(" ")} before this control can be worked.`
          : action || "ACTION_DEFINITION_REQUIRED";

    return {
      control_id: c.control_id,
      control_name: c.description,
      control_category: c.track,
      severity: c.severity,
      priority: SEVERITY_WEIGHT[c.severity] + (parent && outstandingIds.has(parent) ? 50 : 0),
      current_state: c.status,
      blocker_type: type,
      clearance_family: family,
      root_cause: c.classification.why,
      parent_dependency: parent,
      child_dependencies: children(c.control_id),
      owner: owner || "OWNER_ASSIGNMENT_REQUIRED",
      accountable_owner: accountable || owner || "OWNER_ASSIGNMENT_REQUIRED",
      required_action: action || "ACTION_DEFINITION_REQUIRED",
      system_action: systemAction || null,
      human_action: humanAction,
      external_action: externalAction,
      execution_required: execution,
      evidence_required: evidence || "EVIDENCE_DEFINITION_REQUIRED",
      evidence_status: evidenceStatus(c),
      approval_required: approvalRequired,
      approval_status: approvalStatus(c, approvalRequired),
      deadline: null,
      expiry: c.expiry_at,
      activation_impact:
        c.severity === "CRITICAL"
          ? "Blocks production activation of every service that depends on this track."
          : "Constrains activation scope until cleared.",
      production_impact: `Holds ${c.track.split("_").join(" ").toLowerCase()} readiness at ${c.status.split("_").join(" ").toLowerCase()}.`,
      next_action: nextAction,
      clearance_condition: evidence || "EVIDENCE_DEFINITION_REQUIRED",
      route: `?tab=${TRACK_TAB[c.track]}`,
      meta_tasks: meta,
    };
  });

  blockers.sort((a, b) => a.priority - b.priority || a.control_id.localeCompare(b.control_id));

  const families: ClearanceFamily[] = [
    "SYSTEM_CLEARABLE",
    "EXECUTION_CLEARABLE",
    "HUMAN_CLEARABLE",
    "EXTERNAL_CLEARABLE",
    "CERTIFICATION_CLEARABLE",
  ];
  const byFamily = families
    .map((f) => ({
      family: f,
      count: blockers.filter((b) => b.clearance_family === f).length,
      controls: blockers.filter((b) => b.clearance_family === f).map((b) => b.control_id),
    }))
    .filter((r) => r.count > 0);

  const typeCounts = new Map<BlockerType, number>();
  for (const b of blockers) typeCounts.set(b.blocker_type, (typeCounts.get(b.blocker_type) ?? 0) + 1);
  const byType = [...typeCounts.entries()]
    .map(([blocker_type, count]) => ({ blocker_type, count }))
    .sort((a, b) => b.count - a.count);

  const gatedByParent = blockers.filter((b) => b.parent_dependency && outstandingIds.has(b.parent_dependency)).map((b) => b.control_id);
  const actionableNow = blockers.filter((b) => !gatedByParent.includes(b.control_id)).map((b) => b.control_id);

  const deadEnds = blockers
    .filter(
      (b) =>
        !b.next_action ||
        b.owner === "OWNER_ASSIGNMENT_REQUIRED" && b.accountable_owner === "OWNER_ASSIGNMENT_REQUIRED" && b.meta_tasks.length === 0,
    )
    .map((b) => b.control_id);

  const metaTasks = blockers.flatMap((b) => b.meta_tasks.map((task) => ({ control_id: b.control_id, task })));

  const graph: DependencyNode[] = blockers.map((b) => ({
    control_id: b.control_id,
    blocked_by: b.parent_dependency && outstandingIds.has(b.parent_dependency) ? [b.parent_dependency] : [],
    waiting_for:
      b.clearance_family === "SYSTEM_CLEARABLE"
        ? ["platform implementation"]
        : b.clearance_family === "EXECUTION_CLEARABLE"
          ? ["authorised execution + recorded result"]
          : b.clearance_family === "EXTERNAL_CLEARABLE"
            ? ["external authority / credential"]
            : b.clearance_family === "CERTIFICATION_CLEARABLE"
              ? ["all mandatory controls"]
              : [`${b.accountable_owner} decision`],
    unlocks: b.child_dependencies,
  }));

  return { blockers, byFamily, byType, gatedByParent, actionableNow, deadEnds, metaTasks, graph };
}

export const BLOCKER_TYPE_LABEL: Record<BlockerType, string> = {
  BUILD_BLOCKER: "Build",
  CONFIGURATION_BLOCKER: "Configuration",
  INTEGRATION_BLOCKER: "Integration",
  DATA_BLOCKER: "Data",
  ENVIRONMENT_BLOCKER: "Environment",
  EVIDENCE_BLOCKER: "Evidence",
  APPROVAL_BLOCKER: "Approval",
  LEGAL_BLOCKER: "Legal",
  COMMERCIAL_BLOCKER: "Commercial",
  FINANCIAL_BLOCKER: "Financial",
  OPERATIONS_BLOCKER: "Operations",
  PARTNER_BLOCKER: "Partner",
  SUPPORT_BLOCKER: "Support",
  INCIDENT_BLOCKER: "Incident",
  EXECUTION_BLOCKER: "Execution",
  CERTIFICATION_BLOCKER: "Certification",
};
