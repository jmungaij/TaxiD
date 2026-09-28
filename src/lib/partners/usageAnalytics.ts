/**
 * TaxiD API PARTNERS — usage analytics: filtering, aggregation and export.
 *
 * All figures are derived from `partner_api_usage_daily`, which is the platform's
 * own accounting of partner traffic. Nothing here is estimated or synthesised:
 * if a partner has no rows for a filter, the aggregate is zero and the UI must
 * say so rather than implying activity.
 */

import type { ApiEnvironment, PartnerApiCredential, UsageRow } from "./devPortal";
import { CAPABILITY_DOMAINS } from "./apiPlatform";

export interface UsageFilter {
  environments: ApiEnvironment[];
  /** Empty = every capability domain. */
  domains: string[];
  /** Inclusive ISO dates (YYYY-MM-DD). */
  from: string;
  to: string;
  /** Empty = every credential in scope. */
  credentialIds: string[];
}

export const RANGE_PRESETS = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "mtd", label: "Month to date", days: 0 },
] as const;

export type RangePresetKey = (typeof RANGE_PRESETS)[number]["key"];

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function rangeFor(preset: RangePresetKey): { from: string; to: string } {
  const now = new Date();
  if (preset === "mtd") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: iso(start), to: iso(now) };
  }
  const days = RANGE_PRESETS.find((r) => r.key === preset)?.days ?? 30;
  return { from: iso(new Date(now.getTime() - (days - 1) * 86_400_000)), to: iso(now) };
}

export function defaultFilter(): UsageFilter {
  const { from, to } = rangeFor("30d");
  return { environments: ["sandbox", "production"], domains: [], from, to, credentialIds: [] };
}

export function filterUsage(rows: UsageRow[], f: UsageFilter): UsageRow[] {
  return rows.filter((r) => {
    if (f.environments.length && !f.environments.includes(r.environment)) return false;
    if (f.domains.length && !f.domains.includes(r.domain_key)) return false;
    if (f.credentialIds.length && !(r.credential_id && f.credentialIds.includes(r.credential_id))) return false;
    if (r.usage_date < f.from || r.usage_date > f.to) return false;
    return true;
  });
}

export interface UsageAggregate {
  totals: { requests: number; errors: number; throttled: number; errorRate: number; throttleRate: number };
  p95LatencyMs: number | null;
  series: { date: string; requests: number; errors: number; throttled: number }[];
  byDomain: { domain: string; label: string; requests: number; errors: number; throttled: number }[];
  byEnvironment: { environment: ApiEnvironment; requests: number; errors: number; throttled: number }[];
  activeDays: number;
  busiestDay: { date: string; requests: number } | null;
}

const domainLabel = (key: string) =>
  CAPABILITY_DOMAINS.find((d) => d.key === key)?.name ?? (key === "all" ? "All domains" : key);

export function aggregateUsage(rows: UsageRow[]): UsageAggregate {
  const requests = rows.reduce((s, r) => s + r.requests, 0);
  const errors = rows.reduce((s, r) => s + r.errors, 0);
  const throttled = rows.reduce((s, r) => s + r.throttled, 0);

  const bucket = <K extends string | number>(key: (r: UsageRow) => K) => {
    const m = new Map<K, { requests: number; errors: number; throttled: number }>();
    for (const r of rows) {
      const k = key(r);
      const cur = m.get(k) ?? { requests: 0, errors: 0, throttled: 0 };
      m.set(k, {
        requests: cur.requests + r.requests,
        errors: cur.errors + r.errors,
        throttled: cur.throttled + r.throttled,
      });
    }
    return m;
  };

  const days = bucket((r) => r.usage_date);
  const domains = bucket((r) => r.domain_key);
  const envs = bucket((r) => r.environment);
  const latencies = rows.map((r) => r.p95_latency_ms).filter((n): n is number => typeof n === "number");

  const series = [...days.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totals: {
      requests,
      errors,
      throttled,
      errorRate: requests > 0 ? errors / requests : 0,
      throttleRate: requests + throttled > 0 ? throttled / (requests + throttled) : 0,
    },
    p95LatencyMs: latencies.length ? Math.max(...latencies) : null,
    series,
    byDomain: [...domains.entries()]
      .map(([domain, v]) => ({ domain, label: domainLabel(domain), ...v }))
      .sort((a, b) => b.requests - a.requests),
    byEnvironment: [...envs.entries()]
      .map(([environment, v]) => ({ environment, ...v }))
      .sort((a, b) => b.requests - a.requests),
    activeDays: series.filter((d) => d.requests > 0).length,
    busiestDay: series.length
      ? series.reduce((best, d) => (d.requests > best.requests ? { date: d.date, requests: d.requests } : best), {
          date: series[0].date,
          requests: series[0].requests,
        })
      : null,
  };
}

/* --------------------------------------------------------------- exports */

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export interface ExportContext {
  partnerName: string;
  filter: UsageFilter;
  credentials: PartnerApiCredential[];
  generatedAt?: Date;
}

