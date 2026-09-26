import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Clock, RefreshCw, Stethoscope, XCircle } from "lucide-react";
import { classifyTaxError, type TaxLoadFailure } from "@/lib/tax/reportErrors";
import { TaxLoadError } from "@/components/tax/TaxLoadError";
import { fetchTaxSyncRuns, type TaxSyncRun } from "@/lib/tax/syncRunAudit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type HealthEvent = {
  id?: string;
  invoice_id?: string | null;
  event_type?: string;
  response_status?: number | null;
  error_message?: string | null;
  created_at?: string;
};

type Health = {
  last_success?: HealthEvent | null;
  last_error?: HealthEvent | null;
  next_retry_at?: string | null;
  retry_by_status?: Record<string, number>;
  events_by_type?: Record<string, number>;
};

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("en-KE") : "—");

const relative = (d?: string | null) => {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  const mins = Math.round(Math.abs(ms) / 60000);
  const label = mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`;
  return ms >= 0 ? `in ${label}` : `${label} ago`;
};

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Tax report diagnostics: runs tax_report_sync_health and surfaces the last
 * successful eTIMS run, the last error and the next scheduled retry.
 */
export function TaxDiagnosticsPanel({ from, to }: { from?: string; to?: string }) {
  const [data, setData] = useState<Health | null>(null);
  const [failure, setFailure] = useState<TaxLoadFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const [runs, setRuns] = useState<TaxSyncRun[]>([]);

  const run = useCallback(async () => {
    setBusy(true);
    const { data: res, error } = await supabase.rpc("tax_report_sync_health", {
      _from: from ?? todayISO(-7),
      _to: to ?? todayISO(),
    });
    setBusy(false);
    setRanAt(new Date());
    fetchTaxSyncRuns(undefined, 25).then(setRuns).catch(() => setRuns([]));
    if (error) {
      setFailure(classifyTaxError(error));
      return;
    }
    setFailure(null);
    setData((res ?? {}) as Health);
  }, [from, to]);

  useEffect(() => { void run(); }, [run]);


  const lastSuccess = data?.last_success ?? null;
  const lastError = data?.last_error ?? null;
  const nextRetry = data?.next_retry_at ?? null;
  const pending = data?.retry_by_status?.PENDING ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Stethoscope className="h-4 w-4" />Tax report diagnostics
        </CardTitle>
        <div className="flex items-center gap-2">
          {ranAt && <span className="text-xs text-muted-foreground">Checked {ranAt.toLocaleTimeString("en-KE")}</span>}
          <Button size="sm" variant="outline" onClick={run} disabled={busy}>
            <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />Run check
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {failure && <TaxLoadError failure={failure} onRetry={run} busy={busy} context="tax sync diagnostics" />}
        {!failure && busy && !data && <Skeleton className="h-24 w-full" />}
        {!failure && data && (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" />Last successful run
              </div>
              <div className="text-sm font-semibold">{fmt(lastSuccess?.created_at)}</div>
              <div className="text-xs text-muted-foreground">
                {lastSuccess?.event_type ? <Badge variant="secondary">{lastSuccess.event_type}</Badge> : "No successful sync recorded."}
                {lastSuccess?.created_at && <span className="ml-2">{relative(lastSuccess.created_at)}</span>}
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <XCircle className="h-3.5 w-3.5" />Last error
              </div>
              <div className="text-sm font-semibold">{fmt(lastError?.created_at)}</div>
              {lastError ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="destructive">{lastError.event_type}</Badge>
                    {lastError.response_status != null && <Badge variant="outline">HTTP {lastError.response_status}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground break-words">{lastError.error_message ?? "No message captured."}</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No errors in this window.</p>
              )}
            </div>

            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />Next scheduled retry
              </div>
              <div className="text-sm font-semibold">{fmt(nextRetry)}</div>
              <div className="text-xs text-muted-foreground">
                {nextRetry ? `${relative(nextRetry)} · ${pending} queued` : pending ? `${pending} queued, no schedule set` : "Retry queue is empty."}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Sync run audit trail (immutable · last {runs.length || 0} runs)
          </p>
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="text-right">Attempt</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Last error</TableHead>
                  <TableHead>Triggered by</TableHead>
                  <TableHead>Request id</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">
                      No recorded runs yet.
                    </TableCell>
                  </TableRow>
                )}
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{fmt(r.created_at)}</TableCell>
                    <TableCell className="text-xs font-mono">{r.report}</TableCell>
                    <TableCell className="text-xs"><Badge variant="outline">{r.trigger_source}</Badge></TableCell>
                    <TableCell className="text-xs text-right">
                      {r.attempt}{r.backoff_ms ? ` · +${Math.round(r.backoff_ms / 1000)}s` : ""}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "success" ? "secondary" : "destructive"}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-xs truncate">
                      {(r.last_error?.reason as string) ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.triggered_by_email ?? r.triggered_by?.slice(0, 8) ?? "—"}</TableCell>
                    <TableCell className="text-[11px] font-mono">{r.request_id}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>

  );
}

export default TaxDiagnosticsPanel;
