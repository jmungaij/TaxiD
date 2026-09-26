/**
 * HISTORICAL PRICING IMMUTABILITY + COMMERCIAL DOCUMENT RECONSTRUCTION.
 *
 * Two obligations are executed here, in process, at application level:
 *
 *  1. Historical immutability — an accepted quote priced on rate-plan V1 must
 *     still reconstruct to its V1 amount after V2 is approved. The test builds
 *     both versions, prices the same inputs on each, and proves the accepted
 *     snapshot never drifts to the newer amount.
 *
 *  2. Document reconstruction — an INVOICE and a PAYMENT RECEIPT are derived
 *     from the stored rate-plan parts alone (base + distance + weight + service
 *     level + vehicle class + surcharge + tax − discount), so Finance, a
 *     corporate customer, an auditor or a dispute handler can see exactly how
 *     the charged amount was produced.
 *
 * NOTE ON SCOPE: this is application-level evidence. Database-level immutability
 * (direct UPDATE/DELETE against an accepted quote) is a separate control that
 * stays BLOCKED until the isolated Postgres environment exists. Nothing in this
 * module may be read as proof of database enforcement.
 */
import {
  reconstructPrice,
  versionInForce,
  type PricingInputs,
  type RatePlan,
  type RatePlanVersion,
  type PriceReconstruction,
} from "./ratePlan";
import { agreedPriceDrift, type QuoteRecord, type QuoteSnapshot } from "./quote";

const round = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------- fixtures ---------------------------------- */

const V1: RatePlanVersion = {
  rate_plan_id: "rp_courier_metro",
  version: 1,
  status: "APPROVED",
  effective_from: "2026-01-01T00:00:00.000Z",
  effective_to: "2026-08-01T00:00:00.000Z",
  approved_by: "commercial_director",
  immutable: true,
  components: [
    { component_id: "c1", code: "BASE_PICKUP", label: "Base pickup", kind: "BASE", basis: "FLAT", rate: 180, sequence: 1 },
    { component_id: "c2", code: "DISTANCE", label: "Distance", kind: "BASE", basis: "PER_KM", rate: 14, sequence: 2 },
    { component_id: "c3", code: "WEIGHT", label: "Billable weight", kind: "BASE", basis: "PER_KG", rate: 6, sequence: 3 },
    { component_id: "c4", code: "FUEL", label: "Fuel surcharge", kind: "SURCHARGE", basis: "PERCENT_OF_BASE", rate: 7.5, sequence: 4 },
  ],
  rules: [
    { rule_id: "r1", predicate: { service_level: "SAME_DAY" }, applies_component_codes: ["FUEL"], note: "Fuel surcharge applies to same-day only" },
  ],
};

const V2: RatePlanVersion = {
  ...V1,
  version: 2,
  effective_from: "2026-08-01T00:00:00.000Z",
  effective_to: null,
  components: [
    { component_id: "c1", code: "BASE_PICKUP", label: "Base pickup", kind: "BASE", basis: "FLAT", rate: 230, sequence: 1 },
    { component_id: "c2", code: "DISTANCE", label: "Distance", kind: "BASE", basis: "PER_KM", rate: 17, sequence: 2 },
    { component_id: "c3", code: "WEIGHT", label: "Billable weight", kind: "BASE", basis: "PER_KG", rate: 8, sequence: 3 },
    { component_id: "c4", code: "FUEL", label: "Fuel surcharge", kind: "SURCHARGE", basis: "PERCENT_OF_BASE", rate: 9, sequence: 4 },
  ],
};

export const HISTORICAL_RATE_PLAN: RatePlan = {
  rate_plan_id: "rp_courier_metro",
  code: "COURIER_METRO",
  offering_code: "COURIER_DOCUMENT",
  currency: "KES",
  versions: [{ ...V1, status: "SUPERSEDED" }, V2],
};

export const HISTORICAL_INPUTS: PricingInputs = {
  distance_km: 12,
  billable_weight_kg: 4,
  package_count: 1,
  stop_count: 1,
  service_level: "SAME_DAY",
  vehicle_class: "MOTORCYCLE",
  corporate_account_id: "corp_decagon",
  zone: "NAIROBI_METRO",
  tax_rate: 0.16,
};

/* -------------------------- historical immutability ------------------------- */

export interface HistoricalImmutabilityResult {
  v1_total_kes: number;
  v2_total_kes: number;
  accepted_amount_kes: number;
  reconstructed_from_snapshot_kes: number;
  drift_kes: number;
  /** True only when the accepted quote still reconstructs to its V1 amount. */
  passed: boolean;
  notes: string[];
}

