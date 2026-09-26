/**
 * CENTRAL OBSERVABILITY PIPELINE (client side).
 *
 * One structured event model for every runtime signal: auth redirects, API
 * refusals, booking/dispatch/payment outcomes, routing, deployment and cache
 * problems. Events are kept in a bounded in-memory ring for the operator
 * console, emitted as structured console records (never free-text), and
 * best-effort forwarded to the backend analytics sink.
 *
 * Nothing here may throw: observability must never break the product.
 */
import { supabase } from "@/integrations/supabase/client";
import { buildManifest } from "./buildManifest";

export type DiagnosticCategory =
  | "AUTH"
  | "API"
  | "BOOKING"
  | "DISPATCH"
  | "PAYMENT"
  | "DATABASE"
  | "INTEGRATION"
  | "RUNTIME"
  | "ROUTING"
  | "DEPLOYMENT"
  | "CACHE"
  | "SERVICE_ACTIVATION";

export type DiagnosticSeverity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface DiagnosticEvent {
  event_id: string;
  timestamp: string;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  environment: string;
  build_id: string;
  service: string | null;
  operation: string;
  route: string | null;
  correlation_id: string;
  request_id: string;
  user_ref: string | null;
  tenant_ref: string | null;
  error_code: string | null;
  message: string;
  metadata: Record<string, unknown>;
}

const RING_LIMIT = 200;
const ring: DiagnosticEvent[] = [];
const listeners = new Set<(e: DiagnosticEvent) => void>();

export function newCorrelationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Short, human-quotable support reference derived from a correlation id. */
export function supportReference(correlationId: string): string {
  const compact = correlationId.replace(/[^0-9a-z]/gi, "").toUpperCase();
  return `YM-ERR-${compact.slice(0, 8).padEnd(8, "0")}`;
}

/** Opaque, non-reversible reference for identifiers we must not store raw. */
export function hashRef(value: string | null | undefined): string | null {
  if (!value) return null;
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(16)}`;
}

export interface RecordInput {
  category: DiagnosticCategory;
  severity?: DiagnosticSeverity;
  operation: string;
  message: string;
  service?: string | null;
  route?: string | null;
  correlationId?: string;
  requestId?: string;
  userRef?: string | null;
  tenantRef?: string | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
  /** Forward to the backend sink. Defaults to true for WARNING and above. */
  persist?: boolean;
}

export function recordDiagnostic(input: RecordInput): DiagnosticEvent {
  const manifest = buildManifest();
  const correlationId = input.correlationId ?? newCorrelationId();
  const event: DiagnosticEvent = {
    event_id: newCorrelationId(),
    timestamp: new Date().toISOString(),
    category: input.category,
    severity: input.severity ?? "INFO",
    environment: manifest.environment,
    build_id: manifest.build_id,
    service: input.service ?? null,
    operation: input.operation,
    route: input.route ?? (typeof window !== "undefined" ? window.location.pathname : null),
    correlation_id: correlationId,
    request_id: input.requestId ?? correlationId,
    user_ref: input.userRef ?? null,
    tenant_ref: input.tenantRef ?? null,
    error_code: input.errorCode ?? null,
    message: input.message,
    metadata: input.metadata ?? {},
  };

  ring.push(event);
  if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT);
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      /* listener faults are never fatal */
    }
  }

  // Structured console record — one JSON object, greppable, no free text.
  const line = JSON.stringify({ ym_diagnostic: event });
  if (event.severity === "ERROR" || event.severity === "CRITICAL") console.error(line);
  else if (event.severity === "WARNING") console.warn(line);
  // The diagnostics module is the one sanctioned console sink in the app:
  // everything else routes through recordDiagnostic(), so INFO records are
  // emitted here and nowhere else.
  // eslint-disable-next-line no-console
  else console.info(line);

  const shouldPersist =
    input.persist ?? ["WARNING", "ERROR", "CRITICAL"].includes(event.severity);
  if (shouldPersist) void persist(event);

  return event;
}

async function persist(event: DiagnosticEvent): Promise<void> {
  try {
    await supabase.from("analytics_events").insert({
      event_name: `diag.${event.category.toLowerCase()}.${event.operation}`,
      properties: event as unknown as Record<string, unknown>,
    } as never);
  } catch {
    /* sink unavailable — the ring buffer and console record remain */
  }
}

export function diagnosticLog(): DiagnosticEvent[] {
  return [...ring].reverse();
}

export function subscribeDiagnostics(fn: (e: DiagnosticEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearDiagnostics(): void {
  ring.length = 0;
}
