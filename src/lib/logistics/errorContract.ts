/**
 * LOGISTICS ERROR CONTRACT — the single frontend interpretation layer.
 *
 * Pages must not read `error.message` and invent their own copy. They call
 * `mapLogisticsError()` and render the returned presentation. The same event
 * yields two depths:
 *
 *   customer view → what happened, why, can I retry, what next
 *   operator view → code, service, state, required transition, correlation id
 *
 * Legacy edge-function payloads (pre-envelope shapes such as
 * `{ error: "service_not_bookable", reason_code, lifecycle }`) are normalised
 * here so no caller has to know which generation of the API answered.
 */
import {
  LOGISTICS_ERRORS,
  type LogisticsErrorEnvelope,
  type LogisticsErrorSeverity,
} from "../../../supabase/functions/_shared/logistics/errors.ts";

export type { LogisticsErrorEnvelope };
export { LOGISTICS_ERRORS };

export interface CustomerPresentation {
  /** Short headline, e.g. "Express is pilot-only". */
  title: string;
  /** What happened / why, customer safe. */
  detail: string;
  /** What the customer should do next. */
  action: string | null;
  /** Condition that would make this possible. */
  activationCondition: string | null;
  retryable: boolean;
}

export interface OperatorPresentation {
  code: string;
  category: string;
  severity: LogisticsErrorSeverity;
  service: string | null;
  operation: string;
  httpStatus: number;
  reason: string;
  correlationId: string;
  requestId: string;
  timestamp: string;
  /** Ordered operator facts, ready to render as a definition list. */
  facts: Array<{ label: string; value: string }>;
  details: Record<string, unknown>;
}

/** A single LG legal determination that is holding the operation closed. */
export interface LegalBlockingControl {
  control_id: string;
  title: string;
  reason_code: string;
  required_approval: string;
  owner: string | null;
}

export interface MappedLogisticsError {
  envelope: LogisticsErrorEnvelope;
  customer: CustomerPresentation;
  operator: OperatorPresentation;
  /** True when the refusal is a business state, not a fault. */
  isBusinessRefusal: boolean;
  /** True only for pilot-gated services. */
  isPilotOnly: boolean;
  /** Suggested UI route when the service cannot be booked online. */
  fallbackRoute: string | null;
  /**
   * LG legal determinations blocking this stage, with the approval each one
   * still needs. Empty for every non-legal refusal.
   */
  legalBlocking: LegalBlockingControl[];
}


const LEGACY_CODE: Record<string, string> = {
  service_not_bookable: "SERVICE_NOT_BOOKABLE",
  not_eligible: "PACKAGE_NOT_SUPPORTED",
  quote_stale: "QUOTE_STALE",
  quote_expired: "QUOTE_EXPIRED",
  no_rate_plan_in_force: "RATE_PLAN_UNAVAILABLE",
  distance_unresolved: "DISTANCE_UNRESOLVED",
  validation_failed: "VALIDATION_FAILED",
  authentication_required: "AUTHENTICATION_REQUIRED",
  forbidden: "AUTHORIZATION_DENIED",
  method_not_allowed: "INTERNAL_ERROR",
  invalid_json: "VALIDATION_FAILED",
  unknown_offering: "VALIDATION_FAILED",
  package_create_failed: "INTERNAL_ERROR",
  order_create_failed: "INTERNAL_ERROR",
};

const titleFor = (code: string, service: string | null): string => {
  const name = service ?? "This service";
  switch (code) {
    case "SERVICE_PILOT_ONLY":
      return `${name} is pilot-only`;
    case "SERVICE_NOT_BOOKABLE":
      return `${name} is not open for online booking`;
    case "SERVICE_SUSPENDED":
      return `${name} is suspended`;
    case "SERVICE_OUTSIDE_GEOGRAPHY":
      return "Route not served yet";
    case "SERVICE_OUTSIDE_OPERATING_HOURS":
      return "Closed for new pickups";
    case "QUOTE_STALE":
    case "QUOTE_EXPIRED":
      return "Price needs refreshing";
    case "PACKAGE_NOT_SUPPORTED":
      return "Parcel outside service limits";
    case "LEGAL_RESTRICTION":
      return "Goods not permitted";
    case "LEGAL_DETERMINATION_REQUIRED":
      return "Awaiting legal authorisation";

    case "PAYMENT_FAILED":
      return "Payment not completed";
    case "AUTHENTICATION_REQUIRED":
      return "Sign in to continue";
    case "AUTHORIZATION_DENIED":
    case "TENANT_ACCESS_DENIED":
      return "Access denied";
    default:
      return LOGISTICS_ERRORS[code]?.category === "INTERNAL" ? "Something went wrong" : "Booking not completed";
  }
};

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Extracts the payload from a supabase FunctionsHttpError / fetch error / plain object. */
function extractPayload(input: unknown): Record<string, unknown> {
  if (!input) return {};
  if (typeof input === "string") return { message: input };
  const rec = asRecord(input);
  // Supabase wraps the JSON body under `context.body` or the caller passes it directly.
  const ctx = asRecord(rec.context);
  const nested = asRecord(rec.body ?? ctx.body);
  const merged: Record<string, unknown> = { ...rec, ...nested };
  if (input instanceof Error && !merged.message) merged.message = input.message;
  return merged;
}

