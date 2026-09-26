/**
 * "Export summary" card shown inside the KYB audit export dialog.
 *
 * Pure presentational component — no supabase, no state fetching — so it
 * can be exhaustively unit tested with React Testing Library. The parent
 * (`Documents.tsx`) owns the state and passes it in.
 *
 * Responsibilities:
 *   - render the applied filter summary (delegates to `summarizeFilters`)
 *   - render Expected rows (from the pre-flight HEAD count)
 *   - render Last exported (from the previous successful export)
 *   - show a Δ badge when the two counts diverge, so the operator knows
 *     the backend row count shifted between preview and download
 */
import { Loader2 } from "lucide-react";
import { summarizeFilters, type ExportAuditFilters } from "./exportAuditFilters";

export type ExportSummaryProps = {
  filters: ExportAuditFilters;
  selectedCount: number;
  totalCount: number;
  preview: { loading: boolean; expected: number | null; error: string | null };
  lastExportActual: number | null;
  onRefresh: () => void;
};

export function ExportSummary({
  filters, selectedCount, totalCount, preview, lastExportActual, onRefresh,
}: ExportSummaryProps) {
  const delta = lastExportActual !== null && preview.expected !== null
    ? lastExportActual - preview.expected : null;

  return (
    <div
      className="rounded-md border bg-muted/30 p-3 text-xs space-y-1.5"
      data-testid="export-summary"
      role="region"
      aria-labelledby="export-summary-heading"
    >
      <div
        id="export-summary-heading"
        className="font-semibold text-foreground flex items-center justify-between"
      >
        <span>Export summary</span>
        <button
          type="button"
          onClick={onRefresh}
          className="text-primary hover:underline disabled:opacity-50"
          disabled={preview.loading}
          data-testid="export-summary-refresh"
          aria-label={preview.loading ? "Refreshing expected row count" : "Refresh expected row count"}
        >
          {preview.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="text-muted-foreground" data-testid="export-summary-filters">
        Filters: {summarizeFilters(filters)}
      </div>
      <div className="text-muted-foreground" data-testid="export-summary-scope">
        Scope: {selectedCount > 0
          ? `${selectedCount} selected document(s)`
          : `all ${totalCount} document(s)`}
      </div>

      <div
        className="flex items-center gap-4 pt-1"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div>
          <div className="text-[10px] uppercase text-muted-foreground" id="export-summary-expected-label">Expected rows</div>
          <div
            className="text-sm font-semibold"
            data-testid="export-summary-expected"
            aria-labelledby="export-summary-expected-label"
          >
            {preview.loading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" data-testid="export-summary-expected-loading" aria-label="Loading expected row count" />
              : preview.error
                ? <span className="text-status-danger">error</span>
                : preview.expected ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground" id="export-summary-actual-label">Last exported</div>
          <div
            className="text-sm font-semibold"
            data-testid="export-summary-actual"
            aria-labelledby="export-summary-actual-label"
          >
            {lastExportActual ?? "—"}
            {delta !== null && delta !== 0 && (
              <span
                className="ml-1 text-[10px] text-status-warning"
                title="Backend count changed since preview"
                data-testid="export-summary-delta"
                role="note"
                aria-label={`Backend row count changed by ${delta > 0 ? "+" : ""}${delta} since the preview`}
              >
                Δ {delta > 0 ? `+${delta}` : delta}
              </span>
            )}
          </div>
        </div>
      </div>

      {preview.error && (
        <div className="text-status-danger text-[11px]" data-testid="export-summary-preview-error" role="alert">
          Preview failed: {preview.error}
        </div>
      )}
    </div>
  );
}
