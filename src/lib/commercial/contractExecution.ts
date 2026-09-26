/**
 * CONTRACT EXECUTION & VALUE CAPTURE — client contract.
 *
 * Every function here is a thin, typed wrapper over a database RPC that owns the
 * rule. The client never decides whether a contract may be activated, never
 * computes revenue and never writes contract state directly: `contract_activate`
 * is the single atomic, idempotent commercial truth event (one revenue entry per
 * contract activation, enforced by a unique key in the database).
 */
import { supabase } from "@/integrations/supabase/client";

// Contract tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const CONTRACT_BUCKET = "crm-documents";

export type ContractValueType =
  | "one_time"
  | "monthly_recurring"
  | "quarterly_recurring"
  | "annual_recurring"
  | "multi_year"
  | "usage_based"
  | "project";

export const CONTRACT_VALUE_TYPES: { value: ContractValueType; label: string }[] = [
  { value: "one_time", label: "One-off value" },
  { value: "monthly_recurring", label: "Monthly recurring" },
  { value: "quarterly_recurring", label: "Quarterly recurring" },
  { value: "annual_recurring", label: "Annual recurring" },
  { value: "multi_year", label: "Multi-year" },
  { value: "usage_based", label: "Usage based" },
  { value: "project", label: "Project" },
];

export type ContractDocumentType =
  | "draft"
  | "final"
  | "executed"
  | "acceptance_evidence"
  | "signature_evidence"
  | "amendment"
  | "addendum"
  | "supporting";

export interface ContractDocumentRef {
  document_type: ContractDocumentType;
  version: number;
  file_name: string | null;
  reference: string | null;
  uploaded_at: string;
}

export interface ContractRevenueRef {
  amount: number;
  currency: string;
  revenue_period: string;
  event_type: string;
  created_at: string;
}

export interface ContractRecord {
  contract_id: string;
  contract_number: string | null;
  title: string | null;
  customer: string | null;
  status: string;
  value_amount: number | null;
  currency: string;
  value_type: ContractValueType;
  revenue_period: string | null;
  execution_date: string | null;
  term_start: string | null;
  term_end: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  lead_id: string | null;
  customer_signatory: string | null;
  company_signatory: string | null;
  signature_date: string | null;
  variance_reason: string | null;
  activated_at: string | null;
  is_test: boolean;
  payment_terms?: string | null;
  renewal_terms?: string | null;
  billing_frequency?: string | null;
  documents: ContractDocumentRef[];
  revenue: ContractRevenueRef[];
  amendments?: ContractAmendment[];
  timeline?: ContractTimelineEvent[];
  tasks?: ContractTask[];
}

export interface ContractGateCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string | null;
}

export interface ContractGate {
  ok: boolean;
  error?: string;
  contract_id: string;
  contract_number: string | null;
  status: string;
  can_activate: boolean;
  failures: number;
  already_activated: boolean;
  checks: ContractGateCheck[];
  variance_amount: number | null;
  variance_pct: number | null;
  value_amount: number | null;
  currency: string | null;
  revenue_period: string | null;
  execution_date: string | null;
}

export interface ContractActivationResult {
  ok: boolean;
  error?: string;
  gate?: ContractGate;
  already_activated?: boolean;
  contract_number?: string | null;
  revenue_event_id?: string;
  amount?: number | null;
  currency?: string | null;
  revenue_period?: string | null;
  work_item_id?: string | null;
  lifecycle?: { ok?: boolean; error?: string } | null;
}

export interface ContractControlCentre {
  ok: boolean;
  error?: string;
  pipeline: Record<string, number>;
  awaiting_signature: number;
  executed_pending_activation: number;
  revenue_pending_activation: number;
  contracted_revenue_today: number;
  contracted_revenue_month: number;
  activated_today: number;
  average_contract_value: number;
  ready: {
    contract_id: string;
    contract_number: string | null;
    customer: string | null;
    status: string;
    value_amount: number | null;
    currency: string;
    owner_staff_id: string | null;
    execution_date: string | null;
  }[];
  health: Record<string, number>;
}

export interface AccountRevenue {
  ok: boolean;
  error?: string;
  account_id: string;
  contracted_revenue: number;
  recurring_revenue: number;
  active_contracts: number;
  open_opportunities: number;
  sources: {
    revenue_event_id: string;
    contract_id: string;
    contract_number: string | null;
    title: string | null;
    event_type: string;
    amount: number;
    currency: string;
    value_type: string;
    execution_date: string;
    revenue_period: string;
  }[];
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T | { ok: false; error: string }> {
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) return { ok: false as const, error: error.message };
  return data as T;
}