/** Normalises anything the API returned into the canonical envelope. */
export function toEnvelope(
  input: unknown,
  fallback: { operation: string; service?: string | null; correlationId?: string } = { operation: "unknown" },
): LogisticsErrorEnvelope {
  const p = extractPayload(input);
  const correlationId =
    (typeof p.correlation_id === "string" && p.correlation_id) ||
    fallback.correlationId ||
    "unknown";

  // Already canonical.
  if (typeof p.code === "string" && LOGISTICS_ERRORS[p.code as string]) {
    const d = LOGISTICS_ERRORS[p.code as string];
    return {
      error: true,
      code: d.code,
      category: (p.category as LogisticsErrorEnvelope["category"]) ?? d.category,
      message: (p.message as string) ?? d.message,
      user_message: (p.user_message as string) ?? d.user_message,
      reason: (p.reason as string) ?? d.code,
      activation_condition: (p.activation_condition as string) ?? d.activation_condition,
      customer_action: (p.customer_action as string) ?? d.customer_action,
      retryable: typeof p.retryable === "boolean" ? p.retryable : d.retryable,
      severity: (p.severity as LogisticsErrorSeverity) ?? d.severity,
      http_status: typeof p.http_status === "number" ? p.http_status : d.http_status,
      correlation_id: correlationId,
      request_id: (p.request_id as string) ?? correlationId,
      timestamp: (p.timestamp as string) ?? new Date().toISOString(),
      service: (p.service as string) ?? fallback.service ?? null,
      operation: (p.operation as string) ?? fallback.operation,
      details: asRecord(p.details),
      ...(p.fields ? { fields: p.fields as Record<string, string> } : {}),
    };
  }

  // Legacy shape.
  const legacyKey = typeof p.error === "string" ? p.error : "";
  let code = LEGACY_CODE[legacyKey] ?? "INTERNAL_ERROR";
  const reasonCode = typeof p.reason_code === "string" ? p.reason_code : "";
  if (code === "SERVICE_NOT_BOOKABLE" && p.pilot_only === true && p.pilot_allowed_for_this_account !== true) {
    code = "SERVICE_PILOT_ONLY";
  }
  const d = LOGISTICS_ERRORS[code];
  return {
    error: true,
    code: d.code,
    category: d.category,
    message: (p.message as string) ?? d.message,
    user_message: d.user_message,
    reason: reasonCode || legacyKey || d.code,
    activation_condition: d.activation_condition,
    customer_action: d.customer_action,
    retryable: d.retryable,
    severity: d.severity,
    http_status: d.http_status,
    correlation_id: correlationId,
    request_id: correlationId,
    timestamp: new Date().toISOString(),
    service: (p.service as string) ?? fallback.service ?? null,
    operation: fallback.operation,
    details: {
      ...(p.lifecycle ? { lifecycle: p.lifecycle } : {}),
      ...(p.availability ? { availability: p.availability } : {}),
      ...(p.reason_codes ? { reason_codes: p.reason_codes } : {}),
      ...(p.blocking_dependencies ? { blocking_dependencies: p.blocking_dependencies } : {}),
      ...(p.eligibility ? { eligibility: p.eligibility } : {}),
      ...(p.enquiry_available != null ? { enquiry_available: p.enquiry_available } : {}),
    },
    ...(p.fields ? { fields: p.fields as Record<string, string> } : {}),
  };
}

const BUSINESS_CATEGORIES = new Set([
  "SERVICE_AVAILABILITY",
  "PRICING",
  "SUPPLY",
  "PACKAGE",
  "COMPLIANCE",
  "IDEMPOTENCY",
  "STATE",
]);

