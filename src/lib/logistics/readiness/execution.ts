/**
 * READINESS EXECUTION LAYER.
 *
 * Converts the (read-only, evidence-derived) control plane into an executable
 * command centre view: classification, resolution workflow, critical path and a
 * strictly bounded evidence overlay.
 *
 * OVERLAY INTEGRITY RULES (non-negotiable):
 *  1. Only business-record controls whose classification is APPROVAL_CLEARABLE
 *     can be cleared by an approved evidence record.
 *  2. A database-dependent control is NEVER cleared by an approval. It can only
 *     move from BLOCKED to "unblocked, awaiting execution" once DI-00 holds.
 *  3. A pilot control is cleared only by a recorded pilot run with result PASS.
 *  4. A GENUINE_FAILURE is never cleared by evidence.
 *  5. An approved record with a past expiry date yields EXPIRED, not PASS.
 */
import {
  certifyLogisticsProductionReadiness,
  buildCertificationFrom,
  type LogisticsCertification,
  type ReadinessControl,
  type ReadinessTrack,
  type ControlStatus,
} from "./controlPlane";

import { classifyControl, APPROVAL_CLEARABLE, type ClassificationVerdict, type RemediationClass } from "./classification";

export interface EvidenceRecord {
  control_id: string;
  remediation_class: string;
  workflow_state: string;
  evidence_ref: string | null;
  document_path: string | null;
  effective_at: string | null;
  expiry_at: string | null;
  approver_email: string | null;
  decided_at: string | null;
  comments: string | null;
}

export interface PilotRunRecord {
  scenario_id: string;
  result: string;
  evidence_ref: string;
  observed_outcome: string;
  executed_at: string;
}

export interface InfraTargetRecord {
  target_role: string;
  label: string;
  endpoint_ref: string;
  synthetic_fixtures_loaded: boolean;
  isolation_verified: boolean;
  verified_at: string | null;
}

/**
 * A sealed ST certification execution recorded by the DI-00 orchestrator. This
 * is the ONLY way a database-dependent control may reach PASS: it describes an
 * execution against a real isolated PostgreSQL instance.
 */
export interface StExecutionRecord {
  control_id: string;
  result: string;
  environment_key: string | null;
  environment_fingerprint: string | null;
  evidence_sha256: string | null;
  first_failure: { assertion: string; expected: string; observed: string } | null;
  error_message: string | null;
  finished_at: string | null;
  expires_at: string | null;
  invalidated_at: string | null;
}

export interface ExecutionInputs {
  evidence: EvidenceRecord[];
  pilotRuns: PilotRunRecord[];
  infraTargets: InfraTargetRecord[];
  /** Sealed ST executions, latest per control. Optional: absent = none executed. */
  stExecutions?: StExecutionRecord[];
  now?: string;
}

export interface CommandCenterControl extends ReadinessControl {
  classification: ClassificationVerdict;
  /** True when the control is blocked only because its prerequisite is unmet. */
  awaiting_execution: boolean;
  evidence_record: EvidenceRecord | null;
  pilot_run: PilotRunRecord | null;
  st_execution?: StExecutionRecord | null;
}

export interface CriticalPathStep {
  order: number;
  label: string;
  satisfied: boolean;
  outstanding: number;
  route: string;
}

export interface CommandCenterView {
  certification: LogisticsCertification;
  controls: CommandCenterControl[];
  blockers: CommandCenterControl[];
  byClass: { remediation_class: RemediationClass; count: number }[];
  criticalPath: CriticalPathStep[];
  whyHold: { reason: string; count: number; route: string }[];
  infraReady: boolean;
}

const isExpired = (expiry: string | null, now: string) => !!expiry && new Date(expiry) < new Date(now);

/** DI-00 clearance: two registered, isolation-verified, distinct targets with synthetic fixtures. */
export function infrastructureSatisfied(targets: InfraTargetRecord[]): boolean {
  const staging = targets.find((t) => t.target_role === "staging");
  const restore = targets.find((t) => t.target_role === "restore");
  if (!staging || !restore) return false;
  if (staging.endpoint_ref.trim() === restore.endpoint_ref.trim()) return false;
  return staging.isolation_verified && restore.isolation_verified && staging.synthetic_fixtures_loaded;
}

