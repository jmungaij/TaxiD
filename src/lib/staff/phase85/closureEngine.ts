/**
 * Phase 8.5 — Transaction, Revenue & Control Closure Engine (client).
 *
 * Every figure exposed here is read from an authoritative server function.
 * Nothing on this path calculates revenue in the browser, and nothing
 * presents a modelled figure as live: the server stamps provenance and the
 * UI repeats it verbatim. When a stage has no authoritative record the
 * engine reports "missing" rather than filling the gap.
 */
import { supabase } from "@/integrations/supabase/client";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** The 14 authoritative production stages, in economic order. */
export const LINEAGE_STAGES = [
  { no: 1, key: "market_signal", label: "Market signal" },
  { no: 2, key: "opportunity_intent", label: "Opportunity / intent" },
  { no: 3, key: "offer", label: "Offer" },
  { no: 4, key: "capacity_commitment", label: "Capacity commitment" },
  { no: 5, key: "booking", label: "Booking contract" },
  { no: 6, key: "orchestration", label: "Orchestration" },
  { no: 7, key: "fulfilment", label: "Fulfilment" },
  { no: 8, key: "invoice", label: "Invoice" },
  { no: 9, key: "payment", label: "Payment" },
  { no: 10, key: "settlement", label: "Settlement" },
  { no: 11, key: "revenue_event", label: "Revenue event" },
  { no: 12, key: "revenue_ledger", label: "Revenue ledger" },
  { no: 13, key: "outcome", label: "Outcome" },
  { no: 14, key: "learning", label: "Learning" },
] as const;

export type StageKey = (typeof LINEAGE_STAGES)[number]["key"];

export interface LineageStage {
  id: string;
  transaction_ref: string;
  stage_no: number;
  stage_key: StageKey | string;
  authoritative_id: string | null;
  authoritative_table: string | null;
  status: string;
  occurred_at: string | null;
  source: string;
  actor_kind: string;
  evidence: Record<string, unknown>;
}

export interface IntegrityReport {
  ok: boolean;
  scorePct: number;
  transactions: number;
  fulfilled: number;
  economicsComplete: number;
  eligible: number;
  recognised: number;
  invoiced: number;
  paid: number;
  unbilledFulfilments: number;
  revenueEvents: number;
  revenueEventsCents: number;
  ledgerCents: number;
  ledgerReconciles: boolean;
  settlements: number;
  settlementsReconciled: number;
  duplicateRevenueEvents: number;
  openExceptions: number;
  lineageCompletenessPct: number;
  computedAt: string | null;
  error?: string;
}

export interface ExceptionItem {
  exception_ref: string;
  transaction_ref: string | null;
  stage: string;
  kind: string;
  severity: string;
  exposure_cents: number | null;
  priority_score: number | null;
  owner_team: string | null;
  sla_due_at: string | null;
  root_cause: string | null;
  recommended_action: string | null;
  status?: string;
}

export interface ReconciliationRun {
  ok: boolean;
  scanned: number;
  exceptionsRaised: number;
  exposureCents: number;
  breaks: Record<string, number>;
  error?: string;
}

