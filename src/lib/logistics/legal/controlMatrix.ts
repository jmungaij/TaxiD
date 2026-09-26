/**
 * LG CONTROL STATUS MATRIX — LG-01…LG-15 (+ LG-GOODS).
 *
 * This is a PURE PROJECTION over data that already exists:
 *   • LG_DOSSIER            — the controlled draft documents and their true evidentiary state
 *   • CONTROL_RESPONSIBILITY — which party owns the underlying obligation
 *   • lg_dossier_approvals   — the recorded legal / insurer / owner decisions
 *   • ENGINEERING_ENFORCEMENT — the platform control that is actually wired into the live spine
 *
 * It creates NO new legal system, NO new approval mechanism and NO new evidence
 * store. Its only job is to stop a single "status" collapsing five different
 * questions into one, so that:
 *
 *   - an implemented engineering gate is never reported as a legal approval;
 *   - a Fleet Owner's document pack is never reported as a Yalla licence;
 *   - a control is only ever LEGALLY_CLEARED when the required approvers have
 *     actually approved the current document version.
 *
 * Nothing here can mark a control closed. There is deliberately no override,
 * force or "mark cleared" function in this module.
 */

import { LG_DOSSIER, type LgDossierEntry } from "./dossier";
import { responsibilityFor, type ResponsibleParty } from "./responsibilityModel";
import { lgRequiredApprovers, type LgApproverKind, type LgApprovalRow } from "./dossierControl";

export type DimensionStatus =
  | "PROVEN"
  | "IMPLEMENTED"
  | "POPULATION_ENFORCED"
  | "PENDING_APPROVAL"
  | "NOT_PROVEN"
  | "NOT_IMPLEMENTED"
  | "NOT_APPLICABLE";

export interface DimensionVerdict {
  status: DimensionStatus;
  /** Why this status — always states the source of truth, never a claim. */
  basis: string;
}

export type ControlOverall =
  | "LEGALLY_CLEARED"
  | "ENGINEERING IMPLEMENTED — LEGAL APPROVAL PENDING"
  | "PENDING APPROVAL"
  | "NOT PROVEN";

export interface EngineeringEnforcement {
  control_id: string;
  /** The live platform control, named by its actual system of record. */
  control: string;
  /** Where it is enforced in the running spine. */
  enforced_at: string;
  /** What the platform control does NOT establish. Never empty. */
  does_not_establish: string;
}

/**
 * What the platform genuinely enforces today, per control. Each entry names an
 * existing mechanism — no aspirational controls, and every entry states what
 * the mechanism does not prove.
 */
