/**
 * Phase D8.2 — Executive Digest (daily/weekly).
 *
 * Pure reducer over canonical executive data already loaded by the
 * Executive Intelligence page. No new queries, no new engines. The output
 * is a plain-text summary suitable for existing notification channels.
 */
export interface DigestMetric {
  label: string;
  category: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  trend_pct: number | null;
  measured_at: string;
}
export interface DigestAlert {
  severity: string;
  category: string;
  title: string;
  created_at: string;
  acknowledged_at: string | null;
}
export interface DigestGovernance {
  score: number;
  passed: boolean;
  failures: string[];
}

export type DigestWindow = "daily" | "weekly";

export interface ExecutiveDigest {
  window: DigestWindow;
  generated_at: string;
  headline: string;
  sections: Array<{ title: string; lines: string[] }>;
  text: string;
}

function windowCutoff(w: DigestWindow): number {
  const days = w === "daily" ? 1 : 7;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function fmtValue(m: DigestMetric): string {
  if (m.value_text) return m.value_text;
  if (m.value_numeric == null) return "—";
  const v = Number(m.value_numeric);
  if (m.unit === "KES") return `KES ${v.toLocaleString()}`;
  if (m.unit === "%") return `${v.toFixed(1)}%`;
  return v.toLocaleString();
}

export function buildExecutiveDigest(
  window: DigestWindow,
  metrics: DigestMetric[],
  alerts: DigestAlert[],
  governance: DigestGovernance,
): ExecutiveDigest {
  const cutoff = windowCutoff(window);
  const recentAlerts = alerts.filter((a) => new Date(a.created_at).getTime() >= cutoff);
  const critical = recentAlerts.filter((a) => a.severity === "critical");
  const financial = recentAlerts.filter((a) => /financ|payment|wallet|ledger/i.test(a.category));
  const certFailures = recentAlerts.filter((a) => /certif/i.test(a.category));

  const movers = [...metrics]
    .filter((m) => m.trend_pct != null)
    .sort((a, b) => Math.abs(Number(b.trend_pct)) - Math.abs(Number(a.trend_pct)))
    .slice(0, 5);

  const sections: ExecutiveDigest["sections"] = [
    {
      title: `Critical alerts (${critical.length})`,
      lines: critical.slice(0, 10).map((a) => `• [${a.category}] ${a.title}`),
    },
    {
      title: `Financial anomalies (${financial.length})`,
      lines: financial.slice(0, 10).map((a) => `• [${a.severity}] ${a.title}`),
    },
    {
      title: `Certification failures (${certFailures.length})`,
      lines: certFailures.slice(0, 10).map((a) => `• [${a.severity}] ${a.title}`),
    },
    {
      title: "Top KPI movers",
      lines: movers.map(
        (m) => `• ${m.label} (${m.category}) ${Number(m.trend_pct).toFixed(1)}% → ${fmtValue(m)}`,
      ),
    },
    {
      title: "Platform readiness",
      lines: [
        `• Governance ${governance.score}/100 (${governance.passed ? "PASS" : "FAIL"})`,
        ...governance.failures.slice(0, 5).map((f) => `• ${f}`),
      ],
    },
    {
      title: `Open incidents (${alerts.filter((a) => !a.acknowledged_at).length})`,
      lines: alerts
        .filter((a) => !a.acknowledged_at)
        .slice(0, 10)
        .map((a) => `• [${a.severity}] ${a.title}`),
    },
  ];

  const headline =
    window === "daily"
      ? `Daily Executive Digest — ${critical.length} critical, governance ${governance.score}/100`
      : `Weekly Executive Digest — ${recentAlerts.length} alerts, governance ${governance.score}/100`;

  const text = [
    headline,
    `Generated ${new Date().toISOString()}`,
    "",
    ...sections.flatMap((s) => [s.title, ...(s.lines.length ? s.lines : ["• (none)"]), ""]),
  ].join("\n");

  return { window, generated_at: new Date().toISOString(), headline, sections, text };
}
