/**
 * READINESS CLOSURE ORCHESTRATOR.
 *
 * A pure projection over the EXISTING readiness engines. It creates no second
 * readiness database, no second evidence store and no approval mechanism: it
 * reads the evidence-overlaid control plane (execution.ts), the classification
 * engine (classification.ts) and the blocker taxonomy (blockerContract.ts), and
 * publishes, for every control, exactly one precise closure state plus the
 * acceptance criterion, evidence requirement, owner, approver, dependencies,
 * downstream impact, evidence validity and audit status.
 *
 * INTEGRITY RULES
 *  1. Read-only. Nothing here sets, forces, infers or upgrades a status.
 *  2. `PASS` is echoed from the control plane only — never derived here.
 *  3. Generic HOLD is never emitted: a precise blocker state is always chosen.
 *  4. Human decisions stay human — a closure state only routes the action.
 */
import type { CommandCenterControl, CommandCenterView } from "./execution";
import type { ReadinessTrack } from "./controlPlane";
import {
  BLOCKER_TYPE_FAMILY,
  blockerTypeFor,
  parentDependencyFor,
  type BlockerType,
  type ClearanceFamily,
} from "./blockerContract";

/* ------------------------------- taxonomy ------------------------------- */

export type ClosureState =
  | "PASS"
  | "FAIL"
  | "EXPIRED"
  | "INVALIDATED"
  | "SOFTWARE_REQUIRED"
  | "CONFIGURATION_REQUIRED"
  | "EVIDENCE_REQUIRED"
  | "OWNER_APPROVAL_REQUIRED"
  | "LEGAL_APPROVAL_REQUIRED"
  | "PROVIDER_CONFIGURATION_REQUIRED"
  | "EXTERNAL_EXECUTION_REQUIRED"
  | "DEPENDENCY_BLOCKED";

export const CLOSURE_STATE_LABEL: Record<ClosureState, string> = {
  PASS: "Pass — authoritative evidence held",
  FAIL: "Fail — executed and failed",
  EXPIRED: "Expired — evidence no longer valid",
  INVALIDATED: "Invalidated — underlying identity changed",
  SOFTWARE_REQUIRED: "Software required",
  CONFIGURATION_REQUIRED: "Configuration required",
  EVIDENCE_REQUIRED: "Evidence required",
  OWNER_APPROVAL_REQUIRED: "Owner approval required",
  LEGAL_APPROVAL_REQUIRED: "Legal approval required",
  PROVIDER_CONFIGURATION_REQUIRED: "Provider configuration required",
  EXTERNAL_EXECUTION_REQUIRED: "External execution required",
  DEPENDENCY_BLOCKED: "Dependency blocked",
};

export type ClosureFilter =
  | "ALL"
  | "SOFTWARE"
  | "LEGAL"
  | "OPERATIONS"
  | "COMMERCIAL"
  | "FINANCE"
  | "PARTNER"
  | "SUPPORT"
  | "RECOVERY"
  | "PILOT"
  | "OWNER_ACTION"
  | "PROVIDER_ACTION"
  | "EXTERNAL_EXECUTION"
  | "BLOCKED"
  | "PASS";

export const CLOSURE_FILTERS: { key: ClosureFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "SOFTWARE", label: "Software" },
  { key: "LEGAL", label: "Legal" },
  { key: "OPERATIONS", label: "Operations" },
  { key: "COMMERCIAL", label: "Commercial" },
  { key: "FINANCE", label: "Finance" },
  { key: "PARTNER", label: "Partner" },
  { key: "SUPPORT", label: "Support" },
  { key: "RECOVERY", label: "Recovery" },
  { key: "PILOT", label: "Pilot" },
  { key: "OWNER_ACTION", label: "Owner action" },
  { key: "PROVIDER_ACTION", label: "Provider action" },
  { key: "EXTERNAL_EXECUTION", label: "External execution" },
  { key: "BLOCKED", label: "Blocked" },
  { key: "PASS", label: "Pass" },
];

export type EvidenceValidity = "VALID" | "EXPIRED" | "INVALIDATED" | "PENDING_APPROVAL" | "REJECTED" | "ABSENT";

