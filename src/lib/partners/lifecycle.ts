/**
 * YALLA PARTNERS — lifecycle, money and case-management access layer.
 *
 * Everything in this module is a thin, typed call onto server-side routines.
 * The rules live in the database, not here:
 *   • onboarding stages, document review and verification gating
 *     (`partner_application_promote`, `partner_document_review`,
 *      `partner_advance_onboarding` — mandatory documents must be approved
 *      before a partner can be verified),
 *   • money movement (`partner_wallet_topup`, `partner_order_post_financials`,
 *     `partner_settlement_*`) which only ever appends to
 *     `partner_ledger_entries` and is restricted to finance roles,
 *   • staff cases (`partner_case_open`, `partner_case_action`) with SLA timers
 *     and an append-only event trail.
 *
 * The client cannot bypass any of it: partner-facing tables are RLS-scoped to
 * `is_partner_member`, wallets/ledgers/settlements have no write policy at all,
 * and every routine re-checks the caller's role server-side.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

/** The generated types file does not know these new routines yet. */
const db = untypedDb;

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(humanise(error.message));
  return data as T;
}

/** Server error codes are `code: detail`; show the detail, keep the code for logs. */
export function humanise(message: string): string {
  const map: Record<string, string> = {
    not_authorised: "You do not have the role required for this action.",
    documents_incomplete: "Mandatory onboarding documents are not all approved yet.",
    reason_required: "A recorded reason is required for this action.",
    insufficient_wallet_balance: "The partner wallet does not have enough pre-funded balance.",
    settlement_not_approved: "Approve the settlement before reconciling payment.",
    settlement_locked: "This settlement is closed and can no longer be regenerated.",
    reference_required: "A payment reference is required.",
  };
  for (const [code, text] of Object.entries(map)) {
    if (message.includes(code)) {
      const detail = message.split(`${code}:`)[1]?.trim();
      return detail ? `${text} (${detail})` : text;
    }
  }
  return message;
}

/* ------------------------------------------------------------------ types */

export type OnboardingStage =
  | "applied" | "screening" | "documents_pending" | "documents_review"
  | "contracting" | "activation" | "verified" | "rejected" | "suspended";

export type DocStatus = "pending" | "approved" | "rejected" | "expired";
export type CaseState = "open" | "in_progress" | "waiting" | "escalated" | "resolved" | "closed";
export type CaseQueue = "onboarding" | "compliance" | "fulfilment" | "finance" | "risk" | "capacity" | "support";
export type CasePriority = "critical" | "high" | "medium" | "low";
export type SettlementState = "open" | "pending_review" | "approved" | "paid" | "reconciled" | "disputed";

export const ONBOARDING_STAGES: OnboardingStage[] = [
  "applied", "screening", "documents_pending", "documents_review", "contracting", "activation", "verified",
];

export const STAGE_LABEL: Record<OnboardingStage, string> = {
  applied: "Applied",
  screening: "Screening",
  documents_pending: "Documents pending",
  documents_review: "Documents in review",
  contracting: "Contracting",
  activation: "Activation",
  verified: "Verified partner",
  rejected: "Rejected",
  suspended: "Suspended",
};

export const QUEUE_LABEL: Record<CaseQueue, string> = {
  onboarding: "Onboarding",
  compliance: "Compliance",
  fulfilment: "Fulfilment",
  finance: "Finance",
  risk: "Risk",
  capacity: "Capacity",
  support: "Support",
};

export const SETTLEMENT_LABEL: Record<SettlementState, string> = {
  open: "Open",
  pending_review: "Pending review",
  approved: "Approved for payment",
  paid: "Paid",
  reconciled: "Reconciled",
  disputed: "Variance — disputed",
};

export interface OnboardingRequirement {
  code: string;
  label: string;
  description: string | null;
  is_mandatory: boolean;
  validity_months: number | null;
  sort_order: number;
}