/** Flat, spreadsheet-ready CSV of the aggregated dashboard. */
export function usageCsv(agg: UsageAggregate, ctx: ExportContext): string {
  const at = (ctx.generatedAt ?? new Date()).toISOString();
  const lines: string[] = [];
  const row = (...cells: unknown[]) => lines.push(cells.map(csvCell).join(","));

  row("TaxiD API Partners — usage analytics export");
  row("Partner", ctx.partnerName);
  row("Generated at (UTC)", at);
  row("Environments", ctx.filter.environments.join(" | ") || "all");
  row("Capability domains", ctx.filter.domains.length ? ctx.filter.domains.join(" | ") : "all");
  row("Date range", `${ctx.filter.from} to ${ctx.filter.to}`);
  row("Credentials in scope", ctx.filter.credentialIds.length ? String(ctx.filter.credentialIds.length) : "all");
  row();

  row("Section", "Requests", "Errors", "Throttled", "Error rate", "Throttle rate");
  row(
    "Totals",
    agg.totals.requests,
    agg.totals.errors,
    agg.totals.throttled,
    agg.totals.errorRate.toFixed(4),
    agg.totals.throttleRate.toFixed(4),
  );
  row();

  row("Daily series");
  row("Date", "Requests", "Errors", "Throttled");
  for (const d of agg.series) row(d.date, d.requests, d.errors, d.throttled);
  row();

  row("By capability domain");
  row("Domain key", "Domain", "Requests", "Errors", "Throttled");
  for (const d of agg.byDomain) row(d.domain, d.label, d.requests, d.errors, d.throttled);
  row();

  row("By environment");
  row("Environment", "Requests", "Errors", "Throttled");
  for (const e of agg.byEnvironment) row(e.environment, e.requests, e.errors, e.throttled);

  return lines.join("\n");
}

export function downloadCsv(contents: string, filename: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportFilename(ctx: ExportContext, ext: "csv" | "pdf"): string {
  const slug = ctx.partnerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "partner";
  return `yalla-api-usage-${slug}-${ctx.filter.from}-to-${ctx.filter.to}.${ext}`;
}

/** Executive PDF of the same aggregate — identical numbers, print-ready. */
export async function exportUsagePdf(agg: UsageAggregate, ctx: ExportContext): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const M = 48;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = M;

  const room = (need: number) => {
    if (y + need > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const line = (text: string, size = 10, bold = false, indent = 0) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const wrapped = doc.splitTextToSize(text, W - M * 2 - indent) as string[];
    room(wrapped.length * (size + 4));
    doc.text(wrapped, M + indent, y);
    y += wrapped.length * (size + 4);
  };
  const rule = () => {
    room(14);
    doc.setDrawColor(200);
    doc.line(M, y, W - M, y);
    y += 12;
  };

  const at = ctx.generatedAt ?? new Date();
  line("TaxiD API PARTNERS", 9, true);
  line("Usage analytics", 18, true);
  line(ctx.partnerName, 11);
  line(`Generated ${at.toISOString()} · aggregated from platform request accounting`, 8);
  rule();

  line("Filter", 11, true);
  line(`Date range: ${ctx.filter.from} to ${ctx.filter.to}`, 9);
  line(`Environments: ${ctx.filter.environments.join(", ") || "all"}`, 9);
  line(`Capability domains: ${ctx.filter.domains.length ? ctx.filter.domains.join(", ") : "all"}`, 9);
  line(
    `Credentials: ${ctx.filter.credentialIds.length ? `${ctx.filter.credentialIds.length} selected` : "all in scope"}`,
    9,
  );
  rule();

  line("Totals", 11, true);
  line(`Requests: ${agg.totals.requests.toLocaleString()}`, 9);
  line(`Errors: ${agg.totals.errors.toLocaleString()} (${(agg.totals.errorRate * 100).toFixed(2)}%)`, 9);
  line(`Throttled: ${agg.totals.throttled.toLocaleString()} (${(agg.totals.throttleRate * 100).toFixed(2)}%)`, 9);
  line(
    agg.p95LatencyMs === null
      ? "p95 latency: not recorded for this window"
      : `p95 latency (worst day in window): ${agg.p95LatencyMs} ms`,
    9,
  );
  line(
    agg.busiestDay
      ? `Busiest day: ${agg.busiestDay.date} (${agg.busiestDay.requests.toLocaleString()} requests)`
      : "No traffic recorded in this window.",
    9,
  );
  rule();

  line("By capability domain", 11, true);
  if (!agg.byDomain.length) line("No traffic recorded.", 9);
  for (const d of agg.byDomain) {
    line(`${d.label} — ${d.requests.toLocaleString()} requests, ${d.errors.toLocaleString()} errors, ${d.throttled.toLocaleString()} throttled`, 9, false, 10);
  }
  rule();

  line("By environment", 11, true);
  if (!agg.byEnvironment.length) line("No traffic recorded.", 9);
  for (const e of agg.byEnvironment) {
    line(`${e.environment} — ${e.requests.toLocaleString()} requests, ${e.errors.toLocaleString()} errors, ${e.throttled.toLocaleString()} throttled`, 9, false, 10);
  }
  rule();

  line("Daily series", 11, true);
  if (!agg.series.length) line("No traffic recorded.", 9);
  for (const d of agg.series) {
    line(`${d.date} — ${d.requests.toLocaleString()} requests · ${d.errors.toLocaleString()} errors · ${d.throttled.toLocaleString()} throttled`, 8, false, 10);
  }

  doc.save(exportFilename(ctx, "pdf"));
}
