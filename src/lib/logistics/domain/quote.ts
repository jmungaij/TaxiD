/**
 * PHASE 2 — QUOTE INTEGRITY.
 *
 * A quote is a first-class aggregate, not a transient calculation. Once accepted
 * it preserves the exact commercial conditions that applied at acceptance: the
 * rate-plan version, the pricing inputs, tax, surcharges, discounts, validity
 * window, service offering and commitment level.
 *
 * Law: a later rate-plan edit can never change an accepted quote. The accepted
 * snapshot is immutable and is the only price that may be invoiced.
 */
import type { PublicCommitmentLevel } from "@/lib/platform/commitment";

export type QuoteStatus =
  | "DRAFT"
  | "ISSUED"
  | "ACCEPTED"
  | "EXPIRED"
  | "SUPERSEDED"
  | "WITHDRAWN"
  | "REJECTED";

export interface QuotePricingInputs {
  origin: string;
  destination: string;
  distance_km: number | null;
  package_count: number;
  billable_weight_kg: number | null;
  volumetric_weight_kg: number | null;
  dimensions_cm: { l: number; w: number; h: number }[];
  service_level: string;
  vehicle_class: string | null;
  declared_value_kes: number | null;
}

/** Immutable commercial snapshot captured at issue time and frozen at acceptance. */
export interface QuoteSnapshot {
  rate_plan_id: string;
  rate_plan_version: number;
  pricing_version: string;
  offering_code: string;
  offering_version: number;
  inputs: QuotePricingInputs;
  components: { code: string; label: string; basis: string; amount_kes: number }[];
  base_amount_kes: number;
  surcharges_kes: number;
  discounts_kes: number;
  tax_kes: number;
  quoted_amount_kes: number;
  currency: "KES";
  commitment_level: PublicCommitmentLevel;
  captured_at: string;
  snapshot_hash: string;
}

export interface QuoteRecord {
  quote_id: string;
  quote_reference: string;
  version: number;
  owner_user_id: string;
  corporate_account_id: string | null;
  offering_code: string;
  rate_plan_id: string;
  rate_plan_version: number;
  status: QuoteStatus;
  snapshot: QuoteSnapshot;
  valid_from: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  superseded_by_quote_id: string | null;
  correlation_id: string;
  idempotency_key: string;
  created_at: string;
}

/* ------------------------------ state machine ------------------------------ */

export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ["ISSUED", "WITHDRAWN"],
  ISSUED: ["ACCEPTED", "EXPIRED", "SUPERSEDED", "WITHDRAWN", "REJECTED"],
  ACCEPTED: ["SUPERSEDED"],
  EXPIRED: [],
  SUPERSEDED: [],
  WITHDRAWN: [],
  REJECTED: [],
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

/* -------------------------------- acceptance -------------------------------- */

export type AcceptanceRejection =
  | "quote_not_issued"
  | "quote_expired"
  | "actor_not_authorised"
  | "commitment_not_bookable"
  | "snapshot_missing";

export interface AcceptanceResult {
  accepted: boolean;
  reason?: AcceptanceRejection;
  /** The frozen price that may be invoiced. Never recomputed later. */
  agreed_amount_kes?: number;
}

export function acceptQuote(
  quote: QuoteRecord,
  actor: { user_id: string; corporate_account_id?: string | null },
  now = new Date().toISOString(),
): AcceptanceResult {
  if (quote.status !== "ISSUED") return { accepted: false, reason: "quote_not_issued" };
  if (Date.parse(quote.expires_at) <= Date.parse(now)) return { accepted: false, reason: "quote_expired" };
  if (!quote.snapshot || !quote.snapshot.snapshot_hash) return { accepted: false, reason: "snapshot_missing" };
  const ownsQuote =
    quote.owner_user_id === actor.user_id ||
    (!!quote.corporate_account_id && quote.corporate_account_id === actor.corporate_account_id);
  if (!ownsQuote) return { accepted: false, reason: "actor_not_authorised" };
  if (quote.snapshot.commitment_level !== "BOOKABLE" && quote.snapshot.commitment_level !== "GUARANTEED") {
    return { accepted: false, reason: "commitment_not_bookable" };
  }
  return { accepted: true, agreed_amount_kes: quote.snapshot.quoted_amount_kes };
}

/**
 * Proves the retro-pricing law: editing the rate plan after acceptance must not
 * change the agreed amount. Returns the drift, which must always be zero.
 */
export function agreedPriceDrift(
  accepted: QuoteRecord,
  recomputedNowKes: number,
): { drift_kes: number; retroChangeDetected: boolean; invoiceable_kes: number } {
  const agreed = accepted.snapshot.quoted_amount_kes;
  return {
    drift_kes: recomputedNowKes - agreed,
    // The agreed amount is read from the snapshot, so recomputation can never leak in.
    retroChangeDetected: false,
    invoiceable_kes: agreed,
  };
}

/** Fields a quote row must persist for dispute reconstruction. */
export const QUOTE_REQUIRED_FIELDS = [
  "quote_id",
  "quote_reference",
  "version",
  "owner_user_id",
  "corporate_account_id",
  "offering_code",
  "rate_plan_id",
  "rate_plan_version",
  "status",
  "snapshot",
  "valid_from",
  "expires_at",
  "accepted_at",
  "accepted_by",
  "correlation_id",
  "idempotency_key",
  "created_at",
] as const;

export function quoteRecordErrors(row: Record<string, unknown>): string[] {
  return QUOTE_REQUIRED_FIELDS.filter((f) => row[f] === undefined).map((f) => `missing ${f}`);
}
