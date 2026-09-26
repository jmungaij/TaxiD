/**
 * DF-10 PRODUCTION EVIDENCE CERTIFICATE.
 *
 * Purpose: make readiness auditable rather than subjective, and stop a large
 * PASS count from being mistaken for production certification.
 *
 * The assessment is split into independent TRACKS so a strong architecture can
 * never mask a missing infrastructure or legal proof:
 *
 *   ARCHITECTURE / DOMAIN FOUNDATION     — application-level, executable
 *   SECURITY (application adversarial)   — application-level, executable
 *   INTEGRITY                            — application-level, executable
 *   INFRASTRUCTURE EVIDENCE              — requires a real isolated Postgres
 *   LEGAL / COMMERCIAL                   — requires an authoritative record
 *   OPERATIONS                           — requires an approved operating model
 *
 * ABSOLUTE RULE encoded here: source-code inspection, TypeScript compilation,
 * a unit test, a migration file, a policy file or a simulated database result
 * may never be converted into PASS for a database-dependent control. Every
 * database-dependent control therefore reports BLOCKED until executed against
 * a real isolated PostgreSQL instance, and RPO/RTO report
 * BLOCKED — BUSINESS TARGET REQUIRED rather than an invented number.
 */
import { df10AdversarialControls, type AdvControlStatus, type AdversarialControl } from "./df10Adversarial";
import { assessIsolatedEnvironment } from "./isolatedEnvironment";
import { sealedEvidence } from "./sealedEvidence";
import { proveHistoricalRateImmutability, proveCommercialDocumentChain } from "./historicalPricing";

export type TrackId = "DOMAIN" | "SECURITY" | "INTEGRITY" | "INFRASTRUCTURE" | "LEGAL" | "OPERATIONS";
export type TrackVerdict = "PASS" | "HOLD" | "FAIL";
export type EvidenceTier = "APPLICATION_EXECUTED" | "DATABASE_REQUIRED" | "BUSINESS_RECORD_REQUIRED";

const TRACK_MEMBERSHIP: Record<TrackId, string[]> = {
  DOMAIN: ["AV-01", "AV-02", "AV-03", "AV-14", "AV-15", "AV-16", "AV-20", "AV-21", "AV-22", "AV-23", "AV-24", "AV-25"],
  SECURITY: ["AV-07", "AV-26", "AV-28", "AV-29", "AV-08"],
  INTEGRITY: ["AV-09", "AV-10", "AV-11", "AV-12", "AV-13", "AV-27", "AV-30"],
  INFRASTRUCTURE: ["AV-06", "AV-17", "AV-18", "AV-19"],
  LEGAL: ["AV-04", "AV-05"],
  OPERATIONS: [],
};

/** Controls whose PASS may only come from a real database execution. */
const DATABASE_DEPENDENT = new Set(["AV-06", "AV-09", "AV-10", "AV-11", "AV-17", "AV-18", "AV-28", "AV-29", "AV-30"]);

export interface TrackAssessment {
  id: TrackId;
  title: string;
  /** What the track claims when it passes — deliberately narrow. */
  claim: string;
  verdict: TrackVerdict;
  tier: EvidenceTier;
  counts: Record<AdvControlStatus, number>;
  controls: AdversarialControl[];
  note: string;
}

const TRACK_META: Record<TrackId, { title: string; claim: string; tier: EvidenceTier; note: string }> = {
  DOMAIN: {
    title: "Architecture / domain foundation",
    claim: "Entities, state machines, quote, pricing, billing, claims and returns are coherent and reconciled.",
    tier: "APPLICATION_EXECUTED",
    note: "Domain reconciliation is CLOSED. It is not reopened unless a staging execution exposes a real contradiction.",
  },
  SECURITY: {
    title: "Security — application-level adversarial validation",
    claim: "Every modelled attack on authorization, tenancy, RPC identity and webhook authenticity is refused by the application boundary.",
    tier: "APPLICATION_EXECUTED",
    note: "The application must not be the only security boundary; database enforcement is proven in the INFRASTRUCTURE track.",
  },
  INTEGRITY: {
    title: "Integrity — idempotency, concurrency, ordering, audit",
    claim: "Duplicate, stale, out-of-order and concurrent commands produce exactly one authoritative effect in the reference model.",
    tier: "APPLICATION_EXECUTED",
    note: "In-process races can pass while Postgres still has races; the database proof is a separate control.",
  },
  INFRASTRUCTURE: {
    title: "Infrastructure evidence gate",
    claim: "Migration dry run, database RLS, database RPC, database concurrency, backup and restore executed on isolated instances.",
    tier: "DATABASE_REQUIRED",
    note: "No control here may pass on file existence, configuration existence or simulation.",
  },
  LEGAL: {
    title: "Legal / commercial gate",
    claim: "Licensing, protection cover, restricted goods, liability, claims and customer terms are recorded by the accountable authority.",
    tier: "BUSINESS_RECORD_REQUIRED",
    note: "LEGAL_REVIEW is never converted into LICENSED, and insurance evidence never authorises a loss guarantee by itself.",
  },
  OPERATIONS: {
    title: "Operations readiness",
    claim: "Monitoring, alerting, on-call, incident response, reconciliation and support escalation are staffed and rehearsed.",
    tier: "BUSINESS_RECORD_REQUIRED",
    note: "Tracked explicitly so a technically perfect system is not mistaken for an operable service.",
  },
};

