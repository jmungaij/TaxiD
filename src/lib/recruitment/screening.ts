/**
 * Recruitment 360 — screening progress, adjudication and reporting client layer.
 *
 * The browser never computes an outcome here. It reads server-computed batch
 * progress and screening rankings, submits recruiter adjudications (which the
 * database records append-only and re-scores itself), and shapes the results
 * into `ReportTable`s so CSV/PDF export stays pure and testable.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ReportTable } from "@/lib/corporate/executiveExports";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/* ------------------------------- progress -------------------------------- */

export interface BatchProgressFile {
  file_id: string;
  file_name: string;
  storage_path: string;
  doc_type: string;
  size_bytes: number | null;
  status: "stored" | "queued" | "parsing" | "parsed" | "failed" | "skipped";
  attempts: number;
  parse_error: string | null;
  text_extracted: boolean;
  linked_record_id: string | null;
  candidate_name: string | null;
  created_at: string;
}

export interface BatchProgress {
  batch: {
    id: string;
    batch_no: string;
    name: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    totals: Record<string, number> | null;
  };
  files: BatchProgressFile[];
  file_counts: Record<string, number>;
  records: { total: number; by_state: Record<string, number> };
  screening: {
    applications: number;
    evaluated: number;
    pending: number;
    eligible: number;
    requires_review: number;
    not_eligible: number;
    avg_score: number | null;
    adjudications: number;
  };
}

