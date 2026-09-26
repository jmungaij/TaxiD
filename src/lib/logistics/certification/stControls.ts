/**
 * ST CERTIFICATION — client mirror of the orchestrator registry.
 *
 * The authoritative definition lives in
 * `supabase/functions/_shared/di00/stRegistry.ts`; this mirror exists only so
 * the browser can render dependency, target and remediation information without
 * a round trip. A vitest gate proves the two files never drift.
 */

export type StResult =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "NOT_TESTED"
  | "DEPENDENCY_NOT_READY"
  | "OWNER_ACTION_REQUIRED"
  | "PROVIDER_CONFIGURATION_REQUIRED"
  | "EXTERNAL_EXECUTION_REQUIRED"
  | "LEGAL_APPROVAL_REQUIRED"
  | "PRODUCTION_TARGET_REFUSED"
  | "EVIDENCE_EXPIRED";

export type StTarget = "STAGING" | "RESTORE" | "CONTROL_PLANE";
export type StRequirement = "STAGING_VERIFIED" | "RESTORE_VERIFIED" | "SCHEMA" | "FIXTURES" | "BACKUP" | "RESTORE_RUN";

export interface StControlDefinition {
  control_id: string;
  title: string;
  target: StTarget;
  depends_on: string[];
  requires: StRequirement[];
  owner: "engineering" | "security" | "finance" | "operations" | "legal";
  success_condition: string;
  evidence: string;
  owner_input?: { key: string; description: string };
}

