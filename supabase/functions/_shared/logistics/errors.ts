/**
 * LOGISTICS CANONICAL ERROR REGISTRY — one taxonomy, one envelope.
 *
 * Every logistics API failure leaves the server as a `LogisticsErrorEnvelope`.
 * No endpoint invents its own shape and no page invents its own interpretation:
 * the frontend mapper (`src/lib/logistics/errorContract.ts`) reads this same
 * module, so a business refusal such as "Express is PILOT_ONLY" is explained
 * identically at the API boundary, in the customer UI and in the admin console.
 *
 * Rules:
 *  - a refusal is NEVER downgraded to a generic "booking failed";
 *  - `user_message` is customer-safe (no SQL, no stack, no infrastructure);
 *  - `activation_condition` states what would make the operation possible;
 *  - `retryable` is a contract, not a guess.
 *
 * Deno-free: importable by edge functions, the admin UI and vitest alike.
 */

export type LogisticsErrorCategory =
  | "SERVICE_AVAILABILITY"
  | "PRICING"
  | "PAYMENT"
  | "SUPPLY"
  | "PACKAGE"
  | "COMPLIANCE"
  | "IDEMPOTENCY"
  | "STATE"
  | "FULFILMENT"
  | "FINANCE"
  | "AUTH"
  | "TENANCY"
  | "CONFIGURATION"
  | "INTERNAL";

export type LogisticsErrorSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface LogisticsErrorDefinition {
  code: string;
  category: LogisticsErrorCategory;
  http_status: number;
  severity: LogisticsErrorSeverity;
  /** Operator-facing description. */
  message: string;
  /** Customer-safe explanation. */
  user_message: string;
  /** What would have to become true for the operation to succeed. */
  activation_condition: string | null;
  /** Next step offered to the customer. */
  customer_action: string | null;
  retryable: boolean;
}

const def = (d: LogisticsErrorDefinition) => d;