/** Builds an accepted quote frozen on V1, then approves V2 and proves no drift. */
export function proveHistoricalRateImmutability(): HistoricalImmutabilityResult {
  const onV1 = reconstructPrice(V1, HISTORICAL_INPUTS);
  const onV2 = reconstructPrice(V2, HISTORICAL_INPUTS);

  const snapshot: QuoteSnapshot = {
    rate_plan_id: V1.rate_plan_id,
    rate_plan_version: V1.version,
    pricing_version: "rp_courier_metro@1",
    offering_code: "COURIER_DOCUMENT",
    offering_version: 1,
    inputs: {
      origin: "Westlands",
      destination: "Upper Hill",
      distance_km: HISTORICAL_INPUTS.distance_km,
      package_count: HISTORICAL_INPUTS.package_count,
      billable_weight_kg: HISTORICAL_INPUTS.billable_weight_kg,
      volumetric_weight_kg: null,
      dimensions_cm: [{ l: 30, w: 20, h: 5 }],
      service_level: HISTORICAL_INPUTS.service_level,
      vehicle_class: HISTORICAL_INPUTS.vehicle_class,
      declared_value_kes: 15000,
    },
    components: onV1.lines.map((l) => ({ code: l.code, label: l.label, basis: l.basis, amount_kes: l.amount_kes })),
    base_amount_kes: onV1.base_kes,
    surcharges_kes: onV1.surcharges_kes,
    discounts_kes: onV1.discounts_kes,
    tax_kes: onV1.tax_kes,
    quoted_amount_kes: onV1.total_kes,
    currency: "KES",
    commitment_level: "BOOKABLE",
    captured_at: "2026-07-15T09:00:00.000Z",
    snapshot_hash: "sha256:fixture",
  };

  const accepted: QuoteRecord = {
    quote_id: "q_hist_1",
    quote_reference: "QT-HIST-0001",
    version: 1,
    owner_user_id: "user_hist",
    corporate_account_id: "corp_decagon",
    offering_code: "COURIER_DOCUMENT",
    rate_plan_id: V1.rate_plan_id,
    rate_plan_version: 1,
    status: "ACCEPTED",
    snapshot,
    valid_from: "2026-07-15T09:00:00.000Z",
    expires_at: "2026-07-22T09:00:00.000Z",
    accepted_at: "2026-07-16T10:00:00.000Z",
    accepted_by: "user_hist",
    superseded_by_quote_id: null,
    correlation_id: "corr_hist",
    idempotency_key: "idem_hist",
    created_at: "2026-07-15T09:00:00.000Z",
  };

  // Reconstruction must use the version stored on the snapshot, never the
  // version currently in force.
  const storedVersion = [V1, V2].find((v) => v.version === accepted.snapshot.rate_plan_version)!;
  const replay = reconstructPrice(storedVersion, HISTORICAL_INPUTS);
  const drift = agreedPriceDrift(accepted, onV2.total_kes);
  const inForceNow = versionInForce(HISTORICAL_RATE_PLAN, "2026-08-26T00:00:00.000Z");

  const passed =
    replay.total_kes === onV1.total_kes &&
    drift.invoiceable_kes === onV1.total_kes &&
    onV2.total_kes !== onV1.total_kes &&
    inForceNow?.version === 2;

  return {
    v1_total_kes: onV1.total_kes,
    v2_total_kes: onV2.total_kes,
    accepted_amount_kes: accepted.snapshot.quoted_amount_kes,
    reconstructed_from_snapshot_kes: replay.total_kes,
    drift_kes: round(drift.drift_kes),
    passed,
    notes: [
      `V1 reconstructs to KES ${onV1.total_kes} from stored parts; V2 would price the same inputs at KES ${onV2.total_kes}.`,
      `Version in force today is V${inForceNow?.version ?? "none"}, yet the accepted quote still invoices KES ${drift.invoiceable_kes}.`,
      "Application-level only — direct database mutation of the accepted snapshot remains an untested control.",
    ],
  };
}

/* --------------------------- commercial documents --------------------------- */

export interface DocumentLine {
  code: string;
  label: string;
  basis: string;
  amount_kes: number;
}

export interface ReconstructedInvoice {
  invoice_number: string;
  quote_reference: string;
  rate_plan_reference: string;
  issued_at: string;
  currency: "KES";
  lines: DocumentLine[];
  base_kes: number;
  surcharges_kes: number;
  discounts_kes: number;
  taxable_kes: number;
  tax_kes: number;
  total_kes: number;
  /** True when the derived total equals the frozen agreed amount. */
  reconciles_to_quote: boolean;
  derivation: string;
}

/** Builds an invoice purely from the quote snapshot's stored pricing parts. */
export function buildInvoiceFromQuote(quote: QuoteRecord, invoiceNumber: string, issuedAt: string): ReconstructedInvoice {
  const s = quote.snapshot;
  const taxable = round(s.base_amount_kes + s.surcharges_kes - s.discounts_kes);
  const total = round(taxable + s.tax_kes);
  return {
    invoice_number: invoiceNumber,
    quote_reference: s ? quote.quote_reference : quote.quote_reference,
    rate_plan_reference: `${s.rate_plan_id}@v${s.rate_plan_version}`,
    issued_at: issuedAt,
    currency: "KES",
    lines: s.components.map((c) => ({ code: c.code, label: c.label, basis: c.basis, amount_kes: c.amount_kes })),
    base_kes: s.base_amount_kes,
    surcharges_kes: s.surcharges_kes,
    discounts_kes: s.discounts_kes,
    taxable_kes: taxable,
    tax_kes: s.tax_kes,
    total_kes: total,
    reconciles_to_quote: total === s.quoted_amount_kes,
    derivation: "base + distance + weight + service level + vehicle class + surcharge − discount + tax",
  };
}

