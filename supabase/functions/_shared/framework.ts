// Edge Function Framework — Yalla Mobility
//
// One wrapper for ALL edge functions. Provides:
//   - CORS (preflight + headers on every response)
//   - JWT auth (optional, on by default)
//   - Zod request validation
//   - Request-ID + correlation-ID propagation
//   - Structured JSON logs
//   - Uniform error envelope
//   - Latency capture
//   - Fire-and-forget invocation row in `public.edge_function_invocations`
//
// Usage:
//   import { withRequest, ok, fail } from "../_shared/framework.ts";
//   import { z } from "npm:zod@3";
//
//   const Body = z.object({ amount: z.number().int().min(1) });
//
//   Deno.serve(withRequest({
//     name: "my-fn",
//     auth: true,
//     schema: Body,
//     handler: async ({ body, user, log, requestId }) => {
//       log.info("processing", { amount: body.amount });
//       return ok({ ok: true });
//     },
//   }));

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

// Extend the default Supabase CORS allow-list with the custom headers our web
// client sends via `invokeWithJourney` (correlation/trace propagation +
// idempotency). Without these, the browser preflight fails and the caller
// sees "TypeError: Failed to fetch" before the function is ever invoked.
const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers": [
    baseCorsHeaders["Access-Control-Allow-Headers"] ??
      "authorization, x-client-info, apikey, content-type",
    "x-correlation-id",
    "x-request-id",
    "x-retry-count",
    "x-request-received-at",
    "x-event-type",
    "x-device-fingerprint",
    "traceparent",
    "tracestate",
    "idempotency-key",
    "x-internal-secret",
  ].join(", "),
  "Access-Control-Max-Age": "86400",
};
import type { ZodSchema } from "npm:zod@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Cold-start flag: flipped to false on first request served by this isolate.
let COLD_START = true;
const REGION = Deno.env.get("DENO_REGION") ?? Deno.env.get("SB_REGION") ?? null;
const DEPLOYMENT_ID = Deno.env.get("SUPABASE_FUNCTION_VERSION")
  ?? Deno.env.get("DENO_DEPLOYMENT_ID") ?? null;

/** Parse W3C traceparent: `version-traceId-spanId-flags`. */
function parseTraceparent(h: string | null): { traceId: string | null; parentSpanId: string | null } {
  if (!h) return { traceId: null, parentSpanId: null };
  const parts = h.split("-");
  if (parts.length < 4) return { traceId: null, parentSpanId: null };
  return { traceId: parts[1] || null, parentSpanId: parts[2] || null };
}
function randHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
function currentMemoryMb(): number | null {
  try {
    const mu = (Deno as unknown as { memoryUsage?: () => { rss: number } }).memoryUsage?.();
    return mu ? Math.round(mu.rss / (1024 * 1024)) : null;
  } catch { return null; }
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface Logger {
  info: (event: string, ctx?: Record<string, unknown>) => void;
  warn: (event: string, ctx?: Record<string, unknown>) => void;
  error: (event: string, ctx?: Record<string, unknown>) => void;
}

export interface HandlerContext<TBody = unknown> {
  req: Request;
  body: TBody;
  user: { id: string; email?: string; role?: string } | null;
  log: Logger;
  requestId: string;
  correlationId: string;
  admin: SupabaseClient;
}

export interface FrameworkOptions<TBody> {
  name: string;
  auth?: boolean;            // default true
  schema?: ZodSchema<TBody>; // optional Zod body validator
  handler: (ctx: HandlerContext<TBody>) => Promise<Response>;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "ERROR", public details?: unknown) {
    super(message);
  }
}

function makeLogger(fn: string, requestId: string, correlationId: string): Logger {
  const base = (level: "info" | "warn" | "error", event: string, ctx: Record<string, unknown> = {}) => {
    console.log(JSON.stringify({
      level, fn, event,
      request_id: requestId,
      correlation_id: correlationId,
      ts: new Date().toISOString(),
      ...ctx,
    }));
  };
  return {
    info: (e, c) => base("info", e, c),
    warn: (e, c) => base("warn", e, c),
    error: (e, c) => base("error", e, c),
  };
}

function uuid(): string {
  return crypto.randomUUID();
}

