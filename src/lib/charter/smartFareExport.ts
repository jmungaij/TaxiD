/**
 * Procurement-ready SmartFare breakdown exports (CSV + PDF).
 *
 * Buyers running an RFQ need the full cost stack, the platform fee, every
 * saving with its explanation, the provenance of each input and the admin
 * configuration version the price was computed against — in a file they can
 * attach to a tender.
 */
import { formatKes, type MissionFare } from "./smartFare";
import { buildMissionProvenance } from "./pricingProvenance";
import { missionSegmentAlerts } from "./segmentAlerts";
import { validateFare } from "./rateCardValidation";
import { recordPricingAudit } from "./pricingAuditLog";


const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const row = (cells: unknown[]) => cells.map(esc).join(",");

export function missionRef(fare: MissionFare): string {
  return `SF-${fare.from?.code ?? "XXX"}${fare.to?.code ?? "XXX"}-${fare.aircraft.key.toUpperCase().slice(0, 6)}`;
}

export interface AlertRow { segment: string; type: string; severity: string; label: string; detail: string }

/** Canonical per-segment alert rows shared by the RouteMap, CSV and PDF. */
export function smartFareAlertRows(fare: MissionFare): AlertRow[] {
  return missionSegmentAlerts(fare).flatMap((g) =>
    g.alerts.map((a) => ({
      segment: g.segment,
      type: a.kind === "carbon" ? "Carbon" : "Operational risk",
      severity: a.severity,
      label: a.label,
      detail: a.detail,
    })));
}

