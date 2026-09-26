// Downloadable JSON/CSV report generators for a digital twin run.
// Bundles idempotency diffs, readiness breakdown, per-domain rows, drift, and artifacts.

type Row = Record<string, unknown>;

function download(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const header = keys.join(",");
  const body = rows.map((r) => keys.map((k) => csvEscape(r[k])).join(",")).join("\n");
  return header + "\n" + body;
}

export interface RunLike {
  id: string; scale: string; status: string; readiness_score: number | null;
  started_at: string; finished_at: string | null; duration_ms: number | null;
  rows_by_domain: Record<string, number>;
  validation: unknown;
  metadata: {
    readiness_breakdown?: {
      domain_score: number; validation_score: number; total: number;
      domain_ok: number; domain_total: number;
      failing_checks: { name: string; severity: string; detail?: string }[];
      passing_checks: { name: string; weight: number }[];
    };
    idempotency?: {
      ok: boolean;
      before: Record<string, number>; after: Record<string, number>;
      deltas: Record<string, number>;
    };
    drift_domains?: string[];
    drift_by_table?: Record<string, { before: number; after: number; delta: number; domain?: string }>;
    artifacts?: Record<string, { table: string; error: string; attempted: number; sample: Row[] }[]>;
  } | null;
}

export function exportRunJson(run: RunLike) {
  const payload = {
    run_id: run.id, scale: run.scale, status: run.status,
    readiness_score: run.readiness_score,
    started_at: run.started_at, finished_at: run.finished_at, duration_ms: run.duration_ms,
    rows_by_domain: run.rows_by_domain,
    readiness_breakdown: run.metadata?.readiness_breakdown ?? null,
    idempotency: run.metadata?.idempotency ?? null,
    drift_domains: run.metadata?.drift_domains ?? [],
    drift_by_table: run.metadata?.drift_by_table ?? {},
    validation: run.validation,
    artifacts: run.metadata?.artifacts ?? {},
    exported_at: new Date().toISOString(),
  };
  download(`twin-run-${run.id}.json`, "application/json", JSON.stringify(payload, null, 2));
}

export function exportRunCsv(run: RunLike) {
  const sections: string[] = [];
  sections.push(`# Run\nrun_id,${run.id}\nscale,${run.scale}\nstatus,${run.status}\nreadiness_score,${run.readiness_score ?? ""}\nstarted_at,${run.started_at}\nfinished_at,${run.finished_at ?? ""}\nduration_ms,${run.duration_ms ?? ""}`);

  const b = run.metadata?.readiness_breakdown;
  if (b) {
    sections.push("# Readiness breakdown\n" + toCsv([
      { metric: "domain_score", value: b.domain_score, max: 70 },
      { metric: "validation_score", value: b.validation_score, max: 30 },
      { metric: "total", value: b.total, max: 100 },
      { metric: "domains_ok", value: `${b.domain_ok}/${b.domain_total}`, max: "" },
    ]));
    sections.push("# Failing checks\n" + toCsv(b.failing_checks));
    sections.push("# Passing checks\n" + toCsv(b.passing_checks));
  }

  const idem = run.metadata?.idempotency;
  if (idem) {
    const rows = Object.keys(idem.deltas).map((k) => ({
      metric: k, before: idem.before[k], after: idem.after[k], delta: idem.deltas[k],
    }));
    sections.push(`# Idempotency (ok=${idem.ok})\n` + toCsv(rows));
  }

  const dbt = run.metadata?.drift_by_table ?? {};
  if (Object.keys(dbt).length) {
    sections.push("# Drift by table\n" + toCsv(
      Object.entries(dbt).map(([t, v]) => ({ table: t, domain: v.domain ?? "", before: v.before, after: v.after, delta: v.delta }))
    ));
  }

  sections.push("# Rows by domain\n" + toCsv(
    Object.entries(run.rows_by_domain ?? {}).map(([domain, rows]) => ({ domain, rows }))
  ));

  const arts = run.metadata?.artifacts ?? {};
  if (Object.keys(arts).length) {
    const flat = Object.entries(arts).flatMap(([domain, list]) =>
      list.map((a) => ({ domain, table: a.table, attempted: a.attempted, error: a.error, sample: JSON.stringify(a.sample?.[0] ?? {}) }))
    );
    sections.push("# Failure artifacts\n" + toCsv(flat));
  }

  download(`twin-run-${run.id}.csv`, "text/csv", sections.join("\n\n"));
}
