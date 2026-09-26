import { AlertTriangle, DatabaseZap, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TaxLoadError } from "@/components/tax/TaxLoadError";
import type { TaxSchemaReport } from "@/lib/tax/schemaContract";

/**
 * Safe fallback for the tax panels.
 *
 * While the preflight runs, a skeleton is shown. If the reporting contract is not
 * satisfied (missing function or missing column), children are never rendered —
 * the operator gets the exact missing objects, the request id for triage, and a
 * retry button, instead of a blank screen or a mid-render crash.
 */
export function TaxSchemaGuard({
  report,
  checking,
  blocked,
  requestId,
  onRecheck,
  children,
  context = "the tax overview",
}: {
  report: TaxSchemaReport | null;
  checking: boolean;
  blocked: boolean;
  requestId: string;
  onRecheck: () => void;
  children: React.ReactNode;
  context?: string;
}) {
  if (checking) {
    return (
      <div className="space-y-3" data-testid="tax-schema-preflight">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (blocked && report) {
    if (report.failure) {
      return (
        <TaxLoadError
          failure={report.failure}
          onRetry={onRecheck}
          context={`the reporting schema check for ${context}`}
          requestId={requestId}
        />
      );
    }

    return (
      <Alert variant="destructive" role="alert" aria-live="polite" data-testid="tax-schema-blocked">
        <DatabaseZap className="h-4 w-4" />
        <AlertTitle className="flex flex-wrap items-center gap-2">
          Reporting schema is out of date
          <Badge variant="outline">contract v{report.contractVersion}</Badge>
          <Badge variant="outline">schema_drift</Badge>
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="text-xs opacity-80">Blocked before rendering {context} to avoid a partial or misleading report.</p>
          <p className="text-sm font-medium">
            The database is missing objects this report depends on. Apply the pending backend
            reporting migrations, then re-run the check.
          </p>
          {report.missingFunctions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Missing functions</p>
              <ul className="text-xs font-mono space-y-0.5">
                {report.missingFunctions.map((f) => <li key={f}>{f}()</li>)}
              </ul>
            </div>
          )}
          {report.missingColumns.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Missing columns</p>
              <ul className="text-xs font-mono space-y-0.5">
                {report.missingColumns.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onRecheck}>
              <RefreshCw className="h-4 w-4 mr-2" />Re-run schema check
            </Button>
            <span className="text-xs opacity-80">
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              This alert was recorded for platform triage.
            </span>
          </div>
          <p className="text-[11px] font-mono opacity-70">request id {requestId}</p>
        </AlertDescription>
      </Alert>
    );
  }

  return <>{children}</>;
}

export default TaxSchemaGuard;
