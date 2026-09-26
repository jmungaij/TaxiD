/**
 * Phase D8.2 — Executive Export.
 *
 * Reuses the canonical Executive Intelligence datasets already rendered on
 * screen. Never re-queries; the caller passes the exact same objects it
 * shows to the user, guaranteeing "exported KPI == displayed KPI".
 */
import { toCsv, downloadCsv } from "@/lib/csv";
import type { Workspace360GovernanceReport } from "@/lib/workspace360/governance";
import type { DigestMetric, DigestAlert } from "./digest";

export interface ScorecardRow {
  label: string;
  score: number;
  passed: boolean;
  href: string;
}

export interface ExecutiveExportPayload {
  scorecard: ScorecardRow[];
  metrics: DigestMetric[];
  alerts: DigestAlert[];
  governance: Workspace360GovernanceReport;
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function exportExecutiveCsv(p: ExecutiveExportPayload): void {
  const scorecardCsv = toCsv(
    p.scorecard.map((s) => ({
      section: "scorecard",
      label: s.label,
      score: s.score,
      passed: s.passed,
      href: s.href,
    })),
  );
  const metricsCsv = toCsv(
    p.metrics.map((m) => ({
      section: "kpi",
      category: m.category,
      label: m.label,
      value: m.value_text ?? m.value_numeric ?? "",
      unit: m.unit ?? "",
      trend_pct: m.trend_pct ?? "",
      measured_at: m.measured_at,
    })),
  );
  const alertsCsv = toCsv(
    p.alerts.map((a) => ({
      section: "alert",
      severity: a.severity,
      category: a.category,
      title: a.title,
      created_at: a.created_at,
      acknowledged: a.acknowledged_at ? "yes" : "no",
    })),
  );
  const govCsv = toCsv([
    {
      section: "governance",
      passed: p.governance.passed,
      score: p.governance.score,
      certification: p.governance.certification.score,
      health: p.governance.health.platformScore,
      workflows: p.governance.workflows.score,
      consistency: p.governance.consistency.score,
      operations: p.governance.operations.score,
      failures: p.governance.failures.join(" | "),
    },
  ]);
  downloadCsv(
    `executive-intelligence-${ts()}.csv`,
    [scorecardCsv, "", metricsCsv, "", alertsCsv, "", govCsv].join("\n"),
  );
}

/**
 * PDF export via the browser print pipeline — no new engines, no server
 * roundtrip. Renders a print-only HTML document from the same canonical
 * datasets and calls window.print(), which the user saves as PDF.
 */
export function exportExecutivePdf(p: ExecutiveExportPayload): void {
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return;
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const rows = (arr: Array<Record<string, unknown>>, cols: string[]) =>
    arr
      .map(
        (r) =>
          `<tr>${cols
            .map((c) => `<td style="border:1px solid #ddd;padding:4px 8px;font-size:11px">${esc(r[c])}</td>`)
            .join("")}</tr>`,
      )
      .join("");
  const th = (cols: string[]) =>
    `<tr>${cols
      .map(
        (c) =>
          `<th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:left;background:#f5f5f5">${c}</th>`,
      )
      .join("")}</tr>`;
  win.document.write(`<!doctype html><html><head><title>Executive Intelligence — ${new Date().toLocaleString()}</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;padding:24px;color:#111}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px;color:#1e40af}table{border-collapse:collapse;width:100%;margin-bottom:8px}</style>
</head><body>
<h1>Executive Intelligence Report</h1>
<div style="font-size:11px;color:#555">Generated ${new Date().toISOString()} — canonical reuse of Workspace360 + Executive datasets</div>

<h2>Executive Scorecard</h2>
<table>${th(["label", "score", "passed"])}${rows(
    p.scorecard.map((s) => ({ label: s.label, score: `${s.score}/100`, passed: s.passed ? "PASS" : "FAIL" })),
    ["label", "score", "passed"],
  )}</table>

<h2>Governance Summary</h2>
<table>${th(["metric", "value"])}${rows(
    [
      { metric: "Overall", value: `${p.governance.score}/100 ${p.governance.passed ? "PASS" : "FAIL"}` },
      { metric: "Certification", value: `${p.governance.certification.score}/100` },
      { metric: "Health", value: `${p.governance.health.platformScore}/100` },
      { metric: "Workflows", value: `${p.governance.workflows.score}/100` },
      { metric: "Consistency", value: `${p.governance.consistency.score}/100` },
      { metric: "Operations", value: `${p.governance.operations.score}/100` },
    ],
    ["metric", "value"],
  )}</table>

<h2>KPI Panels</h2>
<table>${th(["category", "label", "value", "trend %"])}${rows(
    p.metrics.map((m) => ({
      category: m.category,
      label: m.label,
      value: m.value_text ?? m.value_numeric ?? "",
      "trend %": m.trend_pct == null ? "" : Number(m.trend_pct).toFixed(1),
    })),
    ["category", "label", "value", "trend %"],
  )}</table>

<h2>Open Executive Risks</h2>
<table>${th(["severity", "category", "title", "created_at"])}${rows(
    p.alerts.map((a) => ({
      severity: a.severity,
      category: a.category,
      title: a.title,
      created_at: a.created_at,
    })),
    ["severity", "category", "title", "created_at"],
  )}</table>

<script>window.onload=()=>setTimeout(()=>window.print(),200)</script>
</body></html>`);
  win.document.close();
}
