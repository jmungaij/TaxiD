import { AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TaxLoadFailure } from "@/lib/tax/reportErrors";

/**
 * Inline, non-blocking failure surface for tax report panels.
 * Always renders the real upstream reason plus a retry affordance.
 */
export function TaxLoadError({
  failure,
  onRetry,
  busy,
  context,
  retryInSeconds,
  retryReason,
  requestId,
}: {
  failure: TaxLoadFailure;
  onRetry: () => void;
  busy?: boolean;
  context?: string;
  /** Countdown to the next automatic backoff attempt. */
  retryInSeconds?: number | null;
  /** Why the automatic retry was (or was not) scheduled. */
  retryReason?: string | null;
  requestId?: string;
}) {
  const Icon = failure.kind === "permission" ? ShieldAlert : AlertTriangle;
  return (
    <Alert variant="destructive" role="alert" aria-live="polite">
      <Icon className="h-4 w-4" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {failure.title}
        {failure.code && <Badge variant="outline">code {failure.code}</Badge>}
        <Badge variant="outline">{failure.kind}</Badge>
      </AlertTitle>
      <AlertDescription className="space-y-3">
        {context && <p className="text-xs opacity-80">While loading {context}.</p>}
        <p className="text-sm font-medium">{failure.hint}</p>
        <pre className="whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 text-xs font-mono">
          {failure.reason}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
            <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Retrying…" : "Retry"}
          </Button>
          {retryInSeconds != null && (
            <span className="text-xs opacity-90" data-testid="tax-auto-retry-countdown">
              Retrying automatically in {retryInSeconds}s
            </span>
          )}
          {!failure.retryable && (
            <span className="text-xs opacity-80">Retrying alone will not fix this — see the guidance above.</span>
          )}
        </div>
        {retryReason && <p className="text-xs opacity-80">{retryReason}</p>}
        {requestId && <p className="text-[11px] font-mono opacity-70">request id {requestId}</p>}
      </AlertDescription>
    </Alert>
  );
}


export default TaxLoadError;
