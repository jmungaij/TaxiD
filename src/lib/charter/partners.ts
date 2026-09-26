/**
 * Flight Partner Onboarding — application submission, document evidence and
 * admin review, backed by `charter_partner_applications` and its append-only
 * event log. Reuses the hardened charter evidence uploader for documents.
 */
import { supabase } from "@/integrations/supabase/client";
import { uploadEvidence, validateEvidenceMeta } from "./evidence";

export const PARTNER_STATUSES = [
  "submitted", "under_review", "documents_required", "approved", "rejected",
] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  documents_required: "Documents required",
  approved: "Approved",
  rejected: "Rejected",
};

/** Documents an operator must provide before activation. */
export const REQUIRED_PARTNER_DOCS = [
  { key: "aoc", label: "Air Operator Certificate (AOC)" },
  { key: "insurance", label: "Insurance certificate" },
  { key: "airworthiness", label: "Certificate of airworthiness" },
  { key: "ops_manual", label: "Operations manual" },
] as const;

export interface PartnerDocument {
  key: string;
  label: string;
  path: string;
  file_name: string;
  uploaded_at: string;
}

export interface PartnerApplication {
  id: string;
  submitted_by: string | null;
  operator_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  country: string | null;
  home_base: string | null;
  fleet_size: number;
  aircraft_types: string | null;
  aoc_number: string | null;
  insurance_expiry: string | null;
  notes: string | null;
  documents: PartnerDocument[];
  status: PartnerStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerEvent {
  id: string;
  application_id: string;
  actor_email: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  document_path: string | null;
  created_at: string;
}

const table = "charter_partner_applications";
const eventsTable = "charter_partner_application_events";

async function actor() {
  const { data } = await supabase.auth.getUser();
  return { id: data.user?.id ?? null, email: data.user?.email ?? null };
}

export async function listPartnerApplications(): Promise<PartnerApplication[]> {
  const { data, error } = await supabase.from(table).select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PartnerApplication[];
}

export async function listPartnerEvents(applicationId: string): Promise<PartnerEvent[]> {
  const { data, error } = await supabase
    .from(eventsTable).select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PartnerEvent[];
}

export interface PartnerApplicationInput {
  operator_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  country?: string;
  home_base?: string;
  fleet_size: number;
  aircraft_types?: string;
  aoc_number?: string;
  insurance_expiry?: string;
  notes?: string;
  documents: PartnerDocument[];
}

/** Client-side validation mirroring the table constraints. */
export function validateApplication(input: PartnerApplicationInput): string | null {
  if (input.operator_name.trim().length < 2) return "Operator name is required.";
  if (input.contact_name.trim().length < 2) return "Contact name is required.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.contact_email.trim())) return "A valid contact email is required.";
  if (input.fleet_size < 0 || input.fleet_size > 999) return "Fleet size must be between 0 and 999.";
  if (input.operator_name.length > 160 || input.contact_name.length > 160) return "Names must be under 160 characters.";
  if ((input.notes ?? "").length > 2000) return "Notes must be under 2000 characters.";
  return null;
}

export async function uploadPartnerDocument(file: File, key: string, label: string): Promise<PartnerDocument> {
  const invalid = validateEvidenceMeta(file);
  if (invalid) throw new Error(invalid);
  const path = await uploadEvidence(file, `partner-${key}`);
  return { key, label, path, file_name: file.name, uploaded_at: new Date().toISOString() };
}

export async function submitPartnerApplication(input: PartnerApplicationInput): Promise<PartnerApplication> {
  const invalid = validateApplication(input);
  if (invalid) throw new Error(invalid);
  const me = await actor();
  const { data, error } = await supabase
    .from(table)
    .insert({
      ...input,
      insurance_expiry: input.insurance_expiry || null,
      documents: input.documents as unknown as never,
      submitted_by: me.id,
    } as never)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const row = data as unknown as PartnerApplication;

  await supabase.from(eventsTable).insert({
    application_id: row.id, actor_id: me.id, actor_email: me.email,
    action: "submitted", to_status: "submitted",
    note: `${input.documents.length} document(s) attached`,
  } as never);

  return row;
}

/**
 * Records a review decision. Routed through the charter-api edge function so
 * the decision is role-checked server-side, appended to the audit trail, and
 * (for approved/rejected) triggers the partner decision email + in-app event.
 */
export async function reviewPartnerApplication(
  app: PartnerApplication, next: PartnerStatus, note?: string,
): Promise<PartnerApplication> {
  const { data, error } = await supabase.functions.invoke("charter-api", {
    body: { action: "partner_decide", application_id: app.id, status: next, note: note ?? null },
  });
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context?.body;
    if (typeof ctx === "string") {
      try {
        const parsed = JSON.parse(ctx) as { message?: string; error?: string };
        throw new Error(parsed.message ?? parsed.error ?? error.message);
      } catch { /* fall through */ }
    }
    throw new Error(error.message);
  }
  if (!data?.ok) throw new Error(data?.message ?? data?.error ?? "partner_decision_failed");
  return data.application as PartnerApplication;
}

/** Every partner event across all applications — used by the CSV audit export. */
export async function listAllPartnerEvents(limit = 5000): Promise<PartnerEvent[]> {
  const { data, error } = await supabase
    .from(eventsTable).select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PartnerEvent[];
}


/** Readiness score for an application: documents provided + core fields present. */
export function applicationReadiness(app: PartnerApplication): number {
  const docs = REQUIRED_PARTNER_DOCS.filter((d) => app.documents?.some((x) => x.key === d.key)).length;
  const fields = [app.aoc_number, app.home_base, app.country, app.insurance_expiry, app.fleet_size > 0].filter(Boolean).length;
  return Math.round(((docs / REQUIRED_PARTNER_DOCS.length) * 0.7 + (fields / 5) * 0.3) * 100);
}
