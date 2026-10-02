/**
 * Digital tax invoice & payment receipt for ground charter bookings.
 *
 * Reuses the same forensic substrate as the aviation itinerary and the bus
 * ticket (guilloché rosettes, lathe bands, void-pantograph hatch, microtext,
 * vector emblem, document fingerprint + control number) so an invoice, its
 * receipt and its tickets are all forensically linked.
 *
 * The invoice itemises the FULL "why this price" breakdown produced by
 * `computeBusPrice`, with VAT shown as its own line, which makes it usable as
 * an eTIMS-compliant customer tax document.
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
import { VAT_PCT } from "./busPricing";

/**
 * Structural view of a price breakdown the invoice needs. `BusPriceBreakdown`
 * satisfies it, and so does the simplified three-line road charter fare.
 */
export interface InvoicePriceView {
  lines: Array<{ label: string; amountKes: number; reason: string }>;
  taxableKes: number;
  taxKes: number;
  perSeatKes: number;
  totalKes: number;
  invoiceMonthly?: boolean;
  /** Overrides the printed VAT rate (road charter fares are VAT-inclusive). */
  vatPct?: number;
}

export interface CharterInvoiceInput {
  /** Booking reference — also the document number suffix. */
  reference: string;
  kind?: "invoice" | "receipt";
  /**
   * Lifecycle-aware headline (Enterprise Document System 2.0). When omitted a
   * neutral title is used — never "Tax Invoice".
   */
  documentTitle?: string;
  documentSubtitle?: string;
  documentNumberPrefix?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  route: string;
  departAt?: string;
  vehicle: string;
  passengers: number;
  seats?: string[];
  price: InvoicePriceView;
  /** Journey detail lines (stops, coordinates, notes) printed as an itinerary. */
  itinerary?: string[];
  /** Rendered in red on the header when the document is not yet settled. */
  unpaidNotice?: string;
  /** Payment facts — present on a receipt. */
  paymentMethod?: string;
  mpesaReceipt?: string | null;
  paidAt?: string;
  branding?: Partial<IssuerBranding>;
  templateVersion?: string;
  /**
   * Encrypted QR seal returned by the charter document registry, rendered into
   * the forensic footer. Omitted when the document is produced offline.
   */
  qr?: { dataUrl: string; encoded?: string };
}

/**
 * jsPDF's standard fonts are WinAnsi — non-Latin1 glyphs (→, ×, —, curly
 * quotes) render as mojibake. Every string printed on the document passes
 * through here so titles, routes and itineraries stay legible.
 */
const ascii = (s: string) =>
  s
    .replace(/[\u2192\u27a1]/g, "->")
    .replace(/[\u00d7]/g, "x")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2022]/g, "-")
    .replace(/[\u00b7]/g, "-")
    .replace(/[^\x20-\x7E]/g, "");


const BLUE: [number, number, number] = [29, 78, 216];
const SKY: [number, number, number] = [147, 197, 253];

const money = (n: number) => `KSh ${new Intl.NumberFormat("en-KE").format(Math.round(n))}`;

