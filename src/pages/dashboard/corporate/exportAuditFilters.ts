/**
 * Pure helpers for the KYB audit-log export pipeline.
 *
 * Extracted from `Documents.tsx` so the filter enforcement — date range,
 * document types, and status-transition (action) set — can be covered by
 * fast integration tests without spinning up the component tree.
 *
 * The rules mirror the backend query construction 1:1: any change here
 * must be reflected in `runExportAudit` and vice-versa.
 */

export type ExportAuditFilters = {
  /** ISO date (YYYY-MM-DD) inclusive lower bound, or "" for none. */
  fromDate: string;
  /** ISO date (YYYY-MM-DD) inclusive upper bound, or "" for none. */
  toDate: string;
  /** Allowed doc_type values; empty = any. */
  docTypes: string[];
  /** Allowed audit-log action values; empty = any. */
  actions: string[];
};

export type ExportAuditRow = {
  id: string;
  document_id: string | null;
  doc_type: string | null;
  action: string;
  created_at: string;
};

export type ExportViolation = { rowId: string; reason: string };

/**
 * Convert the UI filter into the exact PostgREST bound strings used by the
 * backend query. Kept as a named helper so tests can assert the boundary
 * inclusivity of the range without duplicating the string literals.
 */
export function toRangeBounds(filters: ExportAuditFilters): { fromIso: string | null; toIso: string | null } {
  return {
    fromIso: filters.fromDate ? `${filters.fromDate}T00:00:00` : null,
    toIso: filters.toDate ? `${filters.toDate}T23:59:59` : null,
  };
}

/**
 * Re-validate query results against the requested filters. This is the
 * defence-in-depth check that runs after the backend query so any filter
 * drift (missing index, RLS quirk, PostgREST bug) surfaces as an explicit
 * export failure instead of a silently-wrong CSV.
 */
export function validateExportRows(
  rows: ExportAuditRow[],
  filters: ExportAuditFilters,
): ExportViolation[] {
  const { fromIso, toIso } = toRangeBounds(filters);
  const fromMs = fromIso ? new Date(fromIso).getTime() : null;
  const toMs = toIso ? new Date(toIso).getTime() : null;
  const allowedTypes = filters.docTypes.length ? new Set(filters.docTypes) : null;
  const allowedActions = filters.actions.length ? new Set(filters.actions) : null;

  const violations: ExportViolation[] = [];
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (fromMs !== null && t < fromMs) violations.push({ rowId: r.id, reason: `before from_date (${r.created_at})` });
    if (toMs !== null && t > toMs) violations.push({ rowId: r.id, reason: `after to_date (${r.created_at})` });
    if (allowedTypes && r.doc_type && !allowedTypes.has(r.doc_type))
      violations.push({ rowId: r.id, reason: `doc_type ${r.doc_type} not selected` });
    if (allowedActions && !allowedActions.has(r.action))
      violations.push({ rowId: r.id, reason: `action ${r.action} not selected` });
  }
  return violations;
}

/**
 * Human-readable summary of the applied filters — used in both the export
 * dialog's "Export summary" section and the retry banner so both surfaces
 * describe the same filter set with identical wording.
 */
export function summarizeFilters(filters: ExportAuditFilters): string {
  const parts: string[] = [];
  if (filters.fromDate || filters.toDate) {
    parts.push(`${filters.fromDate || "…"} → ${filters.toDate || "…"}`);
  } else {
    parts.push("all dates");
  }
  parts.push(`${filters.docTypes.length || "all"} type${filters.docTypes.length === 1 ? "" : "s"}`);
  parts.push(`${filters.actions.length || "all"} action${filters.actions.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
