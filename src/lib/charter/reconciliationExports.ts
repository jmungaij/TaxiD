/**
 * Report builders for corporate wallet reconciliation.
 *
 * Everything is modelled as a plain `ReportTable` so CSV output stays pure and
 * testable, and the shared branded PDF renderer can be reused verbatim.
 */
import type { ReportTable } from "@/lib/corporate/executiveExports";

export interface ReconRunLike {
  id: string;
  window_start: string;
  window_end: string;
  wallets_scanned: number;
  requests_scanned: number;
  findings: number;
  critical: number;
  balanced: boolean;
  triggered_by: string;
  created_at: string;
}

export interface ReconFindingLike {
  id: string;
  run_id: string;
  severity: string;
  kind: string;
  wallet_id: string | null;
  funding_request_id: string | null;
  expected_kes: number | null;
  actual_kes: number | null;
  detail: string;
  created_at: string;
  resolution_status?: string | null;
  resolution_notes?: string | null;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
}

export interface ReconAlertLike {
  id: string;
  finding_id: string;
  severity: string;
  kind: string;
  detail: string;
  status: string;
  attempts: number;
  max_attempts?: number | null;
  email_sent_to: string[] | null;
  webhook_status: number | null;
  last_error: string | null;
  next_attempt_at?: string | null;
  notified_at: string | null;
  acknowledged_at?: string | null;
  acknowledgement_notes?: string | null;
  created_at: string;
}

export interface ReconAttemptLike {
  id: string;
  requested_from: string;
  requested_to: string;
  status: string;
  attempt: number;
  run_id: string | null;
  findings: number;
  critical: number;
  error: string | null;
  note: string | null;
  created_at: string;
  finished_at: string | null;
}

const stamp = (s: string | null | undefined) => (s ? new Date(s).toISOString() : "");
const num = (n: number | null | undefined) => (n == null ? "" : Math.round(Number(n)));

/** Variance between the expected (ledger) and actual (wallet) amount. */
export function findingVariance(f: ReconFindingLike): number | null {
  if (f.expected_kes == null || f.actual_kes == null) return null;
  return Number(f.actual_kes) - Number(f.expected_kes);
}

/**
 * Discrepancy detail export, with each finding linked back to its
 * reconciliation run window so auditors can reproduce the scan.
 */
export function reconciliationFindingsReport(
  findings: ReconFindingLike[],
  runs: ReconRunLike[],
): ReportTable {
  const byRun = new Map(runs.map((r) => [r.id, r]));
  const critical = findings.filter((f) => f.severity === "critical").length;
  const drift = findings.reduce((sum, f) => sum + Math.abs(findingVariance(f) ?? 0), 0);

  return {
    id: "wallet-reconciliation-findings",
    title: "TaxiD · corporate wallet reconciliation findings",
    subtitle: "Discrepancy detail with linked reconciliation runs",
    meta: [
      ["Findings", String(findings.length)],
      ["Critical", String(critical)],
      ["Open", String(findings.filter((f) => (f.resolution_status ?? "open") === "open").length)],
      ["Absolute drift (KES)", String(Math.round(drift))],
      ["Generated", new Date().toISOString()],
    ],
    columns: [
      "Detected", "Severity", "Kind", "Detail", "Expected KES", "Actual KES",
      "Variance KES", "Wallet", "Funding request", "Resolution status", "Acknowledged", "Resolved",
      "Resolution notes", "Run", "Run window start", "Run window end", "Trigger",
    ],
    rows: findings.map((f) => {
      const run = byRun.get(f.run_id);
      return [
        stamp(f.created_at),
        f.severity,
        f.kind,
        f.detail,
        num(f.expected_kes),
        num(f.actual_kes),
        num(findingVariance(f)),
        f.wallet_id ?? "",
        f.funding_request_id ?? "",
        f.resolution_status ?? "open",
        stamp(f.acknowledged_at),
        stamp(f.resolved_at),
        f.resolution_notes ?? "",
        f.run_id,
        stamp(run?.window_start),
        stamp(run?.window_end),
        run?.triggered_by ?? "",
      ];
    }),
  };
}

/** Attempt/retry audit export for reconciliation reruns. */
export function reconciliationAttemptsReport(attempts: ReconAttemptLike[]): ReportTable {
  return {
    id: "wallet-reconciliation-attempts",
    title: "TaxiD · reconciliation attempt audit",
    subtitle: "Every finance-triggered rerun, retry and its outcome",
    meta: [
      ["Attempts", String(attempts.length)],
      ["Failed", String(attempts.filter((a) => a.status === "failed").length)],
      ["Generated", new Date().toISOString()],
    ],
    columns: [
      "Requested", "Range from", "Range to", "Status", "Attempt",
      "Findings", "Critical", "Run", "Finished", "Note", "Error",
    ],
    rows: attempts.map((a) => [
      stamp(a.created_at),
      stamp(a.requested_from),
      stamp(a.requested_to),
      a.status,
      a.attempt,
      a.findings,
      a.critical,
      a.run_id ?? "",
      stamp(a.finished_at),
      a.note ?? "",
      a.error ?? "",
    ]),
  };
}

/** Mismatch alert delivery export: attempts, backoff state and acknowledgements. */
export function reconciliationAlertsReport(alerts: ReconAlertLike[]): ReportTable {
  return {
    id: "wallet-reconciliation-alerts",
    title: "TaxiD · mismatch alert delivery",
    subtitle: "Email and webhook delivery attempts with retry state",
    meta: [
      ["Alerts", String(alerts.length)],
      ["Delivered", String(alerts.filter((a) => a.status === "notified").length)],
      ["Failing", String(alerts.filter((a) => a.status === "failed" || a.status === "exhausted").length)],
      ["Generated", new Date().toISOString()],
    ],
    columns: [
      "Detected", "Severity", "Kind", "Detail", "Status", "Attempts", "Max attempts",
      "Emails", "Webhook status", "Next attempt", "Delivered at", "Acknowledged",
      "Acknowledgement notes", "Last error", "Finding",
    ],
    rows: alerts.map((a) => [
      stamp(a.created_at),
      a.severity,
      a.kind,
      a.detail,
      a.status,
      a.attempts,
      a.max_attempts ?? "",
      (a.email_sent_to ?? []).join("; "),
      a.webhook_status == null ? "" : a.webhook_status,
      stamp(a.next_attempt_at),
      stamp(a.notified_at),
      stamp(a.acknowledged_at),
      a.acknowledgement_notes ?? "",
      a.last_error ?? "",
      a.finding_id,
    ]),
  };
}
