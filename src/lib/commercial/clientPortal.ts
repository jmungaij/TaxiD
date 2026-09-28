/**
 * CLIENT CONTRACT PORTAL, ONBOARDING CLOSURE, REVENUE BY EMPLOYEE AND
 * AMENDMENT BILLING — typed wrappers over the authoritative database RPCs.
 *
 * The client decides nothing here: the token is the credential, the database
 * owns acceptance, activation, revenue and invoice creation.
 */
import { supabase } from "@/integrations/supabase/client";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T | { ok: false; error: string }> {
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) return { ok: false as const, error: error.message };
  return data as T;
}

// ---------------------------------------------------------------------------
// Portal links (staff side)
// ---------------------------------------------------------------------------

export interface PortalInviteResult {
  ok: boolean;
  error?: string;
  invite_id?: string;
  token?: string;
  path?: string;
}

export const createPortalInvite = (args: {
  contractId: string;
  email?: string;
  name?: string;
  days?: number;
}) =>
  rpc<PortalInviteResult>("contract_portal_invite_create", {
    _contract: args.contractId,
    _email: args.email ?? null,
    _name: args.name ?? null,
    _days: args.days ?? 30,
  });

export interface PortalInviteRow {
  id: string;
  contract_id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  expires_at: string;
  opened_at: string | null;
  completed_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export async function fetchPortalInvites(contractIds: string[]): Promise<PortalInviteRow[]> {
  if (contractIds.length === 0) return [];
  const { data, error } = await db
    .from("contract_portal_invites")
    .select("id,contract_id,recipient_email,recipient_name,expires_at,opened_at,completed_at,revoked_at,created_at")
    .in("contract_id", contractIds)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []) as PortalInviteRow[];
}

