/**
 * Failed / retrying export banner shown above the KYB Documents table.
 *
 * Pure presentational component. The parent owns:
 *   - the failure payload (fmt + filters + message + timestamp)
 *   - the `retrying` flag (dedicated to the retry lifecycle; distinct from
 *     any generic "busy" flag so the banner can show a bespoke progress
 *     bar until the download starts)
 *   - the three actions: retry, adjust filters, dismiss
 *
 * The banner MUST preserve `filters` verbatim so "Retry export" re-runs
 * with the exact same parameters and "Adjust filters" reopens the dialog
 * pre-populated with them.
 */
import { Loader2, AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { summarizeFilters, type ExportAuditFilters } from "./exportAuditFilters";

export type ExportError = {
  fmt: "csv" | "pdf";
  filters: ExportAuditFilters;
  message: string;
  at: string;
  /** Idempotency token computed for the failed request. Surfaced in the
   *  debug panel so operators can verify dedupe behaviour and confirm the
   *  retry will collapse to the same audit row. */
  requestToken?: string;
};

export type ExportErrorBannerProps = {
  exportError: ExportError;
  retrying: boolean;
  onRetry: () => void;
  onAdjust: () => void;
  onDismiss: () => void;
};

export function ExportErrorBanner({
  exportError, retrying, onRetry, onAdjust, onDismiss,
}: ExportErrorBannerProps) {
  const fmt = exportError.fmt.toUpperCase();
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 px-5 py-3 bg-status-danger/10 dark:bg-status-danger/20 border-b"
      data-testid="export-error-banner"
      // Announce failure changes to assistive tech. `role=alert` for failed
      // state; while retrying we downgrade to a polite `status` region so
      // the progress update does not preempt the user's screen reader.
      role={retrying ? "status" : "alert"}
      aria-live={retrying ? "polite" : "assertive"}
      aria-atomic="true"
    >
      <div className="text-sm text-status-danger dark:text-status-danger min-w-0">
        <div className="font-semibold flex items-center gap-1.5">
          {retrying
            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" data-testid="export-retry-spinner" aria-hidden="true" />
            : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
          <span data-testid="export-error-title">
            {retrying ? `Retrying ${fmt} export…` : `${fmt} export failed`}
          </span>
        </div>
        {!retrying && (
          <div className="text-xs mt-0.5 break-words" data-testid="export-error-message">
            {exportError.message}
          </div>
        )}
        <div className="text-[11px] mt-0.5 opacity-80" data-testid="export-error-filters">
          Filters preserved: {summarizeFilters(exportError.filters)}
        </div>
        {retrying && (
          <div
            className="text-[11px] mt-1 flex items-center gap-1.5 font-medium"
            data-testid="export-retry-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext="Retry in progress"
            aria-label={`Retrying ${fmt} export — requesting audit rows`}
          >
            <span className="inline-block h-1 w-24 rounded-full bg-status-danger/10 dark:bg-status-danger overflow-hidden" aria-hidden="true">
              <span className="block h-full w-1/2 bg-status-danger animate-pulse" />
            </span>
            Requesting audit rows — the download will start automatically.
          </div>
        )}
        {/* Debug panel — collapsed by default. Exposes the computed
            request token and the raw filter payload so operators can
            verify dedupe and filter persistence at a glance. */}
        <details className="mt-1.5 text-[11px] opacity-90" data-testid="export-error-debug">
          <summary className="cursor-pointer select-none underline decoration-dotted">
            Debug details
          </summary>
          <div className="mt-1 space-y-0.5 font-mono">
            <div data-testid="export-error-debug-token">
              request_token: <span className="break-all">{exportError.requestToken ?? "(unavailable)"}</span>
            </div>
            <div data-testid="export-error-debug-fmt">format: {exportError.fmt}</div>
            <div data-testid="export-error-debug-at">at: {exportError.at}</div>
            <pre
              className="mt-1 whitespace-pre-wrap break-all bg-status-danger/60 dark:bg-status-danger/40 rounded p-1.5"
              data-testid="export-error-debug-filters"
              aria-label="Applied filter payload (JSON)"
            >{JSON.stringify(exportError.filters, null, 2)}</pre>
          </div>
        </details>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm" variant="outline" disabled={retrying} onClick={onAdjust}
          data-testid="export-adjust-btn"
        >
          Adjust filters
        </Button>
        <Button
          size="sm" onClick={onRetry} disabled={retrying} className="gap-1.5"
          data-testid="export-retry-btn"
          aria-label={retrying ? "Retry in progress" : "Retry export"}
        >
          {retrying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {retrying ? "Retrying…" : "Retry export"}
        </Button>
        <Button
          size="sm" variant="ghost" onClick={onDismiss} disabled={retrying} title="Dismiss"
          data-testid="export-dismiss-btn"
          aria-label="Dismiss export error"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
