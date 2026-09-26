/**
 * Risk-based sign-in prompts.
 *
 * The browser contributes only two things: a stable, non-identifying device
 * fingerprint and the browser's own time-zone region. Every weight, threshold
 * and decision lives in the versioned risk policy in the database — the client
 * cannot influence the outcome, and a failure here never grants access.
 */
import { supabase } from "@/integrations/supabase/client";

const untypedDb = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export type RiskDecision = "ALLOW" | "STEP_UP_REQUIRED";

export interface RiskAssessment {
  ok: boolean;
  decision: RiskDecision;
  score: number;
  threshold: number;
  reasons: string[];
  policyVersion: number | null;
  policyPendingApproval: boolean;
}

/** A stable hash of coarse browser traits. No identifiers, no tracking beacons. */
export async function deviceFingerprint(): Promise<string | null> {
  if (typeof window === "undefined" || !window.crypto?.subtle) return null;
  try {
    const traits = [
      navigator.userAgent,
      navigator.language,
      `${window.screen.width}x${window.screen.height}x${window.devicePixelRatio}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
      String(navigator.hardwareConcurrency ?? ""),
    ].join("|");
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(traits));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/** Coarse region from the browser's time zone, e.g. "Africa/Nairobi" -> "Africa". */
function coarseRegion(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz ? tz.split("/")[0] : null;
  } catch {
    return null;
  }
}

/**
 * Scores the current sign-in server-side. Returns null when the assessment
 * could not be made (no active policy, offline, not signed in) — callers must
 * treat null as "no risk signal", never as a pass for a required second factor.
 */
export async function evaluateSignInRisk(): Promise<RiskAssessment | null> {
  const fingerprint = await deviceFingerprint();
  const { data, error } = await untypedDb.rpc("identity_risk_evaluate", {
    _fingerprint_hash: fingerprint,
    _country: coarseRegion(),
  });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || row.ok !== true) return null;
  const policy = (row.policy ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    decision: (row.decision as RiskDecision) ?? "ALLOW",
    score: Number(row.score ?? 0),
    threshold: Number(row.threshold ?? 0),
    reasons: Array.isArray(row.reasons) ? (row.reasons as string[]) : [],
    policyVersion: (policy.version as number) ?? null,
    policyPendingApproval: policy.business_approval === "PENDING_BUSINESS_APPROVAL",
  };
}

export interface OwnRiskAssessment {
  id: string;
  score: number;
  decision: RiskDecision;
  reasons: string[];
  occurred_at: string;
  policy_version: number | null;
}

export async function loadMyRiskAssessments(limit = 10): Promise<OwnRiskAssessment[]> {
  const { data, error } = await untypedDb.rpc("identity_my_risk_assessments", { _limit: limit });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    score: Number(r.score ?? 0),
    decision: (r.decision as RiskDecision) ?? "ALLOW",
    reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
    occurred_at: String(r.occurred_at),
    policy_version: (r.policy_version as number) ?? null,
  }));
}
