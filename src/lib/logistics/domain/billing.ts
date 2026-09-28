/**
 * PHASE 4 — BILLING SEPARATION.
 *
 * Delivery completion is OPERATIONAL. Billability is COMMERCIAL.
 *
 *   DELIVERY OUTCOME + CONTRACT + RATE PLAN + COMMERCIAL RULES → BILLABLE AMOUNT
 *
 * A delivered package is therefore only a "delivery outcome eligible for billing
 * evaluation" — never automatically a billable unit. The billing engine below is
 * the single sanctioned place where that evaluation happens, and every charge
 * keeps a full lineage back to the operational activity that produced it.
 */
import type { PackageResult } from "./custody";

export type BillingModel =
  | "PER_SHIPMENT"
  | "PER_PACKAGE"
  | "MINIMUM_CHARGE"
  | "WEIGHT_BAND"
  | "CORPORATE_CONTRACT";

export interface BillingContract {
  contract_id: string | null;
  model: BillingModel;
  /** Charge raised even when delivery failed after a genuine attempt. */
  charge_attempted_delivery: boolean;
  /** Charge raised for the return leg. */
  charge_return_leg: boolean;
  minimum_charge_kes: number;
  corporate_account_id?: string | null;
}

export type BillingEvaluationOutcome = "BILLABLE" | "NOT_BILLABLE" | "MANUAL_REVIEW";

export interface BillingEvaluationLine {
  package_id: string;
  delivery_outcome: PackageResult["outcome"];
  reason_code?: string;
  evaluation: BillingEvaluationOutcome;
  basis: string;
}

export interface BillingEvaluation {
  /** Delivery outcomes handed to the billing engine — NOT a charge count. */
  outcomes_eligible_for_evaluation: string[];
  lines: BillingEvaluationLine[];
  billable_units: number;
  model: BillingModel;
  manual_review: string[];
  note: string;
}

/**
 * Evaluates delivery outcomes against the commercial contract.
 * The count of delivered packages is deliberately NOT the count of billable units.
 */
export function evaluateBilling(results: PackageResult[], contract: BillingContract): BillingEvaluation {
  const lines: BillingEvaluationLine[] = results.map((r) => {
    if (r.outcome === "PENDING") {
      return { package_id: r.package_id, delivery_outcome: r.outcome, reason_code: r.reason_code, evaluation: "NOT_BILLABLE", basis: "execution incomplete" };
    }
    if (r.outcome === "DELIVERED") {
      return { package_id: r.package_id, delivery_outcome: r.outcome, evaluation: "BILLABLE", basis: `${contract.model} delivered outcome` };
    }
    if (r.outcome === "FAILED") {
      if (r.reason_code === "DAMAGED_PACKAGE" || r.reason_code === "SECURITY_INCIDENT") {
        return { package_id: r.package_id, delivery_outcome: r.outcome, reason_code: r.reason_code, evaluation: "MANUAL_REVIEW", basis: "claim candidate — commercial decision required" };
      }
      return {
        package_id: r.package_id,
        delivery_outcome: r.outcome,
        reason_code: r.reason_code,
        evaluation: contract.charge_attempted_delivery ? "BILLABLE" : "NOT_BILLABLE",
        basis: contract.charge_attempted_delivery ? "attempted-delivery charge permitted by contract" : "no attempted-delivery charge in contract",
      };
    }
    return {
      package_id: r.package_id,
      delivery_outcome: r.outcome,
      reason_code: r.reason_code,
      evaluation: contract.charge_return_leg ? "BILLABLE" : "NOT_BILLABLE",
      basis: contract.charge_return_leg ? "return-leg charge permitted by contract" : "return leg absorbed by TaxiD",
    };
  });

  const billableLines = lines.filter((l) => l.evaluation === "BILLABLE");
  const billable_units =
    contract.model === "PER_SHIPMENT" ? (billableLines.length > 0 ? 1 : 0) : billableLines.length;

  return {
    outcomes_eligible_for_evaluation: results.filter((r) => r.outcome !== "PENDING").map((r) => r.package_id),
    lines,
    billable_units,
    model: contract.model,
    manual_review: lines.filter((l) => l.evaluation === "MANUAL_REVIEW").map((l) => l.package_id),
    note: "Delivered package count is never the billable count; the contract decides.",
  };
}

/* ------------------------- charge → invoice lineage ------------------------- */

/**
 * PHASE 5 of the reconciliation chain:
 *   shipment → quote → charge → invoice item → payment → settlement
 */
export interface ChargeRecord {
  charge_id: string;
  shipment_id: string;
  package_id: string | null;
  quote_id: string;
  rate_plan_id: string;
  rate_plan_version: number;
  offering_code: string;
  amount_kes: number;
  tax_kes: number;
  charge_breakdown: { code: string; amount_kes: number }[];
  billing_evaluation: BillingEvaluationOutcome;
  correlation_id: string;
  idempotency_key: string;
}

export interface InvoiceItemLink {
  link_id: string;
  charge_id: string;
  shipment_id: string;
  package_id: string | null;
  quote_id: string;
  corporate_invoice_item_id: string;
  corporate_invoice_id: string;
  rate_plan_version: number;
}

export const LINEAGE_CHAIN = [
  "shipment",
  "quote",
  "charge",
  "invoice_item",
  "payment",
  "settlement",
] as const;

export interface LineageAudit {
  complete: boolean;
  missing: string[];
  answersWhichActivityProducedThisLine: boolean;
}

/** Proves an invoice line can be traced back to the operational activity. */
export function auditInvoiceLineage(input: {
  link?: InvoiceItemLink | null;
  charge?: ChargeRecord | null;
  paymentAttemptId?: string | null;
  settlementId?: string | null;
}): LineageAudit {
  const missing: string[] = [];
  if (!input.charge?.shipment_id) missing.push("shipment");
  if (!input.charge?.quote_id) missing.push("quote");
  if (!input.charge) missing.push("charge");
  if (!input.link?.corporate_invoice_item_id) missing.push("invoice_item");
  if (!input.paymentAttemptId) missing.push("payment");
  if (!input.settlementId) missing.push("settlement");
  return {
    complete: missing.length === 0,
    missing,
    answersWhichActivityProducedThisLine: !missing.includes("shipment") && !missing.includes("invoice_item"),
  };
}

/* ----------------------------- claim escalation ----------------------------- */

export type ClaimCandidateState = "CLAIM_CANDIDATE" | "CLAIM_OPENED" | "REJECTED_AT_TRIAGE";

/**
 * A claim candidate NEVER becomes a claim automatically — eligibility review is
 * mandatory so TaxiD never auto-assumes liability.
 */
export function promoteClaimCandidate(input: {
  reviewed: boolean;
  reviewer_id: string | null;
  protection_policy_id: string | null;
  eligible: boolean;
}): { state: ClaimCandidateState; blockers: string[] } {
  const blockers: string[] = [];
  if (!input.reviewed) blockers.push("eligibility_review_required");
  if (!input.reviewer_id) blockers.push("reviewer_required");
  if (blockers.length > 0) return { state: "CLAIM_CANDIDATE", blockers };
  if (!input.eligible) return { state: "REJECTED_AT_TRIAGE", blockers: [] };
  if (!input.protection_policy_id) return { state: "CLAIM_CANDIDATE", blockers: ["no_protection_policy_in_force"] };
  return { state: "CLAIM_OPENED", blockers: [] };
}
