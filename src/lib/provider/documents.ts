/**
 * OPERATOR DOCUMENTS — compliance evidence before any listing goes live.
 *
 * An operator uploads their own documents into their own folder of the private
 * `provider-documents` store and records them against their account. Our team
 * verifies each one. A listing is only published once an in-date operating
 * licence, insurance certificate and vehicle inspection are verified.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const PROVIDER_DOC_BUCKET = "provider-documents";
const MAX_BYTES = 15 * 1024 * 1024;
const SIGNED_URL_TTL = 60 * 60;

const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export type ProviderDocKind =
  | "OPERATING_LICENCE"
  | "INSURANCE"
  | "VEHICLE_INSPECTION"
  | "IDENTIFICATION"
  | "TAX_COMPLIANCE";

export type ProviderDocStatus = "SUBMITTED" | "VERIFIED" | "REJECTED" | "SUPERSEDED";

/** Documents that must be verified and in date before a listing can be published. */
export const MANDATORY_DOC_KINDS: ProviderDocKind[] = [
  "OPERATING_LICENCE",
  "INSURANCE",
  "VEHICLE_INSPECTION",
];

export const DOC_KIND_LABEL: Record<ProviderDocKind, string> = {
  OPERATING_LICENCE: "Operating licence",
  INSURANCE: "Insurance certificate",
  VEHICLE_INSPECTION: "Vehicle inspection certificate",
  IDENTIFICATION: "Identification",
  TAX_COMPLIANCE: "Tax compliance certificate",
};

export const DOC_STATUS_LABEL: Record<ProviderDocStatus, string> = {
  SUBMITTED: "Awaiting review",
  VERIFIED: "Verified",
  REJECTED: "Not accepted",
  SUPERSEDED: "Replaced",
};

export interface ProviderDocumentRow {
  id: string;
  provider_user_id: string;
  doc_kind: ProviderDocKind;
  title: string | null;
  reference_no: string | null;
  expires_on: string | null;
  object_path: string;
  file_name: string | null;
  status: ProviderDocStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export const DOC_REFUSAL: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Please sign in first.",
  DOCUMENT_TOO_LARGE: "That file is larger than 15 MB. Please upload a smaller one.",
  DOCUMENT_TYPE_UNSUPPORTED: "Please upload a PDF, JPEG, PNG or WebP file.",
  DOCUMENT_REVIEW_NOT_PERMITTED: "You do not have authority to verify documents.",
  REJECTION_REASON_REQUIRED: "Please say why the document was not accepted.",
  DOCUMENT_NOT_FOUND: "That document is no longer on file.",
};

export function explainDocRefusal(message: string): string {
  if (message.includes("PROVIDER_DOCUMENTS_REQUIRED")) {
    const missing = message.split(":")[1]?.trim() ?? "";
    const names = missing
      .split(",")
      .map((k) => DOC_KIND_LABEL[k.trim() as ProviderDocKind] ?? k.trim())
      .filter(Boolean)
      .join(", ");
    return `This listing cannot go live yet. We still need a verified, in-date ${names || "operator document"}.`;
  }
  return DOC_REFUSAL[message] ?? message;
}

/** Documents on file for the signed-in operator, newest first. */
export async function loadMyDocuments(): Promise<ProviderDocumentRow[]> {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) return [];
  const { data, error } = await db
    .from("provider_documents")
    .select("id,provider_user_id,doc_kind,title,reference_no,expires_on,object_path,file_name,status,review_note,reviewed_at,created_at")
    .eq("provider_user_id", uid)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProviderDocumentRow[];
}

/** Uploads one document file and records it against the operator's account. */
export async function uploadProviderDocument(input: {
  kind: ProviderDocKind;
  file: File;
  referenceNo?: string;
  expiresOn?: string;
}): Promise<ProviderDocumentRow> {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) throw new Error("AUTHENTICATION_REQUIRED");
  if (input.file.size > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
  if (!ALLOWED.includes(input.file.type)) throw new Error("DOCUMENT_TYPE_UNSUPPORTED");

  const safeName = input.file.name.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${uid}/${input.kind}/${crypto.randomUUID()}-${safeName}`;
  const up = await supabase.storage
    .from(PROVIDER_DOC_BUCKET)
    .upload(path, input.file, { contentType: input.file.type, upsert: false });
  if (up.error) throw new Error(up.error.message);

  // Any earlier document of the same kind is replaced by this one.
  await db
    .from("provider_documents")
    .update({ status: "SUPERSEDED" })
    .eq("provider_user_id", uid)
    .eq("doc_kind", input.kind)
    .in("status", ["SUBMITTED", "REJECTED"]);

  const { data, error } = await db
    .from("provider_documents")
    .insert({
      provider_user_id: uid,
      doc_kind: input.kind,
      reference_no: input.referenceNo?.trim() || null,
      expires_on: input.expiresOn || null,
      object_path: path,
      file_name: input.file.name,
      mime_type: input.file.type,
      size_bytes: input.file.size,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ProviderDocumentRow;
}

/** Short-lived link to read a stored document. */
export async function signProviderDocument(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(PROVIDER_DOC_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Staff decision on a submitted document. */
export async function decideProviderDocument(
  documentId: string,
  decision: "VERIFIED" | "REJECTED",
  note?: string,
) {
  const { data, error } = await db.rpc("provider_document_decide", {
    _document_id: documentId,
    _decision: decision,
    _note: note ?? null,
  });
  if (error) throw new Error(explainDocRefusal(error.message));
  return data as { id: string; status: ProviderDocStatus };
}

/** Which mandatory documents are still missing or not yet verified. */
export function missingMandatory(rows: ProviderDocumentRow[]): ProviderDocKind[] {
  const today = new Date().toISOString().slice(0, 10);
  return MANDATORY_DOC_KINDS.filter(
    (kind) =>
      !rows.some(
        (r) =>
          r.doc_kind === kind &&
          r.status === "VERIFIED" &&
          (!r.expires_on || r.expires_on >= today),
      ),
  );
}