export function smartFareToCsv(fare: MissionFare, generatedAt = new Date()): string {
  const p = buildMissionProvenance(fare);
  const lines: string[] = [];

  lines.push(row(["TaxiD SmartFare pricing breakdown"]));
  lines.push(row(["Reference", missionRef(fare)]));
  lines.push(row(["Generated", generatedAt.toISOString()]));
  lines.push(row(["Route", `${fare.from?.city ?? ""} (${fare.from?.code ?? ""}) -> ${fare.to?.city ?? ""} (${fare.to?.code ?? ""})`]));
  lines.push(row(["Asset", fare.aircraft.label]));
  lines.push(row(["Segment", fare.segment]));
  lines.push(row(["Sectors", fare.sectors === 2 ? "Round trip" : "One way"]));
  lines.push(row(["Distance (nm)", fare.distanceNm]));
  lines.push(row(["Block hours", fare.blockHours]));
  lines.push(row(["Carbon (kg CO2e)", fare.carbonKg]));
  lines.push(row(["Price basis", p.basisLabel]));
  lines.push(row(["Operator coverage (%)", p.operatorCoveragePct]));
  lines.push(row(["Operator", p.operator?.operatorName ?? "Not submitted"]));
  lines.push(row(["Availability confirmed", p.availabilityConfirmed ? "Yes" : "No"]));
  lines.push(row(["Admin config version", p.configVersion]));
  lines.push(row(["Admin config saved", p.configSavedAt ?? "n/a"]));
  const v = validateFare(fare);
  lines.push(row(["Quote status", v.canFinalise ? "Binding quote eligible" : "Indicative only"]));
  lines.push(row(["Rate card completion (%)", v.completionPct]));
  lines.push(row(["Rate card version", fare.operator?.submittedAt ?? "n/a"]));
  lines.push(row(["Validation summary", v.summary]));
  lines.push("");


  lines.push(row(["Cost layer", "Amount (KES)", "Detail", "Input source"]));
  for (const l of p.layers) lines.push(row([l.label, l.amount, l.detail ?? "", l.sourceLabel]));
  lines.push(row(["Gross mission cost", fare.grossMissionCost, "", ""]));
  lines.push("");

  lines.push(row(["Saving", "Amount (KES)", "Explanation", "Source", "Status"]));
  for (const s of p.savings) lines.push(row([s.label, s.amount, s.explanation, s.source, "APPLIED"]));
  lines.push(row(["Total savings applied", fare.totalSavings, "", "", ""]));
  for (const s of fare.potentialSavings) {
    lines.push(row([s.label, s.amount, s.explanation, "Requires operator confirmation", "POTENTIAL — NOT APPLIED"]));
  }
  lines.push(row(["Total potential savings (not applied)", fare.potentialSavingsTotal, "", "", ""]));
  lines.push("");

  lines.push(row(["Evidence dimension", "Score"]));
  lines.push(row(["Pricing completeness (operator-sourced %)", fare.evidence.pricingCompleteness]));
  lines.push(row(["Operational readiness", fare.evidence.operationalReadiness]));
  lines.push(row(["Commercial confirmation", fare.evidence.commercialConfirmation]));
  lines.push(row(["Evidence confidence", fare.evidence.evidenceConfidence]));
  lines.push(row(["Block time basis", fare.blockHoursConfirmed ? "Operator-confirmed" : "Estimated (model-derived)"]));
  lines.push("");


  lines.push(row(["Settlement", "Amount (KES)"]));
  lines.push(row(["Operator mission cost", fare.operatorMissionCost]));
  lines.push(row([`TaxiD platform fee (${fare.platformFeePct}%)`, fare.platformFee]));
  lines.push(row(["VAT", fare.vat]));
  lines.push(row(["Mission price", fare.total]));
  lines.push(row(["Price per seat", fare.perSeat]));
  lines.push(row(["Sustainable operating floor", fare.operatingFloor]));
  lines.push("");

  lines.push(row(["Missing input", "Effect on this price"]));
  if (p.missing.length === 0) lines.push(row(["None", "All cost layers supplied by the operator."]));
  for (const m of p.missing) lines.push(row([m.label, m.impact]));
  lines.push("");

  lines.push(row(["Segment", "Alert type", "Severity", "Alert", "Detail"]));
  for (const a of smartFareAlertRows(fare)) {
    lines.push(row([a.segment, a.type, a.severity, a.label, a.detail]));
  }
  lines.push("");

  if (v.blocking.length) {
    lines.push(row(["Blocking requirement", "Reason"]));
    for (const b of v.blocking) lines.push(row([b.label, b.reason]));
    lines.push("");
  }
  for (const n of fare.notes) lines.push(row([n]));


  return lines.join("\n");
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadSmartFareCsv(fare: MissionFare, actor?: string | null) {
  recordPricingAudit(fare, { reason: "csv_export", actor: actor ?? null });
  download(
    new Blob([smartFareToCsv(fare)], { type: "text/csv;charset=utf-8" }),
    `${missionRef(fare)}-smartfare.csv`,
  );
}


/** Procurement PDF — reuses the itinerary document primitives for consistency. */
export async function downloadSmartFarePdf(fare: MissionFare) {
  const [{ jsPDF }, primitives] = await Promise.all([
    import("jspdf"),
    import("./itineraryPdf"),
  ]);
  const p = buildMissionProvenance(fare);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = 48;

  const heading = (text: string) => {
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(20);
    doc.text(text.toUpperCase(), 40, y);
    y += 6;
    doc.setDrawColor(200).line(40, y, W - 40, y);
    y += 14;
  };
  const kv = (label: string, value: string, muted = false) => {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(muted ? 120 : 40);
    doc.text(label, 40, y);
    doc.text(value, W - 40, y, { align: "right" });
    y += 14;
  };
  const wrap = (text: string) => {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
    for (const line of doc.splitTextToSize(text, W - 80)) {
      doc.text(line as string, 40, y);
      y += 10;
    }
  };
  const page = () => {
    if (y > 760) { doc.addPage(); y = 48; }
  };

  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(20);
  doc.text("TaxiD SmartFare™ pricing breakdown", 40, y);
  y += 18;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(120);
  doc.text(`${missionRef(fare)} · generated ${new Date().toLocaleString("en-KE")}`, 40, y);
  y += 24;

  heading("Mission");
  kv("Route", `${fare.from?.city ?? "—"} (${fare.from?.code ?? "—"}) → ${fare.to?.city ?? "—"} (${fare.to?.code ?? "—"})`);
  kv("Asset", fare.aircraft.label);
  kv("Profile", `${fare.segment} · ${fare.sectors === 2 ? "round trip" : "one way"}`);
  kv("Distance / block time", `${fare.distanceNm} nm · ${fare.blockHours.toFixed(2)} h`);
  kv("Carbon", `${fare.carbonKg.toLocaleString()} kg CO₂e`);
  kv("Price basis", p.basisLabel);
  kv("Operator", `${p.operator?.operatorName ?? "Not submitted"} · availability ${p.availabilityConfirmed ? "confirmed" : "unconfirmed"}`);
  kv("Admin config version", `v${p.configVersion}${p.configSavedAt ? ` · ${new Date(p.configSavedAt).toLocaleDateString("en-KE")}` : ""}`);
  y += 8;

  page(); heading("Cost layers");
  for (const l of p.layers) {
    kv(l.label, formatKes(l.amount));
    wrap(`${l.detail ? `${l.detail} — ` : ""}${l.sourceLabel}`);
    page();
  }
  kv("Gross mission cost", formatKes(fare.grossMissionCost));
  y += 8;

  if (p.savings.length) {
    page(); heading("Savings applied");
    for (const s of p.savings) {
      kv(s.label, `− ${formatKes(s.amount)}`);
      wrap(`${s.explanation} — ${s.source}`);
      page();
    }
    kv("Total savings", `− ${formatKes(fare.totalSavings)}`);
    y += 8;
  }

  page(); heading("Settlement");
  kv("Operator mission cost", formatKes(fare.operatorMissionCost));
  kv(`TaxiD platform fee (${fare.platformFeePct}%)`, formatKes(fare.platformFee));
  kv("VAT", formatKes(fare.vat));
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(20);
  doc.text("Mission price", 40, y);
  doc.text(formatKes(fare.total), W - 40, y, { align: "right" });
  y += 16;
  kv("Price per seat", formatKes(fare.perSeat), true);
  kv("Sustainable operating floor", formatKes(fare.operatingFloor), true);
  y += 8;

  page(); heading("Missing inputs");
  if (p.missing.length === 0) wrap("All cost layers were supplied by the operator's rate card.");
  for (const m of p.missing) {
    kv(m.label, "estimated", true);
    wrap(m.impact);
    page();
  }

  const validation = validateFare(fare);
  page(); heading("Quote status");
  kv("Status", validation.canFinalise ? "Binding quote eligible" : "Indicative only");
  kv("Rate card completion", `${validation.completionPct}%`, true);
  wrap(validation.summary);
  for (const b of validation.blocking) {
    kv(b.label, "outstanding", true);
    wrap(b.reason);
    page();
  }

  page(); heading("Carbon & risk alerts by segment");
  for (const a of smartFareAlertRows(fare)) {
    kv(`${a.segment} · ${a.type} · ${a.label}`, a.severity, true);
    wrap(a.detail);
    page();
  }

  const record = recordPricingAudit(fare, { reason: "pdf_export" });
  page(); heading("Audit record");
  kv("Record", `#${record.seq} · ${record.hash}`, true);
  kv("Rate card version", record.rateCardVersion ?? "not submitted", true);
  kv("Admin config version", `v${record.configVersion}`, true);

  page(); heading("Notes");
  for (const n of fare.notes) wrap(n);


  try {
    (primitives as { documentFingerprint?: (d: unknown, ref: string) => void })
      .documentFingerprint?.(doc, missionRef(fare));
  } catch {
    /* fingerprint is decorative — never block the export */
  }

  doc.save(`${missionRef(fare)}-smartfare.pdf`);
}
