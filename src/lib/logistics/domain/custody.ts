/**
 * DF-10 controls 12 & 13 — package identity, chain of custody, partial delivery.
 *
 * A shipment is NOT one package and NOT one delivery attempt. Custody is tracked
 * per package (GS1 EPCIS business-step model, see referenceStandards.ts), and
 * shipment execution outcome is DERIVED from package outcomes — never asserted.
 */
import { ReasonCode } from "./reasonCodes";

/* ------------------------------- identity ------------------------------- */

export interface PackageIdentity {
  package_id: string;
  shipment_id: string;
  /** Customer-facing, globally unique, never reused. */
  tracking_number: string;
  /** Machine-readable label symbol; barcode payload equals tracking_number. */
  barcode: string;
  /** Optional QR deep link for POD/verification surfaces. */
  qr_reference?: string;
  /** Customer's own reference; not unique, never used as identity. */
  customer_reference?: string | null;
}

const TRACKING_RE = /^YL[A-Z][0-9]{10}$/;

export function isValidTrackingNumber(n: string): boolean {
  return TRACKING_RE.test(n);
}

export function uniquenessViolations(packages: PackageIdentity[]): string[] {
  const errors: string[] = [];
  const seenTracking = new Set<string>();
  const seenId = new Set<string>();
  for (const p of packages) {
    if (!isValidTrackingNumber(p.tracking_number)) errors.push(`invalid tracking number: ${p.tracking_number}`);
    if (p.barcode !== p.tracking_number) errors.push(`barcode must equal tracking number for ${p.package_id}`);
    if (seenTracking.has(p.tracking_number)) errors.push(`duplicate tracking number: ${p.tracking_number}`);
    if (seenId.has(p.package_id)) errors.push(`duplicate package_id: ${p.package_id}`);
    seenTracking.add(p.tracking_number);
    seenId.add(p.package_id);
  }
  return errors;
}

/* ----------------------------- chain of custody ----------------------------- */

export const CUSTODY_STEPS = [
  "CUSTODY_ASSIGNED",
  "CUSTODY_PICKED_UP",
  "CUSTODY_TRANSFERRED",
  "CUSTODY_RECEIVED",
  "CUSTODY_LOADED",
  "CUSTODY_UNLOADED",
  "CUSTODY_DELIVERED",
  "CUSTODY_RETURNED",
] as const;

export type CustodyStep = (typeof CUSTODY_STEPS)[number];

export type CustodyHolderKind = "PARTNER" | "COURIER" | "HUB" | "CUSTOMER" | "RECIPIENT";

export interface CustodyEvent {
  package_id: string;
  step: CustodyStep;
  holder_kind: CustodyHolderKind;
  holder_id: string;
  occurred_at: string;
  location?: { lat: number; lng: number } | null;
  reason_code?: ReasonCode;
  correlation_id: string;
  idempotency_key: string;
}

/** Legal custody successors. Custody is a linear, append-only chain per package. */
export const CUSTODY_SUCCESSORS: Record<CustodyStep, CustodyStep[]> = {
  CUSTODY_ASSIGNED: ["CUSTODY_PICKED_UP", "CUSTODY_RETURNED"],
  CUSTODY_PICKED_UP: ["CUSTODY_LOADED", "CUSTODY_TRANSFERRED", "CUSTODY_DELIVERED", "CUSTODY_RETURNED"],
  CUSTODY_LOADED: ["CUSTODY_UNLOADED", "CUSTODY_TRANSFERRED"],
  CUSTODY_UNLOADED: ["CUSTODY_LOADED", "CUSTODY_TRANSFERRED", "CUSTODY_DELIVERED", "CUSTODY_RETURNED"],
  CUSTODY_TRANSFERRED: ["CUSTODY_RECEIVED"],
  CUSTODY_RECEIVED: ["CUSTODY_LOADED", "CUSTODY_DELIVERED", "CUSTODY_TRANSFERRED", "CUSTODY_RETURNED"],
  CUSTODY_DELIVERED: [],
  CUSTODY_RETURNED: [],
};

export interface CustodyValidation {
  valid: boolean;
  errors: string[];
}