function overlayStatus(
  c: ReadinessControl,
  cls: ClassificationVerdict,
  rec: EvidenceRecord | null,
  run: PilotRunRecord | null,
  infraReady: boolean,
  now: string,
  st: StExecutionRecord | null = null,
): { status: ControlStatus; evidence: string; awaiting: boolean } {
  // Rule 4 — engineering failures are never cleared by paperwork.
  if (cls.remediation_class === "GENUINE_FAILURE") {
    return { status: c.status, evidence: c.actual_evidence, awaiting: false };
  }

  // Rule 3 — pilot controls only by a recorded run.
  if (cls.workflow === "PILOT_EXECUTION") {
    if (run && run.result === "PASS") {
      return {
        status: "PASS",
        evidence: `Pilot executed ${new Date(run.executed_at).toISOString().slice(0, 10)}: ${run.observed_outcome} (${run.evidence_ref}).`,
        awaiting: false,
      };
    }
    if (run && run.result === "FAIL") {
      return { status: "FAIL", evidence: `Pilot run failed: ${run.observed_outcome} (${run.evidence_ref}).`, awaiting: false };
    }
    return { status: c.status, evidence: c.actual_evidence, awaiting: infraReady };
  }

  // Rule 2 — database evidence is never granted by approval. It comes only from
  // a sealed ST execution against the isolated instance.
  if (cls.workflow === "DATABASE_CERTIFICATION") {
    if (st && !st.invalidated_at && !isExpired(st.expires_at, now)) {
      if (st.result === "PASS") {
        return {
          status: "PASS",
          evidence: `Executed against ${st.environment_key ?? "the isolated instance"} on ${(st.finished_at ?? now).slice(0, 10)}; evidence ${(st.evidence_sha256 ?? "").slice(0, 16)} on database identity ${(st.environment_fingerprint ?? "unknown").slice(0, 12)}.`,
          awaiting: false,
        };
      }
      if (st.result === "FAIL" || st.result === "PRODUCTION_TARGET_REFUSED") {
        const detail = st.first_failure
          ? `${st.first_failure.assertion}: expected ${st.first_failure.expected}, observed ${st.first_failure.observed}`
          : st.error_message ?? "execution failed";
        return { status: "FAIL", evidence: `Executed and failed — ${detail}.`, awaiting: false };
      }
    }
    if (st && (st.invalidated_at || isExpired(st.expires_at, now))) {
      return {
        status: "EXPIRED",
        evidence: `Recorded execution is no longer authoritative (${st.invalidated_at ? "environment identity changed" : "evidence expired"}); re-execution required.`,
        awaiting: infraReady,
      };
    }
    return {
      status: c.status,
      evidence: infraReady
        ? `${c.actual_evidence} Prerequisite DI-00 satisfied — awaiting execution against the isolated instance.`
        : c.actual_evidence,
      awaiting: infraReady,
    };
  }

  if (cls.workflow === "INFRASTRUCTURE_PROVISIONING") {
    return infraReady
      ? { status: "PASS", evidence: "Isolated staging and separate restore targets registered and isolation-verified.", awaiting: false }
      : { status: c.status, evidence: c.actual_evidence, awaiting: false };
  }

  // Rule 1 + 5 — business records via approved evidence only.
  if (rec && rec.workflow_state === "APPROVED" && APPROVAL_CLEARABLE.includes(cls.remediation_class)) {
    if (isExpired(rec.expiry_at, now)) {
      return { status: "EXPIRED", evidence: `Approved evidence ${rec.evidence_ref} expired on ${rec.expiry_at}.`, awaiting: false };
    }
    return {
      status: "PASS",
      evidence: `${rec.evidence_ref} approved by ${rec.approver_email ?? "authorised approver"} on ${rec.decided_at?.slice(0, 10) ?? "record"}.`,
      awaiting: false,
    };
  }
  if (rec && rec.workflow_state === "PENDING_APPROVAL") {
    return { status: c.status, evidence: `Evidence ${rec.evidence_ref} submitted — pending approval by ${rec.approver_email ?? "the accountable approver"}.`, awaiting: true };
  }
  if (rec && (rec.workflow_state === "REJECTED" || rec.workflow_state === "REVISION_REQUESTED")) {
    return { status: c.status, evidence: `Evidence ${rec.workflow_state.toLowerCase().replace("_", " ")}: ${rec.comments ?? "no comment recorded"}.`, awaiting: false };
  }

  return { status: c.status, evidence: c.actual_evidence, awaiting: false };
}

