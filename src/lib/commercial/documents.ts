/**
 * Commercial Document Orchestration — client mirror.
 *
 * The four customer-facing commercial document stages (quotation, proforma,
 * tax invoice, payment receipt) are projections of ONE authoritative source:
 * the commercial transaction spine. The PDF is never the source of truth —
 * these types and guards mirror the server-side state machine enforced by
 * `commercial_document_generate` / `commercial_document_transition` so the UI
 * can only offer transitions the database will accept.
 */

export const COMMERCIAL_DOCUMENT_TYPES = [
  "quotation",
  "proforma",
  "tax_invoice",
  "payment_receipt",
] as const;
export type CommercialDocumentType = (typeof COMMERCIAL_DOCUMENT_TYPES)[number];

export const COMMERCIAL_DOCUMENT_STATUSES = [
  "draft", "pending_approval", "approved", "sent", "accepted", "rejected",
  "expired", "cancelled", "issued", "partially_paid", "paid",
  "tax_validation", "etims_pending", "etims_accepted", "etims_exception",
  "delivered", "correction_required", "superseded", "voided",
] as const;
export type CommercialDocumentStatus = (typeof COMMERCIAL_DOCUMENT_STATUSES)[number];

export const DOCUMENT_TYPE_LABEL: Record<CommercialDocumentType, string> = {
  quotation: "Quotation",
  proforma: "Proforma Invoice",
  tax_invoice: "Tax Invoice",
  payment_receipt: "Payment Confirmation",
};

export const DOCUMENT_NUMBER_PREFIX: Record<CommercialDocumentType, string> = {
  quotation: "YAL-QTN",
  proforma: "YAL-PFI",
  tax_invoice: "YAL-INV",
  payment_receipt: "YAL-RCP",
};

/** Server-side numbering contract: YAL-XXX-YYYY-NNNNNN. */
export const DOCUMENT_NUMBER_RE = /^YAL-(QTN|PFI|INV|RCP)-\d{4}-\d{6}$/;

/** Terminal states — no further transitions are legal. */
export const TERMINAL_STATUSES: CommercialDocumentStatus[] = [
  "superseded", "voided", "cancelled", "expired",
];

/**
 * Strict state machine, mirroring `commercial_document_transition` in the
 * database. If the UI offers a transition not listed here the RPC rejects it.
 */
export const DOCUMENT_TRANSITIONS: Record<
  CommercialDocumentType,
  Readonly<Partial<Record<CommercialDocumentStatus, readonly CommercialDocumentStatus[]>>>
> = {
  quotation: {
    draft: ["pending_approval", "cancelled"],
    pending_approval: ["approved", "rejected", "draft"],
    approved: ["sent", "expired", "cancelled"],
    sent: ["accepted", "rejected", "expired"],
    accepted: ["superseded"],
  },
  proforma: {
    draft: ["pending_approval", "cancelled"],
    pending_approval: ["approved", "rejected", "draft"],
    approved: ["issued", "cancelled"],
    issued: ["sent", "partially_paid", "paid", "expired", "voided"],
    sent: ["partially_paid", "paid", "expired"],
    partially_paid: ["paid", "voided"],
  },
  tax_invoice: {
    draft: ["tax_validation", "cancelled"],
    tax_validation: ["etims_pending", "correction_required"],
    etims_pending: ["etims_accepted", "etims_exception"],
    etims_accepted: ["issued"],
    etims_exception: ["etims_pending", "voided"],
    issued: ["sent", "correction_required"],
    sent: ["delivered", "correction_required"],
    correction_required: ["superseded", "voided"],
  },
  payment_receipt: {
    draft: ["issued", "cancelled"],
    issued: ["sent", "voided"],
    sent: ["delivered", "voided"],
  },
};

export function canTransition(
  type: CommercialDocumentType,
  from: CommercialDocumentStatus,
  to: CommercialDocumentStatus,
): boolean {
  return (DOCUMENT_TRANSITIONS[type][from] ?? []).includes(to);
}