export async function loadBatchProgress(batchId: string): Promise<BatchProgress> {
  const { data, error } = await db.rpc("rec_migration_batch_progress", { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  return data as BatchProgress;
}

/** Percentage completion of a single lifecycle lane, clamped to 0-100. */
export function lanePct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export interface ProgressLane {
  key: "upload" | "extraction" | "migration" | "screening";
  label: string;
  done: number;
  total: number;
  pct: number;
  detail: string;
}

export function progressLanes(p: BatchProgress): ProgressLane[] {
  const files = p.files ?? [];
  const stored = files.length;
  const parsed = files.filter((f) => f.status === "parsed").length;
  const failed = files.filter((f) => f.status === "failed").length;
  const linked = files.filter((f) => !!f.linked_record_id).length;
  const s = p.screening ?? {
    applications: 0, evaluated: 0, pending: 0, eligible: 0,
    requires_review: 0, not_eligible: 0, avg_score: null, adjudications: 0,
  };
  return [
    {
      key: "upload",
      label: "Documents uploaded",
      done: stored,
      total: Math.max(stored, p.batch?.totals?.files ?? stored),
      pct: lanePct(stored, Math.max(stored, p.batch?.totals?.files ?? stored)),
      detail: `${stored} file${stored === 1 ? "" : "s"} in secure storage`,
    },
    {
      key: "extraction",
      label: "Text extraction",
      done: parsed,
      total: stored,
      pct: lanePct(parsed, stored),
      detail: failed > 0 ? `${failed} failed — retry from the worker monitor` : "No extraction failures",
    },
    {
      key: "migration",
      label: "Records migrated",
      done: linked,
      total: stored,
      pct: lanePct(linked, stored),
      detail: `${p.records?.total ?? 0} migration record${(p.records?.total ?? 0) === 1 ? "" : "s"} created`,
    },
    {
      key: "screening",
      label: "Screening evaluated",
      done: s.evaluated,
      total: s.applications,
      pct: lanePct(s.evaluated, s.applications),
      detail:
        s.applications === 0
          ? "No applications yet"
          : `${s.eligible} eligible · ${s.requires_review} to review · ${s.not_eligible} gated`,
    },
  ];
}

/* ---------------------------- screening report --------------------------- */

export type ContactRequestStatus =
  | "pending" | "awaiting_manual" | "sent" | "responded" | "no_response" | "cancelled";

export interface ScreeningReportRow {
  rank: number;
  application_id: string;
  application_no: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  years_experience: number | null;
  score: number | null;
  eligibility: "eligible" | "requires_review" | "not_eligible" | null;
  recommendation: string | null;
  evidence_confidence: number | null;
  gate_failures: string[] | null;
  missing_evidence: string[] | null;
  stage: string;
  status: string;
  rejection_reason: string | null;
  human_decision: string | null;
  human_decision_reason: string | null;
  human_decided_at: string | null;
  adjudications: number;
  adjudicated_attributes: number;
  evidence_facts: number;
  verified_facts: number;
  weak_facts: number;
  criteria_count: number;
  open_contact_requests: number;
  contact_request_status: ContactRequestStatus | null;
  candidate_id: string;
  evidence_citations: string | null;
}

export interface ScreeningReport {
  vacancy: { id: string; title: string; location: string | null };
  generated_at: string;
  batch_id: string | null;
  criteria_count?: number;
  rows: ScreeningReportRow[];
}

export async function loadScreeningReport(
  vacancyId: string,
  batchId?: string | null,
): Promise<ScreeningReport> {
  const { data, error } = await db.rpc("rec_screening_report", {
    p_vacancy_id: vacancyId,
    p_batch_id: batchId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as ScreeningReport;
}

const ELIGIBILITY_LABEL: Record<string, string> = {
  eligible: "Eligible",
  requires_review: "Requires review",
  not_eligible: "Gate failure",
};

/* ------------------------- coverage + rationale --------------------------- */

export interface CoverageConfidence {
  /** Share of scorecard criteria that have at least one live evidence fact. */
  coveragePct: number;
  /** Share of live evidence facts a human has verified or adjudicated. */
  verifiedPct: number;
  /** Mean extraction confidence reported by the evaluation engine, 0-100. */
  extractionPct: number | null;
  /** Weak (sub-0.6 confidence) facts still standing. */
  weakFacts: number;
  band: "strong" | "adequate" | "thin";
  label: string;
}

/** Evidence coverage for one candidate — derived only from server-reported counts. */
export function coverageConfidence(r: ScreeningReportRow): CoverageConfidence {
  const criteria = r.criteria_count ?? 0;
  const facts = r.evidence_facts ?? 0;
  const covered = criteria > 0 ? Math.min(criteria, facts) : facts;
  const coveragePct = criteria > 0 ? Math.round((covered / criteria) * 100) : facts > 0 ? 100 : 0;
  const verifiedPct = facts > 0 ? Math.round(((r.verified_facts ?? 0) / facts) * 100) : 0;
  const extractionPct = r.evidence_confidence == null ? null : Math.round(Number(r.evidence_confidence) * 100);
  const weakFacts = r.weak_facts ?? 0;
  const gaps = (r.missing_evidence ?? []).length + (r.gate_failures ?? []).length;
  const band: CoverageConfidence["band"] =
    coveragePct >= 80 && weakFacts === 0 && gaps === 0
      ? "strong"
      : coveragePct >= 60 && gaps <= 2
        ? "adequate"
        : "thin";
  return {
    coveragePct,
    verifiedPct,
    extractionPct,
    weakFacts,
    band,
    label: `${coveragePct}% of criteria evidenced · ${verifiedPct}% human-verified${
      extractionPct == null ? "" : ` · ${extractionPct}% extraction confidence`
    }${weakFacts > 0 ? ` · ${weakFacts} weak fact${weakFacts === 1 ? "" : "s"}` : ""}`,
  };
}

/** One-paragraph, evidence-anchored rationale for the recorded or pending decision. */
export function decisionRationale(r: ScreeningReportRow): string {
  const cov = coverageConfidence(r);
  const parts: string[] = [];
  parts.push(
    r.human_decision
      ? `Human decision: ${r.human_decision.replace(/_/g, " ")}${
          r.human_decision_reason ? ` (${r.human_decision_reason})` : ""
        }.`
      : "No human decision recorded yet — AI output is decision support only.",
  );
  parts.push(
    `Scored ${r.score == null ? "not evaluated" : Number(r.score).toFixed(1)} with eligibility “${
      ELIGIBILITY_LABEL[r.eligibility ?? ""] ?? "not evaluated"
    }”; AI recommendation ${r.recommendation ? r.recommendation.replace(/_/g, " ") : "none"}.`,
  );
  parts.push(`Evidence coverage ${cov.band}: ${cov.label}.`);
  if ((r.gate_failures ?? []).length) parts.push(`Hard gates failed: ${(r.gate_failures ?? []).join(", ")}.`);
  if ((r.missing_evidence ?? []).length) parts.push(`Evidence still missing: ${(r.missing_evidence ?? []).join(", ")}.`);
  if ((r.adjudications ?? 0) > 0)
    parts.push(
      `${r.adjudications} human adjudication${r.adjudications === 1 ? "" : "s"} applied across ${
        r.adjudicated_attributes ?? 0
      } attribute${(r.adjudicated_attributes ?? 0) === 1 ? "" : "s"}.`,
    );
  if (!r.email && !r.phone)
    parts.push(
      `Candidate is uncontactable${
        r.contact_request_status ? ` (contact request ${r.contact_request_status.replace(/_/g, " ")})` : ""
      }.`,
    );
  return parts.join(" ");
}

/** Compact flag string for exports — every governance signal in one cell. */
export function adjudicationFlags(r: ScreeningReportRow): string {
  const flags: string[] = [];
  if ((r.adjudications ?? 0) > 0) flags.push(`ADJUDICATED×${r.adjudications}`);
  if ((r.verified_facts ?? 0) > 0) flags.push(`HUMAN-VERIFIED×${r.verified_facts}`);
  if ((r.weak_facts ?? 0) > 0) flags.push(`LOW-CONFIDENCE×${r.weak_facts}`);
  if ((r.gate_failures ?? []).length) flags.push("GATE-FAILURE");
  if (r.eligibility === "requires_review") flags.push("AWAITING-HUMAN-GATE");
  if (!r.email && !r.phone) flags.push("NO-CONTACT");
  if ((r.open_contact_requests ?? 0) > 0) flags.push("CONTACT-REQUEST-OPEN");
  return flags.join(" | ") || "CLEAN";
}

export function screeningReportTable(report: ScreeningReport): ReportTable {
  const rows = report.rows ?? [];
  const eligible = rows.filter((r) => r.eligibility === "eligible").length;
  const review = rows.filter((r) => r.eligibility === "requires_review").length;
  const gated = rows.filter((r) => r.eligibility === "not_eligible").length;
  const meanCoverage = rows.length
    ? Math.round(rows.reduce((n, r) => n + coverageConfidence(r).coveragePct, 0) / rows.length)
    : 0;
  return {
    id: `screening-${report.vacancy.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title: `SAFARID · ${report.vacancy.title} screening report`,
    subtitle: `Generated ${new Date(report.generated_at).toLocaleString()}${
      report.vacancy.location ? ` · ${report.vacancy.location}` : ""
    }`,
    meta: [
      ["Candidates screened", String(rows.length)],
      ["Eligible", String(eligible)],
      ["Requires human review", String(review)],
      ["Hard-gate failures", String(gated)],
      ["Scorecard criteria", String(report.criteria_count ?? rows[0]?.criteria_count ?? 0)],
      ["Mean evidence coverage", `${meanCoverage}%`],
      ["Manual adjudications", String(rows.reduce((n, r) => n + (r.adjudications ?? 0), 0))],
      ["Candidates without contact details", String(rows.filter((r) => !r.email && !r.phone).length)],
      ["Decision authority", "Authorised hiring decision-maker — AI output is decision support only"],
    ],
    columns: [
      "Rank", "Candidate", "Contact", "Contact recovery", "Location", "Score", "Eligibility",
      "AI recommendation", "Coverage confidence", "Adjudication flags", "Gate failures",
      "Missing evidence", "Evidence citations", "Stage", "Human decision",
      "Adjudications", "Decision rationale",
    ],
    rows: rows.map((r) => {
      const cov = coverageConfidence(r);
      return [
        r.rank,
        r.full_name,
        [r.email, r.phone].filter(Boolean).join(" · ") || "Not supplied",
        r.contact_request_status ? r.contact_request_status.replace(/_/g, " ") : "Not requested",
        r.location ?? "Unknown",
        r.score == null ? "" : Number(r.score).toFixed(1),
        ELIGIBILITY_LABEL[r.eligibility ?? ""] ?? "Not evaluated",
        r.recommendation ? r.recommendation.replace(/_/g, " ") : "",
        `${cov.band} — ${cov.label}`,
        adjudicationFlags(r),
        (r.gate_failures ?? []).join("; "),
        (r.missing_evidence ?? []).join("; "),
        r.evidence_citations ?? "",
        r.stage,
        r.human_decision
          ? `${r.human_decision.replace(/_/g, " ")}${r.human_decision_reason ? ` (${r.human_decision_reason})` : ""}`
          : "Pending",
        r.adjudications ?? 0,
        decisionRationale(r),
      ];
    }),
  };
}

/* ----------------------------- adjudication ------------------------------ */

export type AdjudicationDecision =
  | "verify" | "override" | "reject" | "waive_gate" | "set_rejection_reason";

export interface EvidenceAdjudication {
  id: string;
  application_id: string;
  candidate_id: string;
  vacancy_id: string;
  attribute: string;
  decision: AdjudicationDecision;
  before_value: string | null;
  before_confidence: number | null;
  after_value: string | null;
  after_confidence: number | null;
  reason_code: string;
  reason_notes: string | null;
  adjudicator_email: string | null;
  adjudicated_at: string;
  evaluation_before: Record<string, unknown>;
  evaluation_after: Record<string, unknown>;
}

export const ADJUDICATION_REASONS = [
  { code: "verified_from_source_document", label: "Verified against the source document" },
  { code: "verified_with_candidate", label: "Verified directly with the candidate" },
  { code: "extraction_error", label: "Extraction misread the document" },
  { code: "ocr_low_quality", label: "Scanned/OCR quality too low to trust" },
  { code: "evidence_not_substantiated", label: "Claim is not substantiated by evidence" },
  { code: "role_requirement_waived", label: "Requirement waived by hiring authority" },
  { code: "duplicate_or_stale_record", label: "Duplicate or stale historical record" },
] as const;

export const ADJUDICATION_DECISION_LABEL: Record<AdjudicationDecision, string> = {
  verify: "Verify evidence",
  override: "Override with verified value",
  reject: "Reject evidence",
  waive_gate: "Waive requirement",
  set_rejection_reason: "Set rejection reason",
};

export interface EvidenceFact {
  id: string;
  attribute: string;
  value_text: string | null;
  value_numeric: number | null;
  source_kind: string;
  source_ref: string;
  source_locator: string | null;
  confidence: number;
  extracted_by: string;
  verified_at: string | null;
  superseded_at: string | null;
  adjudicated: boolean;
  created_at: string;
}

export async function listEvidenceFacts(applicationId: string): Promise<EvidenceFact[]> {
  const { data, error } = await db
    .from("rec_evidence_facts")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as EvidenceFact[];
}

export async function listAdjudications(applicationId: string): Promise<EvidenceAdjudication[]> {
  const { data, error } = await db
    .from("rec_evidence_adjudications")
    .select("*")
    .eq("application_id", applicationId)
    .order("adjudicated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as EvidenceAdjudication[];
}

export async function listVacancyAdjudications(
  vacancyId: string,
  limit = 200,
): Promise<EvidenceAdjudication[]> {
  const { data, error } = await db
    .from("rec_evidence_adjudications")
    .select("*")
    .eq("vacancy_id", vacancyId)
    .order("adjudicated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as EvidenceAdjudication[];
}

export interface AdjudicateInput {
  applicationId: string;
  attribute: string;
  decision: AdjudicationDecision;
  reasonCode: string;
  valueText?: string | null;
  valueNumeric?: number | null;
  notes?: string | null;
  confidence?: number;
}

export async function adjudicateEvidence(input: AdjudicateInput): Promise<{
  adjudication_id: string;
  decision: AdjudicationDecision;
  attribute: string;
  new_fact_id: string | null;
  evaluation: Record<string, unknown>;
}> {
  const { data, error } = await db.rpc("rec_adjudicate_evidence", {
    p_application_id: input.applicationId,
    p_attribute: input.attribute,
    p_decision: input.decision,
    p_reason_code: input.reasonCode,
    p_value_text: input.valueText ?? null,
    p_value_numeric: input.valueNumeric ?? null,
    p_notes: input.notes ?? null,
    p_confidence: input.confidence ?? 1,
  });
  if (error) throw new Error(error.message);
  return data;
}

export function adjudicationTrailTable(
  vacancyTitle: string,
  rows: EvidenceAdjudication[],
): ReportTable {
  return {
    id: "screening-adjudication-trail",
    title: `SAFARID · ${vacancyTitle} adjudication trail`,
    subtitle: "Append-only record of every human override of AI-extracted evidence",
    meta: [["Adjudications", String(rows.length)]],
    columns: [
      "When", "Adjudicator", "Candidate application", "Attribute", "Decision",
      "Previous value", "Verified value", "Reason", "Notes",
    ],
    rows: rows.map((a) => [
      new Date(a.adjudicated_at).toLocaleString(),
      a.adjudicator_email ?? "Unknown",
      a.application_id,
      a.attribute,
      ADJUDICATION_DECISION_LABEL[a.decision] ?? a.decision,
      a.before_value ?? "",
      a.after_value ?? "",
      a.reason_code,
      a.reason_notes ?? "",
    ]),
  };
}

/* -------------------------- discrepancy reporting ------------------------ */

export type DiscrepancySeverity = "critical" | "high" | "medium" | "low";

export interface ScreeningDiscrepancy {
  applicationId: string;
  candidate: string;
  attribute: string | null;
  severity: DiscrepancySeverity;
  kind:
    | "low_extraction_confidence"
    | "missing_evidence"
    | "hard_gate_failure"
    | "missing_contact"
    | "unresolved_duplicate"
    | "requires_review";
  finding: string;
  action: string;
}

const SEVERITY_ORDER: DiscrepancySeverity[] = ["critical", "high", "medium", "low"];

/**
 * Derive the actionable discrepancy list for a screening run. Purely a function
 * of the server report — no hidden state, so it is unit-testable.
 */
export function screeningDiscrepancies(
  report: ScreeningReport,
  opts?: { lowConfidence?: number; unresolvedDuplicates?: number },
): ScreeningDiscrepancy[] {
  const lowConf = opts?.lowConfidence ?? 0.6;
  const out: ScreeningDiscrepancy[] = [];

  for (const r of report.rows ?? []) {
    if (r.evidence_confidence != null && Number(r.evidence_confidence) < lowConf) {
      out.push({
        applicationId: r.application_id,
        candidate: r.full_name,
        attribute: null,
        severity: Number(r.evidence_confidence) < 0.45 ? "critical" : "high",
        kind: "low_extraction_confidence",
        finding: `Mean evidence confidence is ${(Number(r.evidence_confidence) * 100).toFixed(0)}% — below the ${(lowConf * 100).toFixed(0)}% trust floor.`,
        action: "Open the source document and adjudicate each weak attribute before any decision.",
      });
    }
    for (const label of r.missing_evidence ?? []) {
      out.push({
        applicationId: r.application_id,
        candidate: r.full_name,
        attribute: label,
        severity: "medium",
        kind: "missing_evidence",
        finding: `No evidence recorded for “${label}”.`,
        action: "Request the missing detail from the candidate, or record verified evidence manually.",
      });
    }
    for (const label of r.gate_failures ?? []) {
      out.push({
        applicationId: r.application_id,
        candidate: r.full_name,
        attribute: label,
        severity: "critical",
        kind: "hard_gate_failure",
        finding: `Hard gate failed: ${label}.`,
        action: "Confirm the gate, or waive it with a reason if the hiring authority accepts the exception.",
      });
    }
    if (!r.email || !r.phone) {
      const missing = [!r.email ? "email address" : null, !r.phone ? "telephone number" : null]
        .filter(Boolean)
        .join(" and ");
      out.push({
        applicationId: r.application_id,
        candidate: r.full_name,
        attribute: "contact",
        severity: !r.email && !r.phone ? "high" : "medium",
        kind: "missing_contact",
        finding: `No ${missing} on file${
          r.contact_request_status ? ` · recovery request: ${CONTACT_STATUS_LABEL[r.contact_request_status]}` : ""
        }.`,
        action:
          (r.open_contact_requests ?? 0) > 0
            ? "A recovery request is open — log the candidate's reply against the audit trail when it arrives."
            : "Enter the detail manually from the source document, or send an automated request for it.",
      });
    }
    if (r.eligibility === "requires_review") {
      out.push({
        applicationId: r.application_id,
        candidate: r.full_name,
        attribute: null,
        severity: "high",
        kind: "requires_review",
        finding: "Screening ended in requires-review: a hard gate could not be evidenced either way.",
        action: "A human must adjudicate the gate before the candidate advances or is rejected.",
      });
    }
  }

  const dupes = opts?.unresolvedDuplicates ?? 0;
  if (dupes > 0) {
    out.push({
      applicationId: "",
      candidate: "Batch-level",
      attribute: "identity",
      severity: "high",
      kind: "unresolved_duplicate",
      finding: `${dupes} possible duplicate identit${dupes === 1 ? "y" : "ies"} remain unresolved.`,
      action: "Resolve each duplicate as merge or keep-separate before committing the batch.",
    });
  }

  return out.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.candidate.localeCompare(b.candidate),
  );
}

export function discrepancyReportTable(
  report: ScreeningReport,
  findings: ScreeningDiscrepancy[],
): ReportTable {
  const counts = SEVERITY_ORDER.map(
    (s) => [`${s[0].toUpperCase()}${s.slice(1)} findings`, String(findings.filter((f) => f.severity === s).length)] as [string, string],
  );
  const byApp = new Map((report.rows ?? []).map((r) => [r.application_id, r]));
  return {
    id: "screening-discrepancy-report",
    title: `SAFARID · ${report.vacancy.title} screening discrepancy report`,
    subtitle: `Generated ${new Date(report.generated_at).toLocaleString()}`,
    meta: [["Candidates screened", String((report.rows ?? []).length)], ...counts],
    columns: [
      "Severity", "Candidate", "Attribute", "Finding", "Required action",
      "Coverage confidence", "Adjudication flags", "Application",
    ],
    rows: findings.map((f) => {
      const row = byApp.get(f.applicationId);
      return [
        f.severity,
        f.candidate,
        f.attribute ?? "—",
        f.finding,
        f.action,
        row ? coverageConfidence(row).label : "—",
        row ? adjudicationFlags(row) : "—",
        f.applicationId,
      ];
    }),
  };
}

/* --------------------- contact recovery + audit trail --------------------- */

export interface ContactRequest {
  id: string;
  candidate_id: string;
  application_id: string | null;
  vacancy_id: string | null;
  requested_fields: string[];
  channel: "email" | "sms" | "phone_call" | "whatsapp" | "manual";
  status: ContactRequestStatus;
  attempt_no: number;
  recipient: string | null;
  message_note: string | null;
  response_email: string | null;
  response_phone: string | null;
  response_notes: string | null;
  responder_kind: string | null;
  requested_at: string;
  responded_at: string | null;
}

export interface CandidateAuditEvent {
  id: string;
  action: string;
  created_at: string;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  source: string | null;
}

export interface ContactTimeline {
  candidate: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    last_contact_at: string | null;
  } | null;
  requests: ContactRequest[];
  audit: CandidateAuditEvent[];
}

export async function loadContactTimeline(candidateId: string): Promise<ContactTimeline> {
  const { data, error } = await db.rpc("rec_candidate_contact_timeline", { p_candidate_id: candidateId });
  if (error) throw new Error(error.message);
  return data as ContactTimeline;
}

/** Queue an automated request for the missing details (email/SMS), or park it for manual follow-up. */
export async function requestCandidateContact(input: {
  applicationId: string;
  fields?: string[];
  channel?: "auto" | "email" | "sms" | "whatsapp" | "phone_call" | "manual";
  notes?: string | null;
}): Promise<{ request_id: string; channel: string; status: ContactRequestStatus; recipient: string | null }> {
  const { data, error } = await db.rpc("rec_request_candidate_contact", {
    p_application_id: input.applicationId,
    p_fields: input.fields ?? ["email", "phone"],
    p_channel: input.channel ?? "auto",
    p_notes: input.notes ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Manual capture of contact details a recruiter recovered from a document or a call. */
export async function recordCandidateContact(input: {
  candidateId: string;
  email?: string | null;
  phone?: string | null;
  source?: string;
  notes?: string | null;
  requestId?: string | null;
}): Promise<{ candidate_id: string; email: string | null; phone: string | null }> {
  const { data, error } = await db.rpc("rec_record_candidate_contact", {
    p_candidate_id: input.candidateId,
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
    p_source: input.source ?? "manual_collection",
    p_notes: input.notes ?? null,
    p_request_id: input.requestId ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Log the candidate's reply — or the absence of one — against the request. */
export async function logContactResponse(input: {
  requestId: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  responderKind?: "candidate" | "recruiter" | "referrer" | "system";
  noResponse?: boolean;
}): Promise<{ request_id: string; status: ContactRequestStatus }> {
  const { data, error } = await db.rpc("rec_log_contact_response", {
    p_request_id: input.requestId,
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
    p_notes: input.notes ?? null,
    p_responder_kind: input.responderKind ?? "candidate",
    p_no_response: input.noResponse ?? false,
  });
  if (error) throw new Error(error.message);
  return data;
}

export const CONTACT_STATUS_LABEL: Record<ContactRequestStatus, string> = {
  pending: "Queued",
  awaiting_manual: "Manual follow-up needed",
  sent: "Request sent",
  responded: "Details received",
  no_response: "No response",
  cancelled: "Cancelled",
};

/* --------------------- discrepancy resolution checklist ------------------- */

export interface ResolutionStep {
  key: string;
  order: number;
  title: string;
  detail: string;
  done: boolean;
  blocking: boolean;
  /** What the recruiter should do next in the UI. */
  cta: "collect_contact" | "request_contact" | "adjudicate" | "waive_gate" | "record_decision" | "none";
}

/**
 * Ordered, per-candidate resolution path. Every step is derived from the server
 * report, so completing an action and refetching flips the step to done.
 */
export function resolutionChecklist(r: ScreeningReportRow): ResolutionStep[] {
  const cov = coverageConfidence(r);
  const hasContact = !!r.email || !!r.phone;
  const steps: ResolutionStep[] = [
    {
      key: "contact",
      order: 1,
      title: "Contact details on file",
      detail: hasContact
        ? `Reachable on ${[r.email, r.phone].filter(Boolean).join(" · ")}.`
        : "No email or telephone number — record what you can verify, or send a request.",
      done: hasContact,
      blocking: true,
      cta: hasContact ? "none" : "collect_contact",
    },
    {
      key: "contact_request",
      order: 2,
      title: "Missing-detail request answered",
      detail:
        (r.open_contact_requests ?? 0) > 0
          ? `A request is open (${CONTACT_STATUS_LABEL[r.contact_request_status ?? "pending"]}) — log the reply when it arrives.`
          : r.contact_request_status
            ? `Last request: ${CONTACT_STATUS_LABEL[r.contact_request_status]}.`
            : "No request needed.",
      done: (r.open_contact_requests ?? 0) === 0,
      blocking: false,
      cta: (r.open_contact_requests ?? 0) > 0 ? "request_contact" : "none",
    },
    {
      key: "weak_evidence",
      order: 3,
      title: "Low-confidence extractions adjudicated",
      detail:
        cov.weakFacts > 0
          ? `${cov.weakFacts} fact${cov.weakFacts === 1 ? "" : "s"} below the 60% trust floor — verify each against the source document.`
          : "No weak extractions outstanding.",
      done: cov.weakFacts === 0,
      blocking: true,
      cta: cov.weakFacts > 0 ? "adjudicate" : "none",
    },
    {
      key: "missing_evidence",
      order: 4,
      title: "Missing evidence closed",
      detail: (r.missing_evidence ?? []).length
        ? `Still unevidenced: ${(r.missing_evidence ?? []).join(", ")}.`
        : "Every scored criterion has evidence.",
      done: (r.missing_evidence ?? []).length === 0,
      blocking: false,
      cta: (r.missing_evidence ?? []).length ? "adjudicate" : "none",
    },
    {
      key: "gates",
      order: 5,
      title: "Hard gates resolved",
      detail: (r.gate_failures ?? []).length
        ? `Failed: ${(r.gate_failures ?? []).join(", ")} — confirm, or waive with hiring-authority approval.`
        : r.eligibility === "requires_review"
          ? "A gate could not be evidenced either way — a human must decide it."
          : "All hard gates satisfied.",
      done: (r.gate_failures ?? []).length === 0 && r.eligibility !== "requires_review",
      blocking: true,
      cta: (r.gate_failures ?? []).length || r.eligibility === "requires_review" ? "waive_gate" : "none",
    },
    {
      key: "decision",
      order: 6,
      title: "Human decision recorded",
      detail: r.human_decision
        ? `${r.human_decision.replace(/_/g, " ")}${r.human_decision_reason ? ` — ${r.human_decision_reason}` : ""}.`
        : "The authorised decision-maker has not yet recorded advance or reject.",
      done: !!r.human_decision,
      blocking: true,
      cta: r.human_decision ? "none" : "record_decision",
    },
  ];
  return steps.sort((a, b) => a.order - b.order);
}

export function checklistProgress(steps: ResolutionStep[]): { done: number; total: number; pct: number; blocked: number } {
  const done = steps.filter((s) => s.done).length;
  return {
    done,
    total: steps.length,
    pct: lanePct(done, steps.length),
    blocked: steps.filter((s) => !s.done && s.blocking).length,
  };
}

export function contactRecoveryTable(
  vacancyTitle: string,
  rows: ScreeningReportRow[],
): ReportTable {
  const gaps = rows.filter((r) => !r.email || !r.phone);
  return {
    id: "screening-contact-recovery",
    title: `SAFARID · ${vacancyTitle} contact recovery register`,
    subtitle: "Candidates with incomplete contact details and the state of each recovery request",
    meta: [
      ["Candidates with a contact gap", String(gaps.length)],
      ["Open recovery requests", String(rows.reduce((n, r) => n + (r.open_contact_requests ?? 0), 0))],
    ],
    columns: ["Candidate", "Email", "Telephone", "Missing", "Recovery status", "Application"],
    rows: gaps.map((r) => [
      r.full_name,
      r.email ?? "—",
      r.phone ?? "—",
      [!r.email ? "email" : null, !r.phone ? "phone" : null].filter(Boolean).join(" + "),
      r.contact_request_status ? CONTACT_STATUS_LABEL[r.contact_request_status] : "Not requested",
      r.application_no,
    ]),
  };
}

/** The vacancy most of a batch's applications belong to (batches are per-campaign). */
export async function batchVacancyId(batchId: string): Promise<string | null> {
  const { data, error } = await db
    .from("rec_applications")
    .select("vacancy_id")
    .eq("migration_batch_id", batchId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.vacancy_id as string) ?? null;
}