/** Builds the command-centre view; recalculates tracks, scores and state automatically. */
export function buildCommandCenterView(inputs: ExecutionInputs): CommandCenterView {
  const now = inputs.now ?? new Date().toISOString();
  const baseline = certifyLogisticsProductionReadiness(now);
  const infraReady = infrastructureSatisfied(inputs.infraTargets);

  const latestRun = (id: string) =>
    inputs.pilotRuns
      .filter((r) => r.scenario_id === id)
      .sort((a, b) => (a.executed_at < b.executed_at ? 1 : -1))[0] ?? null;

  const latestSt = (id: string) =>
    (inputs.stExecutions ?? [])
      .filter((e) => e.control_id === id && e.finished_at)
      .sort((a, b) => ((a.finished_at ?? "") < (b.finished_at ?? "") ? 1 : -1))[0] ?? null;

  const controls: CommandCenterControl[] = baseline.controls.map((c) => {
    const cls = classifyControl(c);
    const rec = inputs.evidence.find((e) => e.control_id === c.control_id) ?? null;
    const run = latestRun(c.control_id);
    const st = latestSt(c.control_id);
    const o = overlayStatus(c, cls, rec, run, infraReady, now, st);
    return {
      ...c,
      status: o.status,
      actual_evidence: o.evidence,
      classification: cls,
      awaiting_execution: o.awaiting,
      evidence_record: rec,
      pilot_run: run,
      st_execution: st,
      last_tested_at: o.status === "PASS" && st?.finished_at ? st.finished_at : o.status === "PASS" && run ? run.executed_at : c.last_tested_at,
      updated_at: now,
    };
  });

  const allPass = controls.filter((c) => c.blocking).every((c) => c.status === "PASS");


  // Rebuilt with the SAME builder as the baseline, so blocker narratives,
  // certificate state and migration authorisation are recomputed from the
  // overlaid evidence instead of inheriting stale baseline text.
  const certification: LogisticsCertification = buildCertificationFrom(controls, now);

  const blockers = controls.filter((c) => c.blocking && c.status !== "PASS");

  const classOrder: RemediationClass[] = [
    "GENUINE_FAILURE", "BUILDABLE", "EXTERNAL_INFRASTRUCTURE_REQUIRED", "TESTABLE",
    "EVIDENCE_REQUIRED", "HUMAN_APPROVAL_REQUIRED", "LEGAL_DETERMINATION_REQUIRED",
    "BUSINESS_TARGET_REQUIRED", "CONFIGURABLE", "INTEGRATABLE",
  ];
  const byClass = classOrder
    .map((k) => ({ remediation_class: k, count: blockers.filter((b) => b.classification.remediation_class === k).length }))
    .filter((r) => r.count > 0);

  const outstanding = (tracks: ReadinessTrack[]) => blockers.filter((b) => tracks.includes(b.track)).length;

  const criticalPath: CriticalPathStep[] = [
    { order: 1, label: "Provision the isolated staging and restore instances (DI-00)", satisfied: infraReady, outstanding: infraReady ? 0 : 1, route: "?tab=infrastructure" },
    { order: 2, label: "Execute the database certification suite (ST-01…ST-15)", satisfied: outstanding(["DATABASE_INFRASTRUCTURE"]) === 0, outstanding: outstanding(["DATABASE_INFRASTRUCTURE"]), route: "?tab=infrastructure" },
    { order: 3, label: "Complete the legal readiness register", satisfied: outstanding(["LEGAL_REGULATORY"]) === 0, outstanding: outstanding(["LEGAL_REGULATORY"]), route: "?tab=legal" },
    { order: 4, label: "Complete operations certification (SOP, SLA, owner, training)", satisfied: outstanding(["OPERATIONS"]) === 0, outstanding: outstanding(["OPERATIONS"]), route: "?tab=operations" },
    { order: 5, label: "Complete commercial acceptance", satisfied: outstanding(["COMMERCIAL"]) === 0, outstanding: outstanding(["COMMERCIAL"]), route: "?tab=approvals" },
    { order: 6, label: "Complete financial acceptance", satisfied: outstanding(["FINANCIAL_CONTROLS"]) === 0, outstanding: outstanding(["FINANCIAL_CONTROLS"]), route: "?tab=approvals" },
    { order: 7, label: "Complete support, partner and incident readiness", satisfied: outstanding(["CUSTOMER_SUPPORT", "PARTNER_COMPLIANCE", "INCIDENT_RECOVERY"]) === 0, outstanding: outstanding(["CUSTOMER_SUPPORT", "PARTNER_COMPLIANCE", "INCIDENT_RECOVERY"]), route: "?tab=approvals" },
    { order: 8, label: "Execute the controlled pilot (PL-01…PL-17)", satisfied: outstanding(["OPERATIONAL_PILOT"]) === 0, outstanding: outstanding(["OPERATIONAL_PILOT"]), route: "?tab=pilot" },
    { order: 9, label: "Recertify and advance the readiness state", satisfied: allPass, outstanding: blockers.length, route: "?tab=certification" },
  ];

  const whyHold = [
    { reason: "database & infrastructure controls", count: outstanding(["DATABASE_INFRASTRUCTURE"]), route: "?tab=infrastructure" },
    {
      reason: "business approvals",
      count: blockers.filter((b) => b.environment === "business_record").length,
      route: "?tab=approvals",
    },
    { reason: "controlled pilot scenarios", count: outstanding(["OPERATIONAL_PILOT"]), route: "?tab=pilot" },
    { reason: "engineering defects", count: blockers.filter((b) => b.classification.remediation_class === "GENUINE_FAILURE").length, route: "?tab=engineering" },
  ].filter((r) => r.count > 0);

  return { certification, controls, blockers, byClass, criticalPath, whyHold, infraReady };
}