export function nextStatuses(
  type: CommercialDocumentType,
  from: CommercialDocumentStatus,
): readonly CommercialDocumentStatus[] {
  return DOCUMENT_TRANSITIONS[type][from] ?? [];
}

/** The Part IX event vocabulary (subset emitted by the engine today). */
export const COMMERCIAL_EVENT_TYPES = [
  "TRANSACTION_CREATED",
  "QUOTE_CREATED", "QUOTE_UPDATED", "QUOTE_APPROVED", "QUOTE_REJECTED", "QUOTE_SENT", "QUOTE_ACCEPTED", "QUOTE_EXPIRED",
  "PROFORMA_CREATED", "PROFORMA_UPDATED", "PROFORMA_APPROVED", "PROFORMA_REJECTED", "PROFORMA_SENT",
  "PAYMENT_INITIATED", "PAYMENT_RECEIVED", "PAYMENT_MATCHED", "PAYMENT_UNMATCHED", "PAYMENT_RECONCILED", "PAYMENT_FAILED",
  "TAX_INVOICE_REQUESTED", "TAX_VALIDATION_STARTED", "ETIMS_SUBMISSION_STARTED", "ETIMS_ACCEPTED", "ETIMS_REJECTED", "TAX_INVOICE_ISSUED",
  "PAYMENT_CONFIRMATION_CREATED", "PAYMENT_CONFIRMATION_SENT",
  "EMAIL_QUEUED", "EMAIL_SENT", "EMAIL_DELIVERED", "EMAIL_BOUNCED", "EMAIL_FAILED",
  "PDF_SEALED",
  "DOCUMENT_VOIDED", "DOCUMENT_SUPERSEDED", "DOCUMENT_CORRECTED",
  "DOCUMENT_STATUS_CHANGED", "ISSUANCE_BLOCKED", "COMMERCIAL_VARIANCE_EXCEPTION",
  "AUDIT_EXCEPTION_CREATED", "AUDIT_EXCEPTION_RESOLVED",
] as const;
export type CommercialEventType = (typeof COMMERCIAL_EVENT_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Hard-blocker gates (pure mirrors of the server-side controls)       */
/* ------------------------------------------------------------------ */

export interface GateResult {
  allowed: boolean;
  /** Plain-English reason when blocked. */
  reason: string | null;
}

/** Proforma totals must reconcile with the accepted quotation (±KES 1). */
export function evaluateProformaVariance(
  transactionTotalCents: number,
  sourceQuotationTotalCents: number,
  toleranceCents = 100,
): GateResult {
  const delta = Math.abs(transactionTotalCents - sourceQuotationTotalCents);
  if (delta > toleranceCents) {
    return {
      allowed: false,
      reason: `Commercial variance: transaction total ${transactionTotalCents} differs from source quotation ${sourceQuotationTotalCents} by ${delta} cents. Automatic issuance is blocked pending an approved change request.`,
    };
  }
  return { allowed: true, reason: null };
}

/** eTIMS hard gate: a tax invoice may only be ISSUED from a SYNCED eTIMS record. */
export function evaluateEtimsGate(etimsStatus: string | null): GateResult {
  if (etimsStatus === "SYNCED") return { allowed: true, reason: null };
  return {
    allowed: false,
    reason: etimsStatus
      ? `eTIMS gate: submission is ${etimsStatus}, not SYNCED. The tax invoice is parked in ETIMS_EXCEPTION.`
      : "eTIMS gate: no eTIMS submission exists for this transaction. The tax invoice is parked in ETIMS_EXCEPTION.",
  };
}

export interface ReceiptEvidence {
  paymentStatus: string | null;
  hasSuccessfulMpesa: boolean;
  corporateInvoicePaidInFull: boolean;
}

/** Ghost-receipt prevention: a payment confirmation requires reconciled payment evidence. */
export function evaluateReceiptGate(evidence: ReceiptEvidence): GateResult {
  const statusPaid = ["paid", "reconciled", "matched", "settled"].includes(
    (evidence.paymentStatus ?? "").toLowerCase(),
  );
  if (statusPaid || evidence.hasSuccessfulMpesa || evidence.corporateInvoicePaidInFull) {
    return { allowed: true, reason: null };
  }
  return {
    allowed: false,
    reason: "Payment gate: no reconciled payment evidence. A payment confirmation can never be fabricated — reconcile the payment first.",
  };
}

/* ------------------------------------------------------------------ */
/* Forensic risk scoring (Part XLIX)                                   */
/* ------------------------------------------------------------------ */

export type CommercialRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskSignals {
  varianceCents?: number;
  discountOverThreshold?: boolean;
  recipientEmailChangedRecently?: boolean;
  bankDetailsDifferFromMaster?: boolean;
  duplicateDocumentAttempt?: boolean;
  forgedPaymentEvidence?: boolean;
  auditDestructionAttempt?: boolean;
}

export function scoreCommercialRisk(s: RiskSignals): CommercialRiskLevel {
  if (s.forgedPaymentEvidence || s.auditDestructionAttempt || s.bankDetailsDifferFromMaster || s.duplicateDocumentAttempt) {
    return "CRITICAL";
  }
  if (s.discountOverThreshold || s.recipientEmailChangedRecently) return "HIGH";
  if ((s.varianceCents ?? 0) > 100) return "MEDIUM";
  return "LOW";
}

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

export function formatKes(cents: number, currency = "KES"): string {
  return `${currency} ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;
}

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export function statusTone(status: CommercialDocumentStatus): StatusTone {
  switch (status) {
    case "issued": case "sent": case "delivered": case "accepted": case "approved":
    case "paid": case "etims_accepted":
      return "success";
    case "etims_exception": case "correction_required": case "rejected":
      return "danger";
    case "pending_approval": case "tax_validation": case "etims_pending":
    case "partially_paid":
      return "warning";
    case "voided": case "cancelled": case "expired": case "superseded":
      return "neutral";
    default:
      return "info";
  }
}

export const STATUS_LABEL: Record<CommercialDocumentStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Cancelled",
  issued: "Issued",
  partially_paid: "Partially paid",
  paid: "Paid",
  tax_validation: "Tax validation",
  etims_pending: "eTIMS pending",
  etims_accepted: "eTIMS accepted",
  etims_exception: "eTIMS exception",
  delivered: "Delivered",
  correction_required: "Correction required",
  superseded: "Superseded",
  voided: "Voided",
};

/* ------------------------------------------------------------------ */
/* Separation of duties (four-eyes) — mirrors the server-side control  */
/* in `commercial_document_transition`.                                */
/* ------------------------------------------------------------------ */

export const SOD_REASON =
  "Separation of duties: this document was created by you — a different commercial officer must approve or transition it (four-eyes control).";

/**
 * The creator of a document may never action it through the lifecycle.
 * System actors (null actorId — eTIMS webhooks, reconciliation jobs) and
 * legacy documents without a recorded creator are exempt, exactly like the
 * database function.
 */
export function evaluateSeparationOfDuties(
  createdBy: string | null | undefined,
  actorId: string | null | undefined,
): GateResult {
  if (createdBy && actorId && createdBy === actorId) {
    return { allowed: false, reason: SOD_REASON };
  }
  return { allowed: true, reason: null };
}

/* ------------------------------------------------------------------ */
/* Email dispatch audit trail — mirrors `commercial_document_dispatches` */
/* ------------------------------------------------------------------ */

export const DISPATCH_STATUSES = [
  "queued", "sent", "delivered", "bounced", "failed", "suppressed",
] as const;
export type DocumentDispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const DISPATCH_STATUS_LABEL: Record<DocumentDispatchStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  failed: "Failed",
  suppressed: "Suppressed",
};

export function dispatchStatusTone(status: DocumentDispatchStatus): StatusTone {
  switch (status) {
    case "sent": case "delivered":
      return "success";
    case "bounced": case "failed":
      return "danger";
    case "queued":
      return "info";
    case "suppressed":
      return "warning";
    default:
      return "neutral";
  }
}

/** Deterministic idempotency key: one logical email per document version + leg. */
export function dispatchMessageId(documentId: string, version: number, leg: string): string {
  return `commercial:${documentId}:v${version}:${leg}`;
}
