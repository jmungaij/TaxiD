/**
 * Recruitment 360 — Forensic QA suite for the candidate migration engine.
 *
 * The import engine makes machine inferences (extraction confidence, evidenced
 * fields, duplicate classification, identity and vacancy match scoring). A
 * hiring record is only defensible if those inferences can be audited, so this
 * module re-derives them independently of the engine and reports every
 * discrepancy it finds, each with the evidence that proves it and the action a
 * recruiter should take.
 *
 * It is deliberately pure: given records, duplicates and files it returns
 * findings, with no I/O. That makes it unit-testable and lets the same rules
 * run in CI against fixtures and in the staff portal against live batches.
 */
import type {
  MigrationDuplicate, MigrationFile, MigrationRecordDetail,
} from "@/lib/recruitment/migration";

export type QaSeverity = "critical" | "high" | "medium" | "low";

export type QaDomain =
  | "extraction_confidence" | "field_evidence" | "duplicate_classification"
  | "scoring" | "provenance" | "worker";

export interface QaFinding {
  /** Stable rule id — safe to reference in tickets and regression tests. */
  code: string;
  domain: QaDomain;
  severity: QaSeverity;
  /** What is wrong, in the language of a recruiter. */
  summary: string;
  /** The observed values that prove the finding. */
  evidence: Record<string, unknown>;
  /** What a human should do about it. */
  action: string;
  recordId?: string;
  fileId?: string;
  duplicateId?: string;
  subject?: string;
}

export interface QaReport {
  generatedAt: string;
  scanned: { records: number; duplicates: number; files: number };
  findings: QaFinding[];
  countsBySeverity: Record<QaSeverity, number>;
  countsByDomain: Record<QaDomain, number>;
  /** 0-100. 100 means no discrepancy was detected in the scanned population. */
  integrityScore: number;
  blocking: boolean;
}

/* ------------------------------- thresholds ------------------------------- */

/**
 * Duplicate classification bands the engine is expected to honour. Kept here as
 * the QA contract: if the engine's banding changes, this must change with it and
 * the tests will show which band moved.
 */
export const DUPLICATE_BANDS = {
  exact: { min: 95, max: 100 },
  probable: { min: 80, max: 95 },
  possible: { min: 55, max: 80 },
} as const;

export const CONFIDENCE_BANDS = { high: 0.75, medium: 0.5 } as const;

/** Evidence shorter than this cannot support a field value. */
const MIN_EVIDENCE_CHARS = 3;

/** States in which a record is expected to carry an extraction confidence. */
const PARSED_STATES = new Set(["PARSED", "SCORED", "READY_FOR_REVIEW", "APPROVED", "IMPORTED"]);

const EVIDENCED_FIELDS = [
  "email", "phone", "full_name", "current_title", "current_employer",
  "years_experience", "location", "skills", "education", "employment_history",
  "linkedin_url",
] as const;

const SEVERITY_WEIGHT: Record<QaSeverity, number> = {
  critical: 12, high: 6, medium: 3, low: 1,
};

/* -------------------------------- helpers -------------------------------- */

