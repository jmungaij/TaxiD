/**
 * Public Careers data access — the ONLY path the public website may use to
 * learn about vacancies.
 *
 * There is deliberately no client-side vacancy list, no fallback dataset and no
 * table query here. Both reads go through server-side functions
 * (`rec_public_vacancies`, `rec_public_vacancy`) which enforce the publication
 * eligibility rule — approved AND published AND open AND published_at set —
 * inside the database. The anon role has no direct SELECT grant on
 * `rec_vacancies`, so the public site cannot see anything else even if this
 * file were modified.
 *
 * Freshness contract: publication state is operational data that changes the
 * legality of an application, so every public read is treated as
 * always-stale (no caching window). `PUBLIC_VACANCY_QUERY_OPTIONS` is the single
 * source of truth for that and is asserted by unit tests — a paused vacancy must
 * never be served from cache on a fresh session, incognito window or hard refresh.
 */
import { supabase } from "@/integrations/supabase/client";
import { careersClientIdentity } from "./careersContract";

export const APPLICATION_BUCKET = "recruitment-applications";

/** Never cache publication state. Applied by every public careers query. */
export const PUBLIC_VACANCY_QUERY_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  retry: 1,
};

export interface PublicVacancy {
  id: string;
  public_slug: string;
  vacancy_no: string;
  title: string;
  public_summary: string | null;
  location: string | null;
  employment_type: string;
  work_arrangement: string;
  headcount: number;
  required_skills: string[] | null;
  preferred_skills: string[] | null;
  qualifications: string[] | null;
  responsibilities: string[] | null;
  min_years_experience: number | null;
  target_hire_date: string | null;
  published_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type MetricOperation = "list_vacancies" | "get_vacancy" | "submit_application" | "upload_document";

/**
 * Records latency/outcome of a public careers call. Fire-and-forget: telemetry
 * must never break the visitor experience.
 */
function logPublicApi(
  operation: MetricOperation,
  startedAt: number,
  outcome: "success" | "empty" | "error",
  extra: { slug?: string | null; rowCount?: number | null; error?: string | null } = {},
): void {
  try {
    // Build provenance travels with every measurement: an incident must be
    // attributable to the exact published bundle that produced it.
    const client = careersClientIdentity();
    void db
      .rpc("rec_log_public_api", {
        p_operation: operation,
        p_duration_ms: Math.max(0, Math.round(Date.now() - startedAt)),
        p_outcome: outcome,
        p_slug: extra.slug ?? null,
        p_row_count: extra.rowCount ?? null,
        p_error_message: extra.error ? String(extra.error).slice(0, 400) : null,
        p_build_id: client.build_id,
        p_api_contract_version: client.api_contract_version,
        p_request_id: client.session_ref,
      })
      .then(() => undefined, () => undefined);
  } catch {
    /* telemetry is best-effort */
  }
}


export async function listPublicVacancies(): Promise<PublicVacancy[]> {
  const startedAt = Date.now();
  const { data, error } = await db.rpc("rec_public_vacancies");
  if (error) {
    logPublicApi("list_vacancies", startedAt, "error", { error: error.message });
    throw new Error(error.message);
  }
  const rows = (data ?? []) as PublicVacancy[];
  logPublicApi("list_vacancies", startedAt, rows.length ? "success" : "empty", { rowCount: rows.length });
  return rows;
}

export async function getPublicVacancy(slug: string): Promise<PublicVacancy | null> {
  const startedAt = Date.now();
  const { data, error } = await db.rpc("rec_public_vacancy", { p_slug: slug });
  if (error) {
    logPublicApi("get_vacancy", startedAt, "error", { slug, error: error.message });
    throw new Error(error.message);
  }
  const rows = (data ?? []) as PublicVacancy[];
  logPublicApi("get_vacancy", startedAt, rows.length ? "success" : "empty", { slug, rowCount: rows.length });
  return rows[0] ?? null;
}

export interface ApplicationDocumentRef {
  doc_type: "cv" | "cover_letter" | "certificate" | "supporting";
  /** Requirement identity from the document requirement engine (e.g. `kcse_certificate`). */
  doc_key?: string;
  /** Academic year the document covers, for per-year transcript requirements. */
  academic_year?: number | null;
  /** True when one transcript covers every completed year. */
  consolidated?: boolean;
  rule_id?: string | null;
  /** Only `complete` counts towards submission completeness. */
  upload_status?: "uploading" | "complete" | "failed";
  file_name: string;
  storage_path: string;
  mime_type?: string | null;
  size_bytes?: number | null;
}

export interface PublicApplicationPayload {
  vacancy_slug: string;
  full_name: string;
  email: string;
  phone?: string;
  location?: string;
  headline?: string;
  years_experience?: number | null;
  current_employer?: string;
  current_title?: string;
  cover_letter?: string;
  academic_qualifications: Array<Record<string, string>>;
  professional_qualifications: Array<Record<string, string>>;
  employment_history: Array<Record<string, string>>;
  skills: string[];
  documents: ApplicationDocumentRef[];
  /** Declared academic status — drives conditional graduation requirements. */
  education_status?: string | null;
  qualification_level?: string | null;
  completed_years?: number | null;
  consolidated_transcript?: boolean;
  consent_privacy: boolean;
  /** Required accuracy declaration — separate from optional talent-pool consent. */
  declaration_accuracy?: boolean;
  consent_talent_pool?: boolean;
  /** Answers to the vacancy's blueprint questions, keyed by question_key. */
  answers?: Record<string, unknown>;
  source_detail?: string;
}

export interface PublicApplicationResult {
  duplicate: boolean;
  application_id: string;
  application_no: string;
  vacancy_title: string;
  vacancy_id?: string;
}

/** Mirrors the server rules in `rec_public_apply` so visitors get fast feedback. */
/** Must stay equal to the storage bucket ceiling (recruitment-applications = 10 MB),
 *  otherwise the visitor is promised a size the upload then refuses. */
export const APPLICATION_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const APPLICATION_ALLOWED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
  "text/plain",
];
/** Extension whitelist — phones often send images with an empty MIME type. */
export const APPLICATION_ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "png", "jpg", "jpeg", "webp", "heic", "heif", "txt",
];
export const APPLICATION_ACCEPT_ATTRIBUTE =
  ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.heic,.heif,.txt";
