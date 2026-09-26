/**
 * Recruitment 360 — Candidate Migration & Intelligent CV Import client layer.
 *
 * This module is deliberately thin. Every decision that matters — identity
 * resolution, duplicate classification, vacancy mapping, match scoring,
 * transactional commit and rollback — lives in Postgres, so the browser cannot
 * be the source of truth for a historical hiring record. What lives here:
 *
 *   - file ingestion (hash, upload, register) so uploads are idempotent by
 *     content hash rather than by file name,
 *   - structured-source parsing (CSV / XLSX) and archive expansion (ZIP),
 *   - column mapping heuristics that a recruiter can override,
 *   - typed wrappers over the `rec_migration_*` engine RPCs.
 */
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { unzipSync } from "fflate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const MIGRATION_BUCKET = "recruitment-migration";
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/* ------------------------------- types ---------------------------------- */

export type MigrationBatchStatus =
  | "draft" | "ingesting" | "processing" | "review"
  | "importing" | "imported" | "failed" | "rolled_back";

export interface MigrationBatch {
  id: string;
  batch_no: string;
  name: string;
  source_kind: string;
  source_platform: string | null;
  source_organization: string | null;
  original_campaign: string | null;
  import_date: string | null;
  owner_staff_id: string | null;
  notes: string | null;
  status: MigrationBatchStatus;
  mapping: Record<string, string>;
  totals: Record<string, number> | null;
  quality: Record<string, unknown> | null;
  rollback_available: boolean;
  rolled_back_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MigrationFile {
  id: string;
  batch_id: string;
  original_file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string;
  file_kind: "structured" | "document" | "archive" | "unknown";
  doc_type: string;
  status: "stored" | "queued" | "parsing" | "parsed" | "failed" | "skipped";
  parse_error: string | null;
  page_count: number | null;
  attempts: number;
  created_at: string;
}

export type MigrationQueue =
  | "all" | "ready" | "needs_review" | "duplicates"
  | "unmatched_vacancy" | "low_confidence" | "parsing_failed"
  | "approved" | "rejected" | "imported" | "failed";

export interface MigrationQueueRow {
  id: string;
  source_row_no: number | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  state: string;
  exception_code: string | null;
  exception_reason: string | null;
  identity_match_kind: string | null;
  identity_similarity: number | null;
  vacancy_id: string | null;
  vacancy_title: string | null;
  vacancy_map_kind: string | null;
  match_score: number | null;
  extraction_confidence: number | null;
  source_status: string | null;
  source_applied_at: string | null;
  review_decision: string | null;
  document_count: number;
  duplicate_count: number;
}

export interface MigrationRecordDetail {
  id: string;
  batch_id: string;
  source_row_key: string;
  source_row_no: number | null;
  source_platform: string | null;
  source_candidate_ref: string | null;
  source_application_ref: string | null;
  source_vacancy_ref: string | null;
  source_status: string | null;
  source_applied_at: string | null;
  raw_payload: Record<string, unknown>;
  normalized: Record<string, unknown>;
  extraction: Record<string, unknown>;
  extraction_confidence: number | null;
  state: string;
  exception_code: string | null;
  exception_reason: string | null;
  candidate_id: string | null;
  identity_match_kind: string | null;
  identity_similarity: number | null;
  vacancy_id: string | null;
  vacancy_map_kind: string | null;
  match_score: number | null;
  match_breakdown: Record<string, unknown> | null;
  review_decision: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  imported_candidate_id: string | null;
  imported_application_id: string | null;
  imported_at: string | null;
  import_outcome: string | null;
}

export interface MigrationDuplicate {
  id: string;
  batch_id: string;
  record_id: string;
  candidate_id: string;
  classification: "exact" | "probable" | "possible";
  similarity: number | null;
  signals: Record<string, unknown>;
  resolution: string;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface MigrationEvent {
  id: string;
  batch_id: string;
  record_id: string | null;
  action: string;
  actor_id: string | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

export interface MigrationPreview {
  records: number;
  by_state: Record<string, number>;
  new_candidates: number;
  existing_candidates: number;
  possible_duplicates: number;
  exceptions: number;
  approved: number;
  applications_by_vacancy: Record<string, number>;
  documents: Record<string, number>;
}

export interface MigrationVerification {
  candidates_created: number;
  applications_created: number;
  documents_attached: number;
  vacancies_linked: number;
  duplicates_resolved: number;
  duplicates_pending: number;
  records_imported: number;
  records_failed: number;
  provenance_complete: boolean;
  orphan_applications: number;
  rollback_available: boolean;
}

/* ---------------------------- source parsing ----------------------------- */

export interface ParsedSheet {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}

export type ParsedFileKind = "structured" | "document" | "archive" | "unknown";

export function classifyUpload(file: { name: string; type?: string }): ParsedFileKind {
  const n = file.name.toLowerCase();
  if (n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".tsv")) return "structured";
  if (n.endsWith(".zip")) return "archive";
  if (n.endsWith(".pdf") || n.endsWith(".docx") || n.endsWith(".doc") || n.endsWith(".txt") || n.endsWith(".rtf")) return "document";
  return "unknown";
}

/** Parses CSV / TSV / XLSX into header + string rows. Values are never coerced. */
export function parseStructured(fileName: string, data: ArrayBuffer): ParsedSheet {
  const wb = XLSX.read(data, { type: "array", raw: false, cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { fileName, headers: [], rows: [] };
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  const rows = json.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[String(k).trim()] = v == null ? "" : String(v).trim();
    return out;
  });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { fileName, headers, rows };
}

export interface ArchiveEntry {
  name: string;
  bytes: Uint8Array;
  kind: ParsedFileKind;
}

/** Expands a ZIP into its usable entries. Directory and macOS metadata skipped. */
export function expandArchive(data: ArrayBuffer): ArchiveEntry[] {
  const zip = unzipSync(new Uint8Array(data));
  const out: ArchiveEntry[] = [];
  for (const [path, bytes] of Object.entries(zip)) {
    if (path.endsWith("/") || bytes.length === 0) continue;
    const base = path.split("/").pop() ?? path;
    if (base.startsWith(".") || path.startsWith("__MACOSX")) continue;
    out.push({ name: base, bytes, kind: classifyUpload({ name: base }) });
  }
  return out;
}

/* --------------------------- column mapping ------------------------------ */

/** Canonical target fields a recruiter can map source columns onto. */
export const MAPPING_TARGETS = [
  { key: "full_name", label: "Full name", required: true },
  { key: "email", label: "Email address" },
  { key: "phone", label: "Phone number" },
  { key: "location", label: "Location" },
  { key: "current_title", label: "Current job title" },
  { key: "current_employer", label: "Current employer" },
  { key: "years_experience", label: "Years of experience" },
  { key: "skills", label: "Skills (comma separated)" },
  { key: "qualifications", label: "Qualifications (comma separated)" },
  { key: "cover_letter", label: "Cover letter / notes" },
  { key: "source_vacancy_ref", label: "Vacancy / role applied for" },
  { key: "source_status", label: "Original application status" },
  { key: "source_applied_at", label: "Original application date" },
  { key: "source_candidate_ref", label: "Source candidate reference" },
  { key: "source_application_ref", label: "Source application reference" },
  { key: "document_ref", label: "CV file name or hash" },
] as const;

export type MappingTargetKey = (typeof MAPPING_TARGETS)[number]["key"];
export type ColumnMapping = Partial<Record<MappingTargetKey, string>>;

const HEURISTICS: Record<MappingTargetKey, RegExp[]> = {
  full_name: [/^(full[_\s-]?name|name|candidate([_\s-]?name)?|applicant([_\s-]?name)?)$/i, /name/i],
  email: [/e-?mail/i],
  phone: [/(phone|mobile|tel|msisdn|contact\s*number)/i],
  location: [/(location|city|town|county|residence|address)/i],
  current_title: [/(current\s*(job)?\s*title|job\s*title|position|designation|role)/i],
  current_employer: [/(employer|company|organisation|organization|current\s*company)/i],
  years_experience: [/(years?\s*(of)?\s*experience|experience\s*years?|yoe)/i],
  skills: [/skills?/i],
  qualifications: [/(qualification|education|degree|academic)/i],
  cover_letter: [/(cover\s*letter|motivation|notes|comments|summary)/i],
  source_vacancy_ref: [/(vacancy|position\s*applied|role\s*applied|job\s*(ref|title|applied)|requisition)/i],
  source_status: [/(status|stage|outcome|disposition)/i],
  source_applied_at: [/(applied|application\s*date|date\s*applied|submitted|created)/i],
  source_candidate_ref: [/(candidate\s*(id|ref|no)|applicant\s*(id|ref))/i],
  source_application_ref: [/(application\s*(id|ref|no))/i],
  document_ref: [/(cv|resume|résumé|attachment|document|file)/i],
};

/** Suggests a mapping from source headers. Recruiter confirmation is required. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  for (const target of MAPPING_TARGETS) {
    const patterns = HEURISTICS[target.key];
    for (const pattern of patterns) {
      const hit = headers.find((h) => !taken.has(h) && pattern.test(h.trim()));
      if (hit) {
        mapping[target.key] = hit;
        taken.add(hit);
        break;
      }
    }
  }
  return mapping;
}

const splitList = (v: string | undefined) =>
  (v ?? "")
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);

const toIsoDate = (v: string | undefined): string | null => {
  if (!v) return null;
  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  // dd/mm/yyyy is the dominant Kenyan format; ISO parsing gets it wrong.
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const iso = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  }
  return null;
};

export interface StagePayloadRow {
  source_row_key?: string;
  source_row_no?: number;
  source_platform?: string;
  source_candidate_ref?: string;
  source_application_ref?: string;
  source_vacancy_ref?: string;
  source_status?: string;
  source_applied_at?: string | null;
  raw: Record<string, string>;
  normalized: Record<string, unknown>;
  file_refs: string[];
}

/**
 * Projects source rows through the mapping into the engine's staging contract.
 * The raw row is always carried through untouched — the original evidence must
 * survive the import, even where mapping is imperfect.
 */
export function buildStagePayload(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  sourcePlatform?: string,
): StagePayloadRow[] {
  const pick = (row: Record<string, string>, key: MappingTargetKey) => {
    const col = mapping[key];
    return col ? (row[col] ?? "").trim() : "";
  };
  return rows.map((row, index) => {
    const years = pick(row, "years_experience").replace(/[^\d.]/g, "");
    const docRef = pick(row, "document_ref");
    return {
      source_row_no: index + 1,
      source_platform: sourcePlatform || undefined,
      source_candidate_ref: pick(row, "source_candidate_ref") || undefined,
      source_application_ref: pick(row, "source_application_ref") || undefined,
      source_vacancy_ref: pick(row, "source_vacancy_ref") || undefined,
      source_status: pick(row, "source_status") || undefined,
      source_applied_at: toIsoDate(pick(row, "source_applied_at")),
      raw: row,
      normalized: {
        full_name: pick(row, "full_name") || null,
        email: pick(row, "email") || null,
        phone: pick(row, "phone") || null,
        location: pick(row, "location") || null,
        current_title: pick(row, "current_title") || null,
        current_employer: pick(row, "current_employer") || null,
        years_experience: years ? Number(years) : null,
        cover_letter: pick(row, "cover_letter") || null,
        skills: splitList(pick(row, "skills")),
        qualifications: splitList(pick(row, "qualifications")),
      },
      file_refs: docRef ? [docRef] : [],
    };
  });
}

/* ------------------------------ ingestion -------------------------------- */

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Uint8Array
    ? data.slice().buffer as ArrayBuffer
    : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface UploadResult {
  fileId: string;
  duplicate: boolean;
  sha256: string;
  storagePath: string;
}

/**
 * Uploads one file and registers it against the batch. Content-hash addressing
 * means re-running a partially failed ingest is safe: the same bytes resolve to
 * the same storage object and the same registered file row.
 */
export async function uploadAndRegisterFile(
  batchId: string,
  name: string,
  bytes: Uint8Array | ArrayBuffer,
  opts?: { mime?: string; fileKind?: ParsedFileKind; docType?: string },
): Promise<UploadResult> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`${name} exceeds the 15MB import limit`);
  }
  const hash = await sha256Hex(data);
  const safeName = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
  const storagePath = `${batchId}/${hash}-${safeName}`;
  const mime = opts?.mime || "application/octet-stream";

  const up = await supabase.storage
    .from(MIGRATION_BUCKET)
    .upload(storagePath, new Blob([data as BlobPart], { type: mime }), {
      contentType: mime,
      upsert: true,
    });
  if (up.error) throw new Error(`Upload failed for ${name}: ${up.error.message}`);

  const { data: result, error } = await db.rpc("rec_migration_register_file", {
    p_batch_id: batchId,
    p_original_file_name: name,
    p_storage_path: storagePath,
    p_mime: mime,
    p_size: data.byteLength,
    p_sha256: hash,
    p_file_kind: opts?.fileKind ?? classifyUpload({ name }),
    p_doc_type: opts?.docType ?? "cv",
  });
  if (error) throw new Error(error.message);
  return {
    fileId: result.file_id as string,
    duplicate: Boolean(result.duplicate),
    sha256: hash,
    storagePath,
  };
}