/** Normalises a 0-1 or 0-100 confidence to 0-1, or null when unusable. */
export function normaliseConfidence(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function displayName(r: Pick<MigrationRecordDetail, "normalized" | "source_row_no">): string {
  const n = asRecord(r.normalized);
  const name = typeof n.full_name === "string" && n.full_name.trim() ? n.full_name : null;
  return name ?? (r.source_row_no != null ? `Row ${r.source_row_no}` : "Unnamed record");
}

function evidenceLength(evidence: unknown): number {
  if (typeof evidence === "string") return evidence.trim().length;
  if (Array.isArray(evidence)) return evidence.join(" ").trim().length;
  return 0;
}

/* ----------------------------- extraction QA ----------------------------- */

export function auditExtraction(record: MigrationRecordDetail, documentCount = 0): QaFinding[] {
  const out: QaFinding[] = [];
  const subject = displayName(record);
  const extraction = asRecord(record.extraction);
  const declared = normaliseConfidence(record.extraction_confidence);
  const inExtraction = normaliseConfidence(extraction.confidence);
  const base = { recordId: record.id, subject };

  if (record.extraction_confidence != null && declared === null) {
    out.push({
      ...base, code: "QA_CONF_UNPARSEABLE", domain: "extraction_confidence", severity: "high",
      summary: "Extraction confidence is not a usable number.",
      evidence: { extraction_confidence: record.extraction_confidence },
      action: "Re-run extraction for this record; do not approve it on the current confidence value.",
    });
  } else if (declared !== null && (declared < 0 || declared > 1)) {
    out.push({
      ...base, code: "QA_CONF_OUT_OF_RANGE", domain: "extraction_confidence", severity: "high",
      summary: "Extraction confidence falls outside the valid 0-100% range.",
      evidence: { extraction_confidence: record.extraction_confidence, normalised: declared },
      action: "Re-run extraction; the worker recorded an impossible confidence.",
    });
  }

  if (declared === null && documentCount > 0 && PARSED_STATES.has(record.state)) {
    out.push({
      ...base, code: "QA_CONF_MISSING", domain: "extraction_confidence", severity: "medium",
      summary: "Documents were parsed but no extraction confidence was recorded.",
      evidence: { state: record.state, documents: documentCount },
      action: "Retry extraction so the record carries a scored confidence before review.",
    });
  }

  if (declared !== null && inExtraction !== null && Math.abs(declared - inExtraction) > 0.02) {
    out.push({
      ...base, code: "QA_CONF_MISMATCH", domain: "extraction_confidence", severity: "medium",
      summary: "Stored confidence disagrees with the confidence inside the extraction payload.",
      evidence: { stored: declared, extraction_payload: inExtraction },
      action: "Retry extraction so the stored score matches its own evidence payload.",
    });
  }

  const evidenced = EVIDENCED_FIELDS.filter((f) => extraction[f] !== undefined && extraction[f] !== null);
  if (declared !== null && declared >= CONFIDENCE_BANDS.high && evidenced.length < 3) {
    out.push({
      ...base, code: "QA_CONF_OVERSTATED", domain: "extraction_confidence", severity: "high",
      summary: "High confidence is claimed on very few evidenced fields.",
      evidence: { confidence: declared, evidenced_fields: evidenced },
      action: "Review the source document manually before approving; the score overstates the evidence.",
    });
  }

  if (declared !== null && declared === 0 && evidenced.length >= 3) {
    out.push({
      ...base, code: "QA_CONF_UNDERSTATED", domain: "extraction_confidence", severity: "low",
      summary: "Fields were evidenced but confidence was recorded as zero.",
      evidence: { evidenced_fields: evidenced },
      action: "Retry extraction so the confidence reflects the fields that were found.",
    });
  }

  return out;
}

/* ---------------------------- field evidence QA --------------------------- */

export function auditFieldEvidence(record: MigrationRecordDetail): QaFinding[] {
  const out: QaFinding[] = [];
  const subject = displayName(record);
  const extraction = asRecord(record.extraction);
  const base = { recordId: record.id, subject };

  for (const field of EVIDENCED_FIELDS) {
    const raw = extraction[field];
    if (raw === undefined || raw === null) continue;
    const holder = asRecord(raw);
    const hasValueShape = "value" in holder;

    if (!hasValueShape) {
      out.push({
        ...base, code: "QA_EVID_UNSTRUCTURED", domain: "field_evidence", severity: "medium",
        summary: `Inferred "${field}" was stored without the evidence envelope.`,
        evidence: { field, stored: raw },
        action: "Retry extraction; every inferred field must carry its supporting text.",
      });
      continue;
    }

    if (evidenceLength(holder.evidence) < MIN_EVIDENCE_CHARS) {
      out.push({
        ...base, code: "QA_EVID_MISSING", domain: "field_evidence", severity: "high",
        summary: `Inferred "${field}" has no supporting evidence.`,
        evidence: { field, value: holder.value, evidence: holder.evidence ?? null },
        action: "Verify this field against the source document, or clear it before import.",
      });
      continue;
    }

    if (typeof holder.method !== "string" || !holder.method.trim()) {
      out.push({
        ...base, code: "QA_EVID_NO_METHOD", domain: "field_evidence", severity: "low",
        summary: `Inferred "${field}" does not record how it was derived.`,
        evidence: { field, value: holder.value },
        action: "Retry extraction so the inference method is auditable.",
      });
    }

    // Contact fields must appear verbatim in their own evidence — this is the
    // cheapest possible guard against a value drifting away from its source.
    if ((field === "email" || field === "phone" || field === "linkedin_url")
      && typeof holder.value === "string" && typeof holder.evidence === "string") {
      const value = holder.value.toLowerCase().replace(/[\s()-]/g, "");
      const evidence = holder.evidence.toLowerCase().replace(/[\s()-]/g, "");
      if (value && !evidence.includes(value)) {
        out.push({
          ...base, code: "QA_EVID_NOT_SUPPORTED", domain: "field_evidence", severity: "critical",
          summary: `Inferred "${field}" does not appear in the text cited as its evidence.`,
          evidence: { field, value: holder.value, cited: holder.evidence },
          action: "Do not import this record until the contact detail is confirmed against the source document.",
        });
      }
    }
  }

  const unresolved = Array.isArray(extraction.unresolved) ? extraction.unresolved : [];
  const contradicted = unresolved.filter((f) => typeof f === "string" && extraction[f] != null);
  if (contradicted.length > 0) {
    out.push({
      ...base, code: "QA_EVID_UNRESOLVED_CONTRADICTION", domain: "field_evidence", severity: "medium",
      summary: "Fields are listed as unresolved yet carry extracted values.",
      evidence: { fields: contradicted },
      action: "Retry extraction; the unresolved list and the extracted fields disagree.",
    });
  }

  const normalized = asRecord(record.normalized);
  for (const field of ["email", "phone", "full_name"] as const) {
    const inferred = asRecord(extraction[field]).value;
    const stored = normalized[field];
    if (typeof inferred === "string" && typeof stored === "string" && stored.trim() && inferred.trim()
      && inferred.trim().toLowerCase() !== stored.trim().toLowerCase()) {
      out.push({
        ...base, code: "QA_EVID_NORMALISATION_DRIFT", domain: "field_evidence", severity: "medium",
        summary: `Document-inferred "${field}" differs from the value staged for import.`,
        evidence: { field, inferred, staged: stored },
        action: "Confirm which value is correct before import — the CV and the source row disagree.",
      });
    }
  }

  return out;
}

/* ------------------------- duplicate classification ----------------------- */

export function auditDuplicate(
  duplicate: MigrationDuplicate,
  record?: MigrationRecordDetail,
): QaFinding[] {
  const out: QaFinding[] = [];
  const base = {
    duplicateId: duplicate.id,
    recordId: duplicate.record_id,
    subject: record ? displayName(record) : undefined,
  };
  const similarity = duplicate.similarity == null ? null : Number(duplicate.similarity);
  const band = DUPLICATE_BANDS[duplicate.classification];

  if (similarity === null || !Number.isFinite(similarity)) {
    out.push({
      ...base, code: "QA_DUP_NO_SIMILARITY", domain: "duplicate_classification", severity: "high",
      summary: `A duplicate was classified as "${duplicate.classification}" with no similarity score.`,
      evidence: { classification: duplicate.classification },
      action: "Re-run duplicate detection; classification without a score cannot be reviewed.",
    });
  } else if (band && (similarity < band.min || similarity > band.max)) {
    out.push({
      ...base, code: "QA_DUP_BAND_VIOLATION", domain: "duplicate_classification", severity: "high",
      summary: `Similarity ${similarity.toFixed(1)}% does not support the "${duplicate.classification}" classification.`,
      evidence: { classification: duplicate.classification, similarity, expected: band },
      action: "Re-classify this pair manually; the score and the label disagree.",
    });
  }

  const signals = asRecord(duplicate.signals);
  if (Object.keys(signals).length === 0) {
    out.push({
      ...base, code: "QA_DUP_NO_SIGNALS", domain: "duplicate_classification", severity: "medium",
      summary: "A duplicate was raised without recording which signals matched.",
      evidence: { classification: duplicate.classification, similarity },
      action: "Re-run duplicate detection so the reviewer can see why the pair matched.",
    });
  }

  if (duplicate.classification === "exact" && signals.email !== true && signals.email_match !== true) {
    out.push({
      ...base, code: "QA_DUP_EXACT_WITHOUT_IDENTIFIER", domain: "duplicate_classification", severity: "high",
      summary: "An exact duplicate was declared without a matching unique identifier.",
      evidence: { signals },
      action: "Downgrade to a probable match or confirm the identity manually before merging.",
    });
  }

  if (duplicate.resolution === "pending" && record && ["APPROVED", "IMPORTED"].includes(record.state)) {
    out.push({
      ...base, code: "QA_DUP_APPROVED_WHILE_PENDING", domain: "duplicate_classification", severity: "critical",
      summary: "A record was approved or imported while its duplicate decision was still open.",
      evidence: { state: record.state, classification: duplicate.classification, similarity },
      action: "Resolve the duplicate decision now and verify no candidate was double-created.",
    });
  }

  if (duplicate.resolution !== "pending" && !duplicate.resolved_at) {
    out.push({
      ...base, code: "QA_DUP_RESOLUTION_UNSTAMPED", domain: "duplicate_classification", severity: "medium",
      summary: "A duplicate decision was recorded without a decision timestamp.",
      evidence: { resolution: duplicate.resolution },
      action: "Investigate the audit trail; the decision is not fully attributable.",
    });
  }

  return out;
}

/* -------------------------------- scoring -------------------------------- */

export function auditScoring(record: MigrationRecordDetail): QaFinding[] {
  const out: QaFinding[] = [];
  const subject = displayName(record);
  const base = { recordId: record.id, subject };
  const score = record.match_score == null ? null : Number(record.match_score);
  const breakdown = asRecord(record.match_breakdown);

  if (score !== null && Number.isFinite(score) && (score < 0 || score > 100)) {
    out.push({
      ...base, code: "QA_SCORE_OUT_OF_RANGE", domain: "scoring", severity: "high",
      summary: "Match score falls outside the valid 0-100 range.",
      evidence: { match_score: record.match_score },
      action: "Re-run processing for this record; the score is not interpretable.",
    });
  }

  if (score !== null && Object.keys(breakdown).length === 0) {
    out.push({
      ...base, code: "QA_SCORE_UNEXPLAINED", domain: "scoring", severity: "high",
      summary: "A match score was produced with no explanation of how it was reached.",
      evidence: { match_score: score },
      action: "Re-run processing; an unexplained score cannot support a selection decision.",
    });
  }

  const components = Object.entries(breakdown).filter(([, v]) => typeof v === "number");
  const total = breakdown.total ?? breakdown.score;
  if (typeof total === "number" && score !== null && Math.abs(total - score) > 0.5) {
    out.push({
      ...base, code: "QA_SCORE_TOTAL_MISMATCH", domain: "scoring", severity: "high",
      summary: "The stored score does not match the total inside its own breakdown.",
      evidence: { match_score: score, breakdown_total: total },
      action: "Re-run processing; the score and its explanation were written from different inputs.",
    });
  }

  const negatives = components.filter(([k, v]) => k !== "total" && k !== "score" && (v as number) < 0);
  if (negatives.length > 0) {
    out.push({
      ...base, code: "QA_SCORE_NEGATIVE_COMPONENT", domain: "scoring", severity: "medium",
      summary: "Score breakdown contains negative contributions.",
      evidence: { components: Object.fromEntries(negatives) },
      action: "Review the scoring configuration; contributions should never be negative.",
    });
  }

  if (record.identity_match_kind && record.identity_similarity == null) {
    out.push({
      ...base, code: "QA_IDENTITY_UNSCORED", domain: "scoring", severity: "medium",
      summary: `Identity was matched by "${record.identity_match_kind}" without a similarity score.`,
      evidence: { identity_match_kind: record.identity_match_kind },
      action: "Re-run identity resolution before trusting this match.",
    });
  }

  const identitySimilarity = record.identity_similarity == null ? null : Number(record.identity_similarity);
  if (record.identity_match_kind === "email" && identitySimilarity !== null && identitySimilarity < 99) {
    out.push({
      ...base, code: "QA_IDENTITY_EMAIL_WEAK", domain: "scoring", severity: "high",
      summary: "An email identity match was recorded with less than exact similarity.",
      evidence: { identity_similarity: identitySimilarity },
      action: "Confirm the identity manually; an email match must be exact.",
    });
  }

  if (record.candidate_id && !record.identity_match_kind) {
    out.push({
      ...base, code: "QA_IDENTITY_UNATTRIBUTED", domain: "scoring", severity: "high",
      summary: "The record was linked to an existing candidate without recording how they were matched.",
      evidence: { candidate_id: record.candidate_id },
      action: "Verify the link before import; an unexplained identity link risks merging two people.",
    });
  }

  if (["READY_FOR_REVIEW", "APPROVED"].includes(record.state) && !record.vacancy_id) {
    out.push({
      ...base, code: "QA_VACANCY_UNMAPPED", domain: "scoring", severity: "high",
      summary: "The record is queued for import without a vacancy.",
      evidence: { state: record.state, source_vacancy_ref: record.source_vacancy_ref },
      action: "Map the record to a vacancy, or reconstruct a historical vacancy for it.",
    });
  }

  if (record.vacancy_id && !record.vacancy_map_kind) {
    out.push({
      ...base, code: "QA_VACANCY_UNATTRIBUTED", domain: "scoring", severity: "medium",
      summary: "A vacancy was assigned without recording how the mapping was decided.",
      evidence: { vacancy_id: record.vacancy_id },
      action: "Re-run processing or re-assign the vacancy so the mapping is auditable.",
    });
  }

  return out;
}

/* ------------------------------- provenance ------------------------------- */

export function auditProvenance(record: MigrationRecordDetail): QaFinding[] {
  const out: QaFinding[] = [];
  const base = { recordId: record.id, subject: displayName(record) };

  if (record.state === "APPROVED" && record.exception_code) {
    out.push({
      ...base, code: "QA_STATE_APPROVED_WITH_EXCEPTION", domain: "provenance", severity: "critical",
      summary: "A record carrying an unresolved exception is approved for import.",
      evidence: { exception_code: record.exception_code, exception_reason: record.exception_reason },
      action: "Withdraw the approval, resolve the exception, then approve again.",
    });
  }

  if (record.state === "IMPORTED" && (!record.imported_candidate_id || !record.imported_application_id)) {
    out.push({
      ...base, code: "QA_IMPORT_INCOMPLETE", domain: "provenance", severity: "critical",
      summary: "A record is marked imported but is missing its candidate or application link.",
      evidence: {
        imported_candidate_id: record.imported_candidate_id,
        imported_application_id: record.imported_application_id,
      },
      action: "Run batch verification; this record may have imported only partially.",
    });
  }

  if (record.state === "IMPORTED" && !record.source_status) {
    out.push({
      ...base, code: "QA_PROVENANCE_STATUS_LOST", domain: "provenance", severity: "medium",
      summary: "The original application status was not preserved on import.",
      evidence: { source_platform: record.source_platform },
      action: "Recover the original status from the source export before closing the batch.",
    });
  }

  if (record.review_decision && !record.reviewed_at) {
    out.push({
      ...base, code: "QA_REVIEW_UNSTAMPED", domain: "provenance", severity: "medium",
      summary: "A review decision was recorded without a decision timestamp.",
      evidence: { review_decision: record.review_decision },
      action: "Check the audit trail; this decision is not fully attributable.",
    });
  }

  if (Object.keys(asRecord(record.raw_payload)).length === 0 && record.source_row_no != null) {
    out.push({
      ...base, code: "QA_PROVENANCE_RAW_MISSING", domain: "provenance", severity: "high",
      summary: "The original source row was not retained for this record.",
      evidence: { source_row_no: record.source_row_no },
      action: "Re-stage from the source file; imports must keep their original row.",
    });
  }

  return out;
}

/* --------------------------------- worker --------------------------------- */

export function auditFile(file: MigrationFile, stuckAfterMinutes = 30): QaFinding[] {
  const out: QaFinding[] = [];
  const base = { fileId: file.id, subject: file.original_file_name };

  if (file.status === "failed" && file.attempts >= 3) {
    out.push({
      ...base, code: "QA_WORKER_ATTEMPTS_EXHAUSTED", domain: "worker", severity: "high",
      summary: "A document failed extraction repeatedly and is no longer being retried.",
      evidence: { attempts: file.attempts, error: file.parse_error },
      action: "Inspect the document manually, or capture its fields by hand and mark the record reviewed.",
    });
  }

  if (file.status === "failed" && !file.parse_error) {
    out.push({
      ...base, code: "QA_WORKER_FAILURE_UNEXPLAINED", domain: "worker", severity: "medium",
      summary: "A document is marked failed without a recorded reason.",
      evidence: { attempts: file.attempts },
      action: "Retry the document so a diagnosable error is captured.",
    });
  }

  if (file.status === "parsing") {
    const ageMinutes = (Date.now() - new Date(file.created_at).getTime()) / 60000;
    if (ageMinutes > stuckAfterMinutes) {
      out.push({
        ...base, code: "QA_WORKER_STUCK", domain: "worker", severity: "high",
        summary: "A document has been in extraction far longer than expected.",
        evidence: { minutes_in_progress: Math.round(ageMinutes), attempts: file.attempts },
        action: "Requeue the document — the worker run that claimed it did not finish.",
      });
    }
  }

  if (file.status === "parsed" && (file.page_count ?? 0) === 0 && file.doc_type === "cv") {
    out.push({
      ...base, code: "QA_WORKER_EMPTY_PARSE", domain: "worker", severity: "medium",
      summary: "A CV parsed successfully but yielded no pages of text.",
      evidence: { page_count: file.page_count },
      action: "The document is probably a scan — process it manually or run it through OCR.",
    });
  }

  return out;
}

/* ------------------------------- aggregation ------------------------------ */

export interface QaInput {
  records: MigrationRecordDetail[];
  duplicates?: MigrationDuplicate[];
  files?: MigrationFile[];
  /** record id -> attached document count, used for confidence expectations. */
  documentCounts?: Record<string, number>;
}

export function runQaSuite(input: QaInput): QaReport {
  const { records, duplicates = [], files = [], documentCounts = {} } = input;
  const byId = new Map(records.map((r) => [r.id, r]));
  const findings: QaFinding[] = [];

  for (const record of records) {
    findings.push(
      ...auditExtraction(record, documentCounts[record.id] ?? 0),
      ...auditFieldEvidence(record),
      ...auditScoring(record),
      ...auditProvenance(record),
    );
  }
  for (const duplicate of duplicates) {
    findings.push(...auditDuplicate(duplicate, byId.get(duplicate.record_id)));
  }
  for (const file of files) {
    findings.push(...auditFile(file));
  }

  const countsBySeverity: Record<QaSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const countsByDomain: Record<QaDomain, number> = {
    extraction_confidence: 0, field_evidence: 0, duplicate_classification: 0,
    scoring: 0, provenance: 0, worker: 0,
  };
  let penalty = 0;
  for (const f of findings) {
    countsBySeverity[f.severity] += 1;
    countsByDomain[f.domain] += 1;
    penalty += SEVERITY_WEIGHT[f.severity];
  }

  const population = Math.max(records.length + duplicates.length + files.length, 1);
  const integrityScore = Math.max(0, Math.round(100 - (penalty / population) * 10));

  const order: QaSeverity[] = ["critical", "high", "medium", "low"];
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)
    || a.code.localeCompare(b.code));

  return {
    generatedAt: new Date().toISOString(),
    scanned: { records: records.length, duplicates: duplicates.length, files: files.length },
    findings,
    countsBySeverity,
    countsByDomain,
    integrityScore,
    blocking: countsBySeverity.critical > 0,
  };
}

/* -------------------------------- reporting ------------------------------- */

const CSV_HEADERS = [
  "severity", "domain", "code", "subject", "summary", "action", "record_id", "file_id", "duplicate_id", "evidence",
] as const;

function csvCell(value: unknown): string {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** Actionable discrepancy report a recruiter or auditor can work through offline. */
export function toDiscrepancyCsv(report: QaReport): string {
  const rows = report.findings.map((f) => [
    f.severity, f.domain, f.code, f.subject ?? "", f.summary, f.action,
    f.recordId ?? "", f.fileId ?? "", f.duplicateId ?? "", f.evidence,
  ].map(csvCell).join(","));
  return [CSV_HEADERS.join(","), ...rows].join("\n");
}

export const QA_DOMAIN_LABELS: Record<QaDomain, string> = {
  extraction_confidence: "Extraction confidence",
  field_evidence: "Field evidence",
  duplicate_classification: "Duplicate classification",
  scoring: "Scoring and matching",
  provenance: "Provenance and state",
  worker: "Document worker",
};

export const QA_SEVERITY_LABELS: Record<QaSeverity, string> = {
  critical: "Blocks import",
  high: "Must fix before import",
  medium: "Should fix",
  low: "Advisory",
};
