/**
 * Recruitment 360 — application failure taxonomy and refusal forensics.
 *
 * Forensic finding (31 Aug 2026): `rec_public_apply` wrote its rejection
 * evidence into `rec_public_apply_attempts` and then raised an exception in the
 * same transaction. Postgres rolled the INSERT back with the rest of the
 * statement, so 40 recorded submission refusals left exactly zero stored
 * rejection records. The only surviving trace was a latency metric row.
 *
 * Therefore the refusal is re-reported from the client, after the transaction
 * has aborted, through `rec_record_apply_refusal`. That call also opens (or
 * increments) a remediation case so the candidate keeps ONE application per
 * vacancy and can resume instead of starting again.
 *
 * A refused application is not an outage. `classifyApplicationFailure` keeps
 * business validation, candidate action, security and genuine technical failure
 * apart, and the same rule set exists in SQL (`rec_apply_failure_class`) so the
 * dashboard and the database can never disagree.
 */
import { supabase } from "@/integrations/supabase/client";
import { careersClientIdentity } from "./careersContract";
import type { ApplicationDocumentRef } from "./publicApi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ApplicationFailureClass =
  | "BUSINESS_VALIDATION"
  | "CANDIDATE_ACTION_REQUIRED"
  | "SECURITY_FAILURE"
  | "COMPATIBILITY_FAILURE"
  | "TECHNICAL_FAILURE";

export type ApplicationErrorCode =
  | "DOCUMENT_REQUIRED"
  | "DUPLICATE_SUBMISSION"
  | "VACANCY_CLOSED"
  | "PROFILE_INCOMPLETE"
  | "FILE_REJECTED"
  | "DOCUMENT_UPLOAD_FAILED"
  | "STORAGE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "NOT_AUTHORISED"
  | "BUILD_TOO_OLD"
  | "APPLICATION_CONTRACT_INCOMPATIBLE"
  | "UNCLASSIFIED";


export interface ClassifiedApplicationFailure {
  code: ApplicationErrorCode;
  failureClass: ApplicationFailureClass;
  /** Requirement labels the server says are outstanding, when it named them. */
  missing: string[];
  /** Message shown to the candidate — never a raw database error. */
  message: string;
  /** What the candidate (or SAFARID) must do next. */
  guidance: string;
  /** True when retrying the identical submission can succeed. */
  retryable: boolean;
}