/* ------------------------------ engine RPCs ------------------------------ */

export interface CreateBatchInput {
  name: string;
  source_kind: "csv" | "xlsx" | "documents" | "archive" | "mixed" | "unknown";
  source_platform?: string;
  source_organization?: string;
  original_campaign?: string;
  import_date?: string;
  notes?: string;
}

export async function createBatch(input: CreateBatchInput): Promise<MigrationBatch> {
  const { data, error } = await db.rpc("rec_migration_create_batch", { p_payload: input });
  if (error) throw new Error(error.message);
  return data as MigrationBatch;
}

export async function listBatches(): Promise<MigrationBatch[]> {
  const { data, error } = await db
    .from("rec_migration_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as MigrationBatch[];
}

export async function getBatch(batchId: string): Promise<MigrationBatch | null> {
  const { data, error } = await db.from("rec_migration_batches").select("*").eq("id", batchId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MigrationBatch) ?? null;
}

export async function listBatchFiles(batchId: string): Promise<MigrationFile[]> {
  const { data, error } = await db
    .from("rec_migration_files")
    .select("*")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MigrationFile[];
}

export async function stageRecords(
  batchId: string,
  rows: StagePayloadRow[],
  mapping: ColumnMapping = {},
): Promise<{ inserted: number; already_present: number; documents_linked: number }> {
  const { data, error } = await db.rpc("rec_migration_stage_records", {
    p_batch_id: batchId,
    p_rows: rows,
    p_mapping: mapping,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Runs the document extraction worker over a slice of queued files. */
export async function runDocumentWorker(
  batchId: string,
  limit = 10,
): Promise<{ claimed: number; parsed: number; failed: number; remaining: number | null }> {
  const { data, error } = await supabase.functions.invoke("rec-migration-worker", {
    body: { op: "run", batch_id: batchId, limit },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error ?? "worker_failed");
  return data;
}

export async function processBatch(
  batchId: string,
  limit = 200,
): Promise<Record<string, number>> {
  const { data, error } = await db.rpc("rec_migration_process", { p_batch_id: batchId, p_limit: limit });
  if (error) throw new Error(error.message);
  return data;
}

export async function loadQueue(
  batchId: string,
  queue: MigrationQueue = "all",
  search?: string,
  limit = 100,
  offset = 0,
): Promise<MigrationQueueRow[]> {
  const { data, error } = await db.rpc("rec_migration_queue", {
    p_batch_id: batchId,
    p_queue: queue,
    p_search: search?.trim() || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as MigrationQueueRow[];
}

export async function getRecord(recordId: string): Promise<MigrationRecordDetail | null> {
  const { data, error } = await db
    .from("rec_migration_records")
    .select("*")
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MigrationRecordDetail) ?? null;
}

export async function listRecordDocuments(recordId: string): Promise<MigrationFile[]> {
  const { data, error } = await db
    .from("rec_migration_record_files")
    .select("file_id, doc_type, match_method, match_confidence, rec_migration_files(*)")
    .eq("record_id", recordId);
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => r.rec_migration_files).filter(Boolean) as MigrationFile[];
}

export type ReviewAction =
  | "approve" | "approve_after_review" | "reject"
  | "assign_vacancy" | "retry" | "mark_reviewed";

export async function reviewRecords(
  recordIds: string[],
  action: ReviewAction,
  opts?: { reason?: string; vacancyId?: string },
): Promise<{ action: string; affected: number }> {
  const { data, error } = await db.rpc("rec_migration_review", {
    p_record_ids: recordIds,
    p_action: action,
    p_reason: opts?.reason ?? null,
    p_value: opts?.vacancyId ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function listDuplicates(batchId: string, pendingOnly = true): Promise<MigrationDuplicate[]> {
  let query = db
    .from("rec_migration_duplicates")
    .select("*")
    .eq("batch_id", batchId)
    .order("similarity", { ascending: false });
  if (pendingOnly) query = query.eq("resolution", "pending");
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as MigrationDuplicate[];
}

export async function resolveDuplicate(
  duplicateId: string,
  action: "merge" | "keep_separate",
  notes?: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("rec_migration_resolve_duplicate", {
    p_duplicate_id: duplicateId,
    p_action: action,
    p_notes: notes ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function createHistoricalVacancy(
  batchId: string,
  title: string,
  opts?: { sourceRef?: string; location?: string; openedAt?: string },
): Promise<string> {
  const { data, error } = await db.rpc("rec_migration_create_historical_vacancy", {
    p_batch_id: batchId,
    p_title: title,
    p_source_ref: opts?.sourceRef ?? null,
    p_location: opts?.location ?? null,
    p_opened_at: opts?.openedAt ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function previewBatch(batchId: string): Promise<MigrationPreview> {
  const { data, error } = await db.rpc("rec_migration_preview", { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  return data as MigrationPreview;
}

export async function commitBatch(
  batchId: string,
  limit = 200,
): Promise<Record<string, number | string>> {
  const { data, error } = await db.rpc("rec_migration_commit", { p_batch_id: batchId, p_limit: limit });
  if (error) throw new Error(error.message);
  return data;
}

export async function verifyBatch(batchId: string): Promise<MigrationVerification> {
  const { data, error } = await db.rpc("rec_migration_verify", { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  return data as MigrationVerification;
}

export async function batchReport(batchId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("rec_migration_report", { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function rollbackBatch(batchId: string, reason: string): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("rec_migration_rollback", {
    p_batch_id: batchId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function listBatchEvents(batchId: string, limit = 200): Promise<MigrationEvent[]> {
  const { data, error } = await db
    .from("rec_migration_events")
    .select("*")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as MigrationEvent[];
}

export async function saveMapping(
  name: string,
  sourceKind: string,
  sourcePlatform: string,
  mapping: ColumnMapping,
): Promise<void> {
  const { error } = await db.rpc("rec_migration_save_mapping", {
    p_name: name,
    p_source_kind: sourceKind,
    p_source_platform: sourcePlatform,
    p_mapping: mapping,
  });
  if (error) throw new Error(error.message);
}

export async function listSavedMappings(): Promise<
  { id: string; name: string; source_kind: string; source_platform: string | null; mapping: ColumnMapping }[]
> {
  const { data, error } = await db
    .from("rec_migration_mappings")
    .select("id, name, source_kind, source_platform, mapping")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Signed URL for a stored source document — used by the evidence viewer. */
export async function documentUrl(storagePath: string, expiresIn = 300): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(MIGRATION_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/* --------------------------- worker monitoring --------------------------- */

export interface WorkerBatchStatus {
  batch_id: string;
  batch_no: string;
  name: string;
  status: MigrationBatchStatus;
  created_at: string;
  documents: number;
  queued: number;
  parsing: number;
  parsed: number;
  failed: number;
  stored: number;
  exhausted: number;
  max_attempts: number;
  avg_attempts: number;
  oldest_pending_at: string | null;
  last_error: { file_id: string; file_name: string; error: string | null; attempts: number } | null;
  records_pending: number;
  records_exception: number;
}

export interface WorkerStatus {
  batches: WorkerBatchStatus[];
  totals: {
    queued?: number; parsing?: number; failed?: number; parsed?: number;
    exhausted?: number; stuck_parsing?: number; oldest_pending_at?: string | null;
  };
  generated_at: string;
}

/** Per-batch and platform-wide document worker health. */
export async function workerStatus(batchId?: string, limit = 25): Promise<WorkerStatus> {
  const { data, error } = await db.rpc("rec_migration_worker_status", {
    p_batch_id: batchId ?? null,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return data as WorkerStatus;
}

/** Puts failed or stuck documents back on the extraction queue. */
export async function requeueFiles(
  opts: { fileIds?: string[]; batchId?: string; reason?: string },
): Promise<{ requeued: number }> {
  const { data, error } = await db.rpc("rec_migration_requeue_files", {
    p_file_ids: opts.fileIds ?? null,
    p_batch_id: opts.batchId ?? null,
    p_reason: opts.reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { requeued: number };
}

/** All records in a batch, for the forensic QA suite. */
export async function listBatchRecords(batchId: string, limit = 1000): Promise<MigrationRecordDetail[]> {
  const { data, error } = await db
    .from("rec_migration_records")
    .select("*")
    .eq("batch_id", batchId)
    .order("source_row_no", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as MigrationRecordDetail[];
}

/** record_id -> attached document count, for QA confidence expectations. */
export async function documentCounts(batchId: string): Promise<Record<string, number>> {
  const { data, error } = await db
    .from("rec_migration_record_files")
    .select("record_id, rec_migration_files!inner(batch_id)")
    .eq("rec_migration_files.batch_id", batchId);
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    counts[row.record_id] = (counts[row.record_id] ?? 0) + 1;
  }
  return counts;
}

/* ------------------------------ presentation ----------------------------- */

export const QUEUE_LABELS: Record<MigrationQueue, string> = {
  all: "All records",
  ready: "Ready to import",
  needs_review: "Needs review",
  duplicates: "Duplicate review",
  unmatched_vacancy: "Unmatched vacancy",
  low_confidence: "Low confidence",
  parsing_failed: "Parsing failed",
  approved: "Approved",
  rejected: "Rejected",
  imported: "Imported",
  failed: "Failed",
};

export function batchStatusTone(status: MigrationBatchStatus): "info" | "warning" | "success" | "danger" | "neutral" {
  switch (status) {
    case "imported": return "success";
    case "failed": return "danger";
    case "rolled_back": return "danger";
    case "review": return "warning";
    case "draft": return "neutral";
    default: return "info";
  }
}

export function confidenceBand(value: number | null): "high" | "medium" | "low" | "unknown" {
  if (value === null || value === undefined) return "unknown";
  const v = value > 1 ? value / 100 : value;
  if (v >= 0.75) return "high";
  if (v >= 0.5) return "medium";
  return "low";
}
