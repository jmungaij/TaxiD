/**
 * DRIVER APPLICATIONS — client API.
 *
 * Intake, document evidence, status lookup and staff decisions all execute in
 * the authoritative database functions. This module never decides an outcome:
 * approval, document verification and the mandatory-document gate live in
 * `driver_application_*` SQL functions.
 */
import { supabase } from "@/integrations/supabase/client";

export type DriverApplicationStatus =
  | "SUBMITTED" | "UNDER_REVIEW" | "INFO_REQUESTED" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export type DriverDocumentState =
  | "MISSING" | "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "EXPIRED";

export interface DriverApplicationRow {
  id: string;
  application_reference: string;
  status: DriverApplicationStatus;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string | null;
  date_of_birth: string | null;
  national_id: string;
  kra_pin: string | null;
  contact_email: string;
  contact_phone: string;
  county: string | null;
  town: string | null;
  country: string;
  driver_type: string;
  licence_number: string;
  licence_classes: string[];
  licence_expiry: string | null;
  psv_badge_number: string | null;
  years_experience: number | null;
  vehicle_ownership: "NONE" | "OWNER" | "FLEET_ASSIGNED";
  vehicle_registration: string | null;
  vehicle_make_model: string | null;
  service_categories: string[];
  preferred_city: string | null;
  notes: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  decided_at: string | null;
  driver_id: string | null;
  created_at: string;
}

export interface DriverApplicationDocumentRow {
  id: string;
  application_id: string;
  doc_code: string;
  doc_label: string;
  is_mandatory: boolean;
  state: DriverDocumentState;
  storage_path: string | null;
  document_number: string | null;
  issuing_authority: string | null;
  issued_on: string | null;
  expires_on: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
}

export interface DriverApplicationEventRow {
  id: string;
  application_id: string;
  action: string;
  status_from: string | null;
  status_to: string | null;
  note: string | null;
  created_at: string;
}

export interface Outcome {
  ok?: boolean;
  error?: boolean;
  code?: string;
  message?: string;
  [k: string]: unknown;
}

async function rpc<T = Outcome>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { error: true, code: "RPC_FAILED", message: error.message } as T;
  return (data ?? { error: true, code: "EMPTY_RESPONSE" }) as T;
}

export const DRIVER_SERVICE_CATEGORIES = [
  "RIDE_HAILING", "CORPORATE_TRAVEL", "AIRPORT_TRANSFER", "EXECUTIVE_CHAUFFEUR",
  "PARCEL_DELIVERY", "FREIGHT",
] as const;

export const DRIVER_LICENCE_CLASSES = ["A", "B", "C", "CE", "D", "DE", "F", "G"] as const;

export interface DriverApplicationInput {
  first_name: string;
  middle_name?: string;
  last_name: string;
  gender?: string;
  date_of_birth?: string;
  national_id: string;
  kra_pin?: string;
  contact_email: string;
  contact_phone: string;
  county?: string;
  town?: string;
  driver_type?: string;
  licence_number: string;
  licence_classes: string[];
  licence_expiry?: string;
  psv_badge_number?: string;
  years_experience?: number;
  vehicle_ownership: "NONE" | "OWNER" | "FLEET_ASSIGNED";
  vehicle_registration?: string;
  vehicle_make_model?: string;
  service_categories: string[];
  preferred_city?: string;
  notes?: string;
}

export const submitDriverApplication = (input: DriverApplicationInput) =>
  rpc("driver_application_submit", { p: input as unknown as Record<string, unknown> });

export const driverApplicationStatus = (reference: string, token: string) =>
  rpc("driver_application_status", { _reference: reference, _token: token });

export const decideDriverApplication = (input: {
  applicationId: string;
  action: "REVIEW" | "REQUEST_INFO" | "APPROVE" | "REJECT";
  note?: string;
}) => rpc("driver_application_decide", {
  p: { application_id: input.applicationId, action: input.action, note: input.note ?? null },
});

export const reviewDriverDocument = (input: {
  documentId: string;
  decision: "VERIFY" | "REJECT";
  notes?: string;
}) => rpc("driver_application_document_review", {
  p: { document_id: input.documentId, decision: input.decision, notes: input.notes ?? null },
});

/**
 * Upload one document into the driver-documents store and bind it to exactly
 * one checklist row. The storage path is owner-scoped (`<user id>/…`), which the
 * database entrypoint re-checks — one applicant's file can never satisfy another's.
 */
export async function attachDriverDocument(input: {
  documentId: string;
  applicationReference: string;
  docCode: string;
  file: File;
  documentNumber?: string;
  issuingAuthority?: string;
  issuedOn?: string;
  expiresOn?: string;
}): Promise<Outcome> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: true, code: "AUTHENTICATION_REQUIRED" };

  const safeCode = input.docCode.replace(/[^A-Z0-9_]/gi, "");
  const safeName = input.file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${user.id}/applications/${input.applicationReference}/${safeCode}-${Date.now()}-${safeName}`;

  const up = await supabase.storage.from("driver-documents").upload(path, input.file, { upsert: false });
  if (up.error) return { error: true, code: "UPLOAD_FAILED", message: up.error.message };

  const res = await rpc("driver_application_document_attach", {
    p: {
      document_id: input.documentId,
      storage_path: path,
      document_number: input.documentNumber ?? null,
      issuing_authority: input.issuingAuthority ?? null,
      issued_on: input.issuedOn ?? null,
      expires_on: input.expiresOn ?? null,
    },
  });
  if (res?.error) await supabase.storage.from("driver-documents").remove([path]);
  return res;
}

export async function listDriverApplications(): Promise<DriverApplicationRow[]> {
  const { data, error } = await supabase
    .from("driver_applications" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DriverApplicationRow[];
}

export async function listDriverApplicationDocuments(applicationId: string): Promise<DriverApplicationDocumentRow[]> {
  const { data, error } = await supabase
    .from("driver_application_documents" as never)
    .select("*")
    .eq("application_id", applicationId)
    .order("doc_code");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DriverApplicationDocumentRow[];
}

export async function listDriverApplicationEvents(applicationId: string): Promise<DriverApplicationEventRow[]> {
  const { data, error } = await supabase
    .from("driver_application_events" as never)
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DriverApplicationEventRow[];
}

/** Signed URL for a reviewer to open a submitted document. */
export async function driverDocumentUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("driver-documents").createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/** The applicant's own applications, when signed in. */
export async function myDriverApplications(): Promise<DriverApplicationRow[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("driver_applications" as never)
    .select("*")
    .eq("applicant_user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as unknown as DriverApplicationRow[];
}
