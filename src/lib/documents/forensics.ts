/**
 * Document OS — Forensic Document Security, Authenticity & Traceability.
 *
 * Every document Yalla Mobility issues carries a permanent, server-issued
 * identity. The client never invents any part of it:
 *
 *   issue    → doc_issue_security_mark   (document number, security number, token)
 *   seal     → doc_seal_document_hash    (write-once hash over the rendered bytes)
 *   copy     → doc_register_distribution (recipient-bound download record)
 *   lifecycle→ doc_set_mark_status       (void / expire / restore)
 *   forensics→ doc_tamper_check          (staff) / doc_verify_public (anyone)
 *
 * Identity fields are immutable in the database and every touch appends to a
 * hash-chained event log, so provenance can be replayed but never rewritten.
 */
import { supabase } from "@/integrations/supabase/client";

// These tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const SECURITY_PROFILES = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
  "HIGHLY_RESTRICTED",
] as const;
export type SecurityProfileCode = (typeof SECURITY_PROFILES)[number];

export const MARK_STATUSES = [
  "issued",
  "valid",
  "superseded",
  "revoked",
  "void",
  "expired",
  "archived",
] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

/** Statuses that end a document's authority rather than merely dating it. */
export const REVOCATION_STATUSES = ["revoked", "void"] as const;

export const FORENSIC_STATES = [
  "VERIFIED",
  "AUTHENTIC",
  "AUTHENTIC_SUPERSEDED",
  "AUTHENTIC_REVOKED",
  "AUTHENTIC_VOID",
  "AUTHENTIC_EXPIRED",
  "AUTHENTIC_ARCHIVED",
  "INCOMPLETE_PROVENANCE",
  "SIGNATURE_INVALID",
  "UNSIGNED",
  "HASH_MISMATCH",
  "INVALID_SECURITY_ID",
  "INVALID_DOCUMENT_ID",
  "UNKNOWN_DOCUMENT",
  /** The verifier could not be reached — authenticity is unknown, never assumed. */
  "VERIFICATION_UNAVAILABLE",
  /** Abuse control tripped: too many failed lookups. */
  "RATE_LIMITED",
] as const;
export type ForensicState = (typeof FORENSIC_STATES)[number];

/** Deterministic control outcome — never a percentage. */
export type ControlStatus = "PASS" | "FAIL" | "WARNING" | "UNAVAILABLE";
export interface ForensicControl {
  label: string;
  status: ControlStatus;
  detail?: string;
}



export interface SecurityMark {
  id: string;
  doc_number: string;
  security_number: string;
  verification_token: string;
  document_id: string | null;
  domain_code: string;
  class_code: string;
  source_system: string;
  origin_ref: string;
  doc_version: number;
  template_code: string | null;
  template_version: string | null;
  template_hash: string | null;
  data_snapshot_hash: string | null;
  document_hash: string | null;
  classification: string;
  profile_code: SecurityProfileCode;
  footer_line: string;
  micro_code: string;
  page_count: number | null;
  status: MarkStatus;
  supersedes_mark_id: string | null;
  superseded_by_mark_id: string | null;
  expires_at: string | null;
  issued_at: string;
  created_at: string;
}

export interface SecurityEvent {
  id: string;
  mark_id: string;
  event_type: string;
  actor_id: string | null;
  detail: Record<string, unknown>;
  prev_chain_hash: string | null;
  chain_hash: string | null;
  created_at: string;
}

export interface Distribution {
  id: string;
  mark_id: string;
  distribution_ref: string;
  recipient_label: string;
  recipient_role: string | null;
  channel: string;
  file_hash: string | null;
  purpose: string | null;
  issued_at: string;
}

export interface SecurityProfile {
  code: SecurityProfileCode;
  label: string;
  watermark_text: string;
  watermark_placement: string;
  watermark_opacity: number;
  seal_enabled: boolean;
  seal_opacity: number;
  qr_enabled: boolean;
  recipient_binding: boolean;
  microtext_enabled: boolean;
  footer_opacity: number;
}

