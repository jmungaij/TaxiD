// Payment Journey helpers — Phase 0 certification framework.
//
// Every payment-path edge function uses these helpers to record persisted
// evidence of each stage. None of these calls must ever throw upward — they
// are best-effort observability writes.
//
// Design:
//   • `beginInvocation` writes a workflow_invocations row in STARTED state
//     BEFORE any business logic. Even if the function crashes on the next
//     line, the invocation is recorded.
//   • `finishInvocation` updates that row with SUCCEEDED / FAILED / etc.
//   • `stage` upserts a payment_journey_stages row (per correlation_id).
//   • `event` appends an immutable payment_journey_events row.
//   • `transition` records a payment_state_transitions row.
//   • `classifyRootCause` writes / replaces a payment_rca_classifications row.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type StageStatus = "INVOKED" | "OK" | "SKIPPED" | "FAILED" | "WAITING" | "TIMED_OUT";
export type EventStatus = "OK" | "INVOKED" | "SKIPPED" | "FAILED" | "WAITING" | "RETRIED";
export type PaymentState =
  | "INITIATED" | "SESSION_CREATED" | "ATTEMPT_CREATED" | "STK_REQUESTED"
  | "TOKEN_GRANTED" | "DARAJA_ACCEPTED" | "CUSTOMER_PROMPTED" | "CALLBACK_RECEIVED"
  | "VALIDATED" | "PROCESSING" | "WALLET_UPDATED" | "LEDGER_POSTED" | "SETTLED"
  | "COMPLETED" | "FAILED" | "TIMED_OUT" | "CANCELLED";

/**
 * Canonical workflow name aliases. Historical callers emitted dotted paths
 * (e.g. "payment.wallet.topup"); the registry uses snake_case. Normalize at
 * the write boundary so every invocation joins to workflow_registry. Keep
 * the original in metadata.original_workflow_name for provenance.
 */
const WORKFLOW_NAME_ALIASES: Record<string, string> = {
  "payment.wallet.topup": "wallet_topup",
  "payment.ride.settlement": "ride_payment",
  "payment.ride": "ride_payment",
  "payment.corporate": "corporate_payment",
  "payment.settlement": "settlement",
  "payment.reconciliation": "reconciliation",
};
export function canonicalWorkflowName(name: string | null | undefined): { canonical: string; alias: string | null } {
  const raw = (name ?? "").trim();
  if (!raw) return { canonical: "unknown", alias: null };
  const mapped = WORKFLOW_NAME_ALIASES[raw];
  return mapped ? { canonical: mapped, alias: raw } : { canonical: raw, alias: null };
}

export interface BeginInvocationArgs {
  functionName: string;
  workflowName?: string;
  workflowVersion?: string;
  correlationId: string;
  parentCorrelationId?: string | null;
  requestId: string;
  userId?: string | null;
  caller?: string | null;
  callerRole?: string | null;
  tenantId?: string | null;
  region?: string | null;
  environment?: string | null;
  currentStep?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  httpMethod?: string | null;
  metadata?: Record<string, unknown>;
}

/** Write STARTED invocation row before any business logic. Returns the id. */
export async function beginInvocation(args: BeginInvocationArgs): Promise<string | null> {
  try {
    const raw = args.workflowName ?? args.functionName;
    const { canonical, alias } = canonicalWorkflowName(raw);
    const md: Record<string, unknown> = { ...(args.metadata ?? {}) };
    if (alias) md.original_workflow_name = alias;
    const { data, error } = await admin
      .from("workflow_invocations")
      .insert({
        workflow_name: canonical,
        workflow_version: args.workflowVersion ?? null,
        correlation_id: args.correlationId,
        parent_correlation_id: args.parentCorrelationId ?? null,
        request_id: args.requestId,
        function_name: args.functionName,
        deployment_id: Deno.env.get("SUPABASE_FUNCTION_VERSION")
          ?? Deno.env.get("DENO_DEPLOYMENT_ID") ?? null,
        git_sha: Deno.env.get("GIT_SHA") ?? null,
        user_id: args.userId ?? null,
        caller: args.caller ?? null,
        caller_role: args.callerRole ?? null,
        tenant_id: args.tenantId ?? null,
        region: args.region ?? Deno.env.get("DENO_REGION") ?? null,
        environment: args.environment ?? Deno.env.get("MPESA_ENV") ?? null,
        current_step: args.currentStep ?? null,
        current_state: "INITIATED",
        execution_status: "STARTED",
        ip: args.ip ?? null,
        user_agent: args.userAgent ?? null,
        http_method: args.httpMethod ?? null,
        metadata: md,
      })
      .select("id")
      .single();
    if (error) {
      console.log(JSON.stringify({ level: "warn", event: "journey_begin_failed", error: error.message }));
      return null;
    }
    // Best-effort registry heartbeat
    admin.from("edge_function_registry")
      .update({
        last_invocation_at: new Date().toISOString(),
        invocation_count: (undefined as unknown) as never, // updated by trigger elsewhere if desired
      })
      .eq("function_name", args.functionName)
      .then(() => {});
    return data?.id ?? null;
  } catch (e) {
    console.log(JSON.stringify({ level: "warn", event: "journey_begin_exception", error: String(e) }));
    return null;
  }
}