export const ENGINEERING_ENFORCEMENT: EngineeringEnforcement[] = [
  {
    control_id: "LG-01",
    control: "Facilitator disclosure and service attribution (responsibilityModel.FACILITATOR_DISCLOSURE)",
    enforced_at: "Customer-facing booking surfaces and carrier agreements",
    does_not_establish:
      "Does not determine Yalla's regulatory classification and does not evidence any Communications Authority licence.",
  },
  {
    control_id: "LG-02",
    control: "carrier_compliance_items (FO-CAK-COURIER-LICENCE, FO-TRANSPORT-LICENCE) + carrier_dispatch_gate",
    enforced_at: "Fleet Owner onboarding, matchability evaluation, dispatch gate (fail-closed)",
    does_not_establish: "Does not mean Yalla holds a transport operator authority.",
  },
  {
    control_id: "LG-03",
    control: "carrier_compliance_items at DRIVER level + carrier_subject_eligibility('DRIVER')",
    enforced_at: "Driver assignment and dispatch acceptance",
    does_not_establish: "Does not verify a driver beyond the document evidence actually filed and verified.",
  },
  {
    control_id: "LG-04",
    control: "carrier_compliance_items at VEHICLE level + carrier_subject_eligibility('VEHICLE')",
    enforced_at: "Vehicle assignment and dispatch",
    does_not_establish: "Does not substitute for a statutory inspection certificate.",
  },
  {
    control_id: "LG-05",
    control: "carrier_compliance_items (FO-MOTOR-INSURANCE, VEH-INSURANCE) with expiry tracking",
    enforced_at: "Matchability gate and dispatch gate",
    does_not_establish: "Does not create any Yalla-held insurance cover.",
  },
  {
    control_id: "LG-06",
    control: "Goods-in-transit protection check in the goods policy engine (protection_in_force)",
    enforced_at: "Booking-time goods evaluation",
    does_not_establish: "Does not evidence an in-force goods-in-transit policy, limits or exclusions.",
  },
  {
    control_id: "LG-07",
    control: "Restricted goods rules in the goods policy engine (conditional requirements)",
    enforced_at: "Booking-time goods evaluation — refuses on unmet conditions",
    does_not_establish: "Does not confirm the legal accuracy of the restricted-goods list.",
  },
  {
    control_id: "LG-08",
    control: "Prohibited goods refusal in the goods policy engine (PROHIBITED, UNKNOWN refused)",
    enforced_at: "Booking-time goods evaluation — hard refusal",
    does_not_establish: "Does not confirm the legal completeness of the prohibited-goods list.",
  },
  {
    control_id: "LG-09",
    control: "Immutable POD evidence chain (carrier_pod_submissions, hashed evidence, four-eyes review)",
    enforced_at: "Delivery evidence submission and admin release",
    does_not_establish: "Does not constitute an approved claims-handling standard or an insurer process.",
  },
  {
    control_id: "LG-10",
    control: "Liability allocation recorded in the Fleet Owner agreement and indemnity declarations",
    enforced_at: "Carrier declarations gate (FLEET_OWNER_AGREEMENT, INDEMNITY_ACCEPTANCE)",
    does_not_establish: "Does not determine enforceable liability limits under Kenyan law.",
  },
  {
    control_id: "LG-11",
    control: "Customer terms acceptance recorded at booking with the facilitator disclosure",
    enforced_at: "Booking flow",
    does_not_establish: "Does not mean the terms of carriage have been legally reviewed or approved.",
  },
  {
    control_id: "LG-12",
    control: "Versioned carrier declarations bound to the Fleet Owner agreement version",
    enforced_at: "Fleet Owner onboarding; matchability requires accepted declarations",
    does_not_establish: "Does not evidence an executed, counsel-approved partner agreement.",
  },
  {
    control_id: "LG-13",
    control: "RLS tenant isolation, staff permission scoping and the EXECUTE grant contract",
    enforced_at: "Every data path (database policies and function grants)",
    does_not_establish: "Does not determine the lawful basis for processing under the Data Protection Act.",
  },
  {
    control_id: "LG-14",
    control: "Append-only audit and evidence tables with document forensics",
    enforced_at: "Ledger, audit, document and evidence writes",
    does_not_establish: "Does not evidence an approved retention schedule or cross-border transfer basis.",
  },
  {
    control_id: "LG-15",
    control: "Jurisdiction check in the goods policy engine (non-KE jurisdictions refused)",
    enforced_at: "Booking-time goods evaluation",
    does_not_establish: "Does not evidence any cross-border or regional operating authority.",
  },
  {
    control_id: "LG-GOODS",
    control: "Goods classification policy engine — unclassified goods are refused, never defaulted",
    enforced_at: "Booking-time goods evaluation",
    does_not_establish: "Does not confirm the classification taxonomy is legally complete.",
  },
];

const enforcementFor = (controlId: string): EngineeringEnforcement | null =>
  ENGINEERING_ENFORCEMENT.find((e) => e.control_id === controlId) ?? null;

