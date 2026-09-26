/**
 * DI-00 INDEPENDENCE — client contract.
 *
 * The invariants themselves are evaluated server-side against live databases.
 * This module only interprets the recorded assertion for display and for the
 * "may certification proceed?" question. It can never produce a PASS: an
 * absent or stale assertion reads as NOT_ASSERTED, which blocks certification.
 */

export type InvariantResult = "PASS" | "FAIL" | "NOT_CONFIGURED";

export interface Invariant {
  invariant_id: string;
  requirement: string;
  result: InvariantResult;
  observed: string;
  expected: string;
}

export interface IndependenceAssertion {
  id: string;
  result: "PASS" | "FAIL" | "BLOCKED" | "UNKNOWN" | "NOT_CONFIGURED";
  staging_identity_sha256: string | null;
  restore_identity_sha256: string | null;
  invariants: Invariant[];
  failed_invariants: string[];
  detail: Record<string, unknown>;
  asserted_at: string;
}

export interface CredentialStatusRow {
  environment_key: string;
  secret_name: string;
  dsn_sha256_prefix: string | null;
  host_ref: string | null;
  database_ref: string | null;
  key_version: number;
  configured_at: string;
  rotated_at: string | null;
}

/** How long an independence assertion stays authoritative. */
export const INDEPENDENCE_TTL_HOURS = 24;

export type IndependenceState = "PROVEN" | "FAILED" | "STALE" | "NOT_ASSERTED" | "INCOMPLETE";

export function independenceState(
  assertion: IndependenceAssertion | null | undefined,
  now: Date = new Date(),
): { state: IndependenceState; reason: string; mayCertify: boolean } {
  if (!assertion) {
    return {
      state: "NOT_ASSERTED",
      reason: "No independence assertion exists. Run the invariant check against both databases.",
      mayCertify: false,
    };
  }
  if (assertion.result === "FAIL") {
    return {
      state: "FAILED",
      reason: `Independence invariants failed: ${assertion.failed_invariants.join(", ") || "see the assertion detail"}.`,
      mayCertify: false,
    };
  }
  if (assertion.result !== "PASS") {
    return {
      state: "INCOMPLETE",
      reason: "Both databases must be configured and reachable before independence can be asserted.",
      mayCertify: false,
    };
  }
  const ageHours = (now.getTime() - new Date(assertion.asserted_at).getTime()) / 3_600_000;
  if (ageHours > INDEPENDENCE_TTL_HOURS) {
    return {
      state: "STALE",
      reason: `The last independence proof is ${Math.floor(ageHours)}h old and is no longer authoritative.`,
      mayCertify: false,
    };
  }
  return { state: "PROVEN", reason: "Staging and restore are proven independent, non-production databases.", mayCertify: true };
}

export const INDEPENDENCE_TONE: Record<IndependenceState, "ok" | "warn" | "danger" | "info"> = {
  PROVEN: "ok",
  FAILED: "danger",
  STALE: "warn",
  NOT_ASSERTED: "warn",
  INCOMPLETE: "info",
};
