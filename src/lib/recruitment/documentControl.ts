/**
 * Recruitment 360 — candidate document control.
 *
 * The requirement engine lives in the database (`rec_document_requirements`,
 * `rec_document_evaluate`) so the same rules gate the public application form
 * and the staff screening surface. Nothing here decides what is mandatory: this
 * module only shapes what the server returns.
 *
 * Two states are deliberately kept apart:
 *   upload_status        — did the file actually persist?
 *   verification_status  — has an authorised reviewer accepted it?
 * A candidate can satisfy submission completeness with `uploaded`; only a
 * reviewer can produce `verified`.
 */
import { supabase } from "@/integrations/supabase/client";
import { APPLICATION_BUCKET } from "./publicApi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type EducationStatus =
  | "currently_studying"
  | "awaiting_graduation"
  | "graduated"
  | "other";

export const EDUCATION_STATUS_OPTIONS: Array<{ value: EducationStatus; label: string }> = [
  { value: "currently_studying", label: "Currently studying" },
  { value: "awaiting_graduation", label: "Completed studies but awaiting graduation" },
  { value: "graduated", label: "Graduated" },
  { value: "other", label: "Other" },
];

export type VerificationStatus =
  | "uploaded" | "pending_review" | "under_review" | "verified"
  | "rejected" | "replacement_required" | "waived" | "superseded";

export type RequirementState = "uploaded" | "missing" | "not_provided";

export interface RequirementItem {
  requirement_key: string;
  rule_id: string | null;
  doc_key: string;
  label: string;
  doc_class: "universal" | "education" | "graduation" | "role_specific" | "optional";
  doc_type: "cv" | "cover_letter" | "certificate" | "supporting";
  mandatory: boolean;
  academic_year: number | null;
  consolidated: boolean;
  requires_verification: boolean;
  why_required: string | null;
  state: RequirementState;
  file_name: string | null;
  /** Vacancy requirement definition (see mandatoryRequirements.ts). */
  requirement_text?: string | null;
  hard_requirement?: boolean;
  evidence_kind?: "document" | "declaration" | "document_or_declaration" | null;
  accepted_evidence_types?: string[] | null;
  declaration_prompt?: string | null;
  response_required?: boolean;
  document_id?: string | null;
  verification_status?: string | null;
}


export interface DocumentChecklist {
  open?: boolean;
  complete: boolean;
  mandatory_total: number;
  mandatory_satisfied: number;
  completion_percent: number;
  missing: string[];
  items: RequirementItem[];
}

export interface CandidateDocumentRow {
  id: string;
  doc_key: string;
  doc_type: string;
  academic_year: number | null;
  consolidated: boolean;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  upload_status: "uploading" | "complete" | "failed";
  verification_status: VerificationStatus;
  verified_at: string | null;
  verified_by: string | null;
  review_reason: string | null;
  version_no: number;
  superseded_at: string | null;
  replaces_document_id: string | null;
  file_hash: string | null;
  uploaded_at: string;
}

export type DocumentState =
  | "INCOMPLETE" | "REQUIRES_ACTION" | "COMPLETE_PENDING_VERIFICATION" | "VERIFIED";

export interface ApplicationDocumentStatus extends DocumentChecklist {
  application_id: string;
  education_status: string | null;
  qualification_level: string | null;
  completed_years: number | null;
  consolidated_transcript: boolean;
  documents: CandidateDocumentRow[];
  verified_count: number;
  pending_verification: number;
  rejected_count: number;
  document_state: DocumentState;
}

export interface DocumentEventRow {
  id: string;
  document_id: string | null;
  action: string;
  actor_id: string | null;
  previous_status: string | null;
  new_status: string | null;
  reason: string | null;
  doc_key: string | null;
  academic_year: number | null;
  created_at: string;
}

export interface DocumentContext {
  education_status?: string | null;
  qualification_level?: string | null;
  completed_years?: number | null;
  consolidated_transcript?: boolean;
  documents: Array<{
    doc_key: string;
    academic_year?: number | null;
    consolidated?: boolean;
    storage_path?: string | null;
    size_bytes?: number | null;
    upload_status?: string;
    file_name?: string | null;
  }>;
}

