/**
 * Forensic M-Pesa payment receipt (TaxiD Air).
 *
 * Reuses the exact same security primitives as the itinerary document —
 * guilloche rosettes, lathe bands, void-pantograph hatch, microtext, the
 * vector emblem, the SHA-style document fingerprint and control number — so a
 * receipt and its itinerary are forensically linked and reproducible. The
 * filename, header and fingerprint are all stamped with the template version,
 * which means previously issued PDFs stay byte-reproducible after redesigns.
 */
import { jsPDF } from "jspdf";
import {
  ISSUER,
  controlNumber,
  documentFingerprint,
  guilloche,
  latheBand,
  microHatch,
  microtext,
  section,
  vectorLogo,
  type IssuerBranding,
} from "./itineraryPdf";
import { fetchActivePdfTemplate } from "./pdfTemplate";

export interface ReceiptInput {
  reference: string;
  bookingId?: string;
  payerName: string;
  payerPhoneMasked: string;
  amountLabel: string;
  amountKes: number;
  method: string;
  mpesaReceipt?: string | null;
  checkoutRequestId?: string | null;
  paidAt?: string;
  route: string;
  assetName: string;
  lines: { label: string; value: string }[];
  branding?: Partial<IssuerBranding>;
  templateVersion?: string;
}

const BLUE: [number, number, number] = [29, 78, 216];
const SKY: [number, number, number] = [147, 197, 253];

export async function buildReceiptPdf(input: ReceiptInput): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const H = 297;
  const M = 14;
  const issuer: IssuerBranding = { ...ISSUER, ...(input.branding ?? {}) };
  const version = input.templateVersion ?? "v1";
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

  const fingerprint = documentFingerprint({
    r: input.reference,
    a: input.amountKes,
    m: input.method,
    rc: input.mpesaReceipt ?? "",
    p: input.payerPhoneMasked,
    tpl: version,
    kind: "receipt",
  });
  const control = controlNumber(input.reference, fingerprint);

  // ---- security substrate -------------------------------------------------
  microHatch(doc, 0, 0, W, H);
  guilloche(doc, W / 2, H / 2, 78, 29, 46, [235, 241, 252], 30);
  guilloche(doc, W - 34, 44, 24, 9, 15, [224, 233, 249], 22);
  guilloche(doc, 34, H - 44, 22, 8, 13, [224, 233, 249], 20);
  latheBand(doc, M, 40, W - M * 2, 2.4, SKY);
  latheBand(doc, M, H - 30, W - M * 2, 2.4, SKY);

  // ---- header -------------------------------------------------------------
  await vectorLogo(doc, M, 14, issuer);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text("OFFICIAL PAYMENT RECEIPT", W - M, 20, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  doc.setTextColor(71, 85, 105);
  doc.text(
    [
      `Booking ${input.reference}`,
      `Template ${version} · Control ${control}`,
      paidAt.toUTCString(),
    ],
    W - M,
    25,
    { align: "right" },
  );
  doc.setFontSize(7);
  doc.text([issuer.address, `${issuer.phone} · ${issuer.email}`], M, 32);

  // ---- payment summary ----------------------------------------------------
  let y = section(doc, "PAYMENT SUMMARY", 50);
  doc.setFillColor(246, 249, 255);
  doc.roundedRect(M, y - 2, W - M * 2, 26, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.text(input.amountLabel, M + 6, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    [
      `Paid by ${input.payerName} (${input.payerPhoneMasked})`,
      `Method: ${input.method}${input.mpesaReceipt ? ` · M-Pesa receipt ${input.mpesaReceipt}` : ""}`,
      input.checkoutRequestId ? `Checkout ref: ${input.checkoutRequestId}` : "Status: Confirmed",
    ],
    W - M - 6,
    y + 6,
    { align: "right" },
  );
  y += 34;

  // ---- itinerary context --------------------------------------------------
  y = section(doc, "WHAT THIS PAYMENT COVERS", y);
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`${input.route} · ${input.assetName}`, M, y);
  y += 8;

  doc.setFontSize(8.4);
  for (const line of input.lines) {
    doc.setTextColor(71, 85, 105);
    doc.text(line.label, M, y);
    doc.setTextColor(15, 23, 42);
    doc.text(line.value, W - M, y, { align: "right" });
    doc.setDrawColor(230, 236, 246);
    doc.setLineWidth(0.1);
    doc.line(M, y + 1.8, W - M, y + 1.8);
    y += 6.4;
    if (y > H - 70) break;
  }

  // ---- forensic footer ----------------------------------------------------
  const sy = H - 46;
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(M, sy - 6, W - M * 2, 30, 2, 2, "F");
  doc.setTextColor(226, 232, 240);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("FORENSIC AUTHENTICITY MARKS", M + 5, sy);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.6);
  doc.text(
    [
      `Document fingerprint: ${fingerprint}`,
      `Control number: ${control} · Template ${version}`,
      "Guilloche rosettes, lathe bands, void-pantograph hatch and 1.6pt microtext are embedded.",
      "Any alteration breaks the fingerprint. Verify at taxid.us/verify with the control number.",
    ],
    M + 5,
    sy + 5,
    { lineHeightFactor: 1.5 },
  );

  microtext(
    doc,
    M,
    H - 12,
    W - M * 2,
    `TaxiD AIR RECEIPT ${input.reference} ${control} ${version} AUTHENTIC`,
  );

  return doc;
}

/**
 * Builds and downloads the receipt using the active server-side template.
 * The template version is stamped into the filename, header and fingerprint.
 */
export async function downloadReceiptPdf(
  input: ReceiptInput,
): Promise<{ fingerprint: string; controlNumber: string; templateVersion: string; fileName: string }> {
  const template = await fetchActivePdfTemplate();
  const merged: ReceiptInput = {
    ...input,
    branding: { ...template.brand, ...(input.branding ?? {}) },
    templateVersion: input.templateVersion ?? template.version,
  };
  const doc = await buildReceiptPdf(merged);
  const fileName = `yalla-air-receipt-${merged.reference}-${merged.templateVersion}.pdf`;
  doc.save(fileName);
  const fingerprint = documentFingerprint({
    r: merged.reference,
    a: merged.amountKes,
    m: merged.method,
    rc: merged.mpesaReceipt ?? "",
    p: merged.payerPhoneMasked,
    tpl: merged.templateVersion,
    kind: "receipt",
  });
  return {
    fingerprint,
    controlNumber: controlNumber(merged.reference, fingerprint),
    templateVersion: merged.templateVersion!,
    fileName,
  };
}