export async function revokePortalInvite(inviteId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db
    .from("contract_portal_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ---------------------------------------------------------------------------
// Portal (client side, token bearing)
// ---------------------------------------------------------------------------

export interface PortalContractView {
  ok: boolean;
  error?: string;
  completed?: boolean;
  completed_at?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  upload_bucket?: string;
  upload_prefix?: string;
  contract?: {
    contract_number: string | null;
    title: string | null;
    customer: string | null;
    status: string;
    value_amount: number | null;
    currency: string | null;
    value_type: string | null;
    payment_terms: string | null;
    term_start: string | null;
    term_end: string | null;
    effective_date: string | null;
    company_signatory: string | null;
  };
}

export const openPortalContract = (token: string) => rpc<PortalContractView>("contract_portal_open", { _token: token });

export interface PortalSubmitResult {
  ok: boolean;
  error?: string;
  status?: string;
  contract_number?: string | null;
  work_item_id?: string | null;
}

/**
 * Uploads the signed copy into the isolated, write-only portal inbox bucket —
 * deliberately NOT the internal CRM documents bucket — then confirms acceptance.
 */
export const PORTAL_INBOX_BUCKET = "crm-portal-inbox";

export async function submitPortalAcceptance(args: {
  token: string;
  uploadPrefix: string;
  uploadBucket?: string;
  file: File;
  acceptedBy: string;
  acceptedTitle: string;
  signedOn: string;
  notes?: string;
}): Promise<PortalSubmitResult> {
  const safe = args.file.name.replace(/[^\w.-]+/g, "-");
  const path = `${args.uploadPrefix}${Date.now()}-${safe}`;
  const bucket = args.uploadBucket ?? PORTAL_INBOX_BUCKET;
  const upload = await supabase.storage.from(bucket).upload(path, args.file, { upsert: false });
  if (upload.error) return { ok: false, error: upload.error.message };

  return (await rpc<PortalSubmitResult>("contract_portal_submit", {
    _token: args.token,
    _accepted_by: args.acceptedBy,
    _accepted_title: args.acceptedTitle,
    _signed_on: args.signedOn,
    _storage_path: path,
    _file_name: args.file.name,
    _notes: args.notes ?? null,
  })) as PortalSubmitResult;
}

export const PORTAL_ERROR_COPY: Record<string, string> = {
  INVALID_LINK: "This link is not valid. Ask your TaxiD contact to send a new one.",
  LINK_EXPIRED: "This link has expired. Ask your TaxiD contact to send a new one.",
  LINK_REVOKED: "This link was withdrawn. Ask your TaxiD contact to send a new one.",
  ALREADY_SUBMITTED: "Your signed copy and acceptance are already recorded. Nothing further is needed.",
  CONTRACT_ALREADY_ACTIVE: "This contract is already active, so no further acceptance is needed.",
  SIGNATORY_NAME_REQUIRED: "Please enter the full name of the person signing.",
  SIGNED_COPY_REQUIRED: "Please attach your signed copy before confirming.",
  UPLOAD_PATH_REJECTED: "The upload could not be matched to this link. Please try again.",
  CONTRACT_NOT_FOUND: "This contract is no longer available. Please contact your TaxiD representative.",
};

// ---------------------------------------------------------------------------
// Onboarding closure
// ---------------------------------------------------------------------------

export interface OnboardingTaskRow {
  work_item_id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  contract_id: string;
  entity_ref: string | null;
}

export async function fetchOnboardingTasks(staffId: string): Promise<OnboardingTaskRow[]> {
  const { data, error } = await db
    .from("staff_work_items")
    .select("id,title,description,status,sla_due_at,source_id,entity_ref")
    .eq("staff_id", staffId)
    .eq("work_kind", "contract_onboarding")
    .eq("source_table", "commercial_contract_instances")
    .neq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []).map((r: Record<string, unknown>) => ({
    work_item_id: String(r.id),
    title: String(r.title ?? "Onboarding"),
    description: (r.description as string) ?? null,
    status: String(r.status ?? "open"),
    due_at: (r.sla_due_at as string) ?? null,
    contract_id: String(r.source_id ?? ""),
    entity_ref: (r.entity_ref as string) ?? null,
  }));
}

export interface OnboardingCompleteResult {
  ok: boolean;
  error?: string;
  contract_number?: string | null;
  status?: string;
  activation?: Record<string, unknown> | null;
}

export const completeContractOnboarding = (workItemId: string, notes?: string) =>
  rpc<OnboardingCompleteResult>("contract_onboarding_complete", {
    _work_item: workItemId,
    _notes: notes ?? null,
  });

// ---------------------------------------------------------------------------
// Revenue by employee
// ---------------------------------------------------------------------------

export interface EmployeeRevenueRow {
  owner_staff_id: string | null;
  owner_name: string;
  owner_code: string | null;
  contracts: number;
  contracted_value: number;
  activated_contracts: number;
  awaiting_signature: number;
  awaiting_activation: number;
  activated_revenue_total: number;
  activated_revenue_month: number;
}

export interface EmployeeRevenueBoard {
  ok: boolean;
  error?: string;
  month?: string;
  currency?: string;
  rows?: EmployeeRevenueRow[];
}

export const fetchRevenueByEmployee = (month?: string) =>
  rpc<EmployeeRevenueBoard>("contract_revenue_by_employee", { _month: month ?? null });

// ---------------------------------------------------------------------------
// Amendment billing
// ---------------------------------------------------------------------------

export interface AmendmentBillingRow {
  amendment_id: string;
  amendment_no: number;
  amendment_type: string;
  reason: string | null;
  effective_date: string | null;
  value_before: number | null;
  value_after: number | null;
  value_delta: number | null;
  currency: string | null;
  revenue_period: string | null;
  created_at: string;
  contract_id: string;
  contract_number: string | null;
  customer: string | null;
  payment_terms: string | null;
  owner_name: string | null;
  billing_id: string | null;
  billing_status: string | null;
  invoice_id: string | null;
  work_item_id: string | null;
  invoice_no: string | null;
  invoice_status: string | null;
  total_cents: number | null;
  paid_cents: number | null;
  due_date: string | null;
  needs_invoice: boolean;
}

export interface AmendmentBillingBoard {
  ok: boolean;
  error?: string;
  rows?: AmendmentBillingRow[];
}

export const fetchAmendmentBillingBoard = () => rpc<AmendmentBillingBoard>("contract_amendment_billing_board");

export interface AmendmentBillResult {
  ok: boolean;
  error?: string;
  detail?: string;
  already_billed?: boolean;
  invoice_id?: string;
  work_item_id?: string | null;
  amount_cents?: number;
}

export const billAmendment = (amendmentId: string, dueDays = 14) =>
  rpc<AmendmentBillResult>("contract_amendment_bill", { _amendment: amendmentId, _due_days: dueDays });

export const formatKes = (amount: number | null | undefined, currency = "KES"): string =>
  amount == null ? "Not recorded" : `${currency} ${Number(amount).toLocaleString()}`;

export const formatCents = (cents: number | null | undefined, currency = "KES"): string =>
  cents == null ? "Not recorded" : `${currency} ${(Number(cents) / 100).toLocaleString()}`;