/** Server-resolved checklist for the public application form. */
export async function publicDocumentCheck(
  slug: string,
  context: DocumentContext,
): Promise<DocumentChecklist> {
  const { data, error } = await db.rpc("rec_public_document_check", {
    p_slug: slug,
    p_payload: context,
  });
  if (error) throw new Error(error.message);
  return normaliseChecklist(data);
}

/** Canonical application stages, in progression order. */
export const APPLICATION_STAGES = [
  "education", "profession", "questions", "documents", "review", "submission",
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export interface StageGateVerdict {
  /** False when the stage may not be entered. */
  allowed: boolean;
  stage: string;
  code: string | null;
  outstanding: string[];
  /** True when the server could not be reached — the caller keeps its own mirror. */
  available: boolean;
}

/**
 * Authoritative stage gate. The server re-evaluates the structured academic
 * record and the PERSISTED documentary evidence against the vacancy's education
 * policy, so a candidate cannot reach a downstream stage by editing the page.
 * Every call is recorded in `rec_education_gate_events`.
 */
export async function publicStageGate(
  slug: string,
  stage: ApplicationStage | string,
  payload: Record<string, unknown>,
): Promise<StageGateVerdict> {
  const { data, error } = await db.rpc("rec_public_stage_gate", {
    p_slug: slug,
    p_stage: stage,
    p_payload: payload,
  });
  if (error) {
    return { allowed: false, stage: String(stage), code: null, outstanding: [], available: false };
  }
  const v = (data ?? {}) as { allowed?: boolean; stage?: string; code?: string | null; outstanding?: unknown };
  return {
    allowed: v.allowed === true,
    stage: v.stage ?? String(stage),
    code: v.code ?? null,
    outstanding: Array.isArray(v.outstanding) ? v.outstanding.map((o) => String(o)) : [],
    available: true,
  };
}



function normaliseChecklist(raw: unknown): DocumentChecklist {
  const value = (raw ?? {}) as Partial<DocumentChecklist>;
  return {
    open: value.open,
    complete: value.complete === true,
    mandatory_total: value.mandatory_total ?? 0,
    mandatory_satisfied: value.mandatory_satisfied ?? 0,
    completion_percent: Number(value.completion_percent ?? 0),
    // One requirement, one line: the server merges blueprint requirements with
    // rule-set requirements, which can name the same document twice.
    missing: Array.from(new Set((value.missing ?? []).map((m) => String(m).trim()).filter(Boolean))),
    items: value.items ?? [],
  };
}

/** Staff read: persisted documents plus the requirement checklist. */
export async function applicationDocumentStatus(
  applicationId: string,
): Promise<ApplicationDocumentStatus> {
  const { data, error } = await db.rpc("rec_application_document_status", {
    p_application_id: applicationId,
  });
  if (error) throw new Error(error.message);
  return data as ApplicationDocumentStatus;
}

/** Screening gate — never advance a candidate on incomplete documentation. */
export async function screeningDocumentGate(applicationId: string): Promise<{
  application_id: string;
  document_state: DocumentState;
  allowed: boolean;
  completion_percent: number;
  outstanding: string[];
}> {
  const { data, error } = await db.rpc("rec_screening_document_gate", {
    p_application_id: applicationId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export type ReviewAction = "verify" | "reject" | "request_replacement" | "under_review" | "waive";

export const REJECTION_REASONS = [
  "Illegible",
  "Wrong document",
  "Missing page",
  "Incorrect academic year",
  "Document does not correspond to candidate",
  "Unacceptable format",
  "Suspected alteration",
  "Qualification mismatch",
  "Other",
];

/** Reviewer disposition. The server enforces reason and waiver authority. */
export async function reviewDocument(
  documentId: string,
  action: ReviewAction,
  reason?: string | null,
): Promise<{ document_id: string; previous_status: string; verification_status: string }> {
  const { data, error } = await db.rpc("rec_document_review", {
    p_document_id: documentId,
    p_action: action,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function logDocumentAccess(
  documentId: string,
  action: "DOCUMENT_VIEWED" | "DOCUMENT_DOWNLOADED",
): Promise<void> {
  const { error } = await db.rpc("rec_document_access_log", {
    p_document_id: documentId,
    p_action: action,
  });
  if (error) throw new Error(error.message);
}

/**
 * Signed, short-lived access to a private candidate document. The bucket is
 * never public and the storage policy only admits recruitment staff, so an
 * unauthorised session cannot mint a link even by guessing the path.
 */
export async function signedDocumentUrl(
  storagePath: string,
  documentId: string,
  purpose: "view" | "download",
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(APPLICATION_BUCKET)
    .createSignedUrl(storagePath, 300, purpose === "download" ? { download: true } : undefined);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Document is not accessible.");
  await logDocumentAccess(documentId, purpose === "download" ? "DOCUMENT_DOWNLOADED" : "DOCUMENT_VIEWED");
  return data.signedUrl;
}

export async function documentEvents(applicationId: string): Promise<DocumentEventRow[]> {
  const { data, error } = await db
    .from("rec_document_events")
    .select("id, document_id, action, actor_id, previous_status, new_status, reason, doc_key, academic_year, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentEventRow[];
}

/* ------------------------------------------------------------------ *
 * Presentation helpers — uploaded is NEVER shown as verified.
 * ------------------------------------------------------------------ */

export function verificationLabel(status: VerificationStatus): string {
  switch (status) {
    case "uploaded": return "Submitted for verification";
    case "pending_review": return "Pending review";
    case "under_review": return "Under review";
    case "verified": return "Verified";
    case "rejected": return "Rejected";
    case "replacement_required": return "Replacement required";
    case "waived": return "Waived";
    case "superseded": return "Superseded";
    default: return status;
  }
}

export function verificationTone(
  status: VerificationStatus,
): "success" | "warning" | "destructive" | "neutral" {
  if (status === "verified") return "success";
  if (status === "rejected" || status === "replacement_required") return "destructive";
  if (status === "waived" || status === "superseded") return "neutral";
  return "warning";
}

export function documentStateLabel(state: DocumentState): string {
  switch (state) {
    case "INCOMPLETE": return "Incomplete";
    case "REQUIRES_ACTION": return "Requires candidate action";
    case "COMPLETE_PENDING_VERIFICATION": return "Complete — pending verification";
    case "VERIFIED": return "Fully verified";
    default: return state;
  }
}

/** Documents still on the current version, newest first. */
export function activeDocuments(rows: CandidateDocumentRow[]): CandidateDocumentRow[] {
  return rows.filter((r) => !r.superseded_at);
}

/** All versions filed against one requirement, oldest first. */
export function versionHistory(
  rows: CandidateDocumentRow[],
  docKey: string,
  academicYear: number | null,
): CandidateDocumentRow[] {
  return rows
    .filter((r) => r.doc_key === docKey && (r.academic_year ?? null) === (academicYear ?? null))
    .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at));
}

/** Requirement → the document currently filed against it, if any. */
export function documentForRequirement(
  rows: CandidateDocumentRow[],
  item: RequirementItem,
): CandidateDocumentRow | null {
  const matches = activeDocuments(rows).filter(
    (r) => r.doc_key === item.doc_key && (r.academic_year ?? null) === (item.academic_year ?? null),
  );
  return matches.sort((a, b) => b.version_no - a.version_no)[0] ?? null;
}

/**
 * Staff-side replacement of a rejected document. The previous version is
 * retained and superseded server-side; the new version re-enters review as
 * `uploaded` — never as verified.
 */
export async function replaceDocument(
  documentId: string,
  applicationId: string,
  file: File,
  reason?: string,
): Promise<{ document_id: string; version_no: number }> {
  if (file.size <= 0) throw new Error(`${file.name}: the file appears to be empty.`);
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-120);
  const path = `replacements/${applicationId}/${crypto.randomUUID()}-${safe}`;
  const { error: uploadError } = await supabase.storage
    .from(APPLICATION_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (uploadError) throw new Error(`${file.name} could not be uploaded: ${uploadError.message}`);

  const { data, error } = await db.rpc("rec_document_replace", {
    p_document_id: documentId,
    p_storage_path: path,
    p_file_name: file.name,
    p_size_bytes: file.size,
    p_mime_type: file.type || null,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}
