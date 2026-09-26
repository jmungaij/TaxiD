/**
 * Field-level payment validation surface.
 *
 * Renders the exact blocking field, the server's own sentence and the
 * remediation step, so an executive assistant never has to guess which detail
 * stopped the payment. A collapsible technical debug view exposes the server's
 * decision inputs (sector, manifest requirement, what was actually received)
 * plus numbered instructions, which is what support needs on the first call.
 */
import { useState } from "react";
import { AlertTriangle, ArrowRight, Bug, ChevronDown, Copy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  charterDebugRows,
  charterRemediationSteps,
  type CharterValidationReport,
} from "@/lib/charter/validationErrors";

export function ValidationBlockerAlert({
  report,
  onFocusField,
}: {
  report: CharterValidationReport;
  onFocusField?: (field: string) => void;
}) {
  const [debugOpen, setDebugOpen] = useState(false);
  const rows = charterDebugRows(report);
  const steps = charterRemediationSteps(report);

  const copyDiagnostics = () => {
    const text = [
      `Charter payment validation_failed`,
      `Sector: ${report.sector ?? "unknown"} · manifest required: ${report.manifestRequired ? "yes" : "no"}`,
      ...report.issues.map((i) => `Field ${i.field}: ${i.message}`),
      ...rows.map((r) => `${r.label}: ${r.value}`),
      report.trace ? `Trace: ${report.trace}` : "",
    ].filter(Boolean).join("\n");
    void navigator.clipboard?.writeText(text);
  };

  return (
    <Alert variant="destructive" role="alert" aria-live="assertive" data-testid="validation-blocker">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>
        {report.issues.length === 1
          ? "One detail is blocking payment"
          : `${report.issues.length} details are blocking payment`}
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-2 space-y-2">
          {report.issues.map((issue) => (
            <li key={`${issue.field}-${issue.message}`} className="text-sm">
              <span className="font-semibold">{issue.label}</span>
              <span className="block opacity-90">{issue.message}</span>
              <span className="mt-0.5 flex items-start gap-1 opacity-90">
                <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{issue.fix}</span>
              </span>
              {onFocusField && issue.field !== "unknown" && (
                <button
                  type="button"
                  className="mt-1 text-xs underline"
                  onClick={() => onFocusField(issue.field)}
                >
                  Go to {issue.label.toLowerCase()}
                </button>
              )}
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs opacity-80">
          {report.manifestRequired
            ? "This sector requires a regulated passenger manifest."
            : "Road charters are authorised on the booking contact — no passenger manifest is required."}
          {report.trace ? ` Reference for operations: ${report.trace}` : ""}
        </p>

        <div className="mt-3 border-t border-current/20 pt-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-semibold underline"
            aria-expanded={debugOpen}
            aria-controls="validation-debug-view"
            data-testid="validation-debug-toggle"
            onClick={() => setDebugOpen((o) => !o)}
          >
            <Bug className="h-3.5 w-3.5" aria-hidden="true" />
            {debugOpen ? "Hide technical debug view" : "Show technical debug view"}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${debugOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>

          {debugOpen && (
            <div id="validation-debug-view" data-testid="validation-debug-view" className="mt-2 space-y-3 text-xs">
              <div>
                <p className="font-semibold">Blocking fields</p>
                <ul className="mt-1 space-y-0.5 font-mono opacity-90">
                  {report.issues.map((i) => (
                    <li key={`dbg-${i.field}-${i.message}`}>{i.field} → {i.message}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="font-semibold">Server decision inputs</p>
                {rows.length ? (
                  <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 opacity-90">
                    {rows.map((r) => (
                      <div key={r.label} className="col-span-2 flex justify-between gap-3">
                        <dt>{r.label}</dt>
                        <dd className="font-mono">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-1 opacity-90">The server returned no debug block for this failure.</p>
                )}
              </div>

              <div>
                <p className="font-semibold">How to resolve, step by step</p>
                <ol className="mt-1 space-y-0.5 opacity-90">
                  {steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
              </div>

              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={copyDiagnostics}>
                <Copy className="mr-1 h-3 w-3" aria-hidden="true" /> Copy diagnostics for support
              </Button>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
