/**
 * CSV / PDF export builders for the loaded tax reports.
 *
 * Reports are modelled as `ReportTable` so CSV generation stays pure and the
 * branded A4 PDF renderer is reused from the command-centre export layer.
 */
import {
  type ReportTable, downloadReportCsv, downloadReportPdf, reportToCsv,
} from "@/lib/corporate/executiveExports";

export type { ReportTable };
export { reportToCsv, downloadReportCsv, downloadReportPdf };

const kes = (cents: unknown) => Number(cents ?? 0) / 100;
const num = (v: unknown) => Number(v ?? 0);

export interface TaxInvoiceExportRow {
  invoice_number?: string;
  status?: string;
  customer_name?: string | null;
  customer_kra_pin?: string | null;
  currency?: string;
  subtotal_cents?: number;
  tax_total_cents?: number;
  total_cents?: number;
  issued_at?: string | null;
  kra_reference?: string | null;
  attempt_count?: number;
}

/** eTIMS invoices as loaded by tax_report_invoices. */
export function invoicesReport(
  rows: TaxInvoiceExportRow[],
  window: { from: string; to: string; status?: string },
): ReportTable {
  const gross = rows.reduce((a, r) => a + kes(r.total_cents), 0);
  const vat = rows.reduce((a, r) => a + kes(r.tax_total_cents), 0);
  return {
    id: "etims-invoices",
    title: "SAFARID · eTIMS invoices",
    subtitle: `${window.from} to ${window.to}${window.status && window.status !== "ALL" ? ` · ${window.status}` : ""}`,
    meta: [
      ["Invoices", String(rows.length)],
      ["Gross KES", gross.toFixed(2)],
      ["VAT KES", vat.toFixed(2)],
    ],
    columns: [
      "Invoice #", "Status", "Customer", "KRA PIN", "Currency",
      "Net", "VAT", "Total", "Issued", "KRA reference", "Attempts",
    ],
    rows: rows.map((r) => [
      r.invoice_number ?? "",
      r.status ?? "",
      r.customer_name ?? "",
      r.customer_kra_pin ?? "",
      r.currency ?? "KES",
      kes(r.subtotal_cents).toFixed(2),
      kes(r.tax_total_cents).toFixed(2),
      kes(r.total_cents).toFixed(2),
      r.issued_at ? new Date(r.issued_at).toISOString() : "",
      r.kra_reference ?? "",
      num(r.attempt_count),
    ]),
  };
}

export interface VatSummaryData {
  by_scheme?: Array<{
    tax_scheme_code?: string; line_count?: number;
    taxable_cents?: number; tax_cents?: number; total_cents?: number;
  }>;
  daily?: Array<{
    day?: string; invoice_count?: number;
    net_cents?: number; tax_cents?: number; gross_cents?: number;
  }>;
}

/** VAT summary by scheme, as loaded by tax_report_vat_summary. */
export function vatSummaryReport(data: VatSummaryData | null, window: { from: string; to: string }): ReportTable {
  const schemes = data?.by_scheme ?? [];
  const taxable = schemes.reduce((a, s) => a + kes(s.taxable_cents), 0);
  const tax = schemes.reduce((a, s) => a + kes(s.tax_cents), 0);
  const total = schemes.reduce((a, s) => a + kes(s.total_cents), 0);
  return {
    id: "vat-summary",
    title: "SAFARID · VAT summary by scheme",
    subtitle: `${window.from} to ${window.to}`,
    meta: [
      ["Taxable base KES", taxable.toFixed(2)],
      ["VAT collected KES", tax.toFixed(2)],
      ["Gross sales KES", total.toFixed(2)],
    ],
    columns: ["Scheme", "Lines", "Taxable", "VAT", "Total"],
    rows: schemes.map((s) => [
      s.tax_scheme_code ?? "",
      num(s.line_count),
      kes(s.taxable_cents).toFixed(2),
      kes(s.tax_cents).toFixed(2),
      kes(s.total_cents).toFixed(2),
    ]),
  };
}

/** Daily VAT movement, as loaded by tax_report_vat_summary. */
export function vatDailyReport(data: VatSummaryData | null, window: { from: string; to: string }): ReportTable {
  const daily = data?.daily ?? [];
  return {
    id: "vat-daily",
    title: "SAFARID · daily VAT movement",
    subtitle: `${window.from} to ${window.to}`,
    meta: [["Days", String(daily.length)]],
    columns: ["Date", "Invoices", "Net", "VAT", "Gross"],
    rows: daily.map((d) => [
      d.day ?? "",
      num(d.invoice_count),
      kes(d.net_cents).toFixed(2),
      kes(d.tax_cents).toFixed(2),
      kes(d.gross_cents).toFixed(2),
    ]),
  };
}