const ACCEPTED_LABEL = "PDF, Word, PNG, JPEG, WEBP, HEIC or TXT";

function fileExtension(name: string): string {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

/**
 * Validates one selected file before any network call. Returns a human message
 * or `null` when the file is acceptable. Shared by the form field and the
 * upload helper so the visitor never sees a raw storage error.
 */
export function validateApplicationFile(file: File): string | null {
  if (file.size <= 0) return `${file.name}: the file appears to be empty.`;
  if (file.size > APPLICATION_MAX_FILE_BYTES) return `${file.name}: must be 10 MB or smaller.`;
  const ext = fileExtension(file.name);
  if (!ext || !APPLICATION_ALLOWED_EXTENSIONS.includes(ext)) {
    return `${file.name}: file type is not accepted (${ACCEPTED_LABEL}).`;
  }
  if (file.type && !APPLICATION_ALLOWED_MIME.includes(file.type.toLowerCase())) {
    return `${file.name}: file type is not accepted (${ACCEPTED_LABEL}).`;
  }
  return null;
}

export function validateApplicationPayload(payload: PublicApplicationPayload): string[] {
  const errors: string[] = [];
  const name = (payload.full_name ?? "").trim();
  const email = (payload.email ?? "").trim().toLowerCase();

  if (name.length < 2 || name.length > 120) errors.push("Full name must be between 2 and 120 characters.");
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) errors.push("Enter a valid email address.");
  if (!payload.consent_privacy) errors.push("Please acknowledge the privacy notice.");
  if (payload.declaration_accuracy === false) errors.push("Please confirm the information provided is accurate.");
  if (payload.phone && !/^[0-9+()\-\s]{7,24}$/.test(payload.phone.trim())) errors.push("Phone number format is invalid.");
  // LinkedIn / portfolio links are no longer collected, so no URL rules apply.

  if ((payload.cover_letter ?? "").length > 8000) errors.push("Cover letter is too long (max 8000 characters).");
  if (payload.skills.length > 60) errors.push("Please list at most 60 skills.");
  if (payload.documents.length > 10) errors.push("Please attach at most 10 documents.");
  // Documents are no longer collected at application stage — recruitment
  // requests evidence later in the process, so no attachment is required here.

  for (const doc of payload.documents) {
    if (!doc.storage_path.startsWith(`public-applications/${payload.vacancy_slug}/`)) {
      errors.push(`${doc.file_name}: upload path is not permitted.`);
    }
    if ((doc.size_bytes ?? 0) > APPLICATION_MAX_FILE_BYTES) errors.push(`${doc.file_name}: must be 10 MB or smaller.`);
    if (doc.size_bytes !== null && doc.size_bytes !== undefined && doc.size_bytes <= 0) {
      errors.push(`${doc.file_name}: the file appears to be empty.`);
    }
    if (doc.mime_type && !APPLICATION_ALLOWED_MIME.includes(doc.mime_type.toLowerCase())) {
      errors.push(`${doc.file_name}: file type is not accepted (${ACCEPTED_LABEL}).`);
    }
    if (!APPLICATION_ALLOWED_EXTENSIONS.includes(fileExtension(doc.file_name))) {
      errors.push(`${doc.file_name}: file type is not accepted (${ACCEPTED_LABEL}).`);
    }
  }
  return errors;
}