export interface FinishInvocationArgs {
  invocationId: string | null;
  status: "SUCCEEDED" | "FAILED" | "ABORTED" | "TIMED_OUT";
  durationMs: number;
  currentStep?: string | null;
  currentState?: PaymentState | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function finishInvocation(a: FinishInvocationArgs): Promise<void> {
  if (!a.invocationId) return;
  try {
    await admin.from("workflow_invocations")
      .update({
        execution_status: a.status,
        completed_at: new Date().toISOString(),
        duration_ms: a.durationMs,
        current_step: a.currentStep ?? null,
        current_state: a.currentState ?? null,
        error_code: a.errorCode ?? null,
        error_message: a.errorMessage ?? null,
      })
      .eq("id", a.invocationId);
    // registry counters
    const patch: Record<string, unknown> = { last_invocation_at: new Date().toISOString() };
    if (a.status === "SUCCEEDED") patch.last_success_at = new Date().toISOString();
    else patch.last_failure_at = new Date().toISOString();
  } catch (e) {
    console.log(JSON.stringify({ level: "warn", event: "journey_finish_exception", error: String(e) }));
  }
}

export interface StageArgs {
  correlationId: string;
  paymentAttemptId?: string | null;
  stageKey: string;
  status: StageStatus;
  latencyMs?: number | null;
  evidence?: Record<string, unknown>;
}

export async function stage(a: StageArgs): Promise<void> {
  try {
    await admin.from("payment_journey_stages").upsert({
      correlation_id: a.correlationId,
      payment_attempt_id: a.paymentAttemptId ?? null,
      stage_key: a.stageKey,
      status: a.status,
      latency_ms: a.latencyMs ?? null,
      evidence: a.evidence ?? {},
      occurred_at: new Date().toISOString(),
    }, { onConflict: "correlation_id,stage_key" });
  } catch (e) {
    console.log(JSON.stringify({ level: "warn", event: "journey_stage_exception", error: String(e) }));
  }
}

export interface EventArgs {
  correlationId: string;
  parentCorrelationId?: string | null;
  workflowName?: string | null;
  eventKey: string;
  eventStatus?: EventStatus;
  actor?: string | null;
  sourceComponent?: string | null;
  paymentAttemptId?: string | null;
  paymentSessionId?: string | null;
  checkoutRequestId?: string | null;
  merchantRequestId?: string | null;
  phone?: string | null;
  walletId?: string | null;
  rideId?: string | null;
  orderId?: string | null;
  latencyMs?: number | null;
  evidence?: Record<string, unknown>;
}

export async function event(a: EventArgs): Promise<void> {
  try {
    await admin.from("payment_journey_events").insert({
      correlation_id: a.correlationId,
      parent_correlation_id: a.parentCorrelationId ?? null,
      workflow_name: a.workflowName ?? null,
      event_key: a.eventKey,
      event_status: a.eventStatus ?? "OK",
      actor: a.actor ?? null,
      source_component: a.sourceComponent ?? null,
      payment_attempt_id: a.paymentAttemptId ?? null,
      payment_session_id: a.paymentSessionId ?? null,
      checkout_request_id: a.checkoutRequestId ?? null,
      merchant_request_id: a.merchantRequestId ?? null,
      phone: a.phone ?? null,
      wallet_id: a.walletId ?? null,
      ride_id: a.rideId ?? null,
      order_id: a.orderId ?? null,
      latency_ms: a.latencyMs ?? null,
      evidence: a.evidence ?? {},
    });
  } catch (e) {
    console.log(JSON.stringify({ level: "warn", event: "journey_event_exception", error: String(e) }));
  }
}

export interface TransitionArgs {
  correlationId: string;
  paymentAttemptId?: string | null;
  fromState?: PaymentState | null;
  toState: PaymentState;
  actor?: string | null;
  sourceFunction?: string | null;
  reason?: string | null;
  evidence?: Record<string, unknown>;
}

export async function transition(a: TransitionArgs): Promise<void> {
  try {
    await admin.from("payment_state_transitions").insert({
      correlation_id: a.correlationId,
      payment_attempt_id: a.paymentAttemptId ?? null,
      from_state: a.fromState ?? null,
      to_state: a.toState,
      actor: a.actor ?? null,
      source_function: a.sourceFunction ?? null,
      reason: a.reason ?? null,
      evidence: a.evidence ?? {},
    });
  } catch (e) {
    console.log(JSON.stringify({ level: "warn", event: "journey_transition_exception", error: String(e) }));
  }
}

export interface ClassifyRootCauseArgs {
  correlationId: string;
  paymentAttemptId?: string | null;
  category: string;
  lastSuccessfulStage?: string | null;
  firstFailedStage?: string | null;
  supportingEvidence?: Record<string, unknown>;
  classifiedBy?: string;
}

export async function classifyRootCause(a: ClassifyRootCauseArgs): Promise<void> {
  try {
    await admin.from("payment_rca_classifications").upsert({
      correlation_id: a.correlationId,
      payment_attempt_id: a.paymentAttemptId ?? null,
      category: a.category,
      last_successful_stage: a.lastSuccessfulStage ?? null,
      first_failed_stage: a.firstFailedStage ?? null,
      supporting_evidence: a.supportingEvidence ?? {},
      classified_by: a.classifiedBy ?? "auto",
      classified_at: new Date().toISOString(),
    }, { onConflict: "correlation_id,category" });
  } catch (e) {
    console.log(JSON.stringify({ level: "warn", event: "journey_rca_exception", error: String(e) }));
  }
}

export interface StepArgs {
  correlationId: string;
  invocationId?: string | null;
  paymentAttemptId?: string | null;
  functionName: string;
  stepNumber: number;
  stepKey: string;
  stepName?: string;
  status: "STARTED" | "OK" | "SKIPPED" | "FAILED" | "TIMED_OUT" | "RETRIED";
  latencyMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  evidence?: Record<string, unknown>;
}

/** Record a step-level trace row (Slice 2). Best-effort — never throws. */
export async function step(a: StepArgs): Promise<void> {
  try {
    await admin.from("payment_step_traces").insert({
      correlation_id: a.correlationId,
      invocation_id: a.invocationId ?? null,
      payment_attempt_id: a.paymentAttemptId ?? null,
      function_name: a.functionName,
      step_number: a.stepNumber,
      step_key: a.stepKey,
      step_name: a.stepName ?? null,
      status: a.status,
      latency_ms: a.latencyMs ?? null,
      error_code: a.errorCode ?? null,
      error_message: a.errorMessage ?? null,
      evidence: a.evidence ?? {},
    });
  } catch (e) {
    console.log(JSON.stringify({ level: "warn", event: "journey_step_exception", error: String(e) }));
  }
}

/** Compute + persist a Journey Health Score from stage/step outcomes. */
export async function computeHealthSnapshot(correlationId: string, paymentAttemptId?: string | null): Promise<void> {
  try {
    const [{ data: stages }, { data: steps }, { data: invs }] = await Promise.all([
      admin.from("payment_journey_stages").select("stage_key,status,latency_ms").eq("correlation_id", correlationId),
      admin.from("payment_step_traces").select("step_key,status,latency_ms").eq("correlation_id", correlationId),
      admin.from("workflow_invocations").select("execution_status,duration_ms").eq("correlation_id", correlationId),
    ]);
    const totals = { stages: (stages ?? []).length, steps: (steps ?? []).length, invs: (invs ?? []).length };
    const failed = {
      stages: (stages ?? []).filter((s: any) => ["FAILED","TIMED_OUT"].includes(s.status)).length,
      steps: (steps ?? []).filter((s: any) => ["FAILED","TIMED_OUT"].includes(s.status)).length,
      invs: (invs ?? []).filter((s: any) => ["FAILED","TIMED_OUT","ABORTED"].includes(s.execution_status)).length,
    };
    const okRatio = (denom: number, fails: number) => denom ? Math.max(0, (denom - fails) / denom) : 1;
    const score = Math.round(100 * (
      0.4 * okRatio(totals.stages, failed.stages) +
      0.4 * okRatio(totals.steps, failed.steps) +
      0.2 * okRatio(totals.invs, failed.invs)
    ) * 100) / 100;
    const grade = score >= 95 ? "A" : score >= 85 ? "B" : score >= 70 ? "C" : score >= 50 ? "D" : "F";
    await admin.from("journey_health_snapshots").insert({
      correlation_id: correlationId,
      payment_attempt_id: paymentAttemptId ?? null,
      score, grade,
      breakdown: { totals, failed },
    });
  } catch (e) {
    console.log(JSON.stringify({ level: "warn", event: "journey_health_exception", error: String(e) }));
  }
}

/** 15-step canonical STK-push instrumentation registry. */
export const STK_STEPS = {
  "01_function_entered":       { n: 1,  name: "Function entered" },
  "02_body_validated":         { n: 2,  name: "Request body validated" },
  "03_jwt_verified":           { n: 3,  name: "JWT verified" },
  "04_breaker_checked":        { n: 4,  name: "Circuit breaker checked" },
  "05_idempotency_resolved":   { n: 5,  name: "Idempotency key resolved" },
  "06_wallet_loaded":          { n: 6,  name: "Wallet loaded" },
  "07_attempt_opened":         { n: 7,  name: "Payment attempt opened" },
  "08_fraud_evaluated":        { n: 8,  name: "Fraud engine evaluated" },
  "09_ratelimiter_passed":     { n: 9,  name: "Rate limiter passed" },
  "10_oauth_token_acquired":   { n: 10, name: "Daraja OAuth token acquired" },
  "11_stk_payload_built":      { n: 11, name: "STK payload built" },
  "12_daraja_request_sent":    { n: 12, name: "Daraja request sent" },
  "13_daraja_response_parsed": { n: 13, name: "Daraja response parsed" },
  "14_state_transitioned":     { n: 14, name: "Payment state transitioned" },
  "15_response_returned":      { n: 15, name: "Response returned" },
} as const;
export type StkStepKey = keyof typeof STK_STEPS;

/** Stage key registry — keep centralized so admin explorer stays consistent. */
export const STAGE = {
  CHECKOUT_SUBMITTED: "checkout_submitted",
  INVOKE_DISPATCHED: "invoke_dispatched",
  FUNCTION_ENTERED: "function_entered",
  JWT_VERIFIED: "jwt_verified",
  WALLET_LOADED: "wallet_loaded",
  ATTEMPT_OPENED: "attempt_opened",
  FRAUD_EVALUATED: "fraud_evaluated",
  RATE_LIMITER_PASSED: "rate_limiter_passed",
  OAUTH_REQUESTED: "oauth_requested",
  OAUTH_RECEIVED: "oauth_received",
  STK_PAYLOAD_BUILT: "stk_payload_built",
  DARAJA_REQUEST_SENT: "daraja_request_sent",
  DARAJA_ACCEPTED: "daraja_accepted",
  STK_ATTEMPT_LOGGED: "stk_attempt_logged",
  MPESA_TRANSACTION_INSERTED: "mpesa_transaction_inserted",
  CALLBACK_RECEIVED: "callback_received",
  CALLBACK_PERSISTED: "callback_persisted",
  CALLBACK_CLASSIFIED: "callback_classified",
  WALLET_CREDITED: "wallet_credited",
  LEDGER_POSTED: "ledger_posted",
  SETTLEMENT_POSTED: "settlement_posted",
  NOTIFICATION_DISPATCHED: "notification_dispatched",
} as const;
