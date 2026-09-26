/**
 * ORGANISATION ONBOARDING FOR THE CORPORATE SALES DESK
 *
 * A specialist records the organisation they are selling to once, then keeps its
 * documents up to date for the whole of the sales conversation. Every write goes
 * through a database function that decides authority and keeps earlier versions
 * of a document intact, so nothing is overwritten and nothing is invented.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

// These functions are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const ORG_BUCKET = "crm-documents";

export const ORG_DOC_TYPES = [
  "cr12",
  "kra_pin",
  "certificate_of_registration",
  "tax_compliance",
  "rate_card",
  "proforma_invoice",
  "service_contract",
  "signed_contract",
  "other",
] as const;
export type OrgDocType = (typeof ORG_DOC_TYPES)[number];

export const ORG_DOC_LABEL: Record<OrgDocType, string> = {
  cr12: "CR12 / official search",
  kra_pin: "KRA PIN certificate",
  certificate_of_registration: "Certificate of registration",
  tax_compliance: "Tax compliance certificate",
  rate_card: "Rate card shared",
  proforma_invoice: "Proforma invoice",
  service_contract: "Mobility Service Contract shared",
  signed_contract: "Signed contract returned",
  other: "Other document",
};

/** The documents a corporate organisation is normally expected to provide. */
export const ORG_DOC_CHECKLIST: OrgDocType[] = [
  "cr12",
  "kra_pin",
  "certificate_of_registration",
  "tax_compliance",
  "rate_card",
  "proforma_invoice",
  "service_contract",
  "signed_contract",
];

export interface OrgAccount {
  id: string;
  name: string;
  account_ref: string;
  legal_name: string | null;
  registration_number: string | null;
  tax_identifier: string | null
  industry: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  lifecycle_stage: string;
  owner_staff_id: string | null;
}

export interface OrgDocument {
  document_id: string;
  doc_type: string;
  title: string;
  internal_state: string;
  external_state: string | null;
  updated_at: string;
  version_label: string | null;
  version_seq: number | null;
  storage_path: string | null;
  file_name: string | null;
  uploaded_at: string | null;
  uploaded_by: string | null;
  versions: number;
}

export interface OrgOverview {
  account: OrgAccount | null;
  documents: OrgDocument[];
}

export interface OrgDetailsInput {
  leadId?: string | null;
  accountId?: string | null;
  name: string;
  legalName?: string;
  registrationNumber?: string;
  taxIdentifier?: string;
  industry?: string;
  city?: string;
  phone?: string;
  website?: string;
  notes?: string;
}

export async function loadOrgOverview(params: {
  leadId?: string | null;
  accountId?: string | null;
}): Promise<OrgOverview> {
  const { data, error } = await db.rpc("sales_org_overview", {
    p: { lead_id: params.leadId ?? null, account_id: params.accountId ?? null } as unknown as Json,
  });
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as OrgOverview;
  return { account: payload.account ?? null, documents: payload.documents ?? [] };
}

export async function saveOrganisation(input: OrgDetailsInput): Promise<string> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Enter the organisation's name.");
  const { data, error } = await db.rpc("sales_org_upsert", {
    p: {
      lead_id: input.leadId ?? null,
      account_id: input.accountId ?? null,
      name,
      legal_name: input.legalName?.trim() ?? "",
      registration_number: input.registrationNumber?.trim() ?? "",
      tax_identifier: input.taxIdentifier?.trim() ?? "",
      industry: input.industry?.trim() ?? "",
      city: input.city?.trim() ?? "",
      phone: input.phone?.trim() ?? "",
      website: input.website?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return (data as { account_id: string }).account_id;
}

const ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/** Uploads the file, then registers it as the newest version of that document. */
export async function uploadOrgDocument(input: {
  accountId: string;
  docType: OrgDocType;
  file: File;
  title?: string;
  changeNote?: string;
  sharedWithCustomer?: boolean;
}): Promise<void> {
  if (input.file.size > 25 * 1024 * 1024) throw new Error("The file must be 25 MB or smaller.");
  if (input.file.type && !ALLOWED_MIME.includes(input.file.type)) {
    throw new Error("Only PDF, Word or image files can be filed here.");
  }
  const safe = input.file.name.replace(/[^\w.-]+/g, "_");
  const path = `organisation/${input.accountId}/${input.docType}/${Date.now()}-${safe}`;
  const up = await supabase.storage.from(ORG_BUCKET).upload(path, input.file, { upsert: false });
  if (up.error) throw new Error(up.error.message);

  const { error } = await db.rpc("sales_org_document_register", {
    p: {
      account_id: input.accountId,
      doc_type: input.docType,
      title: input.title?.trim() || ORG_DOC_LABEL[input.docType],
      storage_path: path,
      file_name: input.file.name,
      mime_type: input.file.type || null,
      byte_size: input.file.size,
      change_note: input.changeNote?.trim() ?? "",
      shared_with_customer: input.sharedWithCustomer ?? false,
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

export async function orgDocumentUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(ORG_BUCKET).createSignedUrl(storagePath, 120);
  if (error) return null;
  return data.signedUrl;
}

/** What is still outstanding — stated plainly, never inferred as complete. */
export function outstandingDocuments(documents: OrgDocument[]): OrgDocType[] {
  const held = new Set(documents.map((d) => d.doc_type));
  return ORG_DOC_CHECKLIST.filter((t) => !held.has(t));
}