const RULES: Array<{
  test: RegExp;
  code: ApplicationErrorCode;
  failureClass: ApplicationFailureClass;
  guidance: string;
  retryable: boolean;
}> = [
  {
    // Version drift is never the candidate's fault and never a business refusal.
    test: /BUILD_TOO_OLD|application form has been updated|contract.*incompatib/i,
    code: "BUILD_TOO_OLD",
    failureClass: "COMPATIBILITY_FAILURE",
    guidance:
      "Reload the page to load the current application form. Everything you have saved is preserved.",
    retryable: true,
  },

  {
    // "KCSE Certificate is required" is a requirement refusal, not an outage.
    test: /missing mandatory documents|Missing:|(certificate|transcript|cv|curriculum vitae|photo|letter|document|result slip)[^.]{0,40}\s(is|are)\s+required/i,
    code: "DOCUMENT_REQUIRED",
    failureClass: "BUSINESS_VALIDATION",
    guidance:
      "Attach the outstanding documents on the Documents step. Everything you have already completed has been saved.",
    retryable: false,
  },
  {
    test: /already applied|duplicate/i,
    code: "DUPLICATE_SUBMISSION",
    failureClass: "BUSINESS_VALIDATION",
    guidance: "Your application for this role is already with our recruitment team.",
    retryable: false,
  },
  {
    test: /no longer open|not published|closed|deadline/i,
    code: "VACANCY_CLOSED",
    failureClass: "BUSINESS_VALIDATION",
    guidance: "Applications for this role are closed. Browse other open roles on Careers.",
    retryable: false,
  },
  {
    test: /full name|valid email|privacy notice|accurate|phone number format|cover letter|institution|programme/i,
    code: "PROFILE_INCOMPLETE",
    failureClass: "CANDIDATE_ACTION_REQUIRED",
    guidance: "Complete the highlighted field and submit again.",
    retryable: false,
  },
  {
    test: /file type is not accepted|1[05] MB|exceeded the maximum allowed size|appears to be empty|at most 10 documents/i,
    code: "FILE_REJECTED",
    failureClass: "CANDIDATE_ACTION_REQUIRED",
    guidance: "Replace the file with an accepted format under 10 MB.",
    retryable: false,
  },
  {
    test: /could not be uploaded|upload path is not permitted/i,
    code: "DOCUMENT_UPLOAD_FAILED",
    failureClass: "TECHNICAL_FAILURE",
    guidance:
      "Your document did not reach us. Your progress is preserved — retry the upload; our team has been notified.",
    retryable: true,
  },
  {
    test: /storage|bucket|object not found/i,
    code: "STORAGE_UNAVAILABLE",
    failureClass: "TECHNICAL_FAILURE",
    guidance: "Document storage is temporarily unavailable. Your progress is saved — please retry shortly.",
    retryable: true,
  },
  {
    test: /permission denied|not authoris|not authoriz|jwt|row-level security/i,
    code: "NOT_AUTHORISED",
    failureClass: "SECURITY_FAILURE",
    guidance: "We could not authorise this submission. Our team has been notified.",
    retryable: false,
  },
  {
    test: /too many|rate limit/i,
    code: "RATE_LIMITED",
    failureClass: "TECHNICAL_FAILURE",
    guidance: "Too many attempts in a short period. Please wait a moment and try once more.",
    retryable: true,
  },
  {
    test: /timeout|timed out/i,
    code: "TIMEOUT",
    failureClass: "TECHNICAL_FAILURE",
    guidance: "The request timed out before we could save it. Your progress is preserved — please retry.",
    retryable: true,
  },
  {
    test: /failed to fetch|network|502|503|504|connection/i,
    code: "NETWORK_ERROR",
    failureClass: "TECHNICAL_FAILURE",
    guidance: "The connection dropped before we could save your application. Your progress is preserved — please retry.",
    retryable: true,
  },
];

/** Requirement labels named after the server's "missing mandatory documents:" prefix. */
export function extractMissingRequirements(message: string): string[] {
  const match = /missing mandatory documents:\s*(.+)$/i.exec(message) ?? /Missing:\s*(.+)$/i.exec(message);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function classifyApplicationFailure(error: unknown): ClassifiedApplicationFailure {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const message = raw.trim() || "We could not submit your application.";
  const rule = RULES.find((r) => r.test.test(message));
  return {
    code: rule?.code ?? "UNCLASSIFIED",
    failureClass: rule?.failureClass ?? "TECHNICAL_FAILURE",
    missing: extractMissingRequirements(message),
    message,
    guidance:
      rule?.guidance ??
      "We could not complete your submission. Your progress is preserved — please retry, and contact us if it persists.",
    retryable: rule?.retryable ?? true,
  };
}

/**
 * Persists the refusal outside the aborted submission transaction and opens or
 * increments the candidate's remediation case. Fire-and-forget by design: a
 * telemetry failure must never replace the real error the candidate sees.
 */
export async function recordApplyRefusal(input: {
  slug: string;
  email: string;
  failure: ClassifiedApplicationFailure;
  documents?: ApplicationDocumentRef[];
  step?: string;
}): Promise<void> {
  const client = careersClientIdentity();
  try {
    await db.rpc("rec_record_apply_refusal", {
      p_slug: input.slug,
      p_email: input.email,
      p_message: input.failure.message.slice(0, 400),
      p_error_code: input.failure.code,
      p_missing: input.failure.missing,
      p_documents: (input.documents ?? []).map((d) => ({
        doc_key: d.doc_key ?? d.doc_type,
        doc_type: d.doc_type,
        academic_year: d.academic_year ?? null,
        file_name: d.file_name,
        storage_path: d.storage_path,
        size_bytes: d.size_bytes ?? null,
        upload_status: d.upload_status ?? "complete",
      })),
      p_step: input.step ?? null,
      p_build_id: client.build_id,
      p_api_contract_version: client.api_contract_version,
      p_application_schema_version: client.application_schema_version,
      p_session_ref: client.session_ref,
    });


  } catch {
    /* forensics are best-effort; the candidate's error is authoritative */
  }
}