/**
 * Server-issued upload sessions.
 *
 * Storage is not an open file drop: every applicant file must sit inside a
 * folder the database issued for one currently-open vacancy, valid for two
 * hours and capped at ten files. The session is claimed when the application
 * record is created, so unclaimed folders are identifiable and disposable.
 */
interface UploadSession {
  session_id: string;
  prefix: string;
  expires_at: string;
}

const uploadSessions = new Map<string, UploadSession>();

const SESSION_REFUSAL: Record<string, string> = {
  VACANCY_NOT_OPEN: "This vacancy is no longer accepting applications.",
  RATE_LIMITED: "Too many uploads are being processed right now. Please try again in a few minutes.",
  INVALID_SLUG: "This vacancy could not be identified.",
};

async function ensureUploadSession(slug: string): Promise<UploadSession> {
  const cached = uploadSessions.get(slug);
  // renew a minute before expiry so an in-flight upload cannot land on a dead session
  if (cached && new Date(cached.expires_at).getTime() - 60_000 > Date.now()) return cached;

  const { data, error } = await supabase.rpc("rec_public_upload_session_open" as never, {
    p_slug: slug,
  } as never);
  if (error) throw new Error(`Uploads could not be prepared: ${error.message}`);
  const row = (data ?? {}) as { ok?: boolean; code?: string } & UploadSession;
  if (!row.ok) {
    throw new Error(SESSION_REFUSAL[row.code ?? ""] ?? "Uploads could not be prepared right now.");
  }
  const session: UploadSession = {
    session_id: row.session_id,
    prefix: row.prefix,
    expires_at: row.expires_at,
  };
  uploadSessions.set(slug, session);
  return session;
}

/**
 * Uploads an applicant document into the private recruitment bucket and
 * verifies persistence before reporting success. A selected file is never
 * treated as an uploaded document: when storage rejects the write, the caller
 * receives an error and the requirement stays unsatisfied.
 */