const OWNER_ROLE: Record<string, string> = {
  engineering: "Engineering Lead",
  security: "Information Security Architect",
  finance: "Head of Finance",
  legal: "General Counsel",
  operations: "Head of Operations",
  commercial: "Commercial Director",
  support: "Head of Customer Support",
};

const TRACK_DOMAIN: Partial<Record<ReadinessTrack, ClosureFilter>> = {
  LEGAL_REGULATORY: "LEGAL",
  OPERATIONS: "OPERATIONS",
  COMMERCIAL: "COMMERCIAL",
  FINANCIAL_CONTROLS: "FINANCE",
  PARTNER_COMPLIANCE: "PARTNER",
  CUSTOMER_SUPPORT: "SUPPORT",
  INCIDENT_RECOVERY: "RECOVERY",
  OPERATIONAL_PILOT: "PILOT",
};

/** The control families this closure wave provides a capture surface for. */
export const CLOSURE_WAVE_TRACKS: ReadinessTrack[] = [
  "LEGAL_REGULATORY",
  "OPERATIONS",
  "COMMERCIAL",
  "CUSTOMER_SUPPORT",
  "PARTNER_COMPLIANCE",
];

export interface ClosureRow {
  control_id: string;
  domain: ClosureFilter;
  track: ReadinessTrack;
  severity: string;
  state: ClosureState;
  control_state: string;
  blocker: BlockerType | null;
  clearance_family: ClearanceFamily | null;
  why_blocked: string;
  acceptance_criterion: string;
  required_evidence: string;
  owner: string;
  approver: string;
  dependencies: string[];
  downstream_impact: string[];
  next_action: string;
  evidence_validity: EvidenceValidity;
  evidence_reference: string | null;
  last_verified: string | null;
  expiry: string | null;
  audit_status: "RECORDED" | "NONE";
  in_wave: boolean;
  blocking: boolean;
}

export interface ClosureInventory {
  generated_at: string;
  rows: ClosureRow[];
  totals: {
    total: number;
    pass: number;
    fail: number;
    not_tested: number;
    owner_approval: number;
    provider_configuration: number;
    external_execution: number;
    dependency_blocked: number;
    evidence_required: number;
    software_required: number;
    outstanding: number;
  };
  byState: { state: ClosureState; count: number; controls: string[] }[];
  graph: { control_id: string; depends_on: string[]; unlocks: string[] }[];
  waveOutstanding: ClosureRow[];
}

/* ------------------------------- derivation ------------------------------- */

function evidenceValidity(c: CommandCenterControl, now: string): EvidenceValidity {
  const st = c.st_execution;
  if (st?.invalidated_at) return "INVALIDATED";
  const rec = c.evidence_record;
  if (rec) {
    if (rec.workflow_state === "APPROVED") {
      return rec.expiry_at && new Date(rec.expiry_at) < new Date(now) ? "EXPIRED" : "VALID";
    }
    if (rec.workflow_state === "PENDING_APPROVAL") return "PENDING_APPROVAL";
    if (rec.workflow_state === "REJECTED" || rec.workflow_state === "REVISION_REQUESTED") return "REJECTED";
    if (rec.workflow_state === "EXPIRED") return "EXPIRED";
  }
  if (st && st.result === "PASS") return "VALID";
  if (c.pilot_run) return c.pilot_run.result === "PASS" ? "VALID" : "REJECTED";
  return "ABSENT";
}

/**
 * Precise closure state. Order matters: authoritative outcomes first, then the
 * dependency gate, then the blocker family that decides WHO can clear it.
 */