export async function buildCharterInvoicePdf(input: CharterInvoiceInput): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const H = 297;
  const M = 14;
  const issuer: IssuerBranding = { ...ISSUER, ...(input.branding ?? {}) };
  const version = input.templateVersion ?? "v1";
  const kind = input.kind ?? "invoice";
  const issuedAt = input.paidAt ? new Date(input.paidAt) : new Date();

  const fingerprint = documentFingerprint({
    r: input.reference,
    t: input.price.totalKes,
    v: input.price.taxKes,
    s: (input.seats ?? []).join(","),
    tpl: version,
    kind: `charter-${kind}`,
  });
  const control = controlNumber(input.reference, fingerprint);

  // ---- security substrate -------------------------------------------------
  microHatch(doc, 0, 0, W, H);
  guilloche(doc, W / 2, H / 2, 78, 29, 46, [235, 241, 252], 30);
  guilloche(doc, W - 34, 44, 24, 9, 15, [224, 233, 249], 22);
  latheBand(doc, M, 40, W - M * 2, 2.4, SKY);
  latheBand(doc, M, H - 30, W - M * 2, 2.4, SKY);

  // ---- header -------------------------------------------------------------
  const title =
    input.documentTitle ??
    (kind === "receipt" ? "TRAVEL RECEIPT" : "EXECUTIVE CHARTER PROPOSAL");
  const numberPrefix = input.documentNumberPrefix ?? (kind === "receipt" ? "RCT" : "PRO");
  await vectorLogo(doc, M, 14, issuer);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(title.length > 30 ? 10.4 : 13);
  doc.setTextColor(15, 23, 42);
  doc.text(ascii(title), W - M, 20, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  doc.setTextColor(71, 85, 105);
  doc.text(
    [
      `Document ${numberPrefix}-${input.reference}`,
      `Template ${version} - Control ${control}`,
      issuedAt.toUTCString(),
    ].map(ascii),
    W - M,
    25,
    { align: "right" },
  );
  doc.setFontSize(7);
  doc.text([issuer.address, `${issuer.phone} - ${issuer.email}`].map(ascii), M, 32);
  if (input.documentSubtitle) {
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    doc.text(doc.splitTextToSize(ascii(input.documentSubtitle), 92), W - M, 34.6, { align: "right" });
  }
  if (input.unpaidNotice) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.4);
    doc.setTextColor(190, 18, 60);
    doc.text(ascii(input.unpaidNotice), M, 38.4);
    doc.setFont("helvetica", "normal");
  }

  // ---- issued to & mission ------------------------------------------------
  let y = section(doc, "ISSUED TO", 50);
  doc.setFontSize(8.4);
  doc.setTextColor(15, 23, 42);
  doc.text(
    [
      input.customerName,
      input.customerPhone ?? "",
      input.customerEmail ?? "",
    ].filter(Boolean).map(ascii),
    M,
    y,
  );
  doc.setTextColor(71, 85, 105);
  doc.text(
    [
      ...doc.splitTextToSize(ascii(input.route), 86).slice(0, 2),
      `${input.vehicle} - ${input.passengers} passenger${input.passengers === 1 ? "" : "s"}`,
      input.departAt ? new Date(input.departAt).toLocaleString("en-KE") : "Departure to be confirmed",
      ...(input.seats?.length ? [`Seats: ${input.seats.join(", ")}`] : []),
    ].map(ascii),
    W - M,
    y,
    { align: "right" },
  );
  y += 24;

  // ---- journey itinerary (road charter) -----------------------------------
  if (input.itinerary?.length) {
    y = section(doc, "MISSION ITINERARY - JOURNEY AS REQUESTED", y);
    doc.setFontSize(7.8);
    doc.setTextColor(51, 65, 85);
    for (const row of input.itinerary.slice(0, 8)) {
      doc.text(doc.splitTextToSize(ascii(row), W - M * 2), M, y);
      y += 5;
    }
    y += 4;
  }




  // ---- itemised why-this-price -------------------------------------------
  y = section(doc, "ENTERPRISE PRICING - FULLY ITEMISED", y);
  doc.setFontSize(8.2);
  for (const line of input.price.lines) {
    doc.setTextColor(15, 23, 42);
    doc.text(ascii(line.label), M, y);
    doc.setTextColor(line.amountKes < 0 ? 22 : 15, line.amountKes < 0 ? 130 : 23, line.amountKes < 0 ? 96 : 42);
    doc.text(money(line.amountKes), W - M, y, { align: "right" });
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    doc.text(doc.splitTextToSize(ascii(line.reason), W - M * 2 - 34), M, y + 3.4);
    doc.setFontSize(8.2);
    doc.setDrawColor(230, 236, 246);
    doc.setLineWidth(0.1);
    doc.line(M, y + 6.4, W - M, y + 6.4);
    y += 10.4;
    if (y > H - 84) break;
  }

  // ---- totals -------------------------------------------------------------
  const ty = Math.min(y + 2, H - 78);
  doc.setFillColor(246, 249, 255);
  doc.roundedRect(M, ty, W - M * 2, 26, 2, 2, "F");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const vatPct = input.price.vatPct ?? VAT_PCT;
  doc.text(
    [
      `Mission value: ${money(input.price.taxableKes)}`,
      vatPct > 0
        ? `VAT (${vatPct}%): ${money(input.price.taxKes)}`
        : "VAT: included in the quoted fare",
      `Per passenger: ${money(input.price.perSeatKes)}`,
    ].map(ascii),
    M + 6,
    ty + 8,
    { lineHeightFactor: 1.6 },
  );
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.text(money(input.price.totalKes), W - M - 6, ty + 14, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(71, 85, 105);
  doc.text(
    ascii(
      kind === "receipt"
        ? `Paid via ${input.paymentMethod ?? "M-Pesa"}${input.mpesaReceipt ? ` - ${input.mpesaReceipt}` : ""}`
        : input.price.invoiceMonthly
          ? "Consolidated month-end billing - settle per your corporate credit terms."
          : "Payable on approval via corporate wallet, M-Pesa Paybill 4573823 or bank transfer.",
    ),
    W - M - 6,
    ty + 20,
    { align: "right" },
  );


  // ---- forensic footer ----------------------------------------------------
  const sy = H - 46;
  const qr = input.qr;
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(M, sy - 6, W - M * 2, 30, 2, 2, "F");
  doc.setTextColor(226, 232, 240);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("FORENSIC AUTHENTICITY MARKS", M + 5, sy);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.6);
  const footerWidth = W - M * 2 - (qr ? 46 : 12);
  const footerLines = [
    `Document fingerprint: ${fingerprint}`,
    `Control number: ${control} - Template ${version}`,
    "Guilloche rosettes, lathe bands, void-pantograph hatch and 1.6pt microtext are embedded.",
    qr
      ? "Scan the encrypted QR seal, or verify the control number at taxid.us/verify."
      : "Any alteration breaks the fingerprint. Verify at taxid.us/verify with the control number.",
  ].flatMap((line) => doc.splitTextToSize(ascii(line), footerWidth) as string[]);
  doc.text(footerLines.slice(0, 5), M + 5, sy + 5, { lineHeightFactor: 1.5 });

  // Encrypted QR seal — pure black on a white plate so it survives monochrome
  // print, and 24mm square so a phone camera locks on from ~15cm.
  if (qr) {
    const qrSize = 24;
    const qx = W - M - qrSize - 4;
    const qy = sy - 3;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(qx - 2, qy - 2, qrSize + 4, qrSize + 4, 1.5, 1.5, "F");
    doc.addImage(qr.dataUrl, "PNG", qx, qy, qrSize, qrSize, undefined, "NONE");
  }

  microtext(doc, M, H - 12, W - M * 2, `TaxiD CHARTER ${kind.toUpperCase()} ${input.reference} ${control} ${version}`);
  return doc;
}

export async function downloadCharterInvoicePdf(
  input: CharterInvoiceInput,
): Promise<{ fingerprint: string; controlNumber: string; fileName: string }> {
  const doc = await buildCharterInvoicePdf(input);
  const kind = input.kind ?? "invoice";
  const fileName = `yalla-charter-${kind}-${input.reference}.pdf`;
  doc.save(fileName);
  const fingerprint = documentFingerprint({
    r: input.reference,
    t: input.price.totalKes,
    v: input.price.taxKes,
    s: (input.seats ?? []).join(","),
    tpl: input.templateVersion ?? "v1",
    kind: `charter-${kind}`,
  });
  return { fingerprint, controlNumber: controlNumber(input.reference, fingerprint), fileName };
}