export interface ControlStatusRow {
  control_id: string;
  document_id: string;
  title: string;
  party: ResponsibleParty | "PLATFORM";
  evidence_scope: "SINGLE_DOCUMENT" | "POPULATION";
  legal: DimensionVerdict;
  engineering: DimensionVerdict;
  evidence: DimensionVerdict;
  approval: DimensionVerdict;
  operational: DimensionVerdict;
  commercial: DimensionVerdict;
  overall: ControlOverall;
  /** Approver kinds that must still decide on the current document version. */
  outstanding_approvers: LgApproverKind[];
  owner: string;
  next_action: string;
}

const APPROVED = new Set(["approved", "approved_with_conditions"]);

function approvalsFor(controlId: string, approvals: LgApprovalRow[]): LgApprovalRow[] {
  return approvals.filter((a) => a.control_id === controlId);
}

function outstanding(controlId: string, approvals: LgApprovalRow[]): LgApproverKind[] {
  const decided = new Set(
    approvalsFor(controlId, approvals)
      .filter((a) => APPROVED.has(String(a.decision)))
      .map((a) => a.approver_kind as LgApproverKind),
  );
  return lgRequiredApprovers(controlId).filter((k) => !decided.has(k));
}

function ownerFor(entry: LgDossierEntry, party: ResponsibleParty | "PLATFORM"): string {
  if (party !== "PLATFORM") return "Platform compliance (population evidence) + independent Fleet Owner";
  if (entry.evidence_type === "INSURANCE_POLICY") return "Finance / insurance owner + insurer";
  if (entry.evidence_type === "REGULATORY_LICENCE") return "Legal counsel + regulator";
  return "Legal counsel + company owner";
}

/**
 * Projects one control into six independent status dimensions.
 * No dimension can be supplied by the caller — every value is derived.
 */
export function projectControlStatus(entry: LgDossierEntry, approvals: LgApprovalRow[]): ControlStatusRow {
  const resp = responsibilityFor(entry.control_id);
  const party: ResponsibleParty | "PLATFORM" = resp?.party ?? "PLATFORM";
  const scope = resp?.evidence_scope ?? "SINGLE_DOCUMENT";
  const eng = enforcementFor(entry.control_id);
  const rejected = approvalsFor(entry.control_id, approvals).some((a) => String(a.decision) === "rejected");
  const missing = outstanding(entry.control_id, approvals);
  const anyDecision = approvalsFor(entry.control_id, approvals).some((a) => APPROVED.has(String(a.decision)));

  const approval: DimensionVerdict = rejected
    ? { status: "NOT_PROVEN", basis: "A recorded approver rejected the current document version." }
    : missing.length === 0
      ? { status: "PROVEN", basis: `All required approvers recorded a decision: ${lgRequiredApprovers(entry.control_id).join(", ")}.` }
      : { status: "PENDING_APPROVAL", basis: `Awaiting: ${missing.join(", ")} (lg_dossier_approvals).` };

  const engineering: DimensionVerdict = eng
    ? { status: scope === "POPULATION" ? "POPULATION_ENFORCED" : "IMPLEMENTED", basis: `${eng.control} — enforced at ${eng.enforced_at}. ${eng.does_not_establish}` }
    : { status: "NOT_IMPLEMENTED", basis: "No live platform control is claimed for this legal control." };

  const evidence: DimensionVerdict =
    approval.status === "PROVEN"
      ? { status: "PROVEN", basis: "Approved document version is the evidence of record in Documents 360." }
      : anyDecision
        ? { status: "PENDING_APPROVAL", basis: `Partial approval recorded; authoritative fields still required: ${entry.authoritative_fields.join(", ") || "none"}.` }
        : { status: "NOT_PROVEN", basis: `Draft filed as ${entry.draft_state}. Authoritative fields outstanding: ${entry.authoritative_fields.join(", ") || "none"}.` };

  const legal: DimensionVerdict =
    approval.status === "PROVEN"
      ? { status: "PROVEN", basis: "Legal determination approved and effective; approval record is the authority." }
      : { status: "NOT_PROVEN", basis: "No approved legal determination of record. Engineering enforcement is not a legal approval." };

  const operational: DimensionVerdict = eng
    ? { status: legal.status === "PROVEN" ? "PROVEN" : "IMPLEMENTED", basis: entry.operational_linkage }
    : { status: "NOT_IMPLEMENTED", basis: entry.operational_linkage };

  const commercial: DimensionVerdict =
    party === "PLATFORM"
      ? { status: legal.status === "PROVEN" ? "PROVEN" : "NOT_PROVEN", basis: "Platform may only market a service the approved determination permits." }
      : { status: "POPULATION_ENFORCED", basis: "Commercially exposed per Fleet Owner only while that Fleet Owner's own evidence is verified and unexpired." };

  const overall: ControlOverall =
    legal.status === "PROVEN"
      ? "LEGALLY_CLEARED"
      : engineering.status === "NOT_IMPLEMENTED"
        ? "NOT PROVEN"
        : anyDecision
          ? "PENDING APPROVAL"
          : "ENGINEERING IMPLEMENTED — LEGAL APPROVAL PENDING";

  const next_action =
    overall === "LEGALLY_CLEARED"
      ? "Monitor expiry / renewal of the approved evidence."
      : missing.length > 0
        ? `Obtain and record: ${missing.join(", ")} decision on ${entry.document_id}.`
        : "Record the authoritative fields and re-file the document version for approval.";

  return {
    control_id: entry.control_id,
    document_id: entry.document_id,
    title: entry.title,
    party,
    evidence_scope: scope,
    legal,
    engineering,
    evidence,
    approval,
    operational,
    commercial,
    overall,
    outstanding_approvers: missing,
    owner: ownerFor(entry, party),
    next_action,
  };
}

