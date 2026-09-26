/**
 * Report export builders for the command centres.
 *
 * Every report is first modelled as a plain `ReportTable` (title + columns +
 * rows), which makes CSV output pure and unit-testable, and lets the PDF
 * renderer be a single generic function instead of one per report.
 */
import type { FunnelStage, ContractPipeline } from "@/lib/corporate/executiveCommand";
import type {
  DepartmentBudget, LedgerEntry, MonthlySpend, StatementTotals,
} from "@/lib/corporate/accountCommandCentre";

export type ReportCell = string | number | null;

export interface ReportTable {
  /** Machine-safe id used for filenames. */
  id: string;
  title: string;
  subtitle?: string;
  /** Summary lines rendered above the table (also emitted as CSV preamble). */
  meta?: Array<[string, string]>;
  columns: string[];
  rows: ReportCell[][];
}

const cell = (v: ReportCell): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC4180-safe CSV for a report, including the meta preamble. */
export function reportToCsv(table: ReportTable): string {
  const lines: string[] = [cell(table.title)];
  if (table.subtitle) lines.push(cell(table.subtitle));
  for (const [k, v] of table.meta ?? []) lines.push(`${cell(k)},${cell(v)}`);
  if (lines.length > 0) lines.push("");
  lines.push(table.columns.map(cell).join(","));
  for (const row of table.rows) lines.push(row.map(cell).join(","));
  return lines.join("\n");
}

export function reportFilename(table: ReportTable, ext: "csv" | "pdf", now = Date.now()): string {
  const day = new Date(now).toISOString().slice(0, 10);
  return `yalla-${table.id}-${day}.${ext}`;
}

const money = (n: number) => Math.round(n);

/* ------------------------------------------------------------ executive */

export function funnelReport(stages: FunnelStage[], conversionPct: number): ReportTable {
  return {
    id: "conversion-funnel",
    title: "SAFARID · conversion funnel",
    subtitle: "Enquiry to invoice, trailing 90 days",
    meta: [["Overall conversion %", conversionPct.toFixed(2)]],
    columns: ["Stage", "Count", "% of top", "Step conversion %"],
    rows: stages.map((s) => [
      s.label,
      s.count,
      s.ofTopPct.toFixed(1),
      s.stepConversionPct == null ? "" : s.stepConversionPct.toFixed(1),
    ]),
  };
}

export function pipelineReport(p: ContractPipeline): ReportTable {
  return {
    id: "contract-pipeline",
    title: "SAFARID · contract pipeline",
    columns: ["Measure", "Value"],
    rows: [
      ["Open opportunities", p.open],
      ["Open pipeline KES", money(p.pipelineValueKes)],
      ["Weighted forecast KES", money(p.weightedPipelineKes)],
      ["Contracted KES", money(p.contractedKes)],
      ["Win rate %", p.winRatePct == null ? "" : p.winRatePct.toFixed(1)],
      ["In commercial/legal", p.contractsInLegal],
      ["Stalled opportunities", p.stalled],
      ["Overdue actions", p.overdueActions],
    ],
  };
}

/* -------------------------------------------------------------- account */

export function monthlySpendReport(
  accountName: string,
  spend: MonthlySpend,
  trend: Array<{ monthKey: string; invoicedKes: number }>,
): ReportTable {
  return {
    id: "monthly-spend",
    title: `${accountName} · monthly spend`,
    subtitle: `Current month ${spend.monthKey}`,
    meta: [
      ["Invoiced KES", String(money(spend.invoicedKes))],
      ["Trips", String(spend.tripCount)],
      ["Average trip KES", String(money(spend.avgTripKes))],
      ["MoM change %", spend.deltaVsPrevPct == null ? "" : spend.deltaVsPrevPct.toFixed(1)],
    ],
    columns: ["Month", "Invoiced KES"],
    rows: trend.map((m) => [m.monthKey, money(m.invoicedKes)]),
  };
}

export function budgetsReport(accountName: string, budgets: DepartmentBudget[]): ReportTable {
  return {
    id: "department-budgets",
    title: `${accountName} · department budgets`,
    columns: ["Department", "Code", "Budget KES", "Spent KES", "Remaining KES", "Utilisation %", "Band"],
    rows: budgets.map((b) => [
      b.name,
      b.code ?? "",
      money(b.budgetKes),
      money(b.spentKes),
      money(b.remainingKes),
      b.utilisationPct.toFixed(1),
      b.band,
    ]),
  };
}

export function invoiceLedgerReport(accountName: string, ledger: LedgerEntry[]): ReportTable {
  return {
    id: "invoices-receipts",
    title: `${accountName} · invoices and receipts`,
    columns: ["Type", "Reference", "Date", "Amount KES", "Balance KES", "Status", "Overdue"],
    rows: ledger.map((e) => [
      e.kind,
      e.reference,
      e.date,
      money(e.amountKes),
      money(e.balanceKes),
      e.status,
      e.overdue ? "yes" : "no",
    ]),
  };
}

export function statementReport(
  accountName: string,
  ledger: LedgerEntry[],
  totals: StatementTotals,
  now = Date.now(),
): ReportTable {
  return {
    id: "statement",
    title: `${accountName} · corporate statement`,
    subtitle: `Generated ${new Date(now).toISOString()}`,
    meta: [
      ["Invoiced KES", String(money(totals.invoicedKes))],
      ["Paid KES", String(money(totals.paidKes))],
      ["Outstanding KES", String(money(totals.outstandingKes))],
      ["Overdue KES", String(money(totals.overdueKes))],
    ],
    columns: ["Type", "Reference", "Date", "Amount KES", "Balance KES", "Status", "Overdue"],
    rows: ledger.map((e) => [
      e.kind,
      e.reference,
      e.date,
      money(e.amountKes),
      money(e.balanceKes),
      e.status,
      e.overdue ? "yes" : "no",
    ]),
  };
}

/* ------------------------------------------------------------ downloads */

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadReportCsv(table: ReportTable): void {
  triggerDownload(
    reportFilename(table, "csv"),
    new Blob([reportToCsv(table)], { type: "text/csv;charset=utf-8;" }),
  );
}

/** Renders the report as a branded A4 PDF (lazy-loads jsPDF). */
export async function downloadReportPdf(table: ReportTable): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 14;
  let y = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(table.title, M, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  if (table.subtitle) { doc.text(table.subtitle, M, y); y += 5; }
  for (const [k, v] of table.meta ?? []) { doc.text(`${k}: ${v}`, M, y); y += 4.5; }
  y += 3;

  const cols = table.columns.length;
  const colW = (W - M * 2) / cols;
  const drawHead = () => {
    doc.setFillColor(29, 78, 216);
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.rect(M, y - 4.5, W - M * 2, 6.5, "F");
    table.columns.forEach((c, i) => doc.text(String(c).slice(0, 22), M + 1.5 + i * colW, y));
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30);
  };
  drawHead();

  for (const row of table.rows) {
    if (y > 275) { doc.addPage(); y = 20; drawHead(); }
    row.forEach((c, i) => doc.text(String(c ?? "").slice(0, 24), M + 1.5 + i * colW, y));
    y += 5.5;
  }

  doc.setTextColor(120);
  doc.setFontSize(8);
  doc.text(`SAFARID · generated ${new Date().toISOString()}`, M, 290);
  doc.save(reportFilename(table, "pdf"));
}