const emptyCounts = (): Record<AdvControlStatus, number> => ({ PASS: 0, FAIL: 0, BLOCKED: 0, NOT_TESTED: 0 });

/* ------------------------- additional staging tests ------------------------- */

export interface StagingTest {
  id: string;
  test: string;
  track: TrackId;
  tier: EvidenceTier;
  status: AdvControlStatus | "BLOCKED_BUSINESS_TARGET_REQUIRED";
  evidence: string;
  owner: "engineering" | "security" | "finance" | "legal" | "operations";
}

/** The 15 tests that must be executed against a real isolated PostgreSQL. */
export function stagingTestRegister(): StagingTest[] {
  const env = assessIsolatedEnvironment();
  const hist = proveHistoricalRateImmutability();
  const docs = proveCommercialDocumentChain();
  const sealed = sealedEvidence();
  const ready = env.status === "READY" || sealed.infraReady;
  const blocked = ready ? "NOT_TESTED" : "BLOCKED";
  const envNote = ready
    ? sealed.infraReady
      ? `Isolated environment certified by DI-00 (${sealed.provenance}); execution evidence consumed per control.`
      : "Isolated environment ready; execution pending."
    : env.reason;

  // A database-tier control is decided ONLY by its latest valid sealed execution.
  const decide = (id: string, fallback: string): Pick<StagingTest, "status" | "evidence"> => {
    const rec = sealed.st[id];
    if (rec && rec.valid && rec.result === "PASS") {
      return {
        status: "PASS",
        evidence: `Executed against ${rec.environment_key ?? "the isolated instance"} on ${(rec.finished_at ?? "").slice(0, 19).replace("T", " ")}; sealed evidence ${(rec.evidence_sha256 ?? "").slice(0, 16)} on database identity ${(rec.environment_fingerprint ?? "unknown").slice(0, 12)}.`,
      };
    }
    if (rec && rec.valid && (rec.result === "FAIL" || rec.result === "PRODUCTION_TARGET_REFUSED")) {
      return { status: "FAIL", evidence: `Executed against ${rec.environment_key ?? "the isolated instance"} and failed (${rec.result}); engineering remediation required.` };
    }
    return { status: blocked, evidence: `${fallback} ${envNote}` };
  };

  return [
    { id: "ST-01", test: "Accepted quote database immutability (direct UPDATE / DELETE / price + rate-version mutation)", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "engineering", ...decide("ST-01", `Application-level refusal is proven; database-level refusal is untested.`) },
    {
      id: "ST-02",
      test: "Historical rate-plan reconstruction (accepted V1 quote must not reprice on V2)",
      track: "DOMAIN",
      tier: "APPLICATION_EXECUTED",
      status: hist.passed && docs.passed ? "PASS" : "FAIL",
      evidence: `Executed: V1 reconstructs to KES ${hist.v1_total_kes}; V2 prices the same inputs at KES ${hist.v2_total_kes}; the accepted quote still invoices KES ${hist.accepted_amount_kes} (drift ${hist.drift_kes}). Invoice ${docs.invoice.invoice_number} reconciles to the quote and receipt ${docs.receipt.receipt_number} chains back through invoice → quote → ${docs.invoice.rate_plan_reference}.`,
      owner: "finance",
    },
    { id: "ST-03", test: "Cross-tenant PostgreSQL RLS for all 15 principals", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "security", ...decide("ST-03", `The 5,100-cell matrix is a model, not a Postgres proof: real roles, real session JWT claims, real policies and real queries are required.`) },
    { id: "ST-04", test: "SECURITY DEFINER privilege escalation against deployed functions", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "security", ...decide("ST-04", `Forged tenant/partner/actor arguments must be refused by the function itself, not by the caller.`) },
    { id: "ST-05", test: "PostgreSQL concurrency races (same shipment, dispatch, courier, payment, POD)", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "engineering", ...decide("ST-05", `Parallel real transactions must yield one assignment, one transition, one financial effect.`) },
    { id: "ST-06", test: "PostgreSQL idempotency on booking, acceptance, payment callback, dispatch, POD, return, claim", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "engineering", ...decide("ST-06", `Replayed commands must not create a second authoritative effect at row level.`) },
    { id: "ST-07", test: "Out-of-order and stale event persistence", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "engineering", ...decide("ST-07", `Version-gap, late-terminal and reordered events must be refused by the stored transition guards.`) },
    { id: "ST-08", test: "Webhook replay against the deployed endpoint", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "security", ...decide("ST-08", `10/10 in-process probes pass; a replayed signed delivery must also be refused by the deployed function and ledger.`) },
    { id: "ST-09", test: "Backup creation on the isolated instance", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "engineering", ...decide("ST-09", `Backup configuration existence is explicitly not a pass.`) },
    { id: "ST-10", test: "Actual restore into a separate restore target", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "engineering", ...decide("ST-10", `Restore must verify schema, rows, foreign keys, RLS, RPCs, triggers, event stream, audit trail and application connectivity.`) },
    { id: "ST-11", test: "Post-restore business transaction (quote → booking → shipment → dispatch → delivery → POD → charge → invoice → payment)", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "operations", ...decide("ST-11", `A restored database that cannot process a transaction is not a recovery.`) },
    { id: "ST-12", test: "RPO measurement against an approved business target", track: "OPERATIONS", tier: "BUSINESS_RECORD_REQUIRED", status: "BLOCKED_BUSINESS_TARGET_REQUIRED", evidence: "No approved maximum tolerable data loss exists in the system of record. A target is not invented here; measurement is meaningless without it.", owner: "operations" },
    { id: "ST-13", test: "RTO measurement against an approved business target", track: "OPERATIONS", tier: "BUSINESS_RECORD_REQUIRED", status: "BLOCKED_BUSINESS_TARGET_REQUIRED", evidence: "No approved maximum tolerable downtime exists in the system of record. Recovery duration will be measured once the target is approved.", owner: "operations" },
    { id: "ST-14", test: "Audit-log integrity under unauthorized modification and deletion", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "security", ...decide("ST-14", `Ordinary application identities must be unable to alter the authoritative audit trail at database level.`) },
    { id: "ST-15", test: "Synthetic-data isolation — no production customer, shipment, payment, partner or personal data in staging", track: "INFRASTRUCTURE", tier: "DATABASE_REQUIRED", owner: "engineering", ...decide("ST-15", `Synthetic fixtures are declared and production is refused as a dry-run target; the assertion must still be executed against the provisioned instance.`) },
  ];
}

