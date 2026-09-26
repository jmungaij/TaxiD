/**
 * Phase 8.5 — Finance governance client.
 *
 * Three concerns, deliberately separate from the closure engine:
 *  - the immutable audit trail of money-field changes,
 *  - the read-only Gate H pre-check other services share,
 *  - confidence-scored finance sign-off.
 *
 * Every function here is a thin wrapper over a database RPC. Authority lives in
 * the database (`is_finance_approver`), never in this file — the UI hides what a
 * user may not do, but the refusal itself is server-side.
 */
import { supabase } from "@/integrations/supabase/client";

const rpc = (name: string, args?: Record<string, unknown>) =>
  (supabase as any).rpc(name, args ?? {});

export type FinanceFieldClass =
  | "currency" | "tax" | "commission" | "partner_entitlement"
  | "recognition_rule" | "review" | "other";

export interface FinanceAuditEntry {
  id: string;
  entity_kind: string;
  entity_key: string;
  operation: string;
  field: string;
  field_class: FinanceFieldClass;
  value_before: string | null;
  value_after: string | null;
  changed_by: string | null;
  changed_by_email: string | null;
  change_source: string;
  reason: string | null;
  created_at: string;
}

export interface GatePrecheck {
  ok: boolean;
  error?: string;
  read_only?: boolean;
  transaction_id?: string;
  transaction_ref?: string;
  service_line?: string;
  status?: string;
  rule_key?: string | null;
  eligible?: boolean;
  economics_complete?: boolean;
  missing_fields?: string[];
  blockers?: string[];
  review_status?: string;
  financials_source?: string | null;
  recognisable_amount_cents?: number | null;
  reason?: string;
  checked_at?: string;
}

export interface CaptureScore {
  ok: boolean;
  error?: string;
  transaction_ref?: string;
  service_line?: string;
  confidence?: number;
  factors?: { factor: string; weight: number }[];
  ambiguities?: string[];
  unambiguous?: boolean;
  review_status?: string;
  precheck?: GatePrecheck;
}

export interface AutoApprovalDecision {
  transaction_ref: string;
  service_line: string;
  confidence: string;
  decision: "auto_approved" | "manual_review";
  ambiguities: string[];
}

export interface AutoApprovalRun {
  ok: boolean;
  error?: string;
  run_id?: string;
  dry_run?: boolean;
  threshold?: number;
  scanned: number;
  auto_approved: number;
  left_for_review: number;
  decisions: AutoApprovalDecision[];
}

export const FIELD_CLASS_LABELS: Record<FinanceFieldClass, string> = {
  currency: "Currency",
  tax: "Tax",
  commission: "Commission",
  partner_entitlement: "Partner entitlement",
  recognition_rule: "Recognition rule",
  review: "Review / sign-off",
  other: "Other",
};

/** Does the signed-in user hold finance approval authority? */
export async function isFinanceApprover(): Promise<boolean> {
  const { data, error } = await rpc("is_finance_approver");
  if (error) return false;
  return data === true;
}

export async function loadFinanceAudit(opts: { fieldClass?: FinanceFieldClass; entityKey?: string; limit?: number } = {}) {
  let q = (supabase as any)
    .from("finance_change_audit")
    .select("id,entity_kind,entity_key,operation,field,field_class,value_before,value_after,changed_by,changed_by_email,change_source,reason,created_at")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.fieldClass) q = q.eq("field_class", opts.fieldClass);
  if (opts.entityKey) q = q.eq("entity_key", opts.entityKey);
  const { data, error } = await q;
  return { ok: !error, entries: (data ?? []) as FinanceAuditEntry[], error: error?.message };
}

/** Shared, side-effect-free Gate H pre-check. Safe for other services to call. */
export async function gatePrecheck(input: { ref?: string; id?: string }): Promise<GatePrecheck> {
  const { data, error } = await rpc("revenue_gate_precheck", {
    _transaction_ref: input.ref ?? null,
    _transaction_id: input.id ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "empty_response" }) as GatePrecheck;
}

export async function scoreCapture(transactionId: string): Promise<CaptureScore> {
  const { data, error } = await rpc("score_financial_capture", { _transaction_id: transactionId });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "empty_response" }) as CaptureScore;
}

/** Confidence-based sign-off. Dry runs report the decisions without writing them. */
export async function autoApproveCapture(opts: { dryRun?: boolean; limit?: number; threshold?: number } = {}): Promise<AutoApprovalRun> {
  const { data, error } = await rpc("auto_approve_financial_capture", {
    _dry_run: opts.dryRun ?? true,
    _limit: opts.limit ?? 200,
    _threshold: opts.threshold ?? 85,
  });
  if (error) return { ok: false, error: error.message, scanned: 0, auto_approved: 0, left_for_review: 0, decisions: [] };
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ok: d.ok === true,
    run_id: d.run_id as string | undefined,
    dry_run: d.dry_run as boolean | undefined,
    threshold: Number(d.threshold ?? 0),
    scanned: Number(d.scanned ?? 0),
    auto_approved: Number(d.auto_approved ?? 0),
    left_for_review: Number(d.left_for_review ?? 0),
    decisions: (d.decisions ?? []) as AutoApprovalDecision[],
  };
}

export async function loadAutoApprovalRuns(limit = 20) {
  const { data, error } = await (supabase as any)
    .from("financial_autoapproval_runs")
    .select("id,dry_run,threshold,scanned,auto_approved,left_for_review,started_at,finished_at")
    .order("started_at", { ascending: false })
    .limit(limit);
  return { ok: !error, runs: (data ?? []) as Record<string, unknown>[], error: error?.message };
}

export async function loadRecognitionRules() {
  const { data, error } = await (supabase as any)
    .from("revenue_recognition_rules")
    .select("id,rule_key,service_line,description,is_active,recognise_gross,requires_payment,requires_invoice,requires_settlement,approved_by,approved_at,notes")
    .order("service_line");
  return { ok: !error, rules: (data ?? []) as Record<string, unknown>[], error: error?.message };
}

/** Finance sign-off on a recognition rule. Refused server-side for other roles. */
export async function approveRecognitionRule(ruleKey: string, approve: boolean, notes?: string) {
  const { data, error } = await rpc("approve_recognition_rule", {
    _rule_key: ruleKey, _approve: approve, _notes: notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "empty_response" }) as { ok: boolean; error?: string; rule_key?: string; approved?: boolean };
}

/** Backfill job. Finance-only, server-enforced. */
export async function runFinancialBackfill(opts: { dryRun?: boolean; limit?: number } = {}) {
  const { data, error } = await rpc("backfill_commercial_financials", {
    _dry_run: opts.dryRun ?? true, _limit: opts.limit ?? 500,
  });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ok: d.ok === true,
    dryRun: d.dry_run === true,
    attempted: Number(d.attempted ?? 0),
    populated: Number(d.populated ?? 0),
    stillIncomplete: Number(d.still_incomplete ?? 0),
    gaps: (d.gaps ?? []) as Record<string, unknown>[],
  };
}
