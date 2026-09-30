// Slice D1 — Async notification consumer with trace propagation.
// Receives outbox deliveries for `payment.notify.*` and forwards to
// payment-notify with the full W3C trace context, so provider latency /
// failure never blocks the orchestrator and every dispatch is traceable
// back to the originating payment attempt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { extractTraceContext, traceHeaders } from "../_shared/trace.ts";

import { requireInternalOrStaff } from "../_shared/internal-auth.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Privileged worker: cron/service-role callers, or an admin "run now" button.
  try {
    await requireInternalOrStaff(req, ["admin", "super_admin"]);
  } catch (guardError) {
    const status = (guardError as { status?: number }).status ?? 401;
    return new Response(JSON.stringify({ error: (guardError as Error).message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const envelope = await req.json().catch(() => ({}));
    const notify = envelope?.payload?.notify ?? envelope?.notify ?? envelope?.payload;
    if (!notify?.event_type) {
      return new Response(JSON.stringify({ error: "missing payload.notify.event_type" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prefer envelope trace fields; fall back to request headers.
    const ctx = extractTraceContext(req);
    const trace_id = envelope.trace_id ?? ctx.trace_id;
    const parent_span_id = envelope.span_id ?? ctx.parent_span_id;
    const span_id = ctx.span_id;
    const correlation_id = envelope.correlation_id ?? notify.correlation_id ?? ctx.correlation_id;
    const idempotency_key = envelope.idempotency_key ?? notify.idempotency_key ?? correlation_id;

    const { data, error } = await admin.functions.invoke("payment-notify", {
      body: {
        event_type: notify.event_type,
        severity: notify.severity ?? "info",
        priority: notify.priority,
        payload: notify.payload ?? {},
        correlation_id,
        trace_id,
        span_id,
        parent_span_id,
        idempotency_key,
      },
      headers: traceHeaders({ trace_id, span_id, parent_span_id, correlation_id }),
    });
    if (error) {
      return new Response(JSON.stringify({ error: (error as Error).message, trace_id, correlation_id }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, forwarded: data ?? null, trace_id, correlation_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
