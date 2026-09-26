/**
 * LEGAL EVIDENCE FORM RULES.
 *
 * Client-side integrity gate for the EXISTING evidence submission RPC. It does
 * not decide readiness; it prevents an evidence record that would contaminate
 * the legal register: generic declarations, invented dates, a document location
 * that does not resolve to Documents 360, or a missing approver.
 */
import { LG_ROOT_FOLDER, lgEntry } from "./dossier";

export interface LegalEvidenceFormInput {
  control_id: string;
  evidence_ref: string;
  approver_email: string;
  document_path: string;
  issuing_authority: string;
  effective_at: string;
  expiry_at: string;
  comments: string;
  /** True only when the submitter is filing an authoritative document (licence, insurer policy, executed contract). */
  authoritative_evidence: boolean;
}

/** Declarations that assert nothing and are never acceptable. */
const BANNED_DECLARATIONS = ["confirmed", "ok", "done", "yes", "n/a", "na", "complete", "compliant", "verified"];

export const DOCUMENTS_360_HINT = LG_ROOT_FOLDER;

export function validateLegalEvidenceForm(input: LegalEvidenceFormInput): string[] {
  const errors: string[] = [];
  const ref = input.evidence_ref.trim();
  const approver = input.approver_email.trim();
  const location = input.document_path.trim();
  const authority = input.issuing_authority.trim();
  const declaration = input.comments.trim();

  if (!ref) errors.push("Evidence reference is mandatory.");
  if (!approver) errors.push("An authorised approver is mandatory before submission.");
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(approver)) errors.push("Approver must be a valid email address.");

  if (!location) errors.push("Document location is mandatory and must resolve to Documents 360.");
  else if (!/documents\s*360/i.test(location)) {
    errors.push(`Document location must resolve to Documents 360, e.g. "${DOCUMENTS_360_HINT} / ${input.control_id}".`);
  }

  if (!authority) {
    errors.push('Issuing authority must be the actual issuing authority or explicitly "LEGAL DETERMINATION REQUIRED".');
  }

  if (!declaration) errors.push("A declaration describing the actual evidentiary state is mandatory.");
  else if (BANNED_DECLARATIONS.includes(declaration.toLowerCase().replace(/[.!]$/, ""))) {
    errors.push('A generic declaration such as "Confirmed" is not accepted — describe the actual evidentiary state.');
  } else if (declaration.length < 40) {
    errors.push("The declaration must describe the actual evidentiary state (at least 40 characters).");
  }

  if (!input.authoritative_evidence) {
    if (input.effective_at) errors.push("Effective date must stay blank until authoritative evidence exists.");
    if (input.expiry_at) errors.push("Expiry / review date must stay blank until authoritative evidence exists.");
  } else {
    if (!input.effective_at) errors.push("Authoritative evidence must carry the effective date shown on the document.");
    if (input.effective_at && input.expiry_at && input.expiry_at < input.effective_at) {
      errors.push("Expiry date cannot precede the effective date.");
    }
  }

  const entry = lgEntry(input.control_id);
  if (entry && ref && !ref.toUpperCase().includes(entry.document_id.toUpperCase()) && !input.authoritative_evidence) {
    errors.push(`Evidence reference for ${input.control_id} should cite ${entry.document_id}.`);
  }

  return errors;
}

/** Prefill for the resolve form, derived from the dossier — never from invented data. */
export function lgEvidencePrefill(controlId: string): Record<string, string> | null {
  const entry = lgEntry(controlId);
  if (!entry) return null;
  return {
    ref: `${entry.document_id} — ${entry.title}`,
    doc: entry.folder,
    authority: entry.issuing_authority,
    eff: "",
    exp: "",
    comments: entry.declaration,
  };
}