export interface CertificationCriterion {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface CertificationResult {
  ok: boolean;
  verdict: "PASS" | "FAIL";
  scorePct: number;
  criteriaPassed: number;
  criteriaTotal: number;
  criteria: CertificationCriterion[];
  error?: string;
}

export interface MorningBrief {
  ok: boolean;
  asOf: string | null;
  yesterday: {
    revenueCents: number;
    contributionCents: number;
    transactions: number;
    fulfilments: number;
    collectionsCents: number;
    exceptions: number;
  };
  topRisks: ExceptionItem[];
  approvalsRequired: number;
  criticalIncidents: number;
  learning: Array<{ learning: string; cause: string | null; variance_pct: number | null; created_at: string }>;
  integrity: IntegrityReport | null;
  error?: string;
}

export interface TransactionTrace {
  ok: boolean;
  transaction: Record<string, unknown> | null;
  stages: LineageStage[];
  eligibilityChecks: Array<Record<string, unknown>>;
  exceptions: Array<Record<string, unknown>>;
  settlement: Record<string, unknown> | null;
  revenueEvent: Record<string, unknown> | null;
  error?: string;
}

function obj(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function parseIntegrity(data: unknown): IntegrityReport {
  const d = obj(data);
  return {
    ok: d.ok === true,
    scorePct: num(d.score_pct),
    transactions: num(d.transactions),
    fulfilled: num(d.fulfilled),
    economicsComplete: num(d.economics_complete),
    eligible: num(d.eligible),
    recognised: num(d.recognised),
    invoiced: num(d.invoiced),
    paid: num(d.paid),
    unbilledFulfilments: num(d.unbilled_fulfilments),
    revenueEvents: num(d.revenue_events),
    revenueEventsCents: num(d.revenue_events_cents),
    ledgerCents: num(d.ledger_cents),
    ledgerReconciles: d.ledger_reconciles === true,
    settlements: num(d.settlements),
    settlementsReconciled: num(d.settlements_reconciled),
    duplicateRevenueEvents: num(d.duplicate_revenue_events),
    openExceptions: num(d.open_exceptions),
    lineageCompletenessPct: num(d.lineage_completeness_pct),
    computedAt: typeof d.computed_at === "string" ? d.computed_at : null,
  };
}

export async function loadIntegrity(): Promise<IntegrityReport> {
  const { data, error } = await rpc("commercial_revenue_integrity");
  if (error) return { ...parseIntegrity({}), error: error.message };
  return parseIntegrity(data);
}

export async function runMoneyReconciliation(): Promise<ReconciliationRun> {
  const { data, error } = await rpc("run_commercial_money_reconciliation");
  if (error) return { ok: false, scanned: 0, exceptionsRaised: 0, exposureCents: 0, breaks: {}, error: error.message };
  const d = obj(data);
  return {
    ok: d.ok === true,
    scanned: num(d.scanned),
    exceptionsRaised: num(d.exceptions_raised),
    exposureCents: num(d.exposure_cents),
    breaks: obj(d.breaks) as Record<string, number>,
    error: typeof d.error === "string" ? d.error : undefined,
  };
}

export async function escalateBreachedExceptions(): Promise<{ ok: boolean; escalated: number; error?: string }> {
  const { data, error } = await rpc("escalate_breached_exceptions");
  if (error) return { ok: false, escalated: 0, error: error.message };
  const d = obj(data);
  return { ok: d.ok === true, escalated: num(d.escalated), error: typeof d.error === "string" ? d.error : undefined };
}

export async function emitRevenueEvent(transactionId: string) {
  const { data, error } = await rpc("emit_revenue_event", { _transaction_id: transactionId, _source: "control_tower" });
  if (error) return { ok: false, emitted: false, idempotent: false, reason: error.message };
  const d = obj(data);
  return {
    ok: d.ok === true,
    emitted: d.emitted === true,
    idempotent: d.idempotent === true,
    amountCents: num(d.amount_cents),
    ruleKey: typeof d.rule_key === "string" ? d.rule_key : null,
    reason: typeof d.reason === "string" ? d.reason : (typeof d.error === "string" ? d.error : ""),
    blockers: arr<string>(d.blockers),
  };
}

export async function emitEligibleRevenueEvents(limit = 200) {
  const { data, error } = await rpc("emit_eligible_revenue_events", { _limit: limit });
  if (error) return { ok: false, emitted: 0, skipped: 0, error: error.message };
  const d = obj(data);
  return { ok: d.ok === true, emitted: num(d.emitted), skipped: num(d.skipped), error: typeof d.error === "string" ? d.error : undefined };
}

export async function createSettlementObligation(transactionId: string) {
  const { data, error } = await rpc("create_settlement_obligation", { _transaction_id: transactionId });
  if (error) return { ok: false, reason: error.message };
  const d = obj(data);
  return {
    ok: d.ok === true,
    idempotent: d.idempotent === true,
    settlementId: typeof d.settlement_id === "string" ? d.settlement_id : null,
    entitlementCents: num(d.entitlement_cents),
    reason: typeof d.reason === "string" ? d.reason : (typeof d.error === "string" ? d.error : ""),
  };
}

export async function rebuildLineage(transactionId: string) {
  const { data, error } = await rpc("rebuild_commercial_lineage", { _transaction_id: transactionId });
  if (error) return { ok: false, completenessPct: 0, error: error.message };
  const d = obj(data);
  return { ok: d.ok === true, completenessPct: num(d.completeness_pct), stagesPresent: num(d.stages_present) };
}

export async function loadTrace(transactionRef: string): Promise<TransactionTrace> {
  const { data, error } = await rpc("commercial_transaction_trace", { _transaction_ref: transactionRef });
  const empty: TransactionTrace = {
    ok: false, transaction: null, stages: [], eligibilityChecks: [], exceptions: [],
    settlement: null, revenueEvent: null,
  };
  if (error) return { ...empty, error: error.message };
  const d = obj(data);
  if (d.ok !== true) return { ...empty, error: typeof d.error === "string" ? d.error : "trace_unavailable" };
  return {
    ok: true,
    transaction: obj(d.transaction),
    stages: arr<LineageStage>(d.stages),
    eligibilityChecks: arr<Record<string, unknown>>(d.eligibility_checks),
    exceptions: arr<Record<string, unknown>>(d.exceptions),
    settlement: d.settlement ? obj(d.settlement) : null,
    revenueEvent: d.revenue_event ? obj(d.revenue_event) : null,
  };
}

export async function loadRevenueAtRisk(): Promise<{ ok: boolean; totalCents: number; items: ExceptionItem[]; error?: string }> {
  const { data, error } = await rpc("commercial_revenue_at_risk");
  if (error) return { ok: false, totalCents: 0, items: [], error: error.message };
  const d = obj(data);
  return { ok: d.ok === true, totalCents: num(d.total_at_risk_cents), items: arr<ExceptionItem>(d.items) };
}

export interface RevenueExplain {
  ok: boolean;
  totalCents: number;
  byServiceLine: Array<{ service_line: string; events: number; amount_cents: number }>;
  byCustomer: Array<{ customer_kind: string; corporate_id: string | null; events: number; amount_cents: number }>;
  events: Array<{ transaction_ref: string; amount_cents: number; recognized_at: string; rule_key: string | null; payment_ref: string | null }>;
  error?: string;
}

export async function loadRevenueExplain(fromISO?: string): Promise<RevenueExplain> {
  const { data, error } = await rpc("commercial_revenue_explain", fromISO ? { _from: fromISO } : {});
  if (error) return { ok: false, totalCents: 0, byServiceLine: [], byCustomer: [], events: [], error: error.message };
  const d = obj(data);
  return {
    ok: d.ok === true,
    totalCents: num(d.total_cents),
    byServiceLine: arr(d.by_service_line),
    byCustomer: arr(d.by_customer),
    events: arr(d.events),
  };
}

export async function loadMorningBrief(): Promise<MorningBrief> {
  const { data, error } = await rpc("commercial_morning_brief");
  const empty: MorningBrief = {
    ok: false, asOf: null,
    yesterday: { revenueCents: 0, contributionCents: 0, transactions: 0, fulfilments: 0, collectionsCents: 0, exceptions: 0 },
    topRisks: [], approvalsRequired: 0, criticalIncidents: 0, learning: [], integrity: null,
  };
  if (error) return { ...empty, error: error.message };
  const d = obj(data);
  const y = obj(d.yesterday);
  const t = obj(d.today);
  return {
    ok: d.ok === true,
    asOf: typeof d.as_of === "string" ? d.as_of : null,
    yesterday: {
      revenueCents: num(y.revenue_cents),
      contributionCents: num(y.contribution_cents),
      transactions: num(y.transactions),
      fulfilments: num(y.fulfilments),
      collectionsCents: num(y.collections_cents),
      exceptions: num(y.exceptions),
    },
    topRisks: arr<ExceptionItem>(t.top_risks),
    approvalsRequired: num(t.approvals_required),
    criticalIncidents: num(t.critical_incidents),
    learning: arr(d.learning),
    integrity: d.integrity ? parseIntegrity(d.integrity) : null,
  };
}

export async function certifyPhase85(): Promise<CertificationResult> {
  const { data, error } = await rpc("certify_phase_8_5");
  if (error) {
    return { ok: false, verdict: "FAIL", scorePct: 0, criteriaPassed: 0, criteriaTotal: 0, criteria: [], error: error.message };
  }
  const d = obj(data);
  return {
    ok: d.ok === true,
    verdict: d.verdict === "PASS" ? "PASS" : "FAIL",
    scorePct: num(d.score_pct),
    criteriaPassed: num(d.criteria_passed),
    criteriaTotal: num(d.criteria_total),
    criteria: arr<CertificationCriterion>(d.criteria),
    error: typeof d.error === "string" ? d.error : undefined,
  };
}

export async function recordLearning(input: {
  transactionId?: string | null;
  exceptionId?: string | null;
  decision: string;
  hypothesis?: string;
  actionTaken?: string;
  result?: string;
  cause?: string;
  learning: string;
  ruleOrModel?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) return { ok: false, error: "not_signed_in" };
  const { error } = await (supabase as any).from("commercial_decision_learning").insert({
    transaction_id: input.transactionId ?? null,
    exception_id: input.exceptionId ?? null,
    decision: input.decision,
    hypothesis: input.hypothesis ?? null,
    action_taken: input.actionTaken ?? null,
    result: input.result ?? null,
    cause: input.cause ?? null,
    learning: input.learning,
    rule_or_model: input.ruleOrModel ?? null,
    recorded_by: uid,
  });
  return { ok: !error, error: error?.message };
}

export function formatCents(cents: number | null | undefined, currency = "KES"): string {
  if (cents === null || cents === undefined) return "DATA NOT AVAILABLE";
  try {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(0)}`;
  }
}

/**
 * Where the economic chain breaks, counted honestly across a set of traces.
 * The first stage recorded as "missing" is the break point — reporting a later
 * stage as healthy while an earlier one is absent would be a false positive.
 */
export function firstBreak(stages: readonly LineageStage[]): LineageStage | null {
  const ordered = [...stages].sort((a, b) => a.stage_no - b.stage_no);
  return ordered.find((s) => s.status === "missing") ?? null;
}
