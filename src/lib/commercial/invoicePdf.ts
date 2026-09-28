/**
 * Printed tax invoice and payment receipt, on the TaxiD letterhead.
 *
 * The bytes returned here are hashed and the digest is stored against the
 * record when the document is emailed, so the file in the customer's inbox can
 * always be matched back to the register.
 */
import { sha256Hex } from "./documentPdf";
import type { Invoice, PaymentReceipt } from "./invoice";
import { PAYMENT_METHOD_LABEL } from "./invoice";
import { CONTACT } from "@/config/contact";

export { sha256Hex };

const money = (cents: number, currency: string) =>
  `${currency} ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

const day = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const invoicePdfFilename = (i: Invoice) => `${i.invoice_no ?? "INVOICE-DRAFT"}.pdf`;
export const receiptPdfFilename = (r: PaymentReceipt) => `${r.receipt_no ?? "RECEIPT"}.pdf`;

const W = 210;
const M = 15;
const RIGHT = W - M;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function letterhead(pdf: any, heading: string, reference: string) {
  pdf.setFillColor(20, 52, 144);
  pdf.rect(0, 0, W, 28, "F");
  pdf.setTextColor(255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("TaxiD", M, 13);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text("Yalla Beena Limited · Nairobi, Kenya", M, 19);
  pdf.text(`${CONTACT.phoneDisplay} · ${CONTACT.salesEmail}`, M, 24);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text(heading, RIGHT, 14, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(reference, RIGHT, 21, { align: "right" });
  pdf.setTextColor(30);
}

export async function buildInvoicePdf(i: Invoice): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  letterhead(pdf, "TAX INVOICE", i.invoice_no ?? "DRAFT — NOT ISSUED");

  let y = 40;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("BILL TO", M, y);
  pdf.text("INVOICE DETAILS", 118, y);
  y += 5;
  pdf.setFont("helvetica", "normal");

  const left: string[] = [i.customer_company || "—"];
  if (i.customer_contact_person) left.push(`Attn: ${i.customer_contact_person}`);
  if (i.customer_address) left.push(...String(i.customer_address).split("\n").slice(0, 3));
  if (i.customer_pin) left.push(`PIN: ${i.customer_pin}`);
  if (i.customer_email) left.push(i.customer_email);
  if (i.customer_phone) left.push(i.customer_phone);

  const right: [string, string][] = [
    ["Invoice date", day(i.issue_date ?? i.created_at)],
    ["Due date", day(i.due_date)],
    ["Currency", i.currency],
    ["Payment terms", i.payment_terms],
  ];
  if (i.lpo_reference) right.push(["LPO / PO", i.lpo_reference]);
  if (i.customer_ref) right.push(["Your reference", i.customer_ref]);
  if (i.contract_reference) right.push(["Contract", i.contract_reference]);
  if (i.service_from || i.service_to) right.push(["Service period", `${day(i.service_from)} – ${day(i.service_to)}`]);

  let ly = y;
  for (const line of left) {
    pdf.text(String(line).slice(0, 58), M, ly);
    ly += 5;
  }
  let ry = y;
  for (const [label, value] of right) {
    pdf.setFont("helvetica", "bold");
    pdf.text(label, 118, ry);
    pdf.setFont("helvetica", "normal");
    const wrapped = pdf.splitTextToSize(String(value), RIGHT - 152) as string[];
    pdf.text(wrapped.slice(0, 2), 152, ry);
    ry += Math.max(5, Math.min(wrapped.length, 2) * 4.6);
  }
  y = Math.max(ly, ry) + 6;

  const cols = { no: M, desc: M + 8, date: 108, qty: 130, rate: 150, amt: RIGHT };
  pdf.setFillColor(20, 52, 144);
  pdf.setTextColor(255);
  pdf.rect(M, y - 5, W - M * 2, 8, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  pdf.text("#", cols.no, y);
  pdf.text("DESCRIPTION", cols.desc, y);
  pdf.text("DATE", cols.date, y);
  pdf.text("QTY", cols.qty, y);
  pdf.text("RATE", cols.rate, y);
  pdf.text("AMOUNT", cols.amt, y, { align: "right" });
  y += 9;

  pdf.setTextColor(30);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  (i.lines ?? []).forEach((l, idx) => {
    if (y > 245) {
      pdf.addPage();
      y = 25;
    }
    const desc = pdf.splitTextToSize(l.description || "—", cols.date - cols.desc - 4) as string[];
    pdf.text(String(l.line_no ?? idx + 1), cols.no, y);
    pdf.text(desc.slice(0, 3), cols.desc, y);
    pdf.text(l.service_date ? day(l.service_date) : "—", cols.date, y);
    pdf.text(String(Number(l.qty ?? 0)), cols.qty, y);
    pdf.text((Number(l.unit_rate_cents ?? 0) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 }), cols.rate, y);
    pdf.text(
      (Number(l.amount_cents ?? Math.round((l.qty || 0) * (l.unit_rate_cents || 0))) / 100)
        .toLocaleString("en-KE", { minimumFractionDigits: 2 }),
      cols.amt, y, { align: "right" },
    );
    y += Math.max(6, Math.min(desc.length, 3) * 4.6);
    pdf.setDrawColor(220, 228, 240);
    pdf.line(M, y - 2.5, RIGHT, y - 2.5);
  });

  y += 4;
  const paid = Number(i.paid_cents ?? 0);
  const boxH = paid > 0 ? 34 : 26;
  if (y > 236 - boxH) {
    pdf.addPage();
    y = 25;
  }
  pdf.setFillColor(234, 244, 255);
  pdf.rect(120, y, RIGHT - 120, boxH, "F");
  pdf.setTextColor(20, 52, 144);
  pdf.setFontSize(9.5);
  pdf.text("Subtotal", 124, y + 7);
  pdf.text(money(i.subtotal_cents, i.currency), RIGHT - 4, y + 7, { align: "right" });
  pdf.text(`VAT ${Number(i.vat_rate)}%`, 124, y + 14);
  pdf.text(money(i.vat_cents, i.currency), RIGHT - 4, y + 14, { align: "right" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("TOTAL", 124, y + 22);
  pdf.text(money(i.total_cents, i.currency), RIGHT - 4, y + 22, { align: "right" });
  if (paid > 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text("Received", 124, y + 28);
    pdf.text(money(paid, i.currency), RIGHT - 4, y + 28, { align: "right" });
    pdf.setFont("helvetica", "bold");
    pdf.text("Balance due", 124, y + 33);
    pdf.text(money(i.total_cents - paid, i.currency), RIGHT - 4, y + 33, { align: "right" });
  }

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(60);
  pdf.setFontSize(8.5);
  let ny = y + 4;
  if (i.notes) {
    pdf.setFont("helvetica", "bold");
    pdf.text("Notes", M, ny);
    pdf.setFont("helvetica", "normal");
    ny += 4.5;
    pdf.text(pdf.splitTextToSize(i.notes, 95) as string[], M, ny);
    ny += 18;
  }
  pdf.setFont("helvetica", "bold");
  pdf.text("Authorised by", M, ny + 8);
  pdf.setFont("helvetica", "normal");
  pdf.text(i.authorised_name ?? "—", M, ny + 13);
  pdf.text(i.authorised_title ?? "", M, ny + 17.5);

  pdf.setTextColor(140);
  pdf.setFontSize(7.5);
  pdf.text("This is a tax invoice issued by Yalla Beena Limited.", M, 284);
  pdf.text(`${i.invoice_no ?? "DRAFT"} · generated ${new Date().toISOString()}`, M, 289);

  return new Uint8Array(pdf.output("arraybuffer"));
}

export async function buildReceiptPdf(r: PaymentReceipt): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  letterhead(pdf, "OFFICIAL RECEIPT", r.receipt_no ?? "RECEIPT");

  let y = 42;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("RECEIVED FROM", M, y);
  pdf.text("PAYMENT DETAILS", 118, y);
  y += 5;
  pdf.setFont("helvetica", "normal");

  const left = [r.received_from || r.invoice?.customer_company || "—"];
  if (r.invoice?.customer_address) left.push(...String(r.invoice.customer_address).split("\n").slice(0, 3));
  if (r.invoice?.customer_pin) left.push(`PIN: ${r.invoice.customer_pin}`);

  const right: [string, string][] = [
    ["Date received", day(r.received_on)],
    ["Method", PAYMENT_METHOD_LABEL[r.method] ?? r.method],
    ["Reference", r.payment_reference || "—"],
    ["Against invoice", r.invoice?.invoice_no || "—"],
  ];

  let ly = y;
  for (const line of left) {
    pdf.text(String(line).slice(0, 58), M, ly);
    ly += 5;
  }
  let ry = y;
  for (const [label, value] of right) {
    pdf.setFont("helvetica", "bold");
    pdf.text(label, 118, ry);
    pdf.setFont("helvetica", "normal");
    const wrapped = pdf.splitTextToSize(String(value), RIGHT - 152) as string[];
    pdf.text(wrapped.slice(0, 2), 152, ry);
    ry += Math.max(5, Math.min(wrapped.length, 2) * 4.6);
  }
  y = Math.max(ly, ry) + 10;

  pdf.setFillColor(234, 244, 255);
  pdf.rect(M, y, RIGHT - M, 24, "F");
  pdf.setTextColor(20, 52, 144);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  pdf.text("Amount received", M + 4, y + 9);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(money(r.amount_cents, r.currency), RIGHT - 4, y + 16, { align: "right" });
  y += 32;

  if (r.invoice) {
    pdf.setTextColor(30);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Invoice total: ${money(r.invoice.total_cents, r.currency)}`, M, y);
    pdf.text(`Total received to date: ${money(r.invoice.paid_cents, r.currency)}`, M, y + 5);
    pdf.setFont("helvetica", "bold");
    pdf.text(
      `Balance outstanding: ${money(Math.max(r.invoice.total_cents - r.invoice.paid_cents, 0), r.currency)}`,
      M, y + 10.5,
    );
    y += 20;
  }

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(60);
  pdf.setFontSize(8.5);
  if (r.notes) {
    pdf.setFont("helvetica", "bold");
    pdf.text("Notes", M, y);
    pdf.setFont("helvetica", "normal");
    pdf.text(pdf.splitTextToSize(r.notes, 120) as string[], M, y + 5);
    y += 22;
  }
  pdf.setFont("helvetica", "bold");
  pdf.text("Received and authorised by", M, y + 10);
  pdf.setFont("helvetica", "normal");
  pdf.text(r.authorised_name ?? "—", M, y + 15);
  pdf.text(r.authorised_title ?? "", M, y + 19.5);

  pdf.setTextColor(140);
  pdf.setFontSize(7.5);
  pdf.text("This receipt confirms funds received by Yalla Beena Limited.", M, 284);
  pdf.text(`${r.receipt_no ?? "RECEIPT"} · generated ${new Date().toISOString()}`, M, 289);

  return new Uint8Array(pdf.output("arraybuffer"));
}
