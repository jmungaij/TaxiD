/**
 * Proforma invoice artifact — the printed document the customer receives.
 *
 * The bytes returned here are hashed and the digest is stored against the
 * record when the document is sent, so the file in the customer's inbox can
 * always be matched back to the register.
 */
import { sha256Hex } from "./documentPdf";
import type { Proforma } from "./proforma";
import { CONTACT } from "@/config/contact";

export { sha256Hex };

const money = (cents: number, currency: string) =>
  `${currency} ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

const day = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function proformaPdfFilename(p: Proforma): string {
  return `${p.proforma_no ?? "PROFORMA-DRAFT"}.pdf`;
}

export async function buildProformaPdf(p: Proforma): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 15;
  const RIGHT = W - M;

  // Brand band
  pdf.setFillColor(20, 52, 144);
  pdf.rect(0, 0, W, 28, "F");
  pdf.setTextColor(255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("SAFARID", M, 13);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text("Yalla Beena Limited · Nairobi, Kenya", M, 19);
  pdf.text(`${CONTACT.phoneDisplay} · ${CONTACT.salesEmail}`, M, 24);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text("PROFORMA INVOICE", RIGHT, 14, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(p.proforma_no ?? "DRAFT — NOT ISSUED", RIGHT, 21, { align: "right" });

  let y = 40;
  pdf.setTextColor(30);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("BILL TO", M, y);
  pdf.text("DOCUMENT DETAILS", 118, y);
  y += 5;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);

  const left: string[] = [p.customer_company || "—"];
  if (p.customer_contact_person) left.push(`Attn: ${p.customer_contact_person}`);
  if (p.customer_address) left.push(...String(p.customer_address).split("\n").slice(0, 3));
  if (p.customer_pin) left.push(`PIN: ${p.customer_pin}`);
  if (p.customer_email) left.push(p.customer_email);
  if (p.customer_phone) left.push(p.customer_phone);

  const right: [string, string][] = [
    ["Issue date", day(p.issue_date ?? p.created_at)],
    ["Valid until", day(p.valid_until)],
    ["Currency", p.currency],
    ["Payment terms", p.payment_terms],
  ];
  if (p.booked_for) right.push(["For", p.booked_for]);
  if (p.booked_by) right.push(["Booked by", p.booked_by]);
  if (p.customer_ref) right.push(["Your reference", p.customer_ref]);
  if (p.quote_reference) right.push(["Quotation", p.quote_reference]);
  if (p.contract_reference) right.push(["Contract", p.contract_reference]);
  if (p.service_from || p.service_to) right.push(["Service period", `${day(p.service_from)} – ${day(p.service_to)}`]);

  // Each column advances on its own so a long value (payment terms) wraps
  // inside the page instead of running off the right edge.
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

  // Line table
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
  (p.lines ?? []).forEach((l, i) => {
    if (y > 245) {
      pdf.addPage();
      y = 25;
    }
    const desc = pdf.splitTextToSize(l.description || "—", cols.date - cols.desc - 4) as string[];
    pdf.text(String(l.line_no ?? i + 1), cols.no, y);
    pdf.text(desc.slice(0, 3), cols.desc, y);
    pdf.text(l.service_date ? day(l.service_date) : "—", cols.date, y);
    pdf.text(String(Number(l.qty ?? 0)), cols.qty, y);
    pdf.text((Number(l.unit_rate_cents ?? 0) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 }), cols.rate, y);
    pdf.text(
      (Number(l.amount_cents ?? Math.round((l.qty || 0) * (l.unit_rate_cents || 0))) / 100)
        .toLocaleString("en-KE", { minimumFractionDigits: 2 }),
      cols.amt, y, { align: "right" },
    );
    const h = Math.max(6, Math.min(desc.length, 3) * 4.6);
    y += h;
    pdf.setDrawColor(220, 228, 240);
    pdf.line(M, y - 2.5, RIGHT, y - 2.5);
  });

  y += 4;
  if (y > 230) {
    pdf.addPage();
    y = 25;
  }
  // Totals
  pdf.setFillColor(234, 244, 255);
  pdf.rect(120, y, RIGHT - 120, 26, "F");
  pdf.setTextColor(20, 52, 144);
  pdf.setFontSize(9.5);
  pdf.text("Subtotal", 124, y + 7);
  pdf.text(money(p.subtotal_cents, p.currency), RIGHT - 4, y + 7, { align: "right" });
  pdf.text(`VAT ${Number(p.vat_rate)}%`, 124, y + 14);
  pdf.text(money(p.vat_cents, p.currency), RIGHT - 4, y + 14, { align: "right" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("TOTAL", 124, y + 22);
  pdf.text(money(p.total_cents, p.currency), RIGHT - 4, y + 22, { align: "right" });

  // Notes + authorisation
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(60);
  pdf.setFontSize(8.5);
  let ny = y + 4;
  if (p.notes) {
    pdf.setFont("helvetica", "bold");
    pdf.text("Notes", M, ny);
    pdf.setFont("helvetica", "normal");
    ny += 4.5;
    pdf.text(pdf.splitTextToSize(p.notes, 95) as string[], M, ny);
    ny += 18;
  }
  pdf.setFont("helvetica", "bold");
  pdf.text("Authorised by", M, ny + 8);
  pdf.setFont("helvetica", "normal");
  pdf.text(p.authorised_name ?? "—", M, ny + 13);
  pdf.text(p.authorised_title ?? "", M, ny + 17.5);

  pdf.setTextColor(140);
  pdf.setFontSize(7.5);
  pdf.text(
    "This is a proforma invoice and is not a tax invoice. A tax invoice is issued on payment.",
    M, 284,
  );
  pdf.text(`${p.proforma_no ?? "DRAFT"} · generated ${new Date().toISOString()}`, M, 289);

  return new Uint8Array(pdf.output("arraybuffer"));
}
