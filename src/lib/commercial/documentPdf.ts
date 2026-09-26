/**
 * Commercial document PDF rendering + cryptographic sealing.
 *
 * The artifact flow that makes a PDF provable rather than decorative:
 *
 *   buildCommercialDocumentPdf(doc) → bytes
 *   sha256Hex(bytes)                → digest persisted via
 *                                     commercial_document_attach_hash (write-once)
 *   download of the exact bytes     → the operator holds the sealed artifact
 *
 * The stored hash is the evidence anchor: anyone holding the PDF can recompute
 * the digest and compare it against the sealed hash in the forensic trace.
 */
import type { CommercialDocumentType } from "./documents";

export interface CommercialPdfInput {
  document_number: string;
  document_type: CommercialDocumentType;
  transaction_ref: string;
  version: number;
  status: string;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  source_ref?: string | null;
  recipient_email?: string | null;
  issued_at?: string | null;
  created_at: string;
  document_hash?: string | null;
}

const TYPE_TITLE: Record<CommercialDocumentType, string> = {
  quotation: "QUOTATION",
  proforma: "PROFORMA INVOICE",
  tax_invoice: "TAX INVOICE",
  payment_receipt: "PAYMENT RECEIPT",
};

const money = (cents: number, currency: string) =>
  `${currency} ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

/** Lowercase 64-char hex SHA-256 of the given bytes (WebCrypto, browser + Node ≥20). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes); // guaranteed ArrayBuffer-backed for subtle.digest
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** True when the stored seal matches the bytes in hand. */
export async function verifyDocumentPdfHash(
  storedHash: string | null | undefined,
  bytes: Uint8Array,
): Promise<boolean> {
  if (!storedHash) return false;
  return (await sha256Hex(bytes)) === storedHash;
}

export function commercialDocumentPdfFilename(doc: Pick<CommercialPdfInput, "document_number" | "version">): string {
  return `${doc.document_number}-v${doc.version}.pdf`;
}

/**
 * Renders the branded A4 artifact for a commercial document and returns the
 * raw bytes (never saves — the caller hashes first, then decides).
 */
export async function buildCommercialDocumentPdf(doc: CommercialPdfInput): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 16;
  let y = 0;

  // Executive Blue brand band
  pdf.setFillColor(20, 52, 144);
  pdf.rect(0, 0, W, 26, "F");
  pdf.setTextColor(255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text("SAFARID", M, 12);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.text("Commercial Document · Forensic Original", M, 19);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(TYPE_TITLE[doc.document_type], W - M, 12, { align: "right" });
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.text(doc.document_number, W - M, 19, { align: "right" });

  y = 38;
  pdf.setTextColor(30);
  const field = (label: string, value: string) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(label, M, y);
    pdf.setFont("helvetica", "normal");
    pdf.text(value, M + 44, y);
    y += 6;
  };

  field("Document number", doc.document_number);
  field("Version", `v${doc.version}`);
  field("Status", doc.status.replace(/_/g, " ").toUpperCase());
  field("Transaction", doc.transaction_ref);
  if (doc.source_ref) field("Source document", doc.source_ref);
  field("Issued", (doc.issued_at ?? doc.created_at).slice(0, 19).replace("T", " ") + " UTC");
  if (doc.recipient_email) field("Recipient", doc.recipient_email);

  y += 6;
  // Totals block
  pdf.setFillColor(234, 244, 255); // Ice Blue surface
  pdf.rect(M, y - 5, W - M * 2, 26, "F");
  pdf.setFontSize(10);
  pdf.setTextColor(20, 52, 144);
  pdf.setFont("helvetica", "normal");
  pdf.text("Subtotal", M + 4, y + 2);
  pdf.text(money(doc.subtotal_cents, doc.currency), W - M - 4, y + 2, { align: "right" });
  pdf.text("Tax (VAT)", M + 4, y + 9);
  pdf.text(money(doc.tax_cents, doc.currency), W - M - 4, y + 9, { align: "right" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("TOTAL", M + 4, y + 17);
  pdf.text(money(doc.total_cents, doc.currency), W - M - 4, y + 17, { align: "right" });

  y += 34;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(110);
  if (doc.document_hash) {
    pdf.text("Forensic seal (SHA-256 of this file):", M, y);
    y += 4.5;
    pdf.setFont("courier", "normal");
    pdf.text(doc.document_hash, M, y);
    y += 4.5;
    pdf.setFont("helvetica", "normal");
    pdf.text("Verify: recompute the SHA-256 of this exact file and compare against the sealed hash in the document trace.", M, y);
  } else {
    pdf.text("Unsealed render — this file has not been cryptographically sealed to the document record.", M, y);
  }

  pdf.setTextColor(140);
  pdf.setFontSize(8);
  pdf.text(`SAFARID · ${doc.document_number} · generated ${new Date().toISOString()}`, M, 290);

  return new Uint8Array(pdf.output("arraybuffer"));
}