/* ----------------------------- track assessment ----------------------------- */

export function assessTracks(): TrackAssessment[] {
  const controls = df10AdversarialControls();
  const staging = stagingTestRegister();

  return (Object.keys(TRACK_META) as TrackId[]).map((id) => {
    const meta = TRACK_META[id];
    const members = controls.filter((c) => TRACK_MEMBERSHIP[id].includes(c.id));
    const counts = members.reduce((acc, c) => ({ ...acc, [c.status]: acc[c.status] + 1 }), emptyCounts());

    const stagingMembers = staging.filter((s) => s.track === id);
    const stagingClean = stagingMembers.every((s) => s.status === "PASS");
    const hasFail = counts.FAIL > 0 || stagingMembers.some((s) => s.status === "FAIL");

    let verdict: TrackVerdict;
    if (hasFail) verdict = "FAIL";
    // LEGAL and OPERATIONS can never be cleared by code: they require an
    // authoritative record (counsel determination, approved operating targets).
    else if (id === "OPERATIONS" || id === "LEGAL") verdict = "HOLD";
    else verdict = counts.PASS === members.length && members.length > 0 && stagingClean ? "PASS" : "HOLD";

    return { id, title: meta.title, claim: meta.claim, verdict, tier: meta.tier, counts, controls: members, note: meta.note };
  });
}

/* ------------------------------- certificate -------------------------------- */

export interface CertificateLine {
  section: string;
  item: string;
  satisfied: boolean;
  detail: string;
}

export interface ProductionEvidenceCertificate {
  /** Dominant headline. Never a pass count. */
  headline: string;
  status: "HOLD" | "CERTIFIED";
  tracks: TrackAssessment[];
  staging: StagingTest[];
  sections: CertificateLine[];
  /** Subordinate, deliberately de-emphasised counts. */
  counts: { PASS: number; BLOCKED: number; FAIL: number; NOT_TESTED: number; BUSINESS_TARGET_REQUIRED: number };
  migrationAuthorisation: "PROHIBITED" | "AUTHORISED";
  prohibitionReasons: string[];
  generated_at: string;
}