export interface PartnerDocument {
  id: string;
  partner_id: string | null;
  application_id: string | null;
  requirement_code: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  status: DocStatus;
  issued_on: string | null;
  expires_at: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface OnboardingGap {
  code: string;
  label: string;
  is_mandatory: boolean;
  doc_status: DocStatus | "missing";
  expires_at: string | null;
}

export interface PartnerWallet {
  id: string;
  partner_id: string;
  currency: string;
  balance: number;
  reserved: number;
  credit_limit: number;
  low_balance_threshold: number;
  is_prefunded: boolean;
  updated_at: string;
}

export interface LedgerEntry {
  id: string;
  partner_id: string;
  order_id: string | null;
  settlement_id: string | null;
  entry_kind: string;
  direction: "DEBIT" | "CREDIT";
  amount: number;
  currency: string;
  balance_after: number | null;
  memo: string | null;
  reference: string | null;
  created_at: string;
}

export interface Settlement {
  id: string;
  settlement_code: string;
  partner_id: string;
  period_start: string;
  period_end: string;
  status: SettlementState;
  currency: string;
  orders_count: number;
  gross_value: number;
  supplier_cost: number;
  yalla_margin: number;
  partner_margin: number;
  taxes: number;
  payout_amount: number;
  paid_amount: number | null;
  variance_amount: number | null;
  payment_reference: string | null;
  notes: string | null;
  approved_at: string | null;
  paid_at: string | null;
  reconciled_at: string | null;
  created_at: string;
}

export interface SettlementLine {
  id: string;
  settlement_id: string;
  order_id: string;
  customer_price: number;
  supplier_cost: number;
  yalla_margin: number;
  partner_margin: number;
  taxes: number;
}

export interface PartnerCase {
  id: string;
  work_code: string;
  partner_id: string | null;
  application_id: string | null;
  order_id: string | null;
  journey_id: string | null;
  settlement_id: string | null;
  queue: CaseQueue;
  title: string;
  detail: string | null;
  priority: CasePriority;
  state: CaseState;
  sla_minutes: number;
  sla_started_at: string;
  due_at: string;
  compliance_flags: string[];
  risk_score: number;
  assigned_to: string | null;
  escalated_at: string | null;
  escalation_reason: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

export interface PartnerCaseEvent {
  id: string;
  work_item_id: string;
  action: string;
  from_state: CaseState | null;
  to_state: CaseState | null;
  note: string | null;
  created_at: string;
}

export interface PartnerKpiRow {
  partner_id: string;
  partner_code: string;
  partner_name: string;
  onboarding_stage: OnboardingStage;
  status: string;
  wallet_balance: number;
  orders: number;
  open_orders: number;
  completed: number;
  exceptions: number;
  gross_value: number;
  partner_earnings: number;
  yalla_margin: number;
  completion_rate: number | null;
  open_cases: number;
  breached_cases: number;
  unsettled_payout: number;
  last_order_at: string | null;
}

export interface QueueLoadRow {
  queue: CaseQueue;
  open_cases: number;
  breached: number;
  at_risk: number;
  escalated: number;
}

/* ------------------------------------------------------------------ reads */

export async function fetchRequirements(): Promise<OnboardingRequirement[]> {
  const { data, error } = await db
    .from("partner_onboarding_requirements")
    .select("code, label, description, is_mandatory, validity_months, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as OnboardingRequirement[];
}

export async function fetchPartnerDocuments(partnerId: string): Promise<PartnerDocument[]> {
  const { data, error } = await db
    .from("partner_documents")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PartnerDocument[];
}

export async function fetchOnboardingGaps(partnerId: string): Promise<OnboardingGap[]> {
  return call<OnboardingGap[]>("partner_onboarding_gaps", { _partner_id: partnerId });
}

export async function fetchWallet(partnerId: string): Promise<PartnerWallet | null> {
  const { data, error } = await db.from("partner_wallets").select("*").eq("partner_id", partnerId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PartnerWallet) ?? null;
}

export async function fetchLedger(partnerId: string, limit = 100): Promise<LedgerEntry[]> {
  const { data, error } = await db
    .from("partner_ledger_entries")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as LedgerEntry[];
}

export async function fetchSettlements(partnerId?: string): Promise<Settlement[]> {
  let q = db.from("partner_settlements").select("*").order("period_end", { ascending: false });
  if (partnerId) q = q.eq("partner_id", partnerId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Settlement[];
}

export async function fetchSettlementLines(settlementId: string): Promise<SettlementLine[]> {
  const { data, error } = await db
    .from("partner_settlement_lines")
    .select("*")
    .eq("settlement_id", settlementId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as SettlementLine[];
}

export interface CaseFilter {
  queues?: CaseQueue[];
  partnerId?: string;
  openOnly?: boolean;
  limit?: number;
}

export async function fetchCases(filter: CaseFilter = {}): Promise<PartnerCase[]> {
  let q = db.from("partner_work_items").select("*").order("due_at", { ascending: true }).limit(filter.limit ?? 300);
  if (filter.queues?.length) q = q.in("queue", filter.queues);
  if (filter.partnerId) q = q.eq("partner_id", filter.partnerId);
  if (filter.openOnly !== false) q = q.not("state", "in", "(resolved,closed)");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as PartnerCase[];
}

export async function fetchCaseEvents(caseId: string): Promise<PartnerCaseEvent[]> {
  const { data, error } = await db
    .from("partner_work_events")
    .select("*")
    .eq("work_item_id", caseId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PartnerCaseEvent[];
}

export async function fetchPartnerKpis(partnerId?: string, days = 90): Promise<PartnerKpiRow[]> {
  return call<PartnerKpiRow[]>("partner_performance_kpis", { _partner_id: partnerId ?? null, _days: days });
}

export async function fetchQueueLoad(): Promise<QueueLoadRow[]> {
  return call<QueueLoadRow[]>("partner_queue_load");
}

/* ----------------------------------------------------------- onboarding */

export async function promoteApplication(
  applicationId: string,
  marginPct = 10,
): Promise<string> {
  return call<string>("partner_application_promote", {
    _application_id: applicationId,
    _partner_margin_pct: marginPct,
  });
}

export async function advanceOnboarding(partnerId: string, stage: OnboardingStage, note?: string) {
  return call("partner_advance_onboarding", { _partner_id: partnerId, _stage: stage, _note: note ?? null });
}

export async function reviewDocument(documentId: string, decision: Exclude<DocStatus, "pending">, notes?: string) {
  return call("partner_document_review", { _document_id: documentId, _decision: decision, _notes: notes ?? null });
}

export const PARTNER_DOC_BUCKET = "partner-documents";

/** Uploads evidence into the partner's own folder and records the row. */
export async function uploadPartnerDocument(input: {
  partnerId: string;
  requirementCode: string;
  file: File;
  issuedOn?: string | null;
  expiresAt?: string | null;
}): Promise<PartnerDocument> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new Error("Sign in to upload partner documents.");

  const safe = input.file.name.replace(/[^\w.-]+/g, "_");
  const path = `${input.partnerId}/${input.requirementCode}/${Date.now()}-${safe}`;
  const up = await supabase.storage.from(PARTNER_DOC_BUCKET).upload(path, input.file, { upsert: false });
  if (up.error) throw new Error(up.error.message);

  const { data, error } = await db
    .from("partner_documents")
    .insert({
      partner_id: input.partnerId,
      requirement_code: input.requirementCode,
      file_path: path,
      file_name: input.file.name,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      issued_on: input.issuedOn || null,
      expires_at: input.expiresAt || null,
      uploaded_by: uid,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as PartnerDocument;
}

export async function documentUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(PARTNER_DOC_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/* --------------------------------------------------------------- money */

export async function topUpWallet(partnerId: string, amount: number, reference: string, memo?: string) {
  return call("partner_wallet_topup", {
    _partner_id: partnerId, _amount: amount, _reference: reference, _memo: memo ?? null,
  });
}

export async function postOrderFinancials(orderId: string, event: "confirm" | "complete" | "cancel") {
  return call("partner_order_post_financials", { _order_id: orderId, _event: event });
}

export async function generateSettlement(partnerId: string, periodStart: string, periodEnd: string): Promise<string> {
  return call<string>("partner_settlement_generate", {
    _partner_id: partnerId, _period_start: periodStart, _period_end: periodEnd,
  });
}

export async function approveSettlement(settlementId: string, note?: string) {
  return call("partner_settlement_approve", { _settlement_id: settlementId, _note: note ?? null });
}

export async function reconcileSettlement(
  settlementId: string, paidAmount: number, paymentReference: string, note?: string,
) {
  return call("partner_settlement_reconcile", {
    _settlement_id: settlementId, _paid_amount: paidAmount,
    _payment_reference: paymentReference, _note: note ?? null,
  });
}

/* ---------------------------------------------------------------- cases */

export async function openCase(input: {
  queue: CaseQueue;
  title: string;
  detail?: string;
  priority?: CasePriority;
  slaMinutes?: number;
  partnerId?: string | null;
  orderId?: string | null;
  journeyId?: string | null;
  complianceFlags?: string[];
  riskScore?: number;
  dedupeKey?: string;
}): Promise<string> {
  return call<string>("partner_case_open", {
    _queue: input.queue, _title: input.title, _detail: input.detail ?? null,
    _priority: input.priority ?? "medium", _sla_minutes: input.slaMinutes ?? 240,
    _partner_id: input.partnerId ?? null, _order_id: input.orderId ?? null,
    _journey_id: input.journeyId ?? null, _application_id: null, _settlement_id: null,
    _compliance_flags: input.complianceFlags ?? [], _risk_score: input.riskScore ?? 0,
    _dedupe_key: input.dedupeKey ?? null,
  });
}

export type CaseAction = "claim" | "start" | "wait" | "escalate" | "resolve" | "close" | "reopen" | "assign" | "note";

export const REASON_REQUIRED_ACTIONS: CaseAction[] = ["wait", "escalate", "resolve", "close"];

export async function actOnCase(caseId: string, action: CaseAction, note?: string, assignTo?: string) {
  return call<PartnerCase>("partner_case_action", {
    _case_id: caseId, _action: action, _note: note ?? null, _assign_to: assignTo ?? null,
  });
}

/* --------------------------------------------------------- SLA arithmetic */

export type SlaStatus = "on_track" | "at_risk" | "breached" | "met";

export interface CaseSla {
  status: SlaStatus;
  remainingMinutes: number;
  consumedPct: number;
  label: string;
}

/** Human SLA view of a case. Warning fires in the last 20% of the window. */
export function caseSla(item: Pick<PartnerCase, "due_at" | "sla_minutes" | "state" | "resolved_at">, now = Date.now()): CaseSla {
  const due = Date.parse(item.due_at);
  const closed = item.state === "resolved" || item.state === "closed";
  const end = closed && item.resolved_at ? Date.parse(item.resolved_at) : now;
  const remainingMinutes = Math.round((due - end) / 60_000);
  const consumedPct = Math.min(999, Math.round(((item.sla_minutes - remainingMinutes) / Math.max(1, item.sla_minutes)) * 100));

  let status: SlaStatus;
  if (closed) status = remainingMinutes >= 0 ? "met" : "breached";
  else if (remainingMinutes < 0) status = "breached";
  else if (consumedPct >= 80) status = "at_risk";
  else status = "on_track";

  return { status, remainingMinutes, consumedPct, label: slaLabel(status, remainingMinutes) };
}

function slaLabel(status: SlaStatus, remaining: number): string {
  if (status === "met") return "Met";
  const mins = Math.abs(remaining);
  const human = mins >= 1440 ? `${Math.round(mins / 1440)}d` : mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
  return status === "breached" ? `Overdue ${human}` : `${human} left`;
}

const PRIORITY_ORDER: CasePriority[] = ["critical", "high", "medium", "low"];

/** Operational sort: breached first, then priority, then least time remaining. */
export function sortCases(items: readonly PartnerCase[], now = Date.now()): PartnerCase[] {
  return [...items].sort((a, b) => {
    const sa = caseSla(a, now);
    const sb = caseSla(b, now);
    const breach = Number(sb.status === "breached") - Number(sa.status === "breached");
    if (breach) return breach;
    const p = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
    if (p) return p;
    return sa.remainingMinutes - sb.remainingMinutes;
  });
}

/** Stage completion for the onboarding rail. */
export function stageProgress(stage: OnboardingStage): number {
  const idx = ONBOARDING_STAGES.indexOf(stage);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / ONBOARDING_STAGES.length) * 100);
}

/** True when every mandatory requirement has an approved, unexpired document. */
export function readyToVerify(gaps: readonly OnboardingGap[]): boolean {
  if (gaps.length === 0) return false;
  return gaps.every((g) => !g.is_mandatory || g.doc_status === "approved");
}

/** Expiring or expired approved evidence, soonest first. */
export function expiringDocuments(docs: readonly PartnerDocument[], withinDays = 45): PartnerDocument[] {
  const limit = Date.now() + withinDays * 86_400_000;
  return docs
    .filter((d) => d.status === "approved" && d.expires_at && Date.parse(d.expires_at) <= limit)
    .sort((a, b) => Date.parse(a.expires_at!) - Date.parse(b.expires_at!));
}
