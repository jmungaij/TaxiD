/**
 * Advanced discrepancy filtering, bulk selection and dry-run previews.
 *
 * All logic here is pure so the finance console, the drill-down and the export
 * builders always agree on exactly which rows are in scope — the filtered set
 * that is displayed is the set that gets exported and bulk-actioned.
 */
import type { ReportTable } from "@/lib/corporate/executiveExports";
import type { ReconFindingLike } from "@/lib/charter/reconciliationExports";
import { findingVariance } from "@/lib/charter/reconciliationExports";

export interface FindingFilters {
  /** Inclusive ISO date (yyyy-mm-dd) on the detection timestamp. */
  from?: string;
  /** Inclusive ISO date (yyyy-mm-dd) on the detection timestamp. */
  to?: string;
  /** Wallet id or fragment. */
  wallet?: string;
  /** Resolution status: open | acknowledged | resolved | false_positive. */
  status?: string;
  /** Mismatch type (`kind`). */
  kind?: string;
  severity?: string;
  /** Free-text match on detail / references. */
  search?: string;
  /** Limit to a single reconciliation run. */
  runId?: string;
}

export const EMPTY_FINDING_FILTERS: FindingFilters = {};

export const FINDING_STATUSES = ["open", "acknowledged", "resolved", "false_positive"] as const;

export const resolutionStatus = (f: ReconFindingLike) => f.resolution_status ?? "open";

const dayOf = (iso: string) => iso.slice(0, 10);

/** Distinct mismatch types present in the data set, sorted. */
export function findingKinds(findings: ReconFindingLike[]): string[] {
  return Array.from(new Set(findings.map((f) => f.kind))).sort();
}

/** Distinct wallets present in the data set, sorted. */
export function findingWallets(findings: ReconFindingLike[]): string[] {
  return Array.from(new Set(findings.map((f) => f.wallet_id).filter((w): w is string => !!w))).sort();
}

export function matchesFindingFilters(f: ReconFindingLike, filters: FindingFilters): boolean {
  const day = dayOf(f.created_at);
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  if (filters.wallet && !(f.wallet_id ?? "").includes(filters.wallet)) return false;
  if (filters.status && filters.status !== "all" && resolutionStatus(f) !== filters.status) return false;
  if (filters.kind && filters.kind !== "all" && f.kind !== filters.kind) return false;
  if (filters.severity && filters.severity !== "all" && f.severity !== filters.severity) return false;
  if (filters.runId && f.run_id !== filters.runId) return false;
  if (filters.search) {
    const needle = filters.search.trim().toLowerCase();
    const hay = [f.detail, f.kind, f.wallet_id, f.funding_request_id, f.resolution_notes]
      .filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function filterFindings(findings: ReconFindingLike[], filters: FindingFilters): ReconFindingLike[] {
  return findings.filter((f) => matchesFindingFilters(f, filters));
}

/** Filters flattened for the audit trail / export metadata. */
export function describeFilters(filters: FindingFilters): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== "" && v !== "all"),
  );
}

/** Findings that a bulk acknowledge/resolve action may legally touch. */
export function bulkActionable(findings: ReconFindingLike[]): ReconFindingLike[] {
  return findings.filter((f) => resolutionStatus(f) === "open" || resolutionStatus(f) === "acknowledged");
}

/** Aggregate variance of a filtered slice, used for headline counters. */
export function absoluteDrift(findings: ReconFindingLike[]): number {
  return findings.reduce((sum, f) => sum + Math.abs(findingVariance(f) ?? 0), 0);
}

/* --------------------------------------------------------------- dry run */

export interface DryRunItem {
  severity: string;
  kind: string;
  wallet_id: string | null;
  funding_request_id: string | null;
  expected_kes: number | null;
  actual_kes: number | null;
  detail: string;
}

export interface DryRunPreview {
  dry_run: true;
  window_start: string;
  window_end: string;
  wallets_scanned: number;
  requests_scanned: number;
  findings: number;
  critical: number;
  balanced: boolean;
  items: DryRunItem[];
}

const num = (n: number | null | undefined) => (n == null ? "" : Math.round(Number(n)));

/** Export of a dry-run preview: what a real rerun would record. */
export function dryRunReport(preview: DryRunPreview): ReportTable {
  return {
    id: "wallet-reconciliation-dry-run",
    title: "Yalla Mobility · reconciliation rerun preview (dry run)",
    subtitle: "Discrepancies a real rerun would record — nothing was written",
    meta: [
      ["Window", `${preview.window_start} → ${preview.window_end}`],
      ["Wallets scanned", String(preview.wallets_scanned)],
      ["Fundings scanned", String(preview.requests_scanned)],
      ["Would-be findings", String(preview.findings)],
      ["Critical", String(preview.critical)],
      ["Generated", new Date().toISOString()],
    ],
    columns: [
      "Severity", "Kind", "Detail", "Expected KES (ledger)", "Actual KES (wallet)",
      "Variance KES", "Wallet", "Funding request",
    ],
    rows: preview.items.map((i) => [
      i.severity,
      i.kind,
      i.detail,
      num(i.expected_kes),
      num(i.actual_kes),
      i.expected_kes == null || i.actual_kes == null ? "" : Math.round(Number(i.actual_kes) - Number(i.expected_kes)),
      i.wallet_id ?? "",
      i.funding_request_id ?? "",
    ]),
  };
}