export function mapLogisticsError(
  input: unknown,
  fallback: { operation: string; service?: string | null; correlationId?: string } = { operation: "unknown" },
): MappedLogisticsError {
  const envelope = toEnvelope(input, fallback);
  const details = envelope.details ?? {};
  const isPilotOnly = envelope.code === "SERVICE_PILOT_ONLY";
  const lifecycle = typeof details.lifecycle === "string" ? details.lifecycle : isPilotOnly ? "PILOT" : "UNKNOWN";

  const facts: Array<{ label: string; value: string }> = [
    { label: "Service", value: envelope.service ?? "—" },
    { label: "Current state", value: lifecycle },
    { label: "Requested operation", value: envelope.operation },
    { label: "Booking permitted", value: envelope.code === "SERVICE_PILOT_ONLY" || envelope.code === "SERVICE_NOT_BOOKABLE" ? "FALSE" : "—" },
    { label: "Required transition", value: isPilotOnly ? "PILOT_ONLY → BOOKABLE" : "—" },
    { label: "Activation dependency", value: envelope.activation_condition ?? "—" },
    { label: "Correlation ID", value: envelope.correlation_id },
  ];

  const reasonCodes = Array.isArray(details.reason_codes) ? (details.reason_codes as string[]) : [];
  if (reasonCodes.length) facts.push({ label: "Reason codes", value: reasonCodes.join(", ") });

  const legalBlocking: LegalBlockingControl[] = (Array.isArray(details.legal_blocking) ? details.legal_blocking : [])
    .map((raw) => asRecord(raw))
    .filter((r) => typeof r.control_id === "string")
    .map((r) => ({
      control_id: String(r.control_id),
      title: typeof r.title === "string" ? r.title : String(r.control_id),
      reason_code: typeof r.reason_code === "string" ? r.reason_code : "LG_LEGAL_REVIEW_REQUIRED",
      required_approval:
        typeof r.required_approval === "string" && r.required_approval
          ? r.required_approval
          : "An authorised legal determination approval",
      owner: typeof r.owner === "string" ? r.owner : null,
    }));

  if (legalBlocking.length) {
    facts.push({
      label: "Blocking LG controls",
      value: legalBlocking.map((l) => `${l.control_id} (${l.reason_code})`).join(", "),
    });
    facts.push({
      label: "Outstanding approvals",
      value: legalBlocking.map((l) => `${l.control_id}: ${l.required_approval}`).join(" · "),
    });
  }
  if (typeof details.blocking_stage === "string") {
    facts.push({ label: "Blocking stage", value: details.blocking_stage });
  }

  const enquiryAvailable = details.enquiry_available !== false;

  /**
   * A legal refusal names the controls. The customer sees which authorisations
   * are pending and what each one is waiting for — never a generic refusal.
   */
  const customerDetail = legalBlocking.length
    ? `${envelope.user_message} ${
        legalBlocking.length === 1
          ? `One authorisation is outstanding: ${legalBlocking[0].control_id} — ${legalBlocking[0].title}, awaiting ${legalBlocking[0].required_approval.toLowerCase()}.`
          : `${legalBlocking.length} authorisations are outstanding: ${legalBlocking
              .map((l) => `${l.control_id} (awaiting ${l.required_approval.toLowerCase()})`)
              .join("; ")}.`
      }`
    : envelope.user_message;

  return {
    envelope,
    isPilotOnly,
    legalBlocking,
    isBusinessRefusal: BUSINESS_CATEGORIES.has(envelope.category),
    fallbackRoute:
      (envelope.category === "SERVICE_AVAILABILITY" || legalBlocking.length > 0) && enquiryAvailable
        ? "/delivery/enquiry"
        : null,
    customer: {
      title: titleFor(envelope.code, envelope.service),
      detail: customerDetail,
      action: envelope.customer_action,
      activationCondition: envelope.activation_condition,
      retryable: envelope.retryable,
    },

    operator: {
      code: envelope.code,
      category: envelope.category,
      severity: envelope.severity,
      service: envelope.service,
      operation: envelope.operation,
      httpStatus: envelope.http_status,
      reason: envelope.reason,
      correlationId: envelope.correlation_id,
      requestId: envelope.request_id,
      timestamp: envelope.timestamp,
      facts,
      details,
    },
  };
}