export async function uploadApplicationDocument(
  slug: string,
  file: File,
  docType: ApplicationDocumentRef["doc_type"],
  requirement?: {
    doc_key?: string;
    academic_year?: number | null;
    consolidated?: boolean;
    rule_id?: string | null;
  },
): Promise<ApplicationDocumentRef> {
  const problem = validateApplicationFile(file);
  if (problem) throw new Error(problem);
  const startedAt = Date.now();
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-120);
  const session = await ensureUploadSession(slug);
  const path = `${session.prefix}${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from(APPLICATION_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) {
    logPublicApi("upload_document", startedAt, "error", { slug, error: error.message });
    // A policy refusal can mean the session is spent or expired — force a new one
    // on the next attempt instead of retrying against a dead folder.
    if (/policy|unauthor|denied/i.test(error.message)) uploadSessions.delete(slug);
    const message = /exceeded|too large|payload/i.test(error.message)
      ? `${file.name}: the file is too large to upload (max 10 MB).`
      : /mime|not supported|invalid/i.test(error.message)
        ? `${file.name}: file type is not accepted (${ACCEPTED_LABEL}).`
        : `${file.name} could not be uploaded: ${error.message}`;
    throw new Error(message);
  }

  logPublicApi("upload_document", startedAt, "success", { slug, rowCount: 1 });
  return {
    doc_type: docType,
    doc_key: requirement?.doc_key ?? docType,
    academic_year: requirement?.academic_year ?? null,
    consolidated: requirement?.consolidated ?? false,
    rule_id: requirement?.rule_id ?? null,
    upload_status: "complete",
    file_name: file.name,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
  };
}

/**
 * Records a refused submission as durable evidence. The submission transaction
 * has already aborted at this point, taking its own rejection log with it, so
 * this is the only surviving forensic record of the refusal — and it is what
 * opens the candidate's remediation case.
 */
async function reportSubmissionRefusal(
  payload: PublicApplicationPayload,
  message: string,
): Promise<never> {
  const { classifyApplicationFailure, recordApplyRefusal } = await import("./applicationFailure");
  const failure = classifyApplicationFailure(new Error(message));
  await recordApplyRefusal({
    slug: payload.vacancy_slug,
    email: payload.email,
    failure,
    documents: payload.documents,
    step: "submit",
  });
  throw new Error(failure.message);
}

/**
 * Submits an application directly into the Recruitment 360 ATS. The server
 * re-verifies publication eligibility and every document rule, so a paused or
 * closed vacancy cannot accept applications even from a stale page.
 */
export async function submitPublicApplication(
  payload: PublicApplicationPayload,
): Promise<PublicApplicationResult> {
  const problems = validateApplicationPayload(payload);
  if (problems.length) throw new Error(problems[0]);

  const startedAt = Date.now();
  const { data, error } = await db.rpc("rec_public_apply", { p_payload: payload });
  if (error) {
    logPublicApi("submit_application", startedAt, "error", { slug: payload.vacancy_slug, error: error.message });
    return reportSubmissionRefusal(payload, error.message);
  }
  logPublicApi("submit_application", startedAt, "success", { slug: payload.vacancy_slug, rowCount: 1 });
  return data as PublicApplicationResult;
}


/* ------------------------------------------------------------------ *
 * Recruitment Blueprint — the application form is generated from the
 * vacancy's blueprint, never hard-coded in the page.
 * ------------------------------------------------------------------ */

export type QuestionKind =
  | "text" | "long_text" | "single_choice" | "multi_choice" | "boolean" | "number" | "date";

export interface BlueprintQuestion {
  question_key: string;
  prompt: string;
  help_text: string | null;
  kind: QuestionKind;
  options: string[];
  is_required: boolean;
  /** Knockout questions are exposed as `required` — eligibility logic stays server-side. */
  classification: "required" | "preferred" | "scored" | "informational";
}

export interface BlueprintDocumentRequirement {
  doc_type: ApplicationDocumentRef["doc_type"];
  label: string;
  required?: boolean;
  multiple?: boolean;
}

export interface ApplicationBlueprint {
  open: boolean;
  canonical_slug?: string;
  vacancy?: {
    id: string;
    vacancy_no: string;
    title: string;
    content_version: number;
    location: string | null;
    employment_type: string;
    work_arrangement: string;
    min_years_experience: number | null;
    required_skills: string[] | null;
    preferred_skills: string[] | null;
  };
  blueprint?: {
    id: string;
    version: number;
    cover_letter_mode: "none" | "optional" | "required";
    sections: Record<string, boolean>;
    document_requirements: BlueprintDocumentRequirement[];
    questions: BlueprintQuestion[];
  } | null;
  privacy_notice?: { version: string; title: string; body_markdown: string } | null;
}

export async function getApplicationBlueprint(slug: string): Promise<ApplicationBlueprint> {
  const startedAt = Date.now();
  const { data, error } = await db.rpc("rec_public_application_blueprint", { p_slug: slug });
  if (error) {
    logPublicApi("get_vacancy", startedAt, "error", { slug, error: error.message });
    throw new Error(error.message);
  }
  const result = (data ?? { open: false }) as ApplicationBlueprint;
  logPublicApi("get_vacancy", startedAt, result.open ? "success" : "empty", { slug });
  return result;
}

/**
 * Single-call application bootstrap.
 *
 * The apply page previously made three sequential public calls (handshake,
 * blueprint, vacancy detail) before it could render anything, so the visitor
 * paid three round trips of network latency. `rec_public_apply_bootstrap`
 * composes all three server-side, which is the dominant read-latency win on the
 * application entry path. One measurement is logged for the whole bootstrap.
 */
export async function getApplicationBootstrap(slug: string): Promise<{
  blueprint: ApplicationBlueprint;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contract: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
}> {
  const startedAt = Date.now();
  const client = careersClientIdentity();
  const { data, error } = await db.rpc("rec_public_apply_bootstrap", {
    p_slug: slug,
    p_client: {
      build_id: client.build_id,
      api_contract_version: client.api_contract_version,
      application_schema_version: client.application_schema_version,
    },
  });
  if (error) {
    logPublicApi("get_vacancy", startedAt, "error", { slug, error: error.message });
    throw new Error(error.message);
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const blueprint = (row.blueprint ?? { open: false }) as ApplicationBlueprint;
  logPublicApi("get_vacancy", startedAt, blueprint.open ? "success" : "empty", { slug });
  return { blueprint, contract: row.contract ?? null, detail: row.detail ?? null };
}

/* ------------------------------------------------------------------ *
 * Save & resume — the draft lives server-side, keyed by email plus a
 * resume token that only the candidate holds.
 * ------------------------------------------------------------------ */

const DRAFT_TOKEN_PREFIX = "yalla.careers.draft.";

export function resumeTokenFor(slug: string): string {
  const key = `${DRAFT_TOKEN_PREFIX}${slug}`;
  let token = localStorage.getItem(key);
  if (!token || token.length < 20) {
    token = crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(key, token);
  }
  return token;
}

export function clearResumeToken(slug: string): void {
  localStorage.removeItem(`${DRAFT_TOKEN_PREFIX}${slug}`);
}

export interface DraftState<T = Record<string, unknown>> {
  found: boolean;
  payload?: T;
  step?: number;
  saved_at?: string;
}

export async function saveApplicationDraft(
  slug: string,
  email: string,
  payload: Record<string, unknown>,
  step: number,
  token = resumeTokenFor(slug),
): Promise<{ saved_at: string }> {
  const { data, error } = await db.rpc("rec_public_draft_save", {
    p_slug: slug, p_email: email, p_token: token, p_payload: payload, p_step: step,
  });
  if (error) throw new Error(error.message);
  return data as { saved_at: string };
}

export async function loadApplicationDraft<T = Record<string, unknown>>(
  slug: string,
  email: string,
  token = resumeTokenFor(slug),
): Promise<DraftState<T>> {
  const { data, error } = await db.rpc("rec_public_draft_load", {
    p_slug: slug, p_email: email, p_token: token,
  });
  if (error) throw new Error(error.message);
  return (data ?? { found: false }) as DraftState<T>;
}

/** Client mirror of the server's blueprint answer rules. */
export function validateAnswers(
  questions: BlueprintQuestion[],
  answers: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const q of questions) {
    const a = answers[q.question_key];
    const empty =
      a === undefined || a === null || a === "" ||
      (Array.isArray(a) && a.length === 0);
    if (q.is_required && empty) errors.push(`Please answer: ${q.prompt}`);
    if (typeof a === "string" && a.length > 6000) errors.push(`Answer to "${q.prompt}" is too long.`);
  }
  return errors;
}

/* ------------------------------------------------------------------ *
 * Vacancy detail — the authoritative candidate-facing read. All HR
 * structure (purpose, accountability groups, requirements, outcomes,
 * process) lives on the vacancy record; this page only renders it.
 * ------------------------------------------------------------------ */

export interface AccountabilityGroup { group: string; bullets: string[] }
export interface ProcessStep { step: string; detail: string }

export interface PublicVacancyDetail {
  id: string;
  vacancy_no: string;
  title: string;
  public_summary: string | null;
  role_purpose: string | null;
  location: string | null;
  employment_type: string;
  work_arrangement: string;
  headcount: number;
  min_years_experience: number | null;
  experience_statement: string | null;
  accountability_groups: AccountabilityGroup[];
  required_skills: string[];
  preferred_skills: string[];
  competencies: string[];
  technical_tools: string[];
  qualification_level: string | null;
  qualifications: string[];
  equivalent_experience_accepted: boolean;
  success_outcomes: string[];
  suitability: string[];
  recruitment_process: ProcessStep[];
  application_deadline: string | null;
  published_at: string | null;
  content_version: number;
  department: string | null;
  position_title: string | null;
  reports_to: string | null;
}

export interface OtherOpening {
  public_slug: string;
  title: string;
  location: string | null;
  employment_type: string;
  work_arrangement: string;
}

export interface VacancyDetailResult {
  open: boolean;
  canonical_slug?: string;
  vacancy?: PublicVacancyDetail;
  other_openings?: OtherOpening[];
}

export async function getPublicVacancyDetail(slug: string): Promise<VacancyDetailResult> {
  const startedAt = Date.now();
  const { data, error } = await db.rpc("rec_public_vacancy_detail", { p_slug: slug });
  if (error) {
    logPublicApi("get_vacancy", startedAt, "error", { slug, error: error.message });
    throw new Error(error.message);
  }
  const result = (data ?? { open: false }) as VacancyDetailResult;
  logPublicApi("get_vacancy", startedAt, result.open ? "success" : "empty", { slug });
  return result;
}

/** Professional display labels — British English, no raw enum values. */
export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  permanent: "Permanent",
  contract: "Fixed-term contract",
  fixed_term: "Fixed-term contract",
  temporary: "Temporary",
  internship: "Internship",
  part_time: "Part-time",
  consultant: "Consultancy",
  commission_based: "Commission-based contract",
};

export const WORK_ARRANGEMENT_LABELS: Record<string, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
  field: "Field-based",
};

export function labelFor(map: Record<string, string>, value: string): string {
  return map[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function experienceLabel(years: number | null | undefined): string | null {
  if (years === null || years === undefined) return null;
  return `${years}+ years of relevant experience`;
}

export function positionsLabel(headcount: number): string {
  return `${headcount} position${headcount === 1 ? "" : "s"} available`;
}

/* ------------------------------ internships ------------------------------ */

/**
 * Visitor-safe internship programme announcement.
 *
 * Served by `rec_public_internship`, which returns ONLY presentation fields for
 * a vacancy that is approved, published and open. Internal scoring weights,
 * selection models, assessment/interview design, supervisors and integrity
 * controls are never part of this contract.
 */
export interface PublicInternshipAnnouncement {
  vacancy_id: string;
  public_slug: string;
  internship_type: string;
  duration_weeks: number | null;
  start_date: string | null;
  end_date: string | null;
  application_deadline: string | null;
  host_function: string | null;
  business_unit: string | null;
  programme_purpose: string | null;
  summary: string | null;
  what_you_will_do: string | null;
  what_you_will_learn: string | null;
  who_should_apply: string | null;
  learning_outcomes: unknown;
  practical_capabilities: string[] | null;
  success_profile: string[] | null;
  required_documents: string[] | null;
  /** Sealed revision the announcement was served from, when one exists. */
  published_version?: number | null;
}

export async function getPublicInternship(slug: string): Promise<PublicInternshipAnnouncement | null> {
  const { data, error } = await db.rpc("rec_public_internship", { p_slug: slug });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PublicInternshipAnnouncement[];
  return rows[0] ?? null;
}

/** Learning outcomes are stored as JSON; render only string-shaped entries. */
export function internshipOutcomeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : typeof (v as { outcome?: string })?.outcome === "string" ? (v as { outcome: string }).outcome : ""))
    .filter((s): s is string => !!s);
}

/* --------------------- announcement analytics (visitor-safe) -------------- */

const VISITOR_KEY = "yalla.careers.visitor";

/**
 * Stable, anonymous visitor token. Used only so the funnel can distinguish a
 * repeat view from a new one; the server hashes it before storage and it is
 * never linked to a candidate record.
 */
export function announcementVisitorToken(): string {
  try {
    let token = localStorage.getItem(VISITOR_KEY);
    if (!token || token.length < 20) {
      token = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem(VISITOR_KEY, token);
    }
    return token;
  } catch {
    return "";
  }
}

function deviceClass(): "mobile" | "tablet" | "desktop" {
  const w = typeof window === "undefined" ? 1280 : window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

export type AnnouncementEvent = "VIEW" | "APPLICATION_START" | "APPLICATION_SUBMIT";

/**
 * Records an announcement funnel signal. Fire-and-forget: analytics must never
 * block or break an application. The server caps repeats per visitor per day.
 */
export function trackAnnouncementEvent(slug: string, event: AnnouncementEvent): void {
  if (!slug) return;
  try {
    void db
      .rpc("rec_public_announcement_track", {
        p_slug: slug,
        p_event: event,
        p_visitor: announcementVisitorToken() || null,
        p_referrer: typeof document === "undefined" ? null : document.referrer || null,
        p_device: deviceClass(),
      })
      .then(() => undefined, () => undefined);
  } catch {
    /* best effort */
  }
}

/* ------------------- internship application submission ------------------- */

/** Academic context collected only for internship programmes. */
export interface InternshipAcademicProfile {
  institution?: string | null;
  institution_type?: string | null;
  programme?: string | null;
  qualification_level?: string | null;
  specialisation?: string | null;
  year_of_study?: number | null;
  semester?: number | null;
  academic_stage?: string | null;
  relevant_courses?: string[];
  attachment_done?: boolean;
  attachment_detail?: string | null;
  projects?: string[];
  skills?: string[];
  portfolio_url?: string | null;
  work_experience?: string | null;
  learning_objectives?: string[];
  expected_outcomes?: string[];
}

/** Blank strings are absent data, never a stored empty value. */
export const nullIfBlank = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * The only academic facts an internship application cannot be submitted
 * without. Qualification level is deliberately not one of them: a candidate may
 * legitimately not be able to declare it, and the profile column is nullable so
 * recruiters triage the gap later instead of the applicant being blocked.
 */
export const INTERNSHIP_ACADEMIC_REQUIRED = ["institution", "programme"] as const;

export const QUALIFICATION_MISSING_NOTICE =
  "Qualification level not declared — you can still submit; our recruitment team will confirm it with you.";

/**
 * Client-side gate for the academic step. `errors` block submission; `notices`
 * explain an undeclared-but-permitted gap so the applicant is never left
 * guessing why a field was left blank.
 */
export function validateInternshipAcademicProfile(
  profile: InternshipAcademicProfile,
): { errors: string[]; notices: string[] } {
  const errors: string[] = [];
  const notices: string[] = [];

  if (!nullIfBlank(profile.institution)) errors.push("Please tell us which institution you attend.");
  if (!nullIfBlank(profile.programme)) errors.push("Please tell us which programme you are studying.");
  if (!nullIfBlank(profile.qualification_level)) notices.push(QUALIFICATION_MISSING_NOTICE);

  return { errors, notices };
}

/**
 * Normalises the academic profile before submission: every optional text field
 * becomes `null` rather than `""` or `undefined`, so the stored row states
 * "not declared" explicitly and no NOT NULL / blank-value ambiguity can arise.
 */
export function normaliseInternshipAcademicProfile(
  profile: InternshipAcademicProfile,
): InternshipAcademicProfile {
  return {
    ...profile,
    institution: nullIfBlank(profile.institution),
    institution_type: nullIfBlank(profile.institution_type),
    programme: nullIfBlank(profile.programme),
    qualification_level: nullIfBlank(profile.qualification_level),
    specialisation: nullIfBlank(profile.specialisation),
    academic_stage: nullIfBlank(profile.academic_stage),
    attachment_detail: nullIfBlank(profile.attachment_detail),
    portfolio_url: nullIfBlank(profile.portfolio_url),
    work_experience: nullIfBlank(profile.work_experience),
    year_of_study: profile.year_of_study ?? null,
    semester: profile.semester ?? null,
  };
}


/**
 * Submits an internship application. `rec_public_internship_apply` performs the
 * same publication, consent and document checks as the standard path, then
 * records the academic profile and opens the internal recruitment pipeline.
 * Selection weights, track matching and scores stay server-side.
 */
export async function submitPublicInternshipApplication(
  payload: PublicApplicationPayload & { academic_profile: InternshipAcademicProfile },
): Promise<PublicApplicationResult> {
  const problems = validateApplicationPayload(payload);
  if (problems.length) throw new Error(problems[0]);

  const academic_profile = normaliseInternshipAcademicProfile(payload.academic_profile);
  const academic = validateInternshipAcademicProfile(academic_profile);
  if (academic.errors.length) throw new Error(academic.errors[0]);

  const startedAt = Date.now();
  const { data, error } = await db.rpc("rec_public_internship_apply", {
    p_payload: { ...payload, academic_profile, client_token: announcementVisitorToken() },
  });

  if (error) {
    logPublicApi("submit_application", startedAt, "error", { slug: payload.vacancy_slug, error: error.message });
    return reportSubmissionRefusal(payload, error.message);
  }

  logPublicApi("submit_application", startedAt, "success", { slug: payload.vacancy_slug, rowCount: 1 });
  return data as PublicApplicationResult;
}
