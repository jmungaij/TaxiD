/**
 * Security intelligence — deterministic read service over the Security Control
 * Plane.
 *
 * This is how Ask TaxiD answers "is TaxiD secure right now?" without pretending.
 * Posture is computed from recorded control evidence; controls with no evidence
 * are reported as unverified, and unverified is never presented as a pass.
 *
 * No model is consulted. Every number here comes from the control plane's
 * deterministic arithmetic over the evidence rows it was given.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { emptyReading, newestTimestamp, type Claim, type DomainReading } from "../contract";
import {
  SECURITY_CONTROLS,
  computeSecurityPosture,
  runControlPlane,
  type ControlResult,
  type SecurityFinding,
} from "@/lib/security/controlPlane";

export const SECURITY_PERMISSION = "staff.security.read";

interface EvidenceRow {
  control_id: string | null;
  status: string | null;
  reason: string | null;
  observed_at: string | null;
  evidence: string | null;
}

const STATUSES = new Set(["VERIFIED", "FAILED", "BLOCKED", "UNVERIFIED", "NOT_APPLICABLE"]);

/**
 * Control evidence rows, when the evidence register exists. A missing register
 * is not an error — every control then reports as unverified, which is the
 * honest state.
 */
async function readControlEvidence(): Promise<{ results: ControlResult[]; registerAvailable: boolean }> {
  const { data, error } = await untypedDb
    .from("v_security_control_evidence_current")
    .select("control_id,status,reason,observed_at,evidence")
    .order("observed_at", { ascending: false })
    .limit(500);


  if (error || !data) return { results: [], registerAvailable: false };

  const seen = new Set<string>();
  const results: ControlResult[] = [];
  for (const row of data as EvidenceRow[]) {
    const id = row.control_id ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const status = (row.status ?? "").toUpperCase();
    results.push({
      controlId: id,
      status: STATUSES.has(status) ? (status as ControlResult["status"]) : "UNVERIFIED",
      reason: row.reason ?? undefined,
      observedAt: row.observed_at ?? undefined,
      evidence: row.evidence ?? undefined,
    });
  }
  return { results, registerAvailable: true };
}

export async function readSecurity(
  authorised: boolean,
  openFindings: SecurityFinding[] = [],
): Promise<DomainReading> {
  if (!authorised) {
    return emptyReading("security", SECURITY_PERMISSION, "security read permission not held", false);
  }

  const { results, registerAvailable } = await readControlEvidence();
  const run = runControlPlane(openFindings, results);
  const posture = results.length
    ? run.posture
    : computeSecurityPosture([], { openP0: run.posture.openP0, openP1: run.posture.openP1 });

  const observedAt = posture.observedAt;
  const claims: Claim[] = [
    {
      id: "security.verified_pct",
      label: "Verified control coverage",
      value: `${posture.verifiedPct}%`,
      numeric: posture.verifiedPct,
      classification: "FACT",
      source: "security control plane over recorded control evidence",
      observedAt,
      confidence: registerAvailable ? 90 : 60,
      evidence: [
        { label: `${SECURITY_CONTROLS.length} declared controls`, path: "src/lib/security/controlPlane/posture.ts" },
        {
          label: registerAvailable
            ? `${results.length} control evidence row(s) read`
            : "no control evidence register available — every control counts as unverified",
        },
      ],
    },
    {
      id: "security.open_p0_p1",
      label: "Open P0 / P1 findings",
      value: `${posture.openP0} P0, ${posture.openP1} P1`,
      numeric: posture.openP0 + posture.openP1,
      classification: "FACT",
      source: "security control plane risk engine",
      observedAt,
      confidence: openFindings.length ? 85 : 55,
      evidence: [
        { label: `${openFindings.length} finding(s) assessed`, detail: "Impact x Exploitability x Exposure x Criticality x Uncertainty" },
      ],
    },
    {
      id: "security.unverified_controls",
      label: "Controls without current evidence",
      value: `${posture.blocked.length + posture.unverified.length}`,
      numeric: posture.blocked.length + posture.unverified.length,
      classification: "FACT",
      source: "security control plane posture",
      observedAt,
      confidence: 90,
      evidence: [
        ...posture.blocked.map((b) => ({ label: `${b.title}: blocked`, detail: b.reason })),
        ...posture.unverified.slice(0, 6).map((u) => ({ label: `${u.title}: no evidence yet` })),
      ],
    },
    {
      id: "security.posture_statement",
      label: "Posture",
      value: posture.statement,
      classification: posture.fullyVerified ? "FACT" : "ESTIMATE",
      source: "security control plane posture",
      observedAt,
      confidence: Math.min(90, posture.verifiedPct + 10),
      assumptions: posture.fullyVerified
        ? undefined
        : ["Coverage is measured over declared controls only; an undeclared control cannot be counted."],
      evidence: [{ label: "Computed from control evidence, not asserted" }],
    },
  ];

  if (run.predicted.length > 0) {
    claims.push({
      id: "security.analogous_targets",
      label: "Assets to inspect for the same shape",
      value: `${run.predicted.length}`,
      numeric: run.predicted.length,
      classification: "RECOMMENDATION",
      source: "security control plane learning engine",
      observedAt,
      confidence: 65,
      assumptions: ["These are inspection targets derived from shared traits, not confirmed vulnerabilities."],
      evidence: run.predicted.slice(0, 6).map((p) => ({ label: p.label, detail: p.because })),
    });
  }

  return {
    domain: "security",
    permission: SECURITY_PERMISSION,
    authorised: true,
    claims,
    freshestAt: newestTimestamp([observedAt]),
    rowsInspected: results.length + openFindings.length,
    unavailableReason: registerAvailable ? undefined : undefined,
  };
}
