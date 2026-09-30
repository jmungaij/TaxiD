// _shared/trace.ts — W3C Trace Context + payment envelope helpers.
//
// Every payment event/edge function must import from here so that
// trace_id / span_id / parent_span_id / correlation_id flow end-to-end
// across Orchestrator → STK → Callback → Wallet → Ledger → Settlement →
// Notification Worker → payment-notify.

export interface TraceContext {
  trace_id: string;      // 32 hex chars (W3C)
  span_id: string;       // 16 hex chars (W3C)
  parent_span_id?: string;
  correlation_id: string;
}

export interface PaymentEventEnvelope extends TraceContext {
  idempotency_key: string;
  event_version: string;
  schema_version: string;
  deployment_version?: string;
  git_revision?: string;
  tenant_id?: string;
  environment: string;
  payment_session_id?: string;
  payment_attempt_id?: string;
}

const ENV = Deno.env.get("PAYMENT_ENV") ?? "production";
const DEPLOY = Deno.env.get("DEPLOYMENT_VERSION") ?? Deno.env.get("SUPABASE_DEPLOYMENT_ID") ?? null;
const GIT = Deno.env.get("GIT_REVISION") ?? null;

function randHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Generate a new W3C trace id (128-bit hex). */
export function newTraceId(): string { return randHex(16); }
/** Generate a new W3C span id (64-bit hex). */
export function newSpanId(): string { return randHex(8); }

/** Parse `traceparent` header per W3C: 00-<trace>-<span>-<flags>. */
export function parseTraceparent(v: string | null): { trace_id: string; span_id: string } | null {
  if (!v) return null;
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(v.trim());
  return m ? { trace_id: m[1], span_id: m[2] } : null;
}

/** Serialise a traceparent header for downstream fetches. */
export function toTraceparent(ctx: TraceContext, sampled = true): string {
  return `00-${ctx.trace_id}-${ctx.span_id}-${sampled ? "01" : "00"}`;
}

/** Extract trace context from an incoming Request, minting missing pieces. */
export function extractTraceContext(req: Request): TraceContext {
  const h = req.headers;
  const tp = parseTraceparent(h.get("traceparent"));
  const trace_id = tp?.trace_id ?? h.get("x-trace-id") ?? newTraceId();
  const parent_span_id = tp?.span_id ?? h.get("x-parent-span-id") ?? h.get("x-span-id") ?? undefined;
  const span_id = newSpanId(); // this hop's span
  const correlation_id =
    h.get("x-correlation-id") ?? h.get("x-request-id") ?? crypto.randomUUID();
  return { trace_id, span_id, parent_span_id, correlation_id };
}

/** Merge trace context from a JSON envelope (fallback when headers absent). */
export function extractTraceFromBody(body: Record<string, unknown> | null | undefined): Partial<TraceContext> {
  if (!body || typeof body !== "object") return {};
  const t = body as Record<string, unknown>;
  const out: Partial<TraceContext> = {};
  if (typeof t.trace_id === "string") out.trace_id = t.trace_id;
  if (typeof t.span_id === "string") out.parent_span_id = t.span_id;
  if (typeof t.correlation_id === "string") out.correlation_id = t.correlation_id;
  return out;
}

/** Build outbound headers propagating the trace context to the next hop. */
export function traceHeaders(ctx: TraceContext, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "traceparent": toTraceparent(ctx),
    "x-trace-id": ctx.trace_id,
    "x-span-id": ctx.span_id,
    ...(ctx.parent_span_id ? { "x-parent-span-id": ctx.parent_span_id } : {}),
    "x-correlation-id": ctx.correlation_id,
    ...extra,
  };
}

/** Build a full payment event envelope from a trace context + payment ids. */
export function buildEnvelope(
  ctx: TraceContext,
  opts: {
    idempotency_key?: string;
    payment_session_id?: string;
    payment_attempt_id?: string;
    tenant_id?: string;
    event_version?: string;
    schema_version?: string;
  } = {},
): PaymentEventEnvelope {
  return {
    ...ctx,
    idempotency_key: opts.idempotency_key ?? ctx.correlation_id,
    event_version: opts.event_version ?? "1.0",
    schema_version: opts.schema_version ?? "1.0",
    deployment_version: DEPLOY ?? undefined,
    git_revision: GIT ?? undefined,
    tenant_id: opts.tenant_id,
    environment: ENV,
    payment_session_id: opts.payment_session_id,
    payment_attempt_id: opts.payment_attempt_id,
  };
}

/** Deterministic sha256 hex of a JSON payload — used for DLQ payload_hash. */
export async function payloadHash(payload: unknown): Promise<string> {
  const s = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Cheap error signature (first line of message, trimmed) — for poison detection. */
export function errorSignature(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.split("\n")[0].slice(0, 200);
}
