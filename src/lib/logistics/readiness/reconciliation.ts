/**
 * CERTIFICATION RECONCILIATION.
 *
 * Compares the static, code-derived baseline projection (OLD STATE) with the
 * authoritative evidence-overlaid projection (NEW STATE) and explains every
 * transition with its evidence identity. It creates NO second certification
 * engine, NO second evidence store and NO manual PASS surface: it only reports
 * what the existing engines already computed.
 */
import { certifyLogisticsProductionReadiness, type ControlStatus, type ReadinessTrack } from "./controlPlane";
import type { CommandCenterControl, CommandCenterView } from "./execution";

export interface ReconciliationRow {
  control_id: string;
  track: ReadinessTrack;
  previous_state: ControlStatus | "UNKNOWN";
  current_state: ControlStatus;
  transitioned: boolean;
  evidence_id: string | null;
  executed_at: string | null;
  evidence_validity: "VALID" | "EXPIRED" | "INVALIDATED" | "NOT_APPLICABLE" | "ABSENT";
  target_identity: string | null;
  certificate_reference: string | null;
  reason: string;
}

export interface ReconciliationReport {
  generated_at: string;
  rows: ReconciliationRow[];
  transitions: ReconciliationRow[];
  gates: { state: string; satisfied: boolean; outstanding: number; missing: string[] }[];
  states: {
    technical: string;
    governance: string;
    operational: string;
    financial: string;
    productionGate: string;
  };
  remaining: { control_id: string; status: ControlStatus; reason: string }[];
}

const outstandingIn = (controls: CommandCenterControl[], tracks: ReadinessTrack[]) =>
  controls.filter((c) => c.blocking && tracks.includes(c.track) && c.status !== "PASS").length;

function validity(c: CommandCenterControl, now: string): ReconciliationRow["evidence_validity"] {
  const st = c.st_execution;
  if (st) {
    if (st.invalidated_at) return "INVALIDATED";
    if (st.expires_at && new Date(st.expires_at) < new Date(now)) return "EXPIRED";
    return "VALID";
  }
  const rec = c.evidence_record;
  if (rec) {
    if (rec.expiry_at && new Date(rec.expiry_at) < new Date(now)) return "EXPIRED";
    return rec.workflow_state === "APPROVED" ? "VALID" : "ABSENT";
  }
  if (c.pilot_run) return "VALID";
  return c.environment === "application" ? "NOT_APPLICABLE" : "ABSENT";
}

function reasonFor(c: CommandCenterControl, prev: ControlStatus | "UNKNOWN"): string {
  if (c.status === prev) {
    return c.status === "PASS"
      ? "Already evidenced PASS in the baseline; no change."
      : c.actual_evidence;
  }
  if (c.status === "PASS" && c.st_execution) {
    return `Consumed sealed database certification evidence executed on ${c.st_execution.environment_key ?? "the isolated instance"}.`;
  }
  if (c.status === "PASS" && c.pilot_run) return "Recorded controlled-pilot run returned PASS.";
  if (c.status === "PASS" && c.evidence_record) return "Approved business record present in the evidence register.";
  if (c.status === "PASS") return "Prerequisite environment registry now satisfies this control.";
  if (c.status === "EXPIRED") return "Prior evidence is no longer authoritative; re-execution or re-approval required.";
  if (c.status === "FAIL") return "Executed and failed — engineering remediation required, not paperwork.";
  return c.actual_evidence;
}