export interface ForensicSignal {
  label: string;
  passed: boolean;
}

export interface TamperReport {
  state: ForensicState;
  signals: ForensicSignal[];
  mark?: {
    id: string;
    doc_number: string;
    security_number: string;
    version: number;
    source_system: string;
    origin_ref: string;
    status: MarkStatus;
    classification: string;
    issued_at: string;
    document_hash: string | null;
    template_hash: string | null;
    data_snapshot_hash: string | null;
    profile_code: SecurityProfileCode;
  };
}

/** The detached Ed25519 signature published with a document's identity. */
export interface DocumentSignature {
  algorithm: string;
  key_id: string;
  signature_b64: string;
  signed_statement: string;
  statement_hash: string;
  signed_at: string;
  public_key_pem: string;
  key_provider?: string;
  key_trusted?: boolean;
  key_status?: string;
}

export interface PublicVerification {
  valid: boolean;
  state: ForensicState;
  doc_number?: string;
  organisation?: string;
  document_class?: string;
  domain?: string;
  version?: number;
  classification?: string;
  issued_at?: string;
  has_document_hash?: boolean;
  document_hash?: string | null;
  superseded?: boolean;
  revoked_at?: string | null;
  signed?: boolean;
  /** True when the document's classification withholds offline signature material. */
  material_withheld?: boolean;
  signature?: DocumentSignature | null;
}

/**
 * The authoritative public verdict, produced by the `document-verify` service.
 * The browser renders this; it never computes authenticity itself.
 */
export interface PublicVerdict {
  state: ForensicState;
  relyable: boolean;
  result?: "FORENSICALLY_VERIFIED" | "NOT_RELYABLE";
  doc_number?: string;
  organisation?: string;
  document_class?: string;
  version?: number;
  issued_at?: string;
  revoked_at?: string | null;
  superseded?: boolean;
  material_withheld?: boolean;
  key_id?: string | null;
  signature_material?: DocumentSignature | null;
  controls: ForensicControl[];
}


/** Result of recomputing the audit hash chain for one document. */
export interface AuditChainVerdict {
  verified: boolean;
  events: number;
  broken_links: number;
  head_hash: string | null;
  first_break: {
    event_id: string;
    event_type: string;
    created_at: string;
    stored_hash: string | null;
    expected_hash: string;
  } | null;
  checked_at: string;
}

/** Server-side cryptographic verification of a recorded signature. */
export interface SignatureVerdict {
  signed: boolean;
  signature_valid: boolean;
  statement_match?: boolean;
  key_id?: string;
  key_status?: string;
  key_trusted?: boolean;
  key_provider?: string;
  algorithm?: string;
  signed_at?: string;
  statement_hash?: string;
  reason?: string;
}

/** One self-contained, hash-manifested forensic evidence bundle. */
export interface EvidencePackage {
  manifest: {
    package_format: string;
    doc_number: string;
    body_sha256: string;
    signature_present: boolean;
    audit_chain_verified: boolean;
    generated_at: string;
  };
  body: Record<string, unknown>;
}


export interface SecurityMetrics {
  documents_generated: number;
  documents_valid: number;
  documents_superseded: number;
  documents_void: number;
  documents_expired: number;
  restricted_documents: number;
  sealed_documents: number;
  integrity_failures: number;
  tamper_checks: number;
  downloads: number;
  security_events: number;
}

/* ------------------------------------------------------------------ reads */