export const LOGISTICS_ERRORS: Record<string, LogisticsErrorDefinition> = {
  /* ------------------------- service availability ------------------------- */
  SERVICE_PILOT_ONLY: def({
    code: "SERVICE_PILOT_ONLY",
    category: "SERVICE_AVAILABILITY",
    http_status: 409,
    severity: "WARNING",
    message: "Service is PILOT_ONLY and is not available for production booking.",
    user_message:
      "This service is currently restricted to controlled pilot operation and cannot be booked through production.",
    activation_condition:
      "The service becomes bookable only after the authorised production activation requirements and applicable DF-10 controls have been satisfied.",
    customer_action: "Choose Standard Parcel or another currently bookable service.",
    retryable: false,
  }),
  SERVICE_NOT_BOOKABLE: def({
    code: "SERVICE_NOT_BOOKABLE",
    category: "SERVICE_AVAILABILITY",
    http_status: 409,
    severity: "WARNING",
    message: "Service activation state does not permit self-service booking.",
    user_message: "This service is not open for online booking yet.",
    activation_condition: "Activation prerequisites for this service must be satisfied and recorded.",
    customer_action: "Submit an enquiry and our team will arrange it, or choose a bookable service.",
    retryable: false,
  }),
  SERVICE_SUSPENDED: def({
    code: "SERVICE_SUSPENDED",
    category: "SERVICE_AVAILABILITY",
    http_status: 409,
    severity: "WARNING",
    message: "Service is suspended by the service owner.",
    user_message: "This service is temporarily suspended.",
    activation_condition: "The service owner must lift the suspension.",
    customer_action: "Choose another service or try again later.",
    retryable: false,
  }),
  SERVICE_OUTSIDE_OPERATING_HOURS: def({
    code: "SERVICE_OUTSIDE_OPERATING_HOURS",
    category: "SERVICE_AVAILABILITY",
    http_status: 409,
    severity: "INFO",
    message: "Request falls outside configured operating hours or past cut-off.",
    user_message: "This service is closed for new pickups right now.",
    activation_condition: "Book inside the published operating window.",
    customer_action: "Schedule a pickup inside operating hours.",
    retryable: true,
  }),
  SERVICE_OUTSIDE_GEOGRAPHY: def({
    code: "SERVICE_OUTSIDE_GEOGRAPHY",
    category: "SERVICE_AVAILABILITY",
    http_status: 409,
    severity: "INFO",
    message: "Pickup or delivery point is outside the configured operating regions.",
    user_message: "We do not serve this pickup or delivery area on this service yet.",
    activation_condition: "The route must fall inside a configured operating area.",
    customer_action: "Adjust the addresses or submit an enquiry for this route.",
    retryable: false,
  }),

  /* --------------------------------- pricing -------------------------------- */
  QUOTE_EXPIRED: def({
    code: "QUOTE_EXPIRED",
    category: "PRICING",
    http_status: 409,
    severity: "INFO",
    message: "Quote snapshot is past its validity window.",
    user_message: "Your quote has expired.",
    activation_condition: "A fresh quote must be issued before booking.",
    customer_action: "Request a new price and confirm again.",
    retryable: true,
  }),
  QUOTE_STALE: def({
    code: "QUOTE_STALE",
    category: "PRICING",
    http_status: 409,
    severity: "INFO",
    message: "Client-presented price differs from the server re-rate.",
    user_message: "The price changed since your quote.",
    activation_condition: "The customer must accept the re-rated price.",
    customer_action: "Review the new price and confirm.",
    retryable: true,
  }),
  RATE_PLAN_UNAVAILABLE: def({
    code: "RATE_PLAN_UNAVAILABLE",
    category: "PRICING",
    http_status: 409,
    severity: "ERROR",
    message: "No rate-plan version is in force for this offering at this time.",
    user_message: "This service is priced per contract and cannot be quoted online.",
    activation_condition: "A rate-plan version must be in force for the requested date.",
    customer_action: "Submit an enquiry for a contract price.",
    retryable: false,
  }),
  DISTANCE_UNRESOLVED: def({
    code: "DISTANCE_UNRESOLVED",
    category: "PRICING",
    http_status: 400,
    severity: "INFO",
    message: "Neither coordinates nor a distance band were resolvable.",
    user_message: "We could not work out the distance for this trip.",
    activation_condition: "Pickup and delivery points, or a distance band, must be provided.",
    customer_action: "Pick both addresses from the suggestions and try again.",
    retryable: true,
  }),

  /* -------------------------------- payment --------------------------------- */
  PAYMENT_REQUIRED: def({
    code: "PAYMENT_REQUIRED",
    category: "PAYMENT",
    http_status: 402,
    severity: "INFO",
    message: "Order exists but no authorised payment is recorded.",
    user_message: "Payment has not been completed for this booking.",
    activation_condition: "A verified payment or an approved credit authorisation must be recorded.",
    customer_action: "Complete the M-Pesa prompt or choose another payment method.",
    retryable: true,
  }),
  PAYMENT_FAILED: def({
    code: "PAYMENT_FAILED",
    category: "PAYMENT",
    http_status: 402,
    severity: "WARNING",
    message: "Payment provider reported a failed or cancelled transaction.",
    user_message: "Your payment did not go through.",
    activation_condition: "A successful payment must be confirmed by the provider callback.",
    customer_action: "Try the payment again or use a different method.",
    retryable: true,
  }),
  PAYMENT_PENDING_CONFIRMATION: def({
    code: "PAYMENT_PENDING_CONFIRMATION",
    category: "PAYMENT",
    http_status: 202,
    severity: "INFO",
    message: "Payment initiated; awaiting verified provider callback.",
    user_message: "We are waiting for your payment confirmation.",
    activation_condition: "The provider callback must be received and verified.",
    customer_action: "Approve the prompt on your phone; this page updates automatically.",
    retryable: true,
  }),
  CREDIT_LIMIT_EXCEEDED: def({
    code: "CREDIT_LIMIT_EXCEEDED",
    category: "PAYMENT",
    http_status: 409,
    severity: "WARNING",
    message: "Corporate credit authorisation refused: limit or policy exceeded.",
    user_message: "This booking exceeds your company's approved limit.",
    activation_condition: "A corporate approver must raise the limit or approve the booking.",
    customer_action: "Request approval from your company administrator.",
    retryable: false,
  }),

  /* --------------------------------- supply --------------------------------- */
  PARTNER_UNAVAILABLE: def({
    code: "PARTNER_UNAVAILABLE",
    category: "SUPPLY",
    http_status: 409,
    severity: "WARNING",
    message: "No partner with current, verified, unexpired eligibility evidence is available.",
    user_message: "No courier partner is available for this shipment right now.",
    activation_condition: "An eligible partner with valid compliance evidence must be on duty.",
    customer_action: "Try a later pickup window or submit an enquiry.",
    retryable: true,
  }),
  NO_ELIGIBLE_COURIER: def({
    code: "NO_ELIGIBLE_COURIER",
    category: "SUPPLY",
    http_status: 409,
    severity: "WARNING",
    message: "Dispatch found no courier satisfying geography, vehicle and package capability.",
    user_message: "We could not find a courier able to carry this shipment.",
    activation_condition: "A courier matching the shipment capability profile must be available.",
    customer_action: "Adjust the pickup time or contact support.",
    retryable: true,
  }),
  CAPACITY_EXCEEDED: def({
    code: "CAPACITY_EXCEEDED",
    category: "SUPPLY",
    http_status: 409,
    severity: "WARNING",
    message: "Configured daily capacity for this service is exhausted.",
    user_message: "This service is fully booked for the selected day.",
    activation_condition: "Capacity must be free, or the configured daily limit increased.",
    customer_action: "Choose another pickup day.",
    retryable: true,
  }),

  /* -------------------------- package / compliance -------------------------- */
  PACKAGE_NOT_SUPPORTED: def({
    code: "PACKAGE_NOT_SUPPORTED",
    category: "PACKAGE",
    http_status: 422,
    severity: "INFO",
    message: "Package facts fall outside the offering limits.",
    user_message: "This parcel is outside the limits of the selected service.",
    activation_condition: "Weight, dimensions, count and value must be inside the service limits.",
    customer_action: "Choose a service that accepts this parcel, or split the shipment.",
    retryable: false,
  }),
  LEGAL_RESTRICTION: def({
    code: "LEGAL_RESTRICTION",
    category: "COMPLIANCE",
    http_status: 422,
    severity: "WARNING",
    message: "Goods are restricted or prohibited under the configured goods policy.",
    user_message: "We cannot carry these goods on this service.",
    activation_condition: "The goods must be permitted by the restricted-goods policy.",
    customer_action: "Remove the restricted items or contact us about a compliant option.",
    retryable: false,
  }),
  LEGAL_DETERMINATION_REQUIRED: def({
    code: "LEGAL_DETERMINATION_REQUIRED",
    category: "COMPLIANCE",
    http_status: 409,
    severity: "WARNING",
    message:
      "One or more LG legal determinations (LG-01…LG-15, LG-GOODS) are not approved and effective for this stage.",
    user_message:
      "We cannot accept this booking yet: the legal authorisations that govern this service are still going through approval.",
    activation_condition:
      "Every LG determination that governs this stage must carry an authorised legal review, insurer confirmation where insurance evidence is required, and owner approval against the current document version, with a real effective date.",
    customer_action: "Send an enquiry and our team will confirm as soon as the authorisation is effective.",
    retryable: false,
  }),

  COMPLIANCE_REQUIRED: def({
    code: "COMPLIANCE_REQUIRED",
    category: "COMPLIANCE",
    http_status: 409,
    severity: "WARNING",
    message: "Shipment requires documentary compliance clearance before dispatch.",
    user_message: "This shipment needs a compliance check before we can collect it.",
    activation_condition: "Required documents must be supplied and cleared by compliance.",
    customer_action: "Upload the required documents; our team will confirm.",
    retryable: true,
  }),

  /* ------------------------- idempotency and state -------------------------- */
  BOOKING_ALREADY_EXISTS: def({
    code: "BOOKING_ALREADY_EXISTS",
    category: "IDEMPOTENCY",
    http_status: 409,
    severity: "INFO",
    message: "An order already exists for this idempotency key.",
    user_message: "This booking was already created.",
    activation_condition: null,
    customer_action: "Open the existing booking instead of creating a new one.",
    retryable: false,
  }),
  DUPLICATE_REQUEST: def({
    code: "DUPLICATE_REQUEST",
    category: "IDEMPOTENCY",
    http_status: 409,
    severity: "INFO",
    message: "Duplicate request detected and suppressed.",
    user_message: "We already received this request.",
    activation_condition: null,
    customer_action: "No action needed.",
    retryable: false,
  }),
  INVALID_STATE_TRANSITION: def({
    code: "INVALID_STATE_TRANSITION",
    category: "STATE",
    http_status: 409,
    severity: "WARNING",
    message: "Requested transition is not permitted by the authoritative state machine.",
    user_message: "This action is not possible at the current stage of the shipment.",
    activation_condition: "The aggregate must be in a state that permits this transition.",
    customer_action: "Refresh to see the current status.",
    retryable: false,
  }),
  STALE_EVENT: def({
    code: "STALE_EVENT",
    category: "STATE",
    http_status: 409,
    severity: "INFO",
    message: "Event is older than the last applied sequence and was rejected.",
    user_message: "This update was out of date and was ignored.",
    activation_condition: null,
    customer_action: "No action needed.",
    retryable: false,
  }),

  /* ------------------------------- fulfilment -------------------------------- */
  POD_REQUIRED: def({
    code: "POD_REQUIRED",
    category: "FULFILMENT",
    http_status: 409,
    severity: "WARNING",
    message: "Delivery cannot be completed without the configured proof-of-delivery artefacts.",
    user_message: "Proof of delivery is still outstanding for this shipment.",
    activation_condition: "The required POD artefacts must be captured.",
    customer_action: "Our operations team will follow up with the courier.",
    retryable: true,
  }),

  /* --------------------------------- finance -------------------------------- */
  REFUND_REQUIRED: def({
    code: "REFUND_REQUIRED",
    category: "FINANCE",
    http_status: 409,
    severity: "WARNING",
    message: "A payment exists for a shipment that will not be fulfilled; refund must be raised.",
    user_message: "We owe you a refund for this booking.",
    activation_condition: "A refund must be raised and reconciled by finance.",
    customer_action: "Our finance team will process the refund.",
    retryable: false,
  }),
  RECONCILIATION_REQUIRED: def({
    code: "RECONCILIATION_REQUIRED",
    category: "FINANCE",
    http_status: 409,
    severity: "WARNING",
    message: "Payment ledger and order charge do not agree; manual reconciliation is required.",
    user_message: "We are verifying the payment for this booking.",
    activation_condition: "The payment ledger entry must be matched to the order charge.",
    customer_action: "No action needed; we will confirm shortly.",
    retryable: true,
  }),

  /* ---------------------------- auth and tenancy ---------------------------- */
  AUTHENTICATION_REQUIRED: def({
    code: "AUTHENTICATION_REQUIRED",
    category: "AUTH",
    http_status: 401,
    severity: "INFO",
    message: "No valid session was presented.",
    user_message: "Please sign in to continue.",
    activation_condition: "A valid authenticated session is required.",
    customer_action: "Sign in and try again.",
    retryable: true,
  }),
  AUTHORIZATION_DENIED: def({
    code: "AUTHORIZATION_DENIED",
    category: "AUTH",
    http_status: 403,
    severity: "WARNING",
    message: "Session is valid but lacks the required role or permission.",
    user_message: "You do not have permission to do this.",
    activation_condition: "The required role or permission must be granted.",
    customer_action: "Ask your administrator for access.",
    retryable: false,
  }),
  TENANT_ACCESS_DENIED: def({
    code: "TENANT_ACCESS_DENIED",
    category: "TENANCY",
    http_status: 403,
    severity: "CRITICAL",
    message: "Cross-tenant access attempt refused.",
    user_message: "This record does not belong to your account.",
    activation_condition: null,
    customer_action: "Check you are signed in to the right account.",
    retryable: false,
  }),

  /* ------------------------- configuration / internal ----------------------- */
  VALIDATION_FAILED: def({
    code: "VALIDATION_FAILED",
    category: "CONFIGURATION",
    http_status: 400,
    severity: "INFO",
    message: "Request failed field validation.",
    user_message: "Some details are missing or incorrect.",
    activation_condition: "All required fields must be valid.",
    customer_action: "Correct the highlighted fields and try again.",
    retryable: true,
  }),
  SYSTEM_CONFIGURATION_ERROR: def({
    code: "SYSTEM_CONFIGURATION_ERROR",
    category: "CONFIGURATION",
    http_status: 500,
    severity: "CRITICAL",
    message: "A required system configuration value is missing or invalid.",
    user_message: "We could not complete this because of a configuration problem on our side.",
    activation_condition: "The missing configuration must be supplied by platform operations.",
    customer_action: "Please try again later; our team has been notified.",
    retryable: true,
  }),
  INTERNAL_ERROR: def({
    code: "INTERNAL_ERROR",
    category: "INTERNAL",
    http_status: 500,
    severity: "CRITICAL",
    message: "Unhandled server error.",
    user_message: "Something went wrong on our side.",
    activation_condition: null,
    customer_action: "Please try again; if it repeats, contact support with the reference shown.",
    retryable: true,
  }),
};