export function buildProductionEvidenceCertificate(now = new Date().toISOString()): ProductionEvidenceCertificate {
  const tracks = assessTracks();
  const staging = stagingTestRegister();
  const controls = df10AdversarialControls();

  const sections: CertificateLine[] = [
    ...tracks.flatMap((t) =>
      t.controls.map((c) => ({
        section: t.title,
        item: `${c.id} ${c.name}`,
        satisfied: c.status === "PASS" && !DATABASE_DEPENDENT.has(c.id),
        detail: DATABASE_DEPENDENT.has(c.id) && c.status === "PASS" ? "Database-dependent — application evidence only." : `${c.status} · ${c.evidence.slice(0, 220)}`,
      })),
    ),
    ...staging.map((s) => ({
      section: TRACK_META[s.track].title,
      item: `${s.id} ${s.test}`,
      satisfied: s.status === "PASS",
      detail: `${s.status} · ${s.evidence}`,
    })),
  ];

  const counts = {
    PASS: controls.filter((c) => c.status === "PASS").length + staging.filter((s) => s.status === "PASS").length,
    BLOCKED: controls.filter((c) => c.status === "BLOCKED").length + staging.filter((s) => s.status === "BLOCKED").length,
    FAIL: controls.filter((c) => c.status === "FAIL").length + staging.filter((s) => s.status === "FAIL").length,
    NOT_TESTED: controls.filter((c) => c.status === "NOT_TESTED").length + staging.filter((s) => s.status === "NOT_TESTED").length,
    BUSINESS_TARGET_REQUIRED: staging.filter((s) => s.status === "BLOCKED_BUSINESS_TARGET_REQUIRED").length,
  };

  const prohibitionReasons: string[] = [];
  for (const t of tracks) {
    if (t.verdict !== "PASS") prohibitionReasons.push(`${t.title}: ${t.verdict}`);
  }
  if (counts.FAIL > 0) prohibitionReasons.push(`${counts.FAIL} control(s) FAIL`);
  if (counts.BUSINESS_TARGET_REQUIRED > 0) prohibitionReasons.push("RPO/RTO business targets unresolved");

  const certified = prohibitionReasons.length === 0;

  return {
    headline: certified ? "PRODUCTION STATUS: CERTIFIED" : "PRODUCTION STATUS: HOLD",
    status: certified ? "CERTIFIED" : "HOLD",
    tracks,
    staging,
    sections,
    counts,
    migrationAuthorisation: certified ? "AUTHORISED" : "PROHIBITED",
    prohibitionReasons,
    generated_at: now,
  };
}

/** Auditable certificate document: control, test, environment, evidence, timestamp, result, owner, remediation, approval authority. */
export function renderCertificateMarkdown(cert: ProductionEvidenceCertificate): string {
  const lines: string[] = [
    "# YALLA LOGISTICS PRODUCTION READINESS CERTIFICATE",
    "",
    `**${cert.headline}**`,
    "",
    `Production migration authorisation: **${cert.migrationAuthorisation}**`,
    `Generated: ${cert.generated_at}`,
    "",
    "## Track assessment",
    "",
    ...cert.tracks.map((t) => `- **${t.title}** — ${t.verdict} (${t.tier}). ${t.claim} ${t.note}`),
    "",
    "## Gate counts (subordinate — not a readiness measure)",
    "",
    `PASS ${cert.counts.PASS} · BLOCKED ${cert.counts.BLOCKED} · FAIL ${cert.counts.FAIL} · NOT TESTED ${cert.counts.NOT_TESTED} · BUSINESS TARGET REQUIRED ${cert.counts.BUSINESS_TARGET_REQUIRED}`,
    "",
    "A pass count is not evidence of production readiness. Only a fully evidenced track set is.",
    "",
    "## Isolated-environment evidence register",
    "",
    "| Control | Test | Environment | Result | Owner | Evidence / remediation |",
    "|---|---|---|---|---|---|",
    ...cert.staging.map(
      (s) =>
        `| ${s.id} | ${s.test} | ${s.tier === "DATABASE_REQUIRED" ? "Isolated PostgreSQL (required)" : s.tier === "BUSINESS_RECORD_REQUIRED" ? "Business system of record" : "Application (in process)"} | ${s.status} | ${s.owner} | ${s.evidence} |`,
    ),
    "",
    "## Approval authority",
    "",
    "- Engineering controls: Head of Engineering",
    "- Security controls: Security owner",
    "- Financial / pricing controls: Finance",
    "- Legal gates: Counsel (licensing, protection cover, liability, customer terms)",
    "- Operations gates: Head of Operations (RPO/RTO approval, on-call, incident response)",
    "",
    cert.prohibitionReasons.length > 0
      ? `## Why authorisation is withheld\n\n${cert.prohibitionReasons.map((r) => `- ${r}`).join("\n")}`
      : "## Authorisation\n\nAll mandatory gates evidenced.",
  ];
  return lines.join("\n");
}
