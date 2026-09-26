/**
 * Security scan findings model.
 *
 * Normalizes `paf_runs` rows (produced by the `paf-scan` edge function) into a
 * flat, filterable findings list with lifecycle timestamps:
 *   • first_seen_at — the oldest scan in which the finding appeared
 *   • last_seen_at  — the most recent scan in which it appeared
 *   • resolved_at   — the scan time at which it stopped appearing (if resolved)
 */

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export interface RawFinding {
  severity: Severity;
  resource: string;
  category: string;
  message: string;
  remediation_sql?: string;
  suppressed_by_exception?: string;
}

export interface ScanRun {
  id: string;
  ran_at: string;
  trigger: string;
  scores: Record<string, number> | null;
  risk_register: RawFinding[] | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  passed: boolean;
}

export interface TrackedFinding extends RawFinding {
  key: string;
  status: "open" | "resolved" | "suppressed";
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  occurrences: number;
}

const keyOf = (f: RawFinding) => `${f.resource}::${f.category}`;

/**
 * Build the tracked findings list. `runs` may be in any order; newest run
 * defines the current status.
 */
export function trackFindings(runs: ScanRun[]): TrackedFinding[] {
  const ordered = [...runs].sort((a, b) => a.ran_at.localeCompare(b.ran_at));
  if (ordered.length === 0) return [];
  const latest = ordered[ordered.length - 1];
  const map = new Map<string, TrackedFinding>();

  for (const run of ordered) {
    for (const f of run.risk_register ?? []) {
      const key = keyOf(f);
      const existing = map.get(key);
      if (existing) {
        existing.last_seen_at = run.ran_at;
        existing.occurrences += 1;
        existing.severity = f.severity;
        existing.message = f.message;
        existing.remediation_sql = f.remediation_sql;
        existing.suppressed_by_exception = f.suppressed_by_exception;
        existing.resolved_at = null;
      } else {
        map.set(key, {
          ...f,
          key,
          status: "open",
          first_seen_at: run.ran_at,
          last_seen_at: run.ran_at,
          resolved_at: null,
          occurrences: 1,
        });
      }
    }
    // Anything not present in this run is resolved as of this run.
    const present = new Set((run.risk_register ?? []).map(keyOf));
    for (const t of map.values()) {
      if (!present.has(t.key) && t.resolved_at === null && t.last_seen_at < run.ran_at) {
        t.resolved_at = run.ran_at;
      }
    }
  }

  for (const t of map.values()) {
    if (t.resolved_at) t.status = "resolved";
    else if (t.suppressed_by_exception) t.status = "suppressed";
    else t.status = "open";
  }

  void latest;
  return [...map.values()].sort(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.resource.localeCompare(b.resource),
  );
}

export interface FindingFilters {
  severities: Severity[];
  categories: string[];
  status: "all" | "open" | "resolved" | "suppressed";
  search?: string;
}

export function filterFindings(findings: TrackedFinding[], filters: FindingFilters): TrackedFinding[] {
  const q = filters.search?.trim().toLowerCase();
  return findings.filter((f) => {
    if (filters.severities.length && !filters.severities.includes(f.severity)) return false;
    if (filters.categories.length && !filters.categories.includes(f.category)) return false;
    if (filters.status !== "all" && f.status !== filters.status) return false;
    if (q && !`${f.resource} ${f.category} ${f.message}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function summarize(findings: TrackedFinding[]) {
  const open = findings.filter((f) => f.status === "open");
  const counts = SEVERITIES.reduce<Record<Severity, number>>((acc, s) => {
    acc[s] = open.filter((f) => f.severity === s).length;
    return acc;
  }, {} as Record<Severity, number>);
  return {
    open: open.length,
    resolved: findings.filter((f) => f.status === "resolved").length,
    suppressed: findings.filter((f) => f.status === "suppressed").length,
    counts,
    passed: counts.critical === 0 && counts.high === 0,
  };
}

/** Flat rows for CSV / PDF export. */
export function toExportRows(findings: TrackedFinding[]) {
  return findings.map((f) => ({
    severity: f.severity,
    status: f.status,
    resource: f.resource,
    category: f.category,
    message: f.message,
    first_seen_at: f.first_seen_at,
    last_seen_at: f.last_seen_at,
    resolved_at: f.resolved_at ?? "",
    occurrences: f.occurrences,
    remediation_sql: f.remediation_sql ?? "",
  }));
}

export const EXPORT_COLUMNS = [
  "severity",
  "status",
  "resource",
  "category",
  "message",
  "first_seen_at",
  "last_seen_at",
  "resolved_at",
  "occurrences",
] as const;