export function reconcileReadiness(view: CommandCenterView, now = new Date().toISOString()): ReconciliationReport {
  const baseline = certifyLogisticsProductionReadiness(now);
  const prevOf = new Map(baseline.controls.map((c) => [c.control_id, c.status]));

  const rows: ReconciliationRow[] = view.controls.map((c) => {
    const prev = prevOf.get(c.control_id) ?? "UNKNOWN";
    const st = c.st_execution;
    return {
      control_id: c.control_id,
      track: c.track,
      previous_state: prev,
      current_state: c.status,
      transitioned: prev !== c.status,
      evidence_id: st?.evidence_sha256 ?? c.evidence_record?.evidence_ref ?? c.pilot_run?.evidence_ref ?? null,
      executed_at: st?.finished_at ?? c.pilot_run?.executed_at ?? c.evidence_record?.decided_at ?? c.last_tested_at ?? null,
      evidence_validity: validity(c, now),
      target_identity: st?.environment_fingerprint ?? null,
      certificate_reference: st ? `${st.environment_key ?? "isolated"}::${(st.evidence_sha256 ?? "").slice(0, 16)}` : null,
      reason: reasonFor(c, prev),
    };
  });

  const controls = view.controls;
  const remaining = controls
    .filter((c) => c.blocking && c.status !== "PASS")
    .map((c) => ({ control_id: c.control_id, status: c.status, reason: c.actual_evidence }));

  const technicalOutstanding = outstandingIn(controls, [
    "ARCHITECTURE_DOMAIN", "APPLICATION_SECURITY", "DATABASE_INFRASTRUCTURE", "DATA_INTEGRITY",
  ]);
  const governanceOutstanding = outstandingIn(controls, ["LEGAL_REGULATORY", "PARTNER_COMPLIANCE"]);
  const operationalOutstanding = outstandingIn(controls, [
    "OPERATIONS", "CUSTOMER_SUPPORT", "INCIDENT_RECOVERY", "OPERATIONAL_PILOT",
  ]);
  const financialOutstanding = outstandingIn(controls, ["FINANCIAL_CONTROLS", "COMMERCIAL"]);

  const verdict = (n: number, label: string) => (n === 0 ? `CERTIFIED — ${label} fully evidenced` : `HOLD — ${n} ${label} controls outstanding`);

  return {
    generated_at: now,
    rows,
    transitions: rows.filter((r) => r.transitioned),
    gates: view.certification.gates.map((g) => ({
      state: g.state,
      satisfied: g.satisfied,
      outstanding: g.missing.length,
      missing: g.missing,
    })),
    states: {
      technical: verdict(technicalOutstanding, "technical"),
      governance: verdict(governanceOutstanding, "legal & partner"),
      operational: verdict(operationalOutstanding, "operational"),
      financial: verdict(financialOutstanding, "financial & commercial"),
      productionGate: `${view.certification.productionStatus} — migration ${view.certification.migrationAuthorisation.toLowerCase()} (state ${view.certification.state})`,
    },
    remaining,
  };
}

export function renderReconciliationMarkdown(r: ReconciliationReport): string {
  return [
    "# TaxiD — CERTIFICATION RECONCILIATION REPORT",
    "",
    `Generated ${r.generated_at}`,
    "",
    "## Authoritative state",
    `- TECHNICAL: ${r.states.technical}`,
    `- GOVERNANCE: ${r.states.governance}`,
    `- OPERATIONAL: ${r.states.operational}`,
    `- FINANCIAL: ${r.states.financial}`,
    `- PRODUCTION GATE: ${r.states.productionGate}`,
    "",
    `## Transitions (${r.transitions.length})`,
    "",
    "| Control | Old | New | Evidence | Executed | Validity | Target identity | Certificate | Reason |",
    "|---|---|---|---|---|---|---|---|---|",
    ...r.transitions.map((t) =>
      `| ${t.control_id} | ${t.previous_state} | ${t.current_state} | ${(t.evidence_id ?? "—").slice(0, 20)} | ${t.executed_at ?? "—"} | ${t.evidence_validity} | ${(t.target_identity ?? "—").slice(0, 16)} | ${t.certificate_reference ?? "—"} | ${t.reason} |`,
    ),
    "",
    "## State machine gates",
    ...r.gates.map((g) => `- **${g.state}** — ${g.satisfied ? "satisfied" : `${g.outstanding} outstanding`}`),
    "",
    `## Remaining blockers (${r.remaining.length})`,
    ...r.remaining.map((b) => `- ${b.control_id} (${b.status}) — ${b.reason}`),
  ].join("\n");
}

/**
 * RPO/RTO TEMPLATES.
 *
 * These are reference templates only. They are NOT approvals and NOT TaxiD's
 * targets: an approver must consciously select or override the values and sign
 * off. Nothing here writes to the register.
 */
export interface RecoveryTargetTemplate {
  key: string;
  label: string;
  description: string;
  rpo_minutes: number;
  rto_minutes: number;
}

export const RECOVERY_TARGET_TEMPLATES: RecoveryTargetTemplate[] = [
  {
    key: "standard_enterprise",
    label: "Standard enterprise",
    description: "Nightly plus continuous WAL archiving; recovery inside a business hour.",
    rpo_minutes: 15,
    rto_minutes: 240,
  },
  {
    key: "high_availability",
    label: "High availability",
    description: "Streaming replica with promotion; minimal committed-data loss.",
    rpo_minutes: 5,
    rto_minutes: 60,
  },
  {
    key: "mission_critical",
    label: "Mission critical (payments-grade)",
    description: "Synchronous commit to a standby; near-zero loss, sub-30-minute restoration.",
    rpo_minutes: 1,
    rto_minutes: 30,
  },
];

export const RECOVERY_CONTROLS = {
  "ST-12": { label: "RPO — maximum tolerable committed-data loss", field: "rpo_minutes" as const },
  "ST-13": { label: "RTO — maximum tolerable time to restore service", field: "rto_minutes" as const },
};