/** Validates an ordered custody chain for one package. */
export function validateCustodyChain(events: CustodyEvent[]): CustodyValidation {
  const errors: string[] = [];
  if (events.length === 0) return { valid: true, errors };
  if (events[0].step !== "CUSTODY_ASSIGNED") errors.push("custody chain must open with CUSTODY_ASSIGNED");

  for (let i = 1; i < events.length; i += 1) {
    const prev = events[i - 1];
    const next = events[i];
    if (!CUSTODY_SUCCESSORS[prev.step].includes(next.step)) {
      errors.push(`illegal custody step ${prev.step} → ${next.step}`);
    }
    if (Date.parse(next.occurred_at) < Date.parse(prev.occurred_at)) {
      errors.push(`custody events out of order at index ${i}`);
    }
    if (prev.step === "CUSTODY_TRANSFERRED" && next.step === "CUSTODY_RECEIVED" && next.holder_id === prev.holder_id) {
      errors.push("CUSTODY_RECEIVED must name a different holder than CUSTODY_TRANSFERRED");
    }
  }
  return { valid: errors.length === 0, errors };
}

/* ----------------------------- partial delivery ----------------------------- */

export type PackageOutcome = "DELIVERED" | "FAILED" | "RETURNED" | "PENDING";

export interface PackageResult {
  package_id: string;
  outcome: PackageOutcome;
  reason_code?: ReasonCode;
}

export type ShipmentExecutionOutcome =
  | "IN_EXECUTION"
  | "DELIVERED"
  | "PARTIALLY_DELIVERED"
  | "FAILED"
  | "RETURNED";

export interface ShipmentCompletion {
  outcome: ShipmentExecutionOutcome;
  total: number;
  delivered_packages: number;
  failed_packages: number;
  returned_packages: number;
  pending_packages: number;
  /** POD is required per delivered package, not per shipment. */
  pod_required_for: string[];
  /**
   * Delivery outcomes eligible for BILLING EVALUATION — never a billable count.
   * The billing engine (billing.ts) decides the charge using the contract and
   * rate plan; operational completion alone never bills a customer.
   */
  billing_evaluation_candidates: string[];

  /** Failed/returned packages that may open a claim. */
  claim_candidates: string[];
  notifications: string[];
}

/**
 * Derives shipment completion from package results. A shipment with any failed
 * package NEVER becomes plain DELIVERED; PARTIALLY_DELIVERED is an explicit
 * business outcome with its own billing and claim consequences.
 */
export function computeShipmentCompletion(results: PackageResult[]): ShipmentCompletion {
  const delivered = results.filter((r) => r.outcome === "DELIVERED");
  const failed = results.filter((r) => r.outcome === "FAILED");
  const returned = results.filter((r) => r.outcome === "RETURNED");
  const pending = results.filter((r) => r.outcome === "PENDING");

  let outcome: ShipmentExecutionOutcome;
  if (pending.length > 0) outcome = "IN_EXECUTION";
  else if (delivered.length === results.length && results.length > 0) outcome = "DELIVERED";
  else if (delivered.length === 0 && returned.length > 0 && failed.length === 0) outcome = "RETURNED";
  else if (delivered.length === 0) outcome = "FAILED";
  else outcome = "PARTIALLY_DELIVERED";

  const notifications: string[] = [];
  if (outcome === "PARTIALLY_DELIVERED") notifications.push("customer.partial_delivery_notice");
  if (failed.length > 0) notifications.push("ops.exception_opened");
  if (returned.length > 0) notifications.push("customer.return_initiated");
  if (outcome === "DELIVERED") notifications.push("customer.delivery_completed");

  return {
    outcome,
    total: results.length,
    delivered_packages: delivered.length,
    failed_packages: failed.length,
    returned_packages: returned.length,
    pending_packages: pending.length,
    pod_required_for: delivered.map((r) => r.package_id),
    billing_evaluation_candidates: results.filter((r) => r.outcome !== "PENDING").map((r) => r.package_id),
    claim_candidates: [...failed, ...returned]
      .filter((r) => r.reason_code === "DAMAGED_PACKAGE" || r.reason_code === "SECURITY_INCIDENT")
      .map((r) => r.package_id),
    notifications,
  };
}

/**
 * Delivery completion is NOT financial closure. This is the only sanctioned way
 * to ask whether a shipment is commercially closed.
 */
export function financialClosure(input: {
  execution: ShipmentExecutionOutcome;
  paymentState: string;
  invoiceState: string;
  openClaims: number;
}): { closed: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (input.execution === "IN_EXECUTION") blockers.push("execution_incomplete");
  if (input.paymentState !== "CAPTURED" && input.paymentState !== "REFUNDED") blockers.push(`payment_${input.paymentState.toLowerCase()}`);
  if (input.invoiceState !== "PAID" && input.invoiceState !== "VOID") blockers.push(`invoice_${input.invoiceState.toLowerCase()}`);
  if (input.openClaims > 0) blockers.push("open_claim");
  return { closed: blockers.length === 0, blockers };
}