export async function listSecurityMarks(filters: {
  sourceSystem?: string;
  status?: MarkStatus;
  search?: string;
  limit?: number;
} = {}): Promise<SecurityMark[]> {
  let q = db
    .from("doc_security_marks")
    .select("*")
    .order("issued_at", { ascending: false })
    .limit(filters.limit ?? 100);
  if (filters.sourceSystem) q = q.eq("source_system", filters.sourceSystem);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.search?.trim()) {
    const term = filters.search.trim();
    q = q.or(`doc_number.ilike.%${term}%,security_number.ilike.%${term}%,origin_ref.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as SecurityMark[];
}

export async function getSecurityMark(id: string): Promise<SecurityMark | null> {
  const { data, error } = await db.from("doc_security_marks").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SecurityMark) ?? null;
}

/** Every mark issued for one source record, oldest first — the version chain. */
export async function listMarksForOrigin(sourceSystem: string, originRef: string): Promise<SecurityMark[]> {
  const { data, error } = await db
    .from("doc_security_marks")
    .select("*")
    .eq("source_system", sourceSystem.toUpperCase())
    .eq("origin_ref", originRef)
    .order("doc_version", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SecurityMark[];
}

export async function listSecurityEvents(markId: string): Promise<SecurityEvent[]> {
  const { data, error } = await db
    .from("doc_security_events")
    .select("*")
    .eq("mark_id", markId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SecurityEvent[];
}

export async function listDistributions(markId: string): Promise<Distribution[]> {
  const { data, error } = await db
    .from("doc_distributions")
    .select("*")
    .eq("mark_id", markId)
    .order("issued_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Distribution[];
}

export async function listSecurityProfiles(): Promise<SecurityProfile[]> {
  const { data, error } = await db.from("doc_security_profiles").select("*").order("code");
  if (error) throw new Error(error.message);
  return (data ?? []) as SecurityProfile[];
}

export async function securityMetrics(): Promise<SecurityMetrics> {
  const { data, error } = await db.rpc("doc_security_metrics");
  if (error) throw new Error(error.message);
  return data as SecurityMetrics;
}

/* ----------------------------------------------------------------- writes */

export async function issueSecurityMark(input: {
  domain: string;
  classCode: string;
  sourceSystem: string;
  originRef: string;
  classification?: string;
  profileCode?: SecurityProfileCode;
  documentId?: string | null;
  templateCode?: string | null;
  templateVersion?: string | null;
  templateHash?: string | null;
  dataSnapshotHash?: string | null;
  supersedesMarkId?: string | null;
  expiresAt?: string | null;
}): Promise<SecurityMark> {
  const { data, error } = await db.rpc("doc_issue_security_mark", {
    _domain: input.domain,
    _class: input.classCode,
    _source_system: input.sourceSystem,
    _origin_ref: input.originRef,
    _classification: input.classification ?? "INTERNAL",
    _profile_code: input.profileCode ?? "INTERNAL",
    _document_id: input.documentId ?? null,
    _template_code: input.templateCode ?? null,
    _template_version: input.templateVersion ?? null,
    _template_hash: input.templateHash ?? null,
    _data_snapshot_hash: input.dataSnapshotHash ?? null,
    _supersedes_mark_id: input.supersedesMarkId ?? null,
    _expires_at: input.expiresAt ?? null,
  });
  if (error) throw new Error(error.message);
  return data as SecurityMark;
}

export async function sealDocumentHash(markId: string, documentHash: string, pageCount?: number): Promise<SecurityMark> {
  const { data, error } = await db.rpc("doc_seal_document_hash", {
    _mark_id: markId,
    _document_hash: documentHash,
    _page_count: pageCount ?? null,
  });
  if (error) throw new Error(error.message);
  return data as SecurityMark;
}

export async function setMarkStatus(
  markId: string,
  status: "revoked" | "void" | "expired" | "archived" | "valid",
  reason?: string,
): Promise<SecurityMark> {
  if ((status === "revoked" || status === "void") && !reason?.trim()) {
    throw new Error("A written reason is required to withdraw a document's authority.");
  }

  const { data, error } = await db.rpc("doc_set_mark_status", {
    _mark_id: markId,
    _status: status,
    _reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data as SecurityMark;
}

export async function registerDistribution(input: {
  markId: string;
  recipientLabel: string;
  recipientRole?: string | null;
  channel?: string;
  purpose?: string | null;
  fileHash?: string | null;
}): Promise<Distribution> {
  const { data, error } = await db.rpc("doc_register_distribution", {
    _mark_id: input.markId,
    _recipient_label: input.recipientLabel,
    _recipient_role: input.recipientRole ?? null,
    _channel: input.channel ?? "download",
    _purpose: input.purpose ?? null,
    _file_hash: input.fileHash ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Distribution;
}

export async function tamperCheck(input: {
  docNumber: string;
  securityNumber?: string | null;
  version?: number | null;
  documentHash?: string | null;
}): Promise<TamperReport> {
  const { data, error } = await db.rpc("doc_tamper_check", {
    _doc_number: input.docNumber,
    _security_number: input.securityNumber ?? null,
    _version: input.version ?? null,
    _document_hash: input.documentHash ?? null,
  });
  if (error) throw new Error(error.message);
  return data as TamperReport;
}

/** Raw registry lookup — state only, never document content. */
export async function verifyDocumentPublic(docNumber: string, token: string): Promise<PublicVerification> {
  const { data, error } = await db.rpc("doc_verify_public", {
    _doc_number: docNumber,
    _token: token,
  });
  if (error) throw new Error(error.message);
  return data as PublicVerification;
}

/**
 * Authoritative public verification. The `document-verify` service resolves the
 * registry entry AND verifies the Ed25519 signature server-side; the browser
 * only renders the verdict. If the service cannot be reached the result is
 * VERIFICATION_UNAVAILABLE — an unknown is never converted into "authentic".
 */
export async function verifyDocumentAuthoritative(
  docNumber: string,
  token: string,
): Promise<PublicVerdict> {
  const unavailable = (detail: string): PublicVerdict => ({
    state: "VERIFICATION_UNAVAILABLE",
    relyable: false,
    controls: [{ label: "Verification service", status: "UNAVAILABLE", detail }],
  });

  try {
    const { data, error } = await supabase.functions.invoke("document-verify", {
      body: { doc_number: docNumber, token },
    });
    if (error) return unavailable(error.message);
    const payload = (data as { data?: PublicVerdict } | PublicVerdict) ?? {};
    const verdict = ("data" in payload ? payload.data : payload) as PublicVerdict | undefined;
    if (!verdict?.state || !Array.isArray(verdict.controls)) {
      return unavailable("The verification service returned an unusable response");
    }
    return verdict;
  } catch (e) {
    return unavailable((e as Error).message);
  }
}


/* --------------------------------------------------- cryptographic authority */

/**
 * Signs a document's canonical identity statement. The statement is derived
 * server-side from the sealed registry row, and the private key never leaves
 * the signing service — the client only names the document.
 */
export async function signDocument(markId: string): Promise<SignatureVerdict> {
  const { data, error } = await supabase.functions.invoke("document-signing", {
    body: { action: "sign", mark_id: markId },
  });
  if (error) throw new Error(error.message);
  const payload = (data as { data?: SignatureVerdict } | SignatureVerdict) ?? {};
  return ("data" in payload ? payload.data : payload) as SignatureVerdict;
}

/** Recomputes the statement and verifies the stored signature against the registry key. */
export async function verifyDocumentSignature(markId: string): Promise<SignatureVerdict> {
  const { data, error } = await supabase.functions.invoke("document-signing", {
    body: { action: "verify", mark_id: markId },
  });
  if (error) throw new Error(error.message);
  const payload = (data as { data?: SignatureVerdict } | SignatureVerdict) ?? {};
  return ("data" in payload ? payload.data : payload) as SignatureVerdict;
}

/** Replays the append-only event log and proves no link was rewritten or removed. */
export async function verifyAuditChain(markId: string): Promise<AuditChainVerdict> {
  const { data, error } = await db.rpc("doc_audit_chain_verify", { _mark_id: markId });
  if (error) throw new Error(error.message);
  return data as AuditChainVerdict;
}

/** Builds the forensic evidence package: identity, provenance, signature, custody, audit. */
export async function evidencePackage(markId: string): Promise<EvidencePackage> {
  const { data, error } = await db.rpc("doc_evidence_package", { _mark_id: markId });
  if (error) throw new Error(error.message);
  return data as EvidencePackage;
}

export interface CertifiedEvidencePackage {
  manifest: Record<string, unknown> & { body_sha256: string; proof_sha256: string };
  manifest_sha256: string;
  proof: {
    verdict: string;
    signature: "VERIFIED" | "INVALID" | "UNSIGNED" | "UNAVAILABLE";
    audit_chain: "VERIFIED" | "BROKEN" | "UNAVAILABLE";
    key_fingerprint: string | null;
    generated_at: string;
    document_status: string;
  };
  body: Record<string, unknown>;
}

/**
 * Manifest-hashed evidence package with a backend-generated verification proof:
 * the authority re-verifies the signature and audit chain at export time and
 * states its own verdict inside the package. Every export is audit-logged.
 */
export async function certifiedEvidencePackage(markId: string): Promise<CertifiedEvidencePackage> {
  const { data, error } = await supabase.functions.invoke("document-evidence", {
    body: { mark_id: markId },
  });
  if (error) throw new Error(error.message);
  const payload = (data as { data?: CertifiedEvidencePackage } | CertifiedEvidencePackage) ?? {};
  const pkg = ("data" in payload ? payload.data : payload) as CertifiedEvidencePackage | undefined;
  if (!pkg?.manifest_sha256) throw new Error("The evidence service returned an unusable package");
  return pkg;
}


/** The canonical statement the authority signs — useful for offline verification. */
export async function signingStatement(markId: string): Promise<string | null> {
  const { data, error } = await db.rpc("doc_signing_statement", { _mark_id: markId });
  if (error) throw new Error(error.message);
  return (data as string) ?? null;
}

/* --------------------------------------------------------- pure forensics */

/** SHA-256 of the rendered artefact — the hash printed and registered. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Human-readable control line printed on every page of the document. */
export function controlLine(mark: Pick<SecurityMark,
  "doc_number" | "security_number" | "doc_version" | "source_system" | "origin_ref">,
  recipientLabel?: string | null,
): string {
  const parts = [
    "YALLA MOBILITY",
    "OFFICIAL CONTROLLED DOCUMENT",
    `DOC: ${mark.doc_number}`,
    `SRC: ${mark.source_system}`,
    `ORG: ${mark.origin_ref}`,
    `V${String(mark.doc_version).padStart(2, "0")}`,
    `SEC: ${mark.security_number}`,
  ];
  if (recipientLabel) parts.push(`COPY: ${recipientLabel}`);
  return parts.join(" | ");
}

/** The forensic verdict a human should act on. */
export function forensicVerdict(state: ForensicState): {
  label: string;
  tone: "success" | "warning" | "destructive" | "muted";
  advice: string;
} {
  switch (state) {
    case "VERIFIED":
    case "AUTHENTIC":
      return {
        label: "Authentic",
        tone: "success",
        advice: "Registered in the Yalla Mobility document registry with complete provenance.",
      };
    case "AUTHENTIC_SUPERSEDED":
      return {
        label: "Authentic — superseded",
        tone: "warning",
        advice: "Genuine, but a newer version of this document has been issued. Request the current version.",
      };
    case "AUTHENTIC_EXPIRED":
      return {
        label: "Authentic — expired",
        tone: "warning",
        advice: "Genuine, but past its validity date. It should not be relied upon.",
      };
    case "AUTHENTIC_REVOKED":
      return {
        label: "Authentic — revoked",
        tone: "destructive",
        advice: "Yalla Mobility revoked this document. It is genuine but carries no authority and must not be acted on.",
      };
    case "AUTHENTIC_VOID":
      return {
        label: "Authentic — withdrawn",
        tone: "destructive",
        advice: "This document was withdrawn by Yalla Mobility and carries no authority.",
      };
    case "AUTHENTIC_ARCHIVED":
      return {
        label: "Authentic — archived",
        tone: "warning",
        advice: "Genuine and retained for record, but no longer an operative document.",
      };
    case "SIGNATURE_INVALID":
      return {
        label: "Signature invalid",
        tone: "destructive",
        advice: "The cryptographic signature does not verify against the Yalla Mobility authority key. Treat as forged.",
      };
    case "UNSIGNED":
      return {
        label: "Not cryptographically signed",
        tone: "warning",
        advice: "Registered, but no authority signature was issued — confirm with the issuing team before relying on it.",
      };
    case "INCOMPLETE_PROVENANCE":
      return {
        label: "Incomplete provenance",
        tone: "warning",
        advice: "The registry entry exists but lacks a full template or data lineage — escalate before relying on it.",
      };

    case "HASH_MISMATCH":
      return {
        label: "Content altered",
        tone: "destructive",
        advice: "The document number is genuine but the file content does not match the sealed hash.",
      };
    case "INVALID_SECURITY_ID":
      return {
        label: "Security number mismatch",
        tone: "destructive",
        advice: "The printed security number does not belong to this document number.",
      };
    default:
      return {
        label: "Not a Yalla Mobility document",
        tone: "destructive",
        advice: "No document with this identity was ever issued. Treat it as fraudulent.",
      };
  }
}

/** Weighted integrity confidence (0–100) over the signal set. */
export function integrityConfidence(signals: ForensicSignal[]): number {
  if (!signals.length) return 0;
  const passed = signals.filter((s) => s.passed).length;
  return Math.round((passed / signals.length) * 100);
}

export function markStatusTone(status: MarkStatus): "success" | "warning" | "destructive" | "muted" {
  if (status === "valid" || status === "issued") return "success";
  if (status === "superseded" || status === "expired" || status === "archived") return "warning";
  if (status === "void" || status === "revoked") return "destructive";
  return "muted";
}

/** True when the status ends the document's authority rather than dating it. */
export function isRevoked(status: MarkStatus): boolean {
  return (REVOCATION_STATUSES as readonly string[]).includes(status);
}

export interface AuthorityAssurance {
  /** The single state a human should act on, worst-first. */
  state: ForensicState;
  /** Deterministic control outcomes — PASS / FAIL / WARNING / UNAVAILABLE. */
  controls: ForensicControl[];
  /** Legacy pillar view (boolean per control) retained for compact displays. */
  pillars: Array<{ label: string; passed: boolean; detail?: string }>;
  /** The verdict a reviewer may act on. Never a percentage. */
  result: "FORENSICALLY_VERIFIED" | "NOT_RELYABLE" | "VERIFICATION_UNAVAILABLE";
  relyable: boolean;
}

/**
 * Combines the four independent proofs into one verdict:
 * registry identity, content integrity, cryptographic authenticity and audit
 * continuity. A failure in any of the hard proofs overrides a benign state —
 * a forged signature is never reported as "authentic", and a proof that could
 * not be obtained is reported as UNAVAILABLE rather than assumed to pass.
 */
export function authorityAssurance(input: {
  state: ForensicState;
  provenanceComplete?: boolean;
  signature?: SignatureVerdict | null;
  chain?: AuditChainVerdict | null;
  /** Set when a backend proof could not be reached at all. */
  unavailable?: { signature?: boolean; chain?: boolean };
}): AuthorityAssurance {
  const sig = input.signature;
  const chain = input.chain;

  const identityKnown = input.state !== "UNKNOWN_DOCUMENT"
    && input.state !== "INVALID_DOCUMENT_ID"
    && input.state !== "INVALID_SECURITY_ID"
    && input.state !== "VERIFICATION_UNAVAILABLE"
    && input.state !== "RATE_LIMITED";
  const integrityIntact = identityKnown && input.state !== "HASH_MISMATCH";
  const signatureValid = Boolean(sig?.signed && sig?.signature_valid);
  const chainIntact = chain ? chain.verified : false;

  const sigUnavailable = Boolean(input.unavailable?.signature)
    || input.state === "VERIFICATION_UNAVAILABLE";
  const chainUnavailable = Boolean(input.unavailable?.chain);

  const controls: ForensicControl[] = [
    {
      label: "Registry identity",
      status: input.state === "VERIFICATION_UNAVAILABLE" || input.state === "RATE_LIMITED"
        ? "UNAVAILABLE"
        : identityKnown ? "PASS" : "FAIL",
      detail: "Document and security number issued by Yalla Mobility",
    },
    {
      label: "Content integrity",
      status: identityKnown ? (integrityIntact ? "PASS" : "FAIL") : "UNAVAILABLE",
      detail: "File content matches the sealed hash",
    },
    {
      label: "Cryptographic authenticity",
      status: sigUnavailable ? "UNAVAILABLE" : signatureValid ? "PASS" : sig?.signed ? "FAIL" : "WARNING",
      detail: sigUnavailable
        ? "Signature service unreachable — authenticity unknown"
        : sig?.signed
          ? sig?.reason ?? `Ed25519 signature by ${sig?.key_id ?? "authority key"}`
          : "No authority signature recorded",
    },
    {
      label: "Audit continuity",
      status: chainUnavailable || !chain ? "UNAVAILABLE" : chainIntact ? "PASS" : "FAIL",
      detail: chain
        ? chain.verified
          ? `${chain.events} events, unbroken chain`
          : `${chain.broken_links} broken link(s) detected`
        : "Chain not verified",
    },
    {
      label: "Provenance lineage",
      status: input.provenanceComplete === undefined
        ? "UNAVAILABLE"
        : input.provenanceComplete ? "PASS" : "FAIL",
      detail: "Source → origin → template → snapshot → artefact",
    },
  ];

  let state = input.state;
  if (identityKnown && integrityIntact) {
    if (sig?.signed && !sig.signature_valid) state = "SIGNATURE_INVALID";
    else if (sig && !sig.signed && state === "AUTHENTIC") state = "UNSIGNED";
    else if (input.provenanceComplete === false && state === "AUTHENTIC") state = "INCOMPLETE_PROVENANCE";
  }

  const relyable = controls.every((c) => c.status === "PASS")
    && (state === "AUTHENTIC" || state === "VERIFIED");
  const anyUnavailable = controls.some((c) => c.status === "UNAVAILABLE");
  const result: AuthorityAssurance["result"] = relyable
    ? "FORENSICALLY_VERIFIED"
    : anyUnavailable && !controls.some((c) => c.status === "FAIL")
      ? "VERIFICATION_UNAVAILABLE"
      : "NOT_RELYABLE";

  return {
    state,
    controls,
    pillars: controls.map((c) => ({ label: c.label, passed: c.status === "PASS", detail: c.detail })),
    result,
    relyable,
  };
}



/** Titleises the SCREAMING_SNAKE codes used across the forensic layer. */
export function titleiseCode(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Provenance completeness: the chain a document must be able to prove —
 * source → origin record → template → data snapshot → rendered artefact.
 */
export function provenanceChain(mark: SecurityMark): Array<{ label: string; value: string | null; complete: boolean }> {
  return [
    { label: "Source system", value: mark.source_system, complete: Boolean(mark.source_system) },
    { label: "Origin record", value: mark.origin_ref, complete: Boolean(mark.origin_ref) },
    {
      label: "Template",
      value: mark.template_code ? `${mark.template_code} ${mark.template_version ?? ""}`.trim() : null,
      complete: Boolean(mark.template_hash),
    },
    { label: "Data snapshot", value: mark.data_snapshot_hash, complete: Boolean(mark.data_snapshot_hash) },
    { label: "Rendered artefact", value: mark.document_hash, complete: Boolean(mark.document_hash) },
  ];
}

export function provenanceComplete(mark: SecurityMark): boolean {
  return provenanceChain(mark).every((step) => step.complete);
}
