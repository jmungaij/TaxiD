/**
 * Role-helper grant runbook.
 *
 * Turns raw drift facts (missing grantees / owner mismatch / security context)
 * into an ordered, copy-pasteable remediation plan plus an escalation target,
 * so an on-call admin can resolve an alert without leaving the console.
 *
 * Presentation-only: every step here mirrors what the guard trigger and
 * `run_role_grant_drift_check(source, repair)` already do server-side.
 */
import { CONTACT } from "@/config/contact";

export type DriftSeverity = "critical" | "warning" | "info";

export interface DriftFact {
  function_signature: string;
  missing_grantees: string[];
  function_owner: string;
  owner_expected: boolean;
  security_definer: boolean;
}

export interface RunbookEntry {
  signature: string;
  severity: DriftSeverity;
  /** One-line diagnosis of what exactly is wrong. */
  diagnosis: string;
  /** Blast radius in plain language. */
  impact: string;
  /** Ordered remediation steps. */
  steps: string[];
  /** SQL the admin can hand to a migration if auto-repair is not enough. */
  sql: string[];
  /** Who to escalate to when the steps above do not clear the drift. */
  escalation: { owner: string; channel: string; sla: string };
}

const EXPECTED_GRANTEES = ["authenticated", "anon", "service_role"] as const;

const ESCALATION = {
  critical: {
    owner: "Platform Access Integrity on-call",
    channel: `${CONTACT.supportEmail} · subject "[P1] role-helper grant drift"`,
    sla: "Acknowledge in 15 minutes, resolve in 1 hour",
  },
  warning: {
    owner: "Platform engineering (database)",
    channel: `${CONTACT.supportEmail} · subject "[P2] role-helper ownership drift"`,
    sla: "Acknowledge same business day, resolve in 24 hours",
  },
  info: {
    owner: "Platform engineering (database)",
    channel: CONTACT.supportEmail,
    sla: "Next maintenance window",
  },
} as const satisfies Record<DriftSeverity, RunbookEntry["escalation"]>;

export function severityFor(fact: DriftFact): DriftSeverity {
  if (fact.missing_grantees.length > 0) return "critical";
  if (!fact.owner_expected || !fact.security_definer) return "warning";
  return "info";
}

export function buildRunbookEntry(fact: DriftFact): RunbookEntry {
  const severity = severityFor(fact);
  const missing = fact.missing_grantees.filter((g) =>
    (EXPECTED_GRANTEES as readonly string[]).includes(g),
  );

  const diagnosisParts: string[] = [];
  if (missing.length) {
    diagnosisParts.push(`EXECUTE is missing for ${missing.join(", ")}`);
  }
  if (!fact.owner_expected) {
    diagnosisParts.push(`owner is ${fact.function_owner}, expected postgres`);
  }
  if (!fact.security_definer) {
    diagnosisParts.push("function is not SECURITY DEFINER");
  }
  if (!diagnosisParts.length) diagnosisParts.push("baseline satisfied");

  const impact = missing.length
    ? missing.includes("anon")
      ? "Public pages that read role-gated tables fail with “permission denied for function”; signed-in surfaces may also break if authenticated is missing."
      : "Every RLS policy calling this helper fails for the affected role — dashboards return 42501 instead of empty result sets."
    : !fact.owner_expected
      ? "Grants can be revoked by a non-platform owner and the guard cannot deterministically re-apply them."
      : !fact.security_definer
        ? "The helper is evaluated with the caller's privileges, so RLS policies can recurse or return false negatives."
        : "No user-visible impact; recorded for the audit trail.";

  const steps: string[] = [];
  steps.push("Confirm the drift is still live: press “Refresh grant status” on this page.");
  steps.push(
    "Run the auto-repair path: invoke the drift monitor (source = manual, repair = true). It re-applies grants deterministically and writes a check row.",
  );
  if (missing.length) {
    steps.push(
      `Verify the matrix now shows “granted” for ${missing.join(", ")} on ${fact.function_signature}.`,
    );
  }
  if (!fact.owner_expected) {
    steps.push(
      `Ownership cannot be auto-repaired — raise a migration that runs ALTER FUNCTION ... OWNER TO postgres for ${fact.function_signature}.`,
    );
  }
  if (!fact.security_definer) {
    steps.push(
      "Raise a migration re-declaring the helper as SECURITY DEFINER with SET search_path = public.",
    );
  }
  steps.push(
    "Re-run the CI gate (Role Grant Integrity workflow) so the 42501 integration test confirms the fix end-to-end.",
  );
  steps.push(
    "If the drift reappears, a migration is re-creating the helper without the guard — pin policies to has_role_v1 / has_any_role_v1 and re-check.",
  );

  const sql: string[] = [];
  for (const g of missing) {
    sql.push(`GRANT EXECUTE ON FUNCTION public.${fact.function_signature} TO ${g};`);
  }
  if (!fact.owner_expected) {
    sql.push(`ALTER FUNCTION public.${fact.function_signature} OWNER TO postgres;`);
  }
  if (!sql.length) {
    sql.push(`REVOKE ALL ON FUNCTION public.${fact.function_signature} FROM PUBLIC;`);
  }

  return {
    signature: fact.function_signature,
    severity,
    diagnosis: diagnosisParts.join("; "),
    impact,
    steps,
    sql,
    escalation: ESCALATION[severity],
  };
}

export function buildRunbook(facts: DriftFact[]): RunbookEntry[] {
  const order: Record<DriftSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return facts
    .map(buildRunbookEntry)
    .sort((a, b) => order[a.severity] - order[b.severity] || a.signature.localeCompare(b.signature));
}
