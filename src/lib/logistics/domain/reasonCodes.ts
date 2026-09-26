/**
 * DF-10 control 14 — structured reason codes.
 *
 * Every negative operational outcome must carry a reason code from this closed
 * catalogue. Free text may supplement a code; it may never replace one, and it
 * is never parsed for meaning. Informed by the X12 214 status/reason pairing
 * (see referenceStandards.ts).
 */

export const REASON_CODES = [
  "RECIPIENT_UNAVAILABLE",
  "INVALID_ADDRESS",
  "REFUSED",
  "DAMAGED_PACKAGE",
  "RESTRICTED_GOODS",
  "WEATHER",
  "VEHICLE_FAILURE",
  "COURIER_FAILURE",
  "CUSTOMER_CANCELLATION",
  "PAYMENT_FAILURE",
  "COMPLIANCE_FAILURE",
  "CAPACITY_UNAVAILABLE",
  "SECURITY_INCIDENT",
  "OTHER",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export type ReasonCategory = "RECIPIENT" | "GOODS" | "SUPPLY" | "EXTERNAL" | "COMMERCIAL" | "COMPLIANCE" | "UNCLASSIFIED";

export interface ReasonCodeSpec {
  code: ReasonCode;
  category: ReasonCategory;
  /** Whether the failure counts against the SLA of the operator. */
  slaAttributable: boolean;
  /** Whether it may open a claim. */
  claimEligible: boolean;
  /** Whether a retry/redelivery is the default next action. */
  retryable: boolean;
  /** Free text mandatory in addition to the code. */
  requiresNarrative: boolean;
}

export const REASON_CODE_SPECS: ReasonCodeSpec[] = [
  { code: "RECIPIENT_UNAVAILABLE", category: "RECIPIENT", slaAttributable: false, claimEligible: false, retryable: true, requiresNarrative: false },
  { code: "INVALID_ADDRESS", category: "RECIPIENT", slaAttributable: false, claimEligible: false, retryable: true, requiresNarrative: true },
  { code: "REFUSED", category: "RECIPIENT", slaAttributable: false, claimEligible: false, retryable: false, requiresNarrative: true },
  { code: "DAMAGED_PACKAGE", category: "GOODS", slaAttributable: true, claimEligible: true, retryable: false, requiresNarrative: true },
  { code: "RESTRICTED_GOODS", category: "COMPLIANCE", slaAttributable: false, claimEligible: false, retryable: false, requiresNarrative: true },
  { code: "WEATHER", category: "EXTERNAL", slaAttributable: false, claimEligible: false, retryable: true, requiresNarrative: false },
  { code: "VEHICLE_FAILURE", category: "SUPPLY", slaAttributable: true, claimEligible: false, retryable: true, requiresNarrative: false },
  { code: "COURIER_FAILURE", category: "SUPPLY", slaAttributable: true, claimEligible: false, retryable: true, requiresNarrative: true },
  { code: "CUSTOMER_CANCELLATION", category: "COMMERCIAL", slaAttributable: false, claimEligible: false, retryable: false, requiresNarrative: false },
  { code: "PAYMENT_FAILURE", category: "COMMERCIAL", slaAttributable: false, claimEligible: false, retryable: true, requiresNarrative: false },
  { code: "COMPLIANCE_FAILURE", category: "COMPLIANCE", slaAttributable: true, claimEligible: false, retryable: false, requiresNarrative: true },
  { code: "CAPACITY_UNAVAILABLE", category: "SUPPLY", slaAttributable: true, claimEligible: false, retryable: true, requiresNarrative: false },
  { code: "SECURITY_INCIDENT", category: "EXTERNAL", slaAttributable: true, claimEligible: true, retryable: false, requiresNarrative: true },
  { code: "OTHER", category: "UNCLASSIFIED", slaAttributable: true, claimEligible: false, retryable: false, requiresNarrative: true },
];

/** Events that MUST carry a reason code. */
export const REASON_REQUIRED_EVENTS = [
  "logistics.attempt.failed",
  "logistics.attempt.abandoned",
  "logistics.dispatch.failed",
  "logistics.dispatch.reassigning",
  "logistics.shipment.cancelled",
  "logistics.order.cancelled",
  "logistics.payment.failed",
  "logistics.return.requested",
  "logistics.claim.opened",
  "logistics.package.custody_exception",
] as const;

export interface ReasonPayload {
  reason_code?: string;
  narrative?: string | null;
}

export interface ReasonValidation {
  valid: boolean;
  errors: string[];
}

export function spec(code: ReasonCode): ReasonCodeSpec {
  return REASON_CODE_SPECS.find((s) => s.code === code) as ReasonCodeSpec;
}

/**
 * Server-side guard: reject a negative event that lacks a catalogue reason code,
 * or that supplies narrative-only "explanations".
 */
export function validateReason(eventType: string, payload: ReasonPayload): ReasonValidation {
  const errors: string[] = [];
  const required = (REASON_REQUIRED_EVENTS as readonly string[]).includes(eventType);
  if (!required) return { valid: true, errors };

  const code = payload.reason_code;
  if (!code) {
    errors.push(`${eventType} requires reason_code; narrative text is not a substitute`);
    return { valid: false, errors };
  }
  if (!(REASON_CODES as readonly string[]).includes(code)) {
    errors.push(`reason_code "${code}" is not in the catalogue`);
    return { valid: false, errors };
  }
  const s = spec(code as ReasonCode);
  if (s.requiresNarrative && !payload.narrative?.trim()) {
    errors.push(`reason_code ${code} additionally requires a narrative`);
  }
  return { valid: errors.length === 0, errors };
}

/** SLA calculation must exclude non-attributable failures. */
export function slaAttributable(code: ReasonCode): boolean {
  return spec(code).slaAttributable;
}