export type LogisticsErrorCode = keyof typeof LOGISTICS_ERRORS;

/** The wire contract. Every logistics API failure is exactly this shape. */
export interface LogisticsErrorEnvelope {
  error: true;
  code: string;
  category: LogisticsErrorCategory;
  message: string;
  user_message: string;
  reason: string;
  activation_condition: string | null;
  customer_action: string | null;
  retryable: boolean;
  severity: LogisticsErrorSeverity;
  http_status: number;
  correlation_id: string;
  request_id: string;
  timestamp: string;
  service: string | null;
  operation: string;
  /** Operator-only detail. Never rendered to customers. */
  details?: Record<string, unknown>;
  /** Field-level validation errors, when applicable. */
  fields?: Record<string, string>;
}

export interface EnvelopeContext {
  operation: string;
  correlationId: string;
  requestId?: string;
  service?: string | null;
  /** Overrides the registry reason (defaults to the error code). */
  reason?: string;
  details?: Record<string, unknown>;
  fields?: Record<string, string>;
  /** Overrides the registry HTTP status when a caller needs a different one. */
  httpStatus?: number;
}

export function logisticsError(code: string, ctx: EnvelopeContext): LogisticsErrorEnvelope {
  const d = LOGISTICS_ERRORS[code] ?? LOGISTICS_ERRORS.INTERNAL_ERROR;
  return {
    error: true,
    code: d.code,
    category: d.category,
    message: d.message,
    user_message: d.user_message,
    reason: ctx.reason ?? d.code,
    activation_condition: d.activation_condition,
    customer_action: d.customer_action,
    retryable: d.retryable,
    severity: d.severity,
    http_status: ctx.httpStatus ?? d.http_status,
    correlation_id: ctx.correlationId,
    request_id: ctx.requestId ?? ctx.correlationId,
    timestamp: new Date().toISOString(),
    service: ctx.service ?? null,
    operation: ctx.operation,
    ...(ctx.details ? { details: ctx.details } : {}),
    ...(ctx.fields ? { fields: ctx.fields } : {}),
  };
}