export function closureStateFor(
  c: CommandCenterControl,
  parent: string | null,
  parentSatisfied: boolean,
  validity: EvidenceValidity,
): ClosureState {
  if (c.status === "PASS") return "PASS";
  if (c.status === "FAIL") return "FAIL";
  if (c.status === "EXPIRED") return "EXPIRED";
  if (validity === "INVALIDATED") return "INVALIDATED";
  if (parent && !parentSatisfied) return "DEPENDENCY_BLOCKED";

  const type = blockerTypeFor(c);
  switch (type) {
    case "BUILD_BLOCKER":
      return "SOFTWARE_REQUIRED";
    case "CONFIGURATION_BLOCKER":
    case "INTEGRATION_BLOCKER":
      return "CONFIGURATION_REQUIRED";
    case "ENVIRONMENT_BLOCKER":
      return "PROVIDER_CONFIGURATION_REQUIRED";
    case "LEGAL_BLOCKER":
      return "LEGAL_APPROVAL_REQUIRED";
    case "PARTNER_BLOCKER":
      return validity === "PENDING_APPROVAL" ? "OWNER_APPROVAL_REQUIRED" : "EVIDENCE_REQUIRED";
    case "EXECUTION_BLOCKER":
      return "EXTERNAL_EXECUTION_REQUIRED";
    case "CERTIFICATION_BLOCKER":
      return "DEPENDENCY_BLOCKED";
    case "COMMERCIAL_BLOCKER":
    case "FINANCIAL_BLOCKER":
    case "APPROVAL_BLOCKER":
      return "OWNER_APPROVAL_REQUIRED";
    default:
      // Evidence-family blockers: an approval is only required once evidence exists.
      return validity === "PENDING_APPROVAL" ? "OWNER_APPROVAL_REQUIRED" : "EVIDENCE_REQUIRED";
  }
}

const NEXT_ACTION: Record<ClosureState, string> = {
  PASS: "No action — evidence held and valid.",
  FAIL: "Investigate the recorded failure and re-execute; a failure is never cleared by paperwork.",
  EXPIRED: "Submit a current document or re-execute; expired evidence cannot satisfy readiness.",
  INVALIDATED: "Re-execute against the certified isolated instance; the previous evidence identity changed.",
  SOFTWARE_REQUIRED: "Engineering builds the missing capability, then records the proof.",
  CONFIGURATION_REQUIRED: "Apply the missing configuration, then capture the configuration evidence.",
  EVIDENCE_REQUIRED: "Submit the authoritative document/record for approval via Resolve.",
  OWNER_APPROVAL_REQUIRED: "A different authorised approver must decide the submitted evidence.",
  LEGAL_APPROVAL_REQUIRED: "General Counsel must record the legal determination and its document of record.",
  PROVIDER_CONFIGURATION_REQUIRED: "Complete the provider/infrastructure configuration, then verify it.",
  EXTERNAL_EXECUTION_REQUIRED: "Execute the authorised run against the certified staging target, then record the result.",
  DEPENDENCY_BLOCKED: "Clear the prerequisite control first; this control cannot be worked yet.",
};