export interface ControlMatrix {
  generated_at: string;
  rows: ControlStatusRow[];
  counts: Record<ControlOverall, number>;
  /** True only when every control is legally cleared — never asserted otherwise. */
  legally_certified: boolean;
  certification_statement: string;
}

export function buildLegalControlMatrix(approvals: LgApprovalRow[], nowIso?: string): ControlMatrix {
  const rows = LG_DOSSIER.map((e) => projectControlStatus(e, approvals));
  const counts: Record<ControlOverall, number> = {
    LEGALLY_CLEARED: 0,
    "ENGINEERING IMPLEMENTED — LEGAL APPROVAL PENDING": 0,
    "PENDING APPROVAL": 0,
    "NOT PROVEN": 0,
  };
  for (const r of rows) counts[r.overall] += 1;
  const legally_certified = rows.length > 0 && rows.every((r) => r.overall === "LEGALLY_CLEARED");

  return {
    generated_at: nowIso ?? new Date().toISOString(),
    rows,
    counts,
    legally_certified,
    certification_statement: legally_certified
      ? "All LG controls hold an approved legal determination of record."
      : `NOT LEGALLY CERTIFIED — ${rows.length - counts.LEGALLY_CLEARED} of ${rows.length} controls lack an approved legal determination. Engineering enforcement is implemented but is not a legal approval.`,
  };
}

/** Machine-readable export of the matrix for the certification register. */
export function legalControlMatrixCsv(matrix: ControlMatrix): string {
  const head = [
    "control_id", "document_id", "party", "evidence_scope", "legal_status", "engineering_status",
    "evidence_status", "approval_status", "operational_status", "commercial_status", "overall",
    "outstanding_approvers", "owner", "next_action",
  ];
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = matrix.rows.map((r) =>
    [
      r.control_id, r.document_id, r.party, r.evidence_scope, r.legal.status, r.engineering.status,
      r.evidence.status, r.approval.status, r.operational.status, r.commercial.status, r.overall,
      r.outstanding_approvers.join("|"), r.owner, r.next_action,
    ].map(esc).join(","),
  );
  return [head.join(","), ...lines].join("\n");
}
