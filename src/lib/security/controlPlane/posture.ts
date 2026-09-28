/**
 * TaxiD Security Control Plane — Verification, Evidence and Posture.
 *
 * Posture is computed from executed controls, never asserted. A control with no
 * evidence is UNVERIFIED, and an unverified control never counts as a pass.
 * "Secure" is not a value this module can produce; verified coverage is.
 */
export type ControlStatus = "VERIFIED" | "FAILED" | "BLOCKED" | "UNVERIFIED" | "NOT_APPLICABLE";

export interface SecurityControl {
  id: string;
  title: string;
  /** The asset ids this control proves something about. */
  assetIds: string[];
  /** How it is executed — a gate, a test suite, a live probe. */
  evidenceSource: string;
  /** 1 (hygiene) … 5 (a breach-preventing control). */
  weight: 1 | 2 | 3 | 4 | 5;
}

export interface ControlResult {
  controlId: string;
  status: ControlStatus;
  /** Required for BLOCKED and FAILED — what is missing or what failed. */
  reason?: string;
  observedAt?: string;
  evidence?: string;
}

/** The controls the platform claims to run. Extended as controls are added. */
export const SECURITY_CONTROLS: SecurityControl[] = [
  { id: "execute_grant_contract", title: "Anonymous execute-grant contract", assetIds: ["contract_status_set", "contract_acceptance_record", "rec_public_upload_reserve"], evidenceSource: "scripts/execute-grant-gate.ts", weight: 5 },
  { id: "rls_helper_contract", title: "RLS helper deny-by-default contract", assetIds: ["has_role", "has_staff_permission"], evidenceSource: "scripts/rls-helper-gate.ts", weight: 5 },
  { id: "definer_risk_tiers", title: "SECURITY DEFINER risk classification", assetIds: ["contract_status_set", "rec_public_upload_reserve"], evidenceSource: "scripts/definer-risk-gate.ts", weight: 4 },
  { id: "edge_authorisation", title: "Edge functions authorise before parsing", assetIds: ["mpesa_callback", "partner_api"], evidenceSource: "supabase/functions/_shared/pentest", weight: 5 },
  { id: "anon_upload_ceilings", title: "Anonymous upload reservation ceilings", assetIds: ["rec_public_upload_reserve", "crm_documents"], evidenceSource: "src/lib/security tests + live probe", weight: 4 },
  { id: "payment_replay", title: "Payment callback replay determinism", assetIds: ["mpesa_callback", "crm_invoices"], evidenceSource: "scripts/payment-replay-determinism.ts", weight: 5 },
  { id: "audit_append_only", title: "Audit trails are append-only", assetIds: ["commercial_lifecycle_audit", "ai_answer_ledger"], evidenceSource: "live probe", weight: 4 },
  { id: "tenant_isolation_matrix", title: "Cross-tenant isolation matrix", assetIds: ["crm_accounts", "crm_contracts", "commercial_transactions"], evidenceSource: "pentest persona matrix", weight: 5 },
  { id: "privilege_escalation", title: "Horizontal and vertical escalation probes", assetIds: ["has_role", "has_staff_permission"], evidenceSource: "pentest persona matrix", weight: 5 },
  { id: "storage_idom", title: "Storage object access and IDOR probes", assetIds: ["crm_documents", "rec_candidate_documents"], evidenceSource: "pentest persona matrix", weight: 4 },
  { id: "realtime_delivery", title: "Realtime channel delivery isolation", assetIds: ["ops_event_outbox"], evidenceSource: "pentest realtime probe", weight: 3 },
  { id: "edge_latency_slo", title: "Edge invocation latency budget", assetIds: ["partner_api"], evidenceSource: "contracts/edge-latency-baselines.json", weight: 2 },
];

export interface SecurityPosture {
  /** Share of control weight that is VERIFIED, 0-100. */
  verifiedPct: number;
  counts: Record<ControlStatus, number>;
  verified: string[];
  failed: Array<{ id: string; title: string; reason: string }>;
  blocked: Array<{ id: string; title: string; reason: string }>;
  unverified: Array<{ id: string; title: string }>;
  openP0: number;
  openP1: number;
  /** Freshest control observation, when any control reported one. */
  observedAt?: string;
  /** Honest one-paragraph statement — an intelligence answer, not a dashboard. */
  statement: string;
  /** Never true while any control is FAILED, BLOCKED or UNVERIFIED. */
  fullyVerified: boolean;
}

export function computeSecurityPosture(
  results: ControlResult[],
  risk: { openP0: number; openP1: number } = { openP0: 0, openP1: 0 },
  controls: SecurityControl[] = SECURITY_CONTROLS,
): SecurityPosture {
  const byId = new Map(results.map((r) => [r.controlId, r]));
  const counts: Record<ControlStatus, number> = {
    VERIFIED: 0, FAILED: 0, BLOCKED: 0, UNVERIFIED: 0, NOT_APPLICABLE: 0,
  };

  const verified: string[] = [];
  const failed: SecurityPosture["failed"] = [];
  const blocked: SecurityPosture["blocked"] = [];
  const unverified: SecurityPosture["unverified"] = [];

  let applicableWeight = 0;
  let verifiedWeight = 0;
  const times: number[] = [];

  for (const control of controls) {
    const result = byId.get(control.id);
    const status: ControlStatus = result?.status ?? "UNVERIFIED";
    counts[status] += 1;
    if (result?.observedAt) {
      const t = new Date(result.observedAt).getTime();
      if (Number.isFinite(t)) times.push(t);
    }
    if (status !== "NOT_APPLICABLE") applicableWeight += control.weight;
    if (status === "VERIFIED") {
      verifiedWeight += control.weight;
      verified.push(control.id);
    } else if (status === "FAILED") {
      failed.push({ id: control.id, title: control.title, reason: result?.reason ?? "No reason recorded." });
    } else if (status === "BLOCKED") {
      blocked.push({ id: control.id, title: control.title, reason: result?.reason ?? "No reason recorded." });
    } else if (status === "UNVERIFIED") {
      unverified.push({ id: control.id, title: control.title });
    }
  }

  const verifiedPct = applicableWeight === 0 ? 0 : Math.round((100 * verifiedWeight) / applicableWeight);
  const fullyVerified = failed.length === 0 && blocked.length === 0 && unverified.length === 0;

  const parts: string[] = [`Security posture: ${verifiedPct}% of control weight verified.`];
  parts.push(
    risk.openP0 + risk.openP1 === 0
      ? "No open P0 or P1 findings."
      : `${risk.openP0} open P0 and ${risk.openP1} open P1 finding(s).`,
  );
  if (failed.length) parts.push(`${failed.length} control(s) failed: ${failed.map((f) => f.title).join("; ")}.`);
  if (blocked.length) {
    parts.push(
      `${blocked.length} control(s) could not be executed — ${[...new Set(blocked.map((b) => b.reason))].join("; ")}.`,
    );
  }
  if (unverified.length) parts.push(`${unverified.length} control(s) have no evidence yet.`);
  parts.push(
    fullyVerified
      ? "Every declared control has current evidence."
      : "This is not a pass: unverified and blocked controls are not evidence of safety.",
  );

  return {
    verifiedPct,
    counts,
    verified,
    failed,
    blocked,
    unverified,
    openP0: risk.openP0,
    openP1: risk.openP1,
    observedAt: times.length ? new Date(Math.max(...times)).toISOString() : undefined,
    statement: parts.join(" "),
    fullyVerified,
  };
}
