// Client-side Payment Journey Logger — Phase 0.
//
// Captures every meaningful frontend event during a payment attempt
// (button clicked, validation, mutation start/end, invoke, response,
// UI updated) and persists it to `client_journey_events` linked by the
// same correlation_id used by backend services.
//
// This proves whether the frontend ever called the Edge Function, and
// what it received back. Combined with server-side workflow_invocations,
// admins can immediately tell which hypothesis is true (H1: never invoked,
// H2: wrong function, H3: invoked but exited early, etc.).

import { supabase } from "@/integrations/supabase/client";

export type ClientEventKey =
  | "button_clicked"
  | "validation_started"
  | "validation_passed"
  | "validation_failed"
  | "mutation_started"
  | "invoke_dispatched"
  | "invoke_returned"
  | "mutation_completed"
  | "ui_updated"
  | "polling_started"
  | "polling_transition"
  | "polling_completed"
  | "error_surfaced";

export interface JourneyContext {
  correlationId: string;
  route?: string;
  component?: string;
  targetFunction?: string;
}

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

/** Persist a client-side journey event. Best-effort; never throws. */
export async function logClientEvent(
  ctx: JourneyContext,
  eventKey: ClientEventKey,
  extras: {
    httpStatus?: number;
    durationMs?: number;
    success?: boolean;
    errorMessage?: string;
    evidence?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("client_journey_events").insert({
      correlation_id: ctx.correlationId,
      user_id: userData?.user?.id ?? null,
      session_id: sessionStorage.getItem("yalla.sessionId") ?? null,
      event_key: eventKey,
      route: ctx.route ?? window.location.pathname,
      component: ctx.component ?? null,
      target_function: ctx.targetFunction ?? null,
      http_status: extras.httpStatus ?? null,
      duration_ms: extras.durationMs ?? null,
      success: extras.success ?? null,
      error_message: extras.errorMessage ?? null,
      evidence: (extras.evidence ?? {}) as never,
    });
  } catch (e) {
    // observability must never break the UX
     
    console.warn("[journey] client event failed", e);
  }
}

/**
 * Wrap a Supabase functions.invoke() call with full journey logging.
 * Emits `invoke_dispatched` before the call and `invoke_returned` after,
 * regardless of success/failure, and propagates correlation headers.
 */
export async function invokeWithJourney<T = unknown>(
  ctx: JourneyContext,
  functionName: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<{ data: T | null; error: unknown; httpStatus?: number }> {
  const startedAt = performance.now();
  await logClientEvent(
    { ...ctx, targetFunction: functionName },
    "invoke_dispatched",
    { evidence: { body_keys: Object.keys(body) } as Record<string, unknown> },
  );

  const headers: Record<string, string> = {
    "x-correlation-id": ctx.correlationId,
    "x-request-id": ctx.correlationId,
    ...extraHeaders,
  };

  const bodyWithCorr = { ...body, correlation_id: ctx.correlationId };
  const res = await supabase.functions.invoke(functionName, {
    body: bodyWithCorr,
    headers,
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const httpStatus = (res as unknown as { response?: Response })?.response?.status;
  const err = res.error ? (res.error.message ?? String(res.error)) : undefined;

  await logClientEvent(
    { ...ctx, targetFunction: functionName },
    "invoke_returned",
    {
      httpStatus,
      durationMs,
      success: !res.error,
      errorMessage: err,
    },
  );

  return { data: (res.data as T) ?? null, error: res.error, httpStatus };
}
