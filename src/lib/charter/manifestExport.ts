/**
 * Trip manifest exports for the operator portal (CSV + PDF).
 *
 * Terminology is resolved through the Marketplace Asset Framework, so a bus
 * manifest never prints aviation vocabulary and a voyage manifest reads as a
 * voyage. Reuses the existing forensic PDF primitives.
 */
import { jsPDF } from "jspdf";
import { domainLexicon } from "./assetDomains";
import type { CharterBookingRow } from "./api";

export interface ManifestPassenger {
  name?: string;
  seat?: string;
  document_number?: string;
  phone?: string;
  email?: string;
}

const money = (n: number, ccy = "KES") =>
  `${ccy === "KES" ? "KSh" : ccy} ${new Intl.NumberFormat("en-KE").format(Math.round(n || 0))}`;

function rowsOf(booking: CharterBookingRow) {
  const trip = (booking.trip ?? {}) as Record<string, unknown>;
  const seats = Array.isArray(trip.seats) ? (trip.seats as string[]) : [];
  const pax = (booking.passengers ?? []) as ManifestPassenger[];
  return pax.map((p, i) => ({
    index: i + 1,
    name: p.name ?? `Guest ${i + 1}`,
    seat: seats[i] ?? p.seat ?? "unassigned",
    document: p.document_number ?? "—",
    phone: p.phone ?? "—",
    email: p.email ?? "—",
  }));
}

const csvCell = (v: string) => `"${String(v).replace(/"/g, '""')}"`;

/** CSV manifest — one row per occupant plus a totals footer. */
export function manifestCsv(booking: CharterBookingRow): string {
  const lex = domainLexicon(booking.category_slug);
  const trip = (booking.trip ?? {}) as Record<string, string>;
  const rows = rowsOf(booking);
  const head = ["#", lex.occupantLabel, "Seat", "Document", "Phone", "Email"];
  const meta = [
    ["Reference", booking.reference],
    [lex.assetLabel, booking.asset_name],
    [lex.routeLabel, `${trip.origin ?? "—"} → ${trip.destination ?? "—"}`],
    [lex.departureLabel, trip.date ?? "—"],
    ["Status", booking.flight_status],
    ["Payment", `${booking.payment_method} · ${booking.payment_status}`],
  ];
  return [
    ...meta.map(([k, v]) => `${csvCell(k)},${csvCell(String(v ?? "—"))}`),
    "",
    head.map(csvCell).join(","),
    ...rows.map((r) =>
      [r.index, r.name, r.seat, r.document, r.phone, r.email].map((c) => csvCell(String(c))).join(","),
    ),
    "",
    `${csvCell(`Total ${lex.occupantPluralLabel.toLowerCase()}`)},${csvCell(String(rows.length))}`,
    `${csvCell("Total value")},${csvCell(money(booking.amount, booking.currency))}`,
  ].join("\n");
}

export function downloadManifestCsv(booking: CharterBookingRow) {
  const blob = new Blob([manifestCsv(booking)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `manifest-${booking.reference}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** PDF manifest — printable crew copy with seat assignments and totals. */
export function buildManifestPdf(booking: CharterBookingRow): jsPDF {
  const lex = domainLexicon(booking.category_slug);
  const trip = (booking.trip ?? {}) as Record<string, string>;
  const rows = rowsOf(booking);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 14;
  let y = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(`${lex.brandName} · ${lex.manifestLabel}`, M, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `${booking.reference} · ${booking.asset_name} · ${trip.origin ?? "—"} → ${trip.destination ?? "—"} · ${trip.date ?? "—"}`,
    M,
    y,
  );
  y += 5;
  doc.text(
    `Status ${booking.flight_status} · Payment ${booking.payment_method} / ${booking.payment_status} · ${money(booking.amount, booking.currency)}`,
    M,
    y,
  );
  y += 8;

  const cols: Array<[string, number]> = [
    ["#", M],
    [lex.occupantLabel, M + 10],
    ["Seat", M + 62],
    ["Document", M + 84],
    ["Phone", M + 122],
    ["Email", M + 152],
  ];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  cols.forEach(([label, x]) => doc.text(label, x, y));
  y += 2;
  doc.setDrawColor(203, 213, 225);
  doc.line(M, y, 210 - M, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  rows.forEach((r) => {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    const vals = [String(r.index), r.name, r.seat, r.document, r.phone, r.email];
    cols.forEach(([, x], i) => doc.text(String(vals[i]).slice(0, i === 5 ? 26 : 24), x, y));
    y += 5;
  });

  y += 3;
  doc.setFont("helvetica", "bold");
  doc.text(`Total ${lex.occupantPluralLabel.toLowerCase()}: ${rows.length}`, M, y);
  doc.text(`Total value: ${money(booking.amount, booking.currency)}`, M + 70, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated ${new Date().toLocaleString()} · Yalla Mobility operator portal`, M, 288);
  return doc;
}

export function downloadManifestPdf(booking: CharterBookingRow) {
  buildManifestPdf(booking).save(`manifest-${booking.reference}.pdf`);
}
