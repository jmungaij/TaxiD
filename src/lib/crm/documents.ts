/**
 * Document OS — canonical document identity, immutable versions, approvals and
 * external shares.
 *
 * Rules enforced by the database, mirrored here so the UI never invents state:
 *   version create  → crm_create_document_version  (only writer of versions)
 *   approve/reject  → crm_decide_document_version   (mandatory rationale)
 *   external share  → crm_share_document_version    (approved documents only)
 *
 * Files live in the private `crm-documents` storage bucket; nothing is served
 * publicly — downloads always go through a short-lived signed URL.
 */
import { supabase } from "@/integrations/supabase/client";

// The document tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const DOC_CLASSES = ["master", "customer_instance"] as const;
export type DocClass = (typeof DOC_CLASSES)[number];

export const DOC_TYPES = [
  "proposal",
  "contract",
  "rate_card",
  "nda",
  "sow",
  "invoice_pack",
  "policy",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_INTERNAL_STATES = [
  "draft",
  "internal_review",
  "approval_pending",
  "approved",
  "active",
  "superseded",
  "archived",
] as const;
export type DocInternalState = (typeof DOC_INTERNAL_STATES)[number];

export const DOC_EXTERNAL_STATES = [
  "draft",
  "approved",
  "shared",
  "customer_review",
  "customer_revision_requested",
  "revised",
  "accepted",
  "executed",
] as const;
export type DocExternalState = (typeof DOC_EXTERNAL_STATES)[number];

export const DOC_VERBS = [
  "view",
  "download",
  "use_template",
  "create_version",
  "edit",
  "submit",
  "approve",
  "share",
  "archive",
] as const;
export type DocVerb = (typeof DOC_VERBS)[number];

export const DOCUMENTS_BUCKET = "crm-documents";

export interface CrmDocument {
  id: string;
  doc_class: DocClass;
  doc_type: string;
  title: string;
  description: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  parent_document_id: string | null;
  owner_staff_id: string | null;
  internal_state: DocInternalState;
  external_state: DocExternalState | null;
  current_version_id: string | null;
  confidentiality: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface CrmDocumentVersion {
  id: string;
  document_id: string;
  version_label: string;
  version_seq: number;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  change_note: string | null;
  authored_staff_id: string | null;
  approval_state: string;
  created_at: string;
}

export interface CrmDocumentApproval {
  id: string;
  version_id: string;
  decision: "approved" | "rejected";
  rationale: string;
  decided_staff_id: string | null;
  created_at: string;
}

export interface CrmDocumentShare {
  id: string;
  version_id: string;
  contact_id: string | null;
  channel: string;
  recipient_email: string | null;
  note: string | null;
  shared_at: string;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

/* ------------------------------- documents ------------------------------- */

export interface DocumentFilters {
  docClass?: DocClass;
  accountId?: string;
  opportunityId?: string;
}

export async function listDocuments(filters: DocumentFilters = {}): Promise<CrmDocument[]> {
  let q = db.from("crm_documents").select("*").order("updated_at", { ascending: false });
  if (filters.docClass) q = q.eq("doc_class", filters.docClass);
  if (filters.accountId) q = q.eq("account_id", filters.accountId);
  if (filters.opportunityId) q = q.eq("opportunity_id", filters.opportunityId);
  return unwrap<CrmDocument[]>(await q);
}

export type NewDocument = {
  docClass: DocClass;
  docType: string;
  title: string;
  description?: string | null;
  accountId?: string | null;
  opportunityId?: string | null;
  parentDocumentId?: string | null;
  ownerStaffId?: string | null;
  confidentiality?: string;
  tags?: string[];
};

export async function createDocument(input: NewDocument): Promise<CrmDocument> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await db
    .from("crm_documents")
    .insert({
      doc_class: input.docClass,
      doc_type: input.docType,
      title: input.title,
      description: input.description ?? null,
      account_id: input.accountId ?? null,
      opportunity_id: input.opportunityId ?? null,
      parent_document_id: input.parentDocumentId ?? null,
      owner_staff_id: input.ownerStaffId ?? null,
      confidentiality: input.confidentiality ?? "internal",
      tags: input.tags ?? [],
      external_state: input.docClass === "customer_instance" ? "draft" : null,
      created_by: auth?.user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CrmDocument;
}

/** Spawns a customer instance from a master template, preserving lineage. */
export async function instantiateTemplate(input: {
  masterId: string;
  accountId: string;
  opportunityId?: string | null;
  title: string;
  ownerStaffId?: string | null;
}): Promise<CrmDocument> {
  const master = await getDocument(input.masterId);
  if (!master) throw new Error("Master template not found");
  if (master.doc_class !== "master") throw new Error("Only master templates can be instantiated");
  return createDocument({
    docClass: "customer_instance",
    docType: master.doc_type,
    title: input.title,
    description: master.description,
    accountId: input.accountId,
    opportunityId: input.opportunityId ?? null,
    parentDocumentId: master.id,
    ownerStaffId: input.ownerStaffId ?? null,
    confidentiality: master.confidentiality,
    tags: master.tags,
  });
}

export async function getDocument(id: string): Promise<CrmDocument | null> {
  const { data, error } = await db.from("crm_documents").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CrmDocument) ?? null;
}

export async function archiveDocument(id: string): Promise<void> {
  const { error } = await db.from("crm_documents").update({ internal_state: "archived" }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setInternalState(id: string, state: DocInternalState): Promise<void> {
  const { error } = await db.from("crm_documents").update({ internal_state: state }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setExternalState(id: string, state: DocExternalState): Promise<void> {
  const { error } = await db.from("crm_documents").update({ external_state: state }).eq("id", id);
  if (error) throw new Error(error.message);
}

/* -------------------------------- versions ------------------------------- */

export async function listVersions(documentId: string): Promise<CrmDocumentVersion[]> {
  return unwrap<CrmDocumentVersion[]>(
    await db
      .from("crm_document_versions")
      .select("*")
      .eq("document_id", documentId)
      .order("version_seq", { ascending: false }),
  );
}

export async function uploadVersionFile(documentId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${documentId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Only writer of versions — the RPC assigns the sequence and emits the event. */
export async function createVersion(input: {
  documentId: string;
  file?: File | null;
  changeNote?: string | null;
}): Promise<string> {
  let storagePath: string | null = null;
  if (input.file) storagePath = await uploadVersionFile(input.documentId, input.file);

  const { data, error } = await db.rpc("crm_create_document_version", {
    _document_id: input.documentId,
    _storage_path: storagePath,
    _file_name: input.file?.name ?? null,
    _mime_type: input.file?.type ?? null,
    _byte_size: input.file?.size ?? null,
    _change_note: input.changeNote ?? null,
    _checksum: null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function signedDownloadUrl(storagePath: string, expiresInSeconds = 120): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* ------------------------------- approvals ------------------------------- */

export async function listApprovals(documentId: string): Promise<(CrmDocumentApproval & { version?: { version_label: string } })[]> {
  const versions = await listVersions(documentId);
  if (versions.length === 0) return [];
  return unwrap<(CrmDocumentApproval & { version?: { version_label: string } })[]>(
    await db
      .from("crm_document_approvals")
      .select("*, version:crm_document_versions(version_label)")
      .in("version_id", versions.map((v) => v.id))
      .order("created_at", { ascending: false }),
  );
}

export async function decideVersion(input: {
  versionId: string;
  decision: "approved" | "rejected";
  rationale: string;
}): Promise<string> {
  if (input.rationale.trim().length < 5) throw new Error("A rationale of at least 5 characters is required");
  const { data, error } = await db.rpc("crm_decide_document_version", {
    _version_id: input.versionId,
    _decision: input.decision,
    _rationale: input.rationale.trim(),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/* --------------------------------- shares -------------------------------- */

export async function listShares(documentId: string): Promise<(CrmDocumentShare & { version?: { version_label: string } })[]> {
  const versions = await listVersions(documentId);
  if (versions.length === 0) return [];
  return unwrap<(CrmDocumentShare & { version?: { version_label: string } })[]>(
    await db
      .from("crm_document_shares")
      .select("*, version:crm_document_versions(version_label)")
      .in("version_id", versions.map((v) => v.id))
      .order("shared_at", { ascending: false }),
  );
}

export async function shareVersion(input: {
  versionId: string;
  contactId?: string | null;
  channel?: string;
  recipientEmail?: string | null;
  note?: string | null;
}): Promise<string> {
  const { data, error } = await db.rpc("crm_share_document_version", {
    _version_id: input.versionId,
    _contact_id: input.contactId ?? null,
    _channel: input.channel ?? "email",
    _recipient_email: input.recipientEmail ?? null,
    _note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/* -------------------------------- authority ------------------------------ */

export async function documentAuthority(documentId: string, verb: DocVerb): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) return false;
  const { data, error } = await db.rpc("crm_document_authority", {
    _user_id: auth.user.id,
    _document_id: documentId,
    _verb: verb,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/* -------------------------- pure lifecycle logic ------------------------- */

/** Governance rule: only an approved (or active) document may leave the building. */
export function canShareExternally(doc: Pick<CrmDocument, "internal_state">): boolean {
  return doc.internal_state === "approved" || doc.internal_state === "active";
}

/**
 * Authority is business-level, not ownership-level: owning the commercial
 * relationship never grants edit/approve on a master template.
 */
export function defaultVerbsForOpportunityOwner(docClass: DocClass): DocVerb[] {
  if (docClass === "master") return ["view", "download", "use_template"];
  return ["view", "download", "use_template", "create_version", "share", "submit"];
}

export function nextVersionLabel(versions: Pick<CrmDocumentVersion, "version_seq">[]): string {
  const max = versions.reduce((m, v) => Math.max(m, v.version_seq), 0);
  return `v${max + 1}.0`;
}

export function documentStateTone(state: DocInternalState): "neutral" | "warning" | "success" | "muted" {
  if (state === "approved" || state === "active") return "success";
  if (state === "internal_review" || state === "approval_pending") return "warning";
  if (state === "archived" || state === "superseded") return "muted";
  return "neutral";
}

export function titleiseDoc(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
