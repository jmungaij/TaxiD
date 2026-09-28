/**
 * Export job history (admin).
 *
 * Every scheduled CSV/PDF report delivery run: artifact download links, retry
 * status with the next retry time, and failure alerts for runs that exhausted
 * their attempts.
 */
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SeoHead } from "@/components/seo/SeoHead";
import { AlertTriangle, Download, FileClock, RefreshCw, RotateCw } from "lucide-react";
import {
  artifactDownloadUrl, formatBytes, isRetryable, jobStateLabel, loadExportJobs,
  retryExportJob, runPendingRetries, type ExportJob,
} from "@/lib/corporate/exportJobs";
import { AppButton } from "@/components/nav/AppButton";

const STATUS_TONE: Record<string, string> = {
  delivered: "bg-primary/15 text-primary border-primary/30",
  generated: "bg-muted text-muted-foreground",
  retry_scheduled: "bg-status-warning/15 text-status-warning border-status-warning/30 dark:text-status-warning",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};

const ts = (v: string | null) => (v ? new Date(v).toLocaleString("en-KE") : "—");

export default function ExportJobHistory() {
  const [jobs, setJobs] = React.useState<ExportJob[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState("all");
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setJobs(await loadExportJobs());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load export runs");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const filtered = React.useMemo(
    () => (status === "all" ? jobs : jobs.filter((j) => j.status === status)),
    [jobs, status],
  );
  const exhausted = React.useMemo(
    () => jobs.filter((j) => j.status === "failed" && j.attempt >= j.max_attempts),
    [jobs],
  );

  const download = async (job: ExportJob) => {
    setBusy(job.id);
    const { url, error } = await artifactDownloadUrl(job);
    setBusy(null);
    if (error || !url) { toast.error(error ?? "No artifact available"); return; }
    window.open(url, "_blank", "noopener,noreferrer");
    toast.success("Signed download link opened (valid 5 minutes)");
  };

  const retry = async (job: ExportJob) => {
    setBusy(job.id);
    const { error } = await retryExportJob(job);
    setBusy(null);
    if (error) { toast.error(error); return; }
    toast.success("Retry queued");
    void load();
  };

  const drain = async () => {
    setBusy("drain");
    const { error, processed } = await runPendingRetries();
    setBusy(null);
    if (error) { toast.error(error); return; }
    toast.success(`Processed ${processed ?? 0} pending retr${processed === 1 ? "y" : "ies"}`);
    void load();
  };

  return (
    <div className="space-y-6">
      <SeoHead
        title="Export Job History | TaxiD"
        description="Scheduled report export runs with artifact downloads, retry status and failure alerts."
        path="/dashboard/admin/export-jobs"
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FileClock className="h-5 w-5" aria-hidden /> Export job history
          </h1>
          <p className="text-sm text-muted-foreground">
            Artifacts are stored privately — downloads use short-lived signed links and are counted.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[190px]" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All runs</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="generated">Generated</SelectItem>
              <SelectItem value="retry_scheduled">Retry scheduled</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => void drain()} disabled={busy === "drain"}>
            <RotateCw className={`mr-1 h-4 w-4 ${busy === "drain" ? "animate-spin" : ""}`} aria-hidden /> Run due retries
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </header>

      {exhausted.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>{exhausted.length} scheduled deliver{exhausted.length === 1 ? "y" : "ies"} failed</AlertTitle>
          <AlertDescription>
            {exhausted.slice(0, 3).map((j) => (
              <div key={j.id} className="text-xs">
                {j.report_key} · {j.error ?? j.last_error_code ?? "unknown error"} · {ts(j.created_at)}
              </div>
            ))}
            Retries are exhausted — fix the cause, then retry manually.
          </AlertDescription>
        </Alert>
      )}

      {loading && jobs.length === 0 ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">No export runs recorded yet.</CardContent></Card>
      ) : (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Runs ({filtered.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-3">Report</th>
                  <th className="py-2 pr-3">Format</th>
                  <th className="py-2 pr-3">Rows</th>
                  <th className="py-2 pr-3">Size</th>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2 pr-3">Next retry</th>
                  <th className="py-2 pr-3">Recipients</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((j) => (
                  <tr key={j.id} className="border-b border-border/40">
                    <td className="py-2 pr-3 whitespace-nowrap">{ts(j.created_at)}</td>
                    <td className="py-2 pr-3">{j.report_key}</td>
                    <td className="py-2 pr-3 uppercase">{j.format}</td>
                    <td className="py-2 pr-3 tabular-nums">{j.row_count}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatBytes(j.artifact_bytes || j.csv_bytes)}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className={STATUS_TONE[j.status] ?? STATUS_TONE.generated}>
                        {jobStateLabel(j)}
                      </Badge>
                      {j.error && <div className="mt-1 max-w-[240px] text-xs text-destructive">{j.error}</div>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{ts(j.next_retry_at)}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{j.recipients.join(", ") || "—"}</td>
                    <td className="py-2 pr-3">
                      <div className="flex justify-end gap-1">
                        <AppButton analytics="admin_export_job_artifact_download" action="submit"
                          size="sm" variant="outline" disabled={!j.artifact_path || busy === j.id}
                          aria-label="Download export job artefact"
                          onClick={() => void download(j)}
                        >
                          <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> CSV/PDF
                        </AppButton>
                        {isRetryable(j) && (
                          <Button size="sm" variant="ghost" disabled={busy === j.id} onClick={() => void retry(j)}>
                            <RotateCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Retry
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