export function buildClosureInventory(view: CommandCenterView, now = new Date().toISOString()): ClosureInventory {
  const infraReady = view.infraReady;
  const byId = new Map(view.controls.map((c) => [c.control_id, c]));
  const satisfied = (id: string | null) => {
    if (!id) return true;
    if (id === "ALL_MANDATORY_CONTROLS") return view.controls.filter((c) => c.blocking).every((c) => c.status === "PASS");
    return byId.get(id)?.status === "PASS";
  };

  const parents = new Map<string, string | null>();
  for (const c of view.controls) parents.set(c.control_id, parentDependencyFor(c, infraReady));

  const rows: ClosureRow[] = view.controls.map((c) => {
    const parent = parents.get(c.control_id) ?? null;
    const validity = evidenceValidity(c, now);
    const state = closureStateFor(c, parent, satisfied(parent), validity);
    const type = c.status === "PASS" ? null : blockerTypeFor(c);
    const unlocks = view.controls
      .filter((o) => parents.get(o.control_id) === c.control_id && o.status !== "PASS")
      .map((o) => o.control_id);

    return {
      control_id: c.control_id,
      domain: TRACK_DOMAIN[c.track] ?? "SOFTWARE",
      track: c.track,
      severity: c.severity,
      state,
      control_state: c.status,
      blocker: type,
      clearance_family: type ? BLOCKER_TYPE_FAMILY[type] : null,
      why_blocked: c.status === "PASS" ? "" : c.classification.why,
      acceptance_criterion: c.description,
      required_evidence: c.required_evidence,
      owner: OWNER_ROLE[c.owner] ?? c.owner,
      approver: c.approval_authority,
      dependencies: parent ? [parent] : [],
      downstream_impact: unlocks,
      next_action: NEXT_ACTION[state],
      evidence_validity: validity,
      evidence_reference:
        c.evidence_record?.evidence_ref ?? c.st_execution?.evidence_sha256 ?? c.pilot_run?.evidence_ref ?? null,
      last_verified: c.last_tested_at ?? c.st_execution?.finished_at ?? null,
      expiry: c.evidence_record?.expiry_at ?? c.st_execution?.expires_at ?? c.expiry_at ?? null,
      audit_status: c.evidence_record || c.pilot_run || c.st_execution ? "RECORDED" : "NONE",
      in_wave: CLOSURE_WAVE_TRACKS.includes(c.track),
      blocking: c.blocking,
    };
  });

  const count = (s: ClosureState) => rows.filter((r) => r.state === s).length;
  const states = Array.from(new Set(rows.map((r) => r.state)));

  return {
    generated_at: now,
    rows,
    totals: {
      total: rows.length,
      pass: count("PASS"),
      fail: count("FAIL"),
      not_tested: rows.filter((r) => r.control_state === "NOT_TESTED").length,
      owner_approval: count("OWNER_APPROVAL_REQUIRED") + count("LEGAL_APPROVAL_REQUIRED"),
      provider_configuration: count("PROVIDER_CONFIGURATION_REQUIRED"),
      external_execution: count("EXTERNAL_EXECUTION_REQUIRED"),
      dependency_blocked: count("DEPENDENCY_BLOCKED"),
      evidence_required: count("EVIDENCE_REQUIRED"),
      software_required: count("SOFTWARE_REQUIRED") + count("CONFIGURATION_REQUIRED"),
      outstanding: rows.filter((r) => r.state !== "PASS" && r.blocking).length,
    },
    byState: states.map((s) => ({
      state: s,
      count: rows.filter((r) => r.state === s).length,
      controls: rows.filter((r) => r.state === s).map((r) => r.control_id),
    })),
    graph: rows.map((r) => ({ control_id: r.control_id, depends_on: r.dependencies, unlocks: r.downstream_impact })),
    waveOutstanding: rows.filter((r) => r.in_wave && r.state !== "PASS"),
  };
}

export function matchesClosureFilter(r: ClosureRow, f: ClosureFilter): boolean {
  switch (f) {
    case "ALL":
      return true;
    case "PASS":
      return r.state === "PASS";
    case "BLOCKED":
      return r.state === "DEPENDENCY_BLOCKED";
    case "OWNER_ACTION":
      return r.state === "OWNER_APPROVAL_REQUIRED" || r.state === "LEGAL_APPROVAL_REQUIRED";
    case "PROVIDER_ACTION":
      return r.state === "PROVIDER_CONFIGURATION_REQUIRED";
    case "EXTERNAL_EXECUTION":
      return r.state === "EXTERNAL_EXECUTION_REQUIRED";
    case "SOFTWARE":
      return r.state === "SOFTWARE_REQUIRED" || r.state === "CONFIGURATION_REQUIRED" || r.domain === "SOFTWARE";
    default:
      return r.domain === f;
  }
}

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** CSV export of the closure inventory, dependency graph and classifications. */
export function closureInventoryCsv(inv: ClosureInventory): string {
  const header = [
    "control_id", "domain", "track", "severity", "closure_state", "control_state", "blocker_type",
    "clearance_family", "why_blocked", "acceptance_criterion", "required_evidence", "owner", "approver",
    "depends_on", "unlocks", "next_action", "evidence_validity", "evidence_reference", "last_verified",
    "expiry", "audit_status", "in_closure_wave", "mandatory",
  ];
  const lines = inv.rows.map((r) =>
    [
      r.control_id, r.domain, r.track, r.severity, r.state, r.control_state, r.blocker ?? "",
      r.clearance_family ?? "", r.why_blocked, r.acceptance_criterion, r.required_evidence, r.owner, r.approver,
      r.dependencies.join(" "), r.downstream_impact.join(" "), r.next_action, r.evidence_validity,
      r.evidence_reference ?? "", r.last_verified ?? "", r.expiry ?? "", r.audit_status,
      r.in_wave ? "yes" : "no", r.blocking ? "yes" : "no",
    ].map(cell).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