export interface PaymentReceipt {
  receipt_number: string;
  invoice_number: string;
  paid_at: string;
  method: "MPESA" | "CORPORATE_WALLET" | "BANK_TRANSFER";
  provider_reference: string;
  amount_paid_kes: number;
  invoice_total_kes: number;
  balance_kes: number;
  status: "PAID_IN_FULL" | "PARTIALLY_PAID" | "OVERPAID";
  /** Chain the receipt back through invoice → quote → rate-plan version. */
  lineage: string[];
}

export function buildPaymentReceipt(input: {
  receiptNumber: string;
  invoice: ReconstructedInvoice;
  amountPaidKes: number;
  paidAt: string;
  method: PaymentReceipt["method"];
  providerReference: string;
}): PaymentReceipt {
  const balance = round(input.invoice.total_kes - input.amountPaidKes);
  return {
    receipt_number: input.receiptNumber,
    invoice_number: input.invoice.invoice_number,
    paid_at: input.paidAt,
    method: input.method,
    provider_reference: input.providerReference,
    amount_paid_kes: round(input.amountPaidKes),
    invoice_total_kes: input.invoice.total_kes,
    balance_kes: balance,
    status: balance === 0 ? "PAID_IN_FULL" : balance > 0 ? "PARTIALLY_PAID" : "OVERPAID",
    lineage: [
      `receipt ${input.receiptNumber}`,
      `invoice ${input.invoice.invoice_number}`,
      `quote ${input.invoice.quote_reference}`,
      `rate plan ${input.invoice.rate_plan_reference}`,
    ],
  };
}

export interface CommercialDocumentProof {
  reconstruction: PriceReconstruction;
  invoice: ReconstructedInvoice;
  receipt: PaymentReceipt;
  passed: boolean;
}

/** Executes the full quote → invoice → receipt reconstruction on rate-plan V1. */
export function proveCommercialDocumentChain(): CommercialDocumentProof {
  const reconstruction = reconstructPrice(V1, HISTORICAL_INPUTS);
  const hist = proveHistoricalRateImmutability();

  const snapshotQuote: QuoteRecord = {
    quote_id: "q_hist_1",
    quote_reference: "QT-HIST-0001",
    version: 1,
    owner_user_id: "user_hist",
    corporate_account_id: "corp_decagon",
    offering_code: "COURIER_DOCUMENT",
    rate_plan_id: V1.rate_plan_id,
    rate_plan_version: 1,
    status: "ACCEPTED",
    snapshot: {
      rate_plan_id: V1.rate_plan_id,
      rate_plan_version: 1,
      pricing_version: "rp_courier_metro@1",
      offering_code: "COURIER_DOCUMENT",
      offering_version: 1,
      inputs: {
        origin: "Westlands",
        destination: "Upper Hill",
        distance_km: HISTORICAL_INPUTS.distance_km,
        package_count: 1,
        billable_weight_kg: HISTORICAL_INPUTS.billable_weight_kg,
        volumetric_weight_kg: null,
        dimensions_cm: [{ l: 30, w: 20, h: 5 }],
        service_level: HISTORICAL_INPUTS.service_level,
        vehicle_class: HISTORICAL_INPUTS.vehicle_class,
        declared_value_kes: 15000,
      },
      components: reconstruction.lines.map((l) => ({ code: l.code, label: l.label, basis: l.basis, amount_kes: l.amount_kes })),
      base_amount_kes: reconstruction.base_kes,
      surcharges_kes: reconstruction.surcharges_kes,
      discounts_kes: reconstruction.discounts_kes,
      tax_kes: reconstruction.tax_kes,
      quoted_amount_kes: reconstruction.total_kes,
      currency: "KES",
      commitment_level: "BOOKABLE",
      captured_at: "2026-07-15T09:00:00.000Z",
      snapshot_hash: "sha256:fixture",
    },
    valid_from: "2026-07-15T09:00:00.000Z",
    expires_at: "2026-07-22T09:00:00.000Z",
    accepted_at: "2026-07-16T10:00:00.000Z",
    accepted_by: "user_hist",
    superseded_by_quote_id: null,
    correlation_id: "corr_hist",
    idempotency_key: "idem_hist",
    created_at: "2026-07-15T09:00:00.000Z",
  };

  const invoice = buildInvoiceFromQuote(snapshotQuote, "INV-HIST-0001", "2026-07-20T09:00:00.000Z");
  const receipt = buildPaymentReceipt({
    receiptNumber: "RCT-HIST-0001",
    invoice,
    amountPaidKes: invoice.total_kes,
    paidAt: "2026-07-20T10:15:00.000Z",
    method: "MPESA",
    providerReference: "SJ12ABC345",
  });

  return {
    reconstruction,
    invoice,
    receipt,
    passed:
      invoice.reconciles_to_quote &&
      receipt.status === "PAID_IN_FULL" &&
      receipt.lineage.length === 4 &&
      hist.passed,
  };
}
