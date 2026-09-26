/**
 * Yalla Mobility Enterprise Document System 2.0 — document title resolver.
 *
 * Charter documents are NOT tax invoices. A tax invoice may only be issued for
 * a completed taxable supply, so the title is derived from the booking
 * lifecycle instead of being hardcoded. Every generated PDF, preview card and
 * share message reads its title from here so the platform can never emit
 * "Tax Invoice" for a proposal or an itinerary again.
 */

export type DocumentLifecycle = "draft" | "confirmed" | "completed" | "cancelled";

export interface DocumentTitleContext {
  /** Booking payment status, when a booking record exists. */
  paymentStatus?: string | null;
  /** Booking / mission status, when a booking record exists. */
  bookingStatus?: string | null;
  /** True when the document is issued against a corporate account. */
  corporate?: boolean;
  /** True when no booking record exists yet (pure quotation). */
  quoteOnly?: boolean;
}

export interface ResolvedDocumentTitle {
  lifecycle: DocumentLifecycle;
  /** Printed headline, e.g. "EXECUTIVE CHARTER PROPOSAL". */
  title: string;
  /** Sentence-case label for UI chrome. */
  label: string;
  /** Short supporting line describing what the document represents. */
  subtitle: string;
  /** Reference prefix, e.g. "PRO", "ITN", "RCT". */
  numberPrefix: string;
  /** Stable document kind for the evidence vault. */
  documentKind: string;
}

const PAID = new Set(["paid", "settled", "completed", "reconciled"]);
const CANCELLED = new Set(["cancelled", "canceled", "refunded", "void", "failed"]);
const CONFIRMED = new Set([
  "approved",
  "confirmed",
  "awaiting_corporate_wallet",
  "awaiting_mpesa_stk",
  "awaiting_bank_transfer",
  "in_transit",
  "dispatched",
]);

export function documentLifecycle(ctx: DocumentTitleContext): DocumentLifecycle {
  const pay = (ctx.paymentStatus ?? "").toLowerCase();
  const book = (ctx.bookingStatus ?? "").toLowerCase();
  if (CANCELLED.has(pay) || CANCELLED.has(book)) return "cancelled";
  if (PAID.has(pay) || book === "completed") return "completed";
  if (!ctx.quoteOnly && (CONFIRMED.has(pay) || CONFIRMED.has(book))) return "confirmed";
  return "draft";
}

export function resolveDocumentTitle(ctx: DocumentTitleContext): ResolvedDocumentTitle {
  const lifecycle = documentLifecycle(ctx);
  const corporate = Boolean(ctx.corporate);

  switch (lifecycle) {
    case "completed":
      return {
        lifecycle,
        title: corporate ? "CORPORATE JOURNEY COMPLETION RECORD" : "TRAVEL RECEIPT",
        label: corporate ? "Journey completion record" : "Travel receipt",
        subtitle: "Mission completed and settled. Retain for expense and audit purposes.",
        numberPrefix: "RCT",
        documentKind: "travel-receipt",
      };
    case "confirmed":
      return {
        lifecycle,
        title: corporate ? "ENTERPRISE TRAVEL AUTHORIZATION" : "TRAVEL ITINERARY & MISSION CONFIRMATION",
        label: corporate ? "Enterprise travel authorization" : "Travel itinerary & mission confirmation",
        subtitle: "Confirmed mission. Present this credential to the crew on departure.",
        numberPrefix: corporate ? "ETA" : "ITN",
        documentKind: corporate ? "enterprise-travel-authorization" : "travel-itinerary",
      };
    case "cancelled":
      return {
        lifecycle,
        title: "MISSION CANCELLATION RECORD",
        label: "Cancellation record",
        subtitle: "This mission was cancelled. Refund treatment follows the published policy.",
        numberPrefix: "CXL",
        documentKind: "cancellation-record",
      };
    default:
      return {
        lifecycle,
        title: corporate ? "CORPORATE MOBILITY PROPOSAL" : "EXECUTIVE CHARTER PROPOSAL",
        label: corporate ? "Corporate mobility proposal" : "Executive charter proposal",
        subtitle:
          "Official quotation — not a tax invoice. Valid pending corporate organisation approval and payment.",
        numberPrefix: "PRO",
        documentKind: "charter-proposal",
      };
  }
}

/** Large status badge text used across documents and UI previews. */
export function documentStatusBadge(paymentStatus?: string | null): string {
  const s = (paymentStatus ?? "").toLowerCase();
  if (PAID.has(s)) return "Completed";
  if (CANCELLED.has(s)) return s === "refunded" ? "Refunded" : "Cancelled";
  if (s === "awaiting_corporate_wallet") return "Awaiting corporate wallet";
  if (s === "awaiting_mpesa_stk") return "Awaiting M-Pesa payment";
  if (s === "awaiting_bank_transfer") return "Awaiting bank transfer";
  if (s === "approved" || s === "confirmed") return "Confirmed";
  return "Awaiting approval";
}