/**
 * Availability refusal → canonical error code.
 *
 * PILOT_ONLY is a backend state: when the serviceability engine reports a pilot
 * lifecycle and this caller is not enrolled, the refusal is reported as
 * SERVICE_PILOT_ONLY and never as a generic failure.
 */
export function availabilityErrorCode(input: {
  decision: string;
  lifecycle: string;
  pilotOnly: boolean;
  pilotAllowedForThisAccount: boolean;
  blockingCode?: string | null;
}): string {
  if (input.pilotOnly && !input.pilotAllowedForThisAccount) return "SERVICE_PILOT_ONLY";
  if (input.decision === "SUSPENDED" || input.lifecycle === "SUSPENDED") return "SERVICE_SUSPENDED";
  const blocking = input.blockingCode ?? "";
  if (blocking === "SERVICE_AREA_MISSING") return "SERVICE_OUTSIDE_GEOGRAPHY";
  if (blocking === "OPERATING_HOURS_MISSING") return "SERVICE_OUTSIDE_OPERATING_HOURS";
  if (blocking === "CAPACITY_NOT_CONFIGURED") return "CAPACITY_EXCEEDED";
  if (blocking === "EXPRESS_RATE_PLAN_MISSING") return "RATE_PLAN_UNAVAILABLE";
  return "SERVICE_NOT_BOOKABLE";
}