export interface ContractAmendment {
  amendment_id: string;
  amendment_no: number;
  amendment_type: "value" | "term_dates" | "commercial_terms" | "scope" | "mixed";
  reason: string;
  effective_date: string | null;
  value_before: number | null;
  value_after: number | null;
  value_delta: number | null;
  currency: string;
  revenue_period: string | null;
  changed_fields: string[];
  created_at: string;
}

export interface ContractTask {
  work_item_id: string;
  title: string;
  status: string;
  priority: string | null;
  due_at: string | null;
}

export interface ContractTimelineEvent {
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  created_at: string;
}

export interface ManagerContractRow {
  contract_id: string;
  contract_number: string | null;
  title: string | null;
  customer: string | null;
  account_id: string | null;
  status: string;
  value_amount: number | null;
  currency: string;
  value_type: string;
  revenue_period: string | null;
  execution_date: string | null;
  term_start: string | null;
  term_end: string | null;
  activated_at: string | null;
  updated_at: string;
  owner_staff_id: string | null;
  owner_name: string | null;
  owner_code: string | null;
  recognised_revenue: number;
  amendments: number;
  has_executed_document: boolean;
  has_acceptance: boolean;
  open_tasks: number;
  next_task_due: string | null;
  next_action: string;
}

export interface ManagerOwnerRow {
  owner_staff_id: string | null;
  owner_name: string;
  contracts: number;
  open_value: number;
  recognised_revenue: number;
  awaiting_signature: number;
}

export interface ManagerAmendmentRow extends ContractAmendment {
  contract_id: string;
  contract_number: string | null;
  customer: string | null;
}

export interface ContractManagerDashboard {
  ok: boolean;
  error?: string;
  month: string;
  contracts: ManagerContractRow[];
  by_owner: ManagerOwnerRow[];
  amendment_activity: ManagerAmendmentRow[];
  centre: ContractControlCentre;
}

export interface AmendmentResult {
  ok: boolean;
  error?: string;
  detail?: string;
  amendment_no?: number;
  amendment_type?: string;
  value_before?: number | null;
  value_after?: number | null;
  value_delta?: number | null;
  currency?: string;
  revenue_period?: string | null;
  work_item_id?: string | null;
}

export const fetchMyContractBook = () => rpc<{ ok: boolean; error?: string; items: ContractRecord[] }>("contract_my_book");

export const fetchContractManagerDashboard = () => rpc<ContractManagerDashboard>("contract_manager_dashboard");

export const createContract = (patch: Record<string, unknown>) =>
  rpc<{ ok: boolean; error?: string; contract_id?: string; contract_number?: string }>("contract_create", {
    _patch: patch,
  });

export const setContractStatus = (contractId: string, status: string, reason?: string) =>
  rpc<{ ok: boolean; error?: string; status?: string }>("contract_status_set", {
    _contract: contractId,
    _status: status,
    _reason: reason ?? null,
  });

export const recordContractAcceptance = (args: {
  contractId: string;
  acceptedOn: string;
  acceptedBy: string;
  channel: string;
  reference: string;
  notes?: string;
}) =>
  rpc<{ ok: boolean; error?: string; detail?: string; status?: string }>("contract_acceptance_record", {
    _contract: args.contractId,
    _accepted_on: args.acceptedOn,
    _accepted_by: args.acceptedBy,
    _channel: args.channel,
    _reference: args.reference,
    _notes: args.notes ?? null,
  });

/** Amends an activated contract; the database posts only the revenue difference. */
export const amendContract = (contractId: string, patch: Record<string, unknown>, reason: string) =>
  rpc<AmendmentResult>("contract_amend", { _contract: contractId, _patch: patch, _reason: reason });

export interface ContractAccountOption {
  id: string;
  name: string;
  legal_name: string | null;
  lifecycle_stage: string | null;
}

/** Accounts the signed-in user may raise a contract against. */
export async function fetchContractAccounts(): Promise<ContractAccountOption[]> {
  const { data, error } = await db
    .from("crm_accounts")
    .select("id,name,legal_name,lifecycle_stage")
    .eq("is_test", false)
    .order("name")
    .limit(500);
  if (error) return [];
  return (data ?? []) as ContractAccountOption[];
}

export const fetchContractGate = (contractId: string) =>
  rpc<ContractGate>("contract_activation_check", { _contract: contractId });

export const fetchContractControlCentre = () => rpc<ContractControlCentre>("contract_control_centre");

export const fetchAccountRevenue = (accountId: string) =>
  rpc<AccountRevenue>("contract_account_revenue", { _account: accountId });