export function ok(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    status: init.status ?? 200,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

export function fail(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(JSON.stringify({ error: { code, message, details } }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function withRequest<TBody = unknown>(opts: FrameworkOptions<TBody>) {
  const { name, auth = true, schema, handler } = opts;

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const t0 = Date.now();
    const isCold = COLD_START;
    COLD_START = false;
    const memStart = currentMemoryMb();
    const requestId = req.headers.get("x-request-id") || uuid();
    const correlationId = req.headers.get("x-correlation-id") || requestId;
    const { traceId: incomingTrace, parentSpanId } = parseTraceparent(req.headers.get("traceparent"));
    const traceId = incomingTrace ?? randHex(16);
    const spanId = randHex(8);
    const retryCount = Number(req.headers.get("x-retry-count") ?? "0") || 0;
    const receivedAt = Number(req.headers.get("x-request-received-at") ?? "0");
    const queueTimeMs = receivedAt > 0 && receivedAt <= t0 ? t0 - receivedAt : null;
    const requestBytesHeader = Number(req.headers.get("content-length") ?? "");
    let requestBytes: number | null = Number.isFinite(requestBytesHeader) && requestBytesHeader > 0
      ? requestBytesHeader : null;
    const eventType = req.headers.get("x-event-type") ?? null;
    const routePath = (() => { try { return new URL(req.url).pathname; } catch { return null; } })();
    const log = makeLogger(name, requestId, correlationId);

    let user: HandlerContext["user"] = null;
    let tenantId: string | null = null;
    let countryCode: string | null = null;
    let status = 500;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    let response: Response;

    try {
      // ---- Auth ---------------------------------------------------------
      if (auth) {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          throw new HttpError(401, "Missing bearer token", "UNAUTHORIZED");
        }
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const token = authHeader.replace("Bearer ", "");
        const { data, error } = await userClient.auth.getClaims(token);
        if (error || !data?.claims) {
          throw new HttpError(401, "Invalid token", "UNAUTHORIZED");
        }
        const c = data.claims as Record<string, unknown>;
        user = {
          id: c.sub as string,
          email: c.email as string | undefined,
          role: c.role as string | undefined,
        };
        const appMeta = (c.app_metadata ?? {}) as Record<string, unknown>;
        const userMeta = (c.user_metadata ?? {}) as Record<string, unknown>;
        tenantId = (appMeta.tenant_id as string) ?? (userMeta.tenant_id as string) ?? null;
        countryCode = (appMeta.country_code as string) ?? (userMeta.country_code as string) ?? null;
      }

      // ---- Body validation ---------------------------------------------
      let body: TBody = undefined as unknown as TBody;
      if (req.method !== "GET" && req.method !== "DELETE") {
        const raw = await req.text();
        if (requestBytes == null) requestBytes = new TextEncoder().encode(raw).length;
        const parsed = raw ? JSON.parse(raw) : {};
        if (schema) {
          const r = schema.safeParse(parsed);
          if (!r.success) {
            throw new HttpError(400, "Validation failed", "INVALID_INPUT", r.error.flatten());
          }
          body = r.data;
        } else {
          body = parsed as TBody;
        }
      }

      response = await handler({
        req, body, user, log, requestId, correlationId, admin,
      });
      status = response.status;

      // ensure framework headers present
      const hdrs = new Headers(response.headers);
      hdrs.set("x-request-id", requestId);
      hdrs.set("x-correlation-id", correlationId);
      hdrs.set("x-trace-id", traceId);
      hdrs.set("x-span-id", spanId);
      if (isCold) hdrs.set("x-cold-start", "1");
      for (const [k, v] of Object.entries(corsHeaders)) hdrs.set(k, v as string);
      response = new Response(response.body, { status: response.status, headers: hdrs });
    } catch (e) {
      if (e instanceof HttpError) {
        status = e.status;
        errorCode = e.code;
        errorMessage = e.message;
        log.warn("http_error", { status, code: e.code, message: e.message });
        response = fail(e.status, e.code, e.message, e.details);
      } else {
        status = 500;
        errorCode = "INTERNAL";
        errorMessage = (e as Error)?.message ?? "Internal error";
        log.error("unhandled", { error: errorMessage, stack: (e as Error)?.stack });
        response = fail(500, "INTERNAL", "Internal server error");
      }
    }

    const latency = Date.now() - t0;
    // Measure response bytes without consuming the body sent to the caller.
    let responseBytes: number | null = null;
    try {
      const clone = response.clone();
      const buf = await clone.arrayBuffer();
      responseBytes = buf.byteLength;
    } catch { /* ignore */ }
    const memEnd = currentMemoryMb();
    const memoryMb = memEnd ?? memStart ?? null;

    log.info("complete", {
      status, latency_ms: latency, cold_start: isCold, trace_id: traceId, span_id: spanId,
      tenant_id: tenantId, retry_count: retryCount, request_bytes: requestBytes,
      response_bytes: responseBytes, memory_mb: memoryMb,
    });

    // Fire-and-forget invocation row. Never block the response on this.
    try {
      const ip = req.headers.get("cf-connecting-ip")
        || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || null;
      admin.from("edge_function_invocations").insert({
        request_id: requestId,
        correlation_id: correlationId,
        function_name: name,
        user_id: user?.id ?? null,
        method: req.method,
        status_code: status,
        latency_ms: latency,
        error_code: errorCode,
        error_message: errorMessage,
        ip,
        user_agent: req.headers.get("user-agent"),
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        tenant_id: tenantId,
        country_code: countryCode,
        cold_start: isCold,
        request_bytes: requestBytes,
        response_bytes: responseBytes,
        retry_count: retryCount,
        queue_time_ms: queueTimeMs,
        cpu_time_ms: latency,
        memory_mb: memoryMb,
        region: REGION,
        deployment_id: DEPLOYMENT_ID,
        route_path: routePath,
        event_type: eventType,
      }).then(({ error }) => {
        if (error) console.log(JSON.stringify({
          level: "warn", fn: name, event: "invocation_log_failed", error: error.message,
        }));
      });
      // Keep edge_function_registry counters in sync (repair for B1.3 stale-counter drift).
      admin.rpc("record_edge_function_invocation", {
        p_function_name: name,
        p_status_code: status,
        p_latency_ms: latency,
        p_deployment_id: DEPLOYMENT_ID,
      }).then(({ error }) => {
        if (error) console.log(JSON.stringify({
          level: "warn", fn: name, event: "registry_sync_failed", error: error.message,
        }));
      });
    } catch (_) { /* swallow */ }

    return response;
  };
}