export const ST_CONTROLS: StControlDefinition[] = [
  {
    control_id: "ST-01",
    title: "Accepted quote database immutability",
    target: "STAGING",
    depends_on: [],
    requires: ["STAGING_VERIFIED", "SCHEMA"],
    owner: "engineering",
    success_condition: "Direct UPDATE of price or rate-plan version and direct DELETE of an accepted quote are both refused by the database.",
    evidence: "SQLSTATE and message returned by the database for each refused statement.",
  },
  {
    control_id: "ST-02",
    title: "Historical rate-plan reconstruction (accepted quote must not reprice)",
    target: "STAGING",
    depends_on: ["ST-01"],
    requires: ["STAGING_VERIFIED", "SCHEMA"],
    owner: "finance",
    success_condition: "A V2 rate plan prices the same inputs differently while the accepted V1 quote and its invoice remain at the accepted amount.",
    evidence: "V1 accepted amount, V2 recomputed amount, invoice total after the V2 plan exists.",
  },
  {
    control_id: "ST-03",
    title: "Cross-tenant PostgreSQL row level security",
    target: "STAGING",
    depends_on: ["ST-01"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIXTURES"],
    owner: "security",
    success_condition: "A non-owner application role sees only its own tenant, cannot insert or update another tenant's rows, and sees nothing without a tenant claim.",
    evidence: "Row counts and refusals observed per tenant claim under SET LOCAL ROLE.",
  },
  {
    control_id: "ST-04",
    title: "SECURITY DEFINER privilege escalation",
    target: "STAGING",
    depends_on: ["ST-03"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIXTURES"],
    owner: "security",
    success_condition: "A forged tenant argument and a missing tenant claim are both refused inside the SECURITY DEFINER function itself.",
    evidence: "Refusal messages for forged tenant, absent claim and cross-tenant package.",
  },
  {
    control_id: "ST-05",
    title: "PostgreSQL concurrency races",
    target: "STAGING",
    depends_on: ["ST-03"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIXTURES"],
    owner: "engineering",
    success_condition: "Two parallel assignment transactions on the same package produce exactly one winner and one refusal.",
    evidence: "Both transaction outcomes and the final persisted assignment.",
  },
  {
    control_id: "ST-06",
    title: "PostgreSQL idempotency of booking and payment callbacks",
    target: "STAGING",
    depends_on: ["ST-05"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIXTURES"],
    owner: "engineering",
    success_condition: "Replayed booking and payment commands create exactly one row and one financial effect.",
    evidence: "Created flags and row counts after the replay.",
  },
  {
    control_id: "ST-07",
    title: "Out-of-order and stale event persistence",
    target: "STAGING",
    depends_on: ["ST-06"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIXTURES"],
    owner: "engineering",
    success_condition: "Version gaps, illegal transitions and post-terminal transitions are refused by the stored transition guard.",
    evidence: "Refusal codes for each adversarial transition and the final package state.",
  },
  {
    control_id: "ST-08",
    title: "Signed webhook replay refusal",
    target: "STAGING",
    depends_on: ["ST-06"],
    requires: ["STAGING_VERIFIED", "SCHEMA"],
    owner: "security",
    success_condition: "A valid signed delivery is accepted once, its replay is refused, and a tampered signature is rejected.",
    evidence: "Ledger outcomes for first delivery, replay and forged signature.",
  },
  {
    control_id: "ST-09",
    title: "Backup creation on the isolated instance",
    target: "CONTROL_PLANE",
    depends_on: ["ST-07"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIXTURES", "BACKUP"],
    owner: "engineering",
    success_condition: "A backup artefact exists, is downloadable and its checksum re-verifies independently of the recorded value.",
    evidence: "Backup reference, recorded checksum, independently recomputed checksum, row and object counts.",
  },
  {
    control_id: "ST-10",
    title: "Actual restore into the independent restore target",
    target: "RESTORE",
    depends_on: ["ST-09"],
    requires: ["RESTORE_VERIFIED", "BACKUP", "RESTORE_RUN"],
    owner: "engineering",
    success_condition: "The restore target holds the restored schema, row counts, triggers, RLS policies and functions, and its identity differs from staging.",
    evidence: "Per-table row comparison, object inventory and both environment fingerprints.",
  },
  {
    control_id: "ST-11",
    title: "Post-restore business transaction",
    target: "RESTORE",
    depends_on: ["ST-10"],
    requires: ["RESTORE_VERIFIED", "RESTORE_RUN"],
    owner: "operations",
    success_condition: "A complete quote → booking → shipment → dispatch → delivery → POD → payment → invoice journey executes on the restored database.",
    evidence: "Identifiers produced by the journey and the resulting package state and invoice total.",
  },
  {
    control_id: "ST-12",
    title: "RPO measurement against an approved business target",
    target: "CONTROL_PLANE",
    depends_on: ["ST-10"],
    requires: ["BACKUP", "RESTORE_RUN"],
    owner: "operations",
    success_condition: "Measured data loss window is within the approved maximum tolerable data loss.",
    evidence: "Approved target, measured backup-to-restore data window.",
    owner_input: {
      key: "RPO_TARGET_MINUTES",
      description: "Approved maximum tolerable data loss in minutes, recorded as approved readiness evidence for ST-12.",
    },
  },
  {
    control_id: "ST-13",
    title: "RTO measurement against an approved business target",
    target: "CONTROL_PLANE",
    depends_on: ["ST-10"],
    requires: ["RESTORE_RUN"],
    owner: "operations",
    success_condition: "Measured recovery duration is within the approved maximum tolerable downtime.",
    evidence: "Approved target, measured restore duration.",
    owner_input: {
      key: "RTO_TARGET_MINUTES",
      description: "Approved maximum tolerable downtime in minutes, recorded as approved readiness evidence for ST-13.",
    },
  },
  {
    control_id: "ST-14",
    title: "Audit-log integrity under unauthorised modification",
    target: "STAGING",
    depends_on: ["ST-03"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIXTURES"],
    owner: "security",
    success_condition: "An ordinary application identity cannot update, delete or truncate the audit trail, and mutations continue to append audit rows.",
    evidence: "Refusal messages and audit row growth across the probe.",
  },
  {
    control_id: "ST-15",
    title: "Synthetic-data isolation in staging",
    target: "STAGING",
    depends_on: ["ST-03"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIXTURES"],
    owner: "engineering",
    success_condition: "Every record carries a synthetic marker and no production identifier pattern is present anywhere in the certification schema.",
    evidence: "Per-pattern offender counts and the synthetic flag of the schema metadata.",
  },
];

export const ST_CONTROL_IDS = ST_CONTROLS.map((c) => c.control_id);

/** Topological execution order, with independent controls grouped into waves. */
export function stExecutionWaves(controls: StControlDefinition[] = ST_CONTROLS): string[][] {
  const remaining = new Map(controls.map((c) => [c.control_id, new Set(c.depends_on)]));
  const done = new Set<string>();
  const waves: string[][] = [];
  while (remaining.size > 0) {
    const wave = [...remaining.entries()]
      .filter(([, deps]) => [...deps].every((d) => done.has(d)))
      .map(([id]) => id)
      .sort();
    if (wave.length === 0) throw new Error("ST dependency graph contains a cycle");
    for (const id of wave) {
      remaining.delete(id);
      done.add(id);
    }
    waves.push(wave);
  }
  return waves;
}

export const ST_RESULT_TONE: Record<StResult, "ok" | "warn" | "danger" | "info"> = {
  PASS: "ok",
  FAIL: "danger",
  BLOCKED: "warn",
  NOT_TESTED: "info",
  DEPENDENCY_NOT_READY: "warn",
  OWNER_ACTION_REQUIRED: "warn",
  PROVIDER_CONFIGURATION_REQUIRED: "warn",
  EXTERNAL_EXECUTION_REQUIRED: "warn",
  LEGAL_APPROVAL_REQUIRED: "warn",
  PRODUCTION_TARGET_REFUSED: "danger",
  EVIDENCE_EXPIRED: "warn",
};

export const ST_REQUIREMENT_LABEL: Record<StRequirement, string> = {
  STAGING_VERIFIED: "Staging verified",
  RESTORE_VERIFIED: "Restore verified",
  SCHEMA: "Certification schema deployed",
  FIXTURES: "Synthetic fixtures loaded",
  BACKUP: "Integrity-verified backup",
  RESTORE_RUN: "Verified restore executed",
};