export const recordContractExecution = (contractId: string, patch: Record<string, unknown>) =>
  rpc<{ ok: boolean; error?: string; status?: string }>("contract_execution_record", {
    _contract: contractId,
    _patch: patch,
  });

export const activateContract = (contractId: string, reason?: string) =>
  rpc<ContractActivationResult>("contract_activate", { _contract: contractId, _reason: reason ?? null });

// ---------------------------------------------------------------------------
// ACTIVATION PLAN — pick a contract, set the service start date and the
// onboarding owner. The database owns the gate, the revenue entry and the
// onboarding task; this client only carries the three chosen facts.
// ---------------------------------------------------------------------------

export interface ActivationBlocker {
  label: string;
  detail: string | null;
}

export interface ActivationPlanContract {
  contract_id: string;
  contract_number: string | null;
  title: string | null;
  customer: string | null;
  status: string;
  value_amount: number | null;
  currency: string;
  value_type: string;
  revenue_period: string | null;
  execution_date: string | null;
  effective_date: string | null;
  term_start: string | null;
  owner_staff_id: string | null;
  owner_name: string | null;
  is_test: boolean;
  can_activate: boolean;
  blockers: ActivationBlocker[];
}

export interface ActivationOwnerOption {
  staff_id: string;
  full_name: string | null;
}

export interface ActivationPlan {
  ok: boolean;
  error?: string;
  contracts: ActivationPlanContract[];
  owners: ActivationOwnerOption[];
  my_staff_id: string | null;
}

export interface ActivationPlanResult extends ContractActivationResult {
  service_start?: string;
  owner_staff_id?: string;
  onboarding_task?: {
    work_item_id: string;
    title: string;
    due_at: string | null;
    staff_id: string;
  } | null;
}

export const fetchActivationPlan = () => rpc<ActivationPlan>("contract_activation_plan");

export const applyActivationPlan = (args: {
  contractId: string;
  serviceStart: string;
  ownerStaffId: string;
  reason?: string;
}) =>
  rpc<ActivationPlanResult>("contract_activation_plan_apply", {
    _contract: args.contractId,
    _service_start: args.serviceStart,
    _owner_staff: args.ownerStaffId,
    _reason: args.reason ?? null,
  });

export const attachContractDocument = (args: {
  contractId: string;
  documentType: ContractDocumentType;
  storagePath?: string | null;
  fileName?: string | null;
  externalReference?: string | null;
  notes?: string | null;
}) =>
  rpc<{ ok: boolean; error?: string; version?: number }>("contract_document_attach", {
    _contract: args.contractId,
    _document_type: args.documentType,
    _storage_path: args.storagePath ?? null,
    _file_name: args.fileName ?? null,
    _external_reference: args.externalReference ?? null,
    _notes: args.notes ?? null,
  });

/** Uploads the signed copy to private storage, then registers the version. */
export async function uploadContractDocument(
  contractId: string,
  documentType: ContractDocumentType,
  file: File,
  notes?: string,
): Promise<{ ok: boolean; error?: string; version?: number }> {
  const safe = file.name.replace(/[^\w.-]+/g, "-");
  const path = `contracts/${contractId}/${documentType}-${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from(CONTRACT_BUCKET).upload(path, file, { upsert: false });
  if (error) return { ok: false, error: error.message };
  return (await attachContractDocument({
    contractId,
    documentType,
    storagePath: path,
    fileName: file.name,
    notes,
  })) as { ok: boolean; error?: string; version?: number };
}

/** Presentation helper — never invents a currency. */
export const formatContractValue = (amount: number | null, currency: string | null): string =>
  amount == null ? "Value not recorded" : `${currency ?? ""} ${Number(amount).toLocaleString()}`.trim();

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  generated: "Generated",
  internal_review: "Internal review",
  approved: "Approved to send",
  sent_to_customer: "Sent to customer",
  shared: "Sent to customer",
  customer_review: "With customer",
  under_negotiation: "In negotiation",
  customer_accepted: "Customer accepted",
  signature_pending: "Awaiting signature",
  partially_signed: "Partly signed",
  executed: "Signed by both parties",
  contracted: "Contracted",
  active: "Active",
  completed: "Completed",
  expired: "Expired",
  terminated: "Terminated",
  declined: "Declined",
  superseded: "Superseded",
};

/** Statuses that still need customer or internal movement before activation. */
export const CONTRACT_OPEN_STATUSES = [
  "draft",
  "generated",
  "internal_review",
  "approved",
  "sent_to_customer",
  "shared",
  "customer_review",
  "under_negotiation",
  "customer_accepted",
  "signature_pending",
  "partially_signed",
  "executed",
];
