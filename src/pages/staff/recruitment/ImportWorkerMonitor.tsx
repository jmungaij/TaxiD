/**
 * Recruitment 360 — Document worker monitor.
 *
 * Operational visibility for the CV extraction worker: queue backlog, per-batch
 * and per-file processing state, attempt counts, the last error, and the retry
 * controls that put stuck or failed documents back on the queue.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2, PlayCircle, RefreshCw, RotateCcw } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import * as mig from "@/lib/recruitment/migration";
import { auditFile } from "@/lib/recruitment/migrationQa";

const STATUS_TONE: Record<string, string> = {
  parsed: "bg-success/10 text-success border-success/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  parsing: "bg-warning/10 text-warning-foreground border-warning/30",
  queued: "bg-muted text-foreground border-border",
  stored: "bg-muted/50 text-muted-foreground border-border",
  skipped: "bg-muted/50 text-muted-foreground border-border",
};

const humanise = (v: string) => v.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

function relative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default function RecruitmentImportWorkerMonitor() {
  const qc = useQueryClient();
  const [selectedBatch, setSelectedBatch] = useState<string>("");
  const [fileFilter, setFileFilter] = useState<string>("attention");

  const status = useQuery({
    queryKey: ["rec", "migration", "worker-status"],
    queryFn: () => mig.workerStatus(),
    refetchInterval: 20_000,
  });

  const focusBatch = selectedBatch || status.data?.batches?.[0]?.batch_id || "";

  const files = useQuery({
    queryKey: ["rec", "migration", "files", focusBatch],
    queryFn: () => mig.listBatchFiles(focusBatch),
    enabled: !!focusBatch,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["rec", "migration"] });
  };

  const requeue = useMutation({
    mutationFn: (vars: { fileIds?: string[]; batchId?: string; reason: string }) => mig.requeueFiles(vars),
    onSuccess: (r) => { toast.success(`${r.requeued} document(s) put back on the queue`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const runWorker = useMutation({
    mutationFn: (batchId: string) => mig.runDocumentWorker(batchId, 15),
    onSuccess: (r) => { toast.success(`${r.parsed} parsed, ${r.failed} failed, ${r.remaining ?? 0} still queued`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const totals = status.data?.totals ?? {};
  const batches = status.data?.batches ?? [];

  const visibleFiles = useMemo(() => {
    const all = (files.data ?? []).filter((f) => f.file_kind === "document");
    if (fileFilter === "all") return all;
    if (fileFilter === "attention") return all.filter((f) => f.status === "failed" || f.status === "parsing" || auditFile(f).length > 0);
    return all.filter((f) => f.status === fileFilter);
  }, [files.data, fileFilter]);

  const attentionFileIds = useMemo(
    () => (files.data ?? []).filter((f) => f.status === "failed" || f.status === "parsing").map((f) => f.id),
    [files.data],
  );

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360 · Import operations"
        title="Document worker monitor"
        lede="Live processing state for CV and document extraction across every import batch: backlog, attempt counts, last error and retry controls."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void status.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Refresh worker status
            </Button>
            <Button variant="outline" asChild>
              <Link to="/staff/recruitment/import">Back to Import Centre</Link>
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {[
          { label: "Queued", value: totals.queued ?? 0 },
          { label: "In extraction", value: totals.parsing ?? 0 },
          { label: "Parsed", value: totals.parsed ?? 0 },
          { label: "Failed", value: totals.failed ?? 0 },
          { label: "Retries exhausted", value: totals.exhausted ?? 0 },
          { label: "Stuck over 30 min", value: totals.stuck_parsing ?? 0 },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {(totals.stuck_parsing ?? 0) > 0 && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Documents are stuck in extraction</AlertTitle>
          <AlertDescription>
            {totals.stuck_parsing} document(s) were claimed by a worker run that never finished. Requeue them below so
            they are picked up again.
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Per-batch processing status</CardTitle></CardHeader>
        <CardContent>
          {status.isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : batches.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No import batches have been created yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">Docs</TableHead>
                  <TableHead className="text-right">Queued</TableHead>
                  <TableHead className="text-right">Parsing</TableHead>
                  <TableHead className="text-right">Parsed</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Attempts (max / avg)</TableHead>
                  <TableHead>Oldest pending</TableHead>
                  <TableHead>Last error</TableHead>
                  <TableHead className="text-right">Controls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.batch_id} className={b.batch_id === focusBatch ? "bg-muted/40" : undefined}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left font-medium underline-offset-2 hover:underline"
                        onClick={() => setSelectedBatch(b.batch_id)}
                      >
                        {b.batch_no} · {b.name}
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {humanise(b.status)} · {b.records_pending} record(s) pending · {b.records_exception} exception(s)
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.documents}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.queued}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.parsing}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.parsed}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.failed}{b.exhausted > 0 ? ` (${b.exhausted} exhausted)` : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.max_attempts} / {b.avg_attempts}</TableCell>
                    <TableCell className="text-sm">{relative(b.oldest_pending_at)}</TableCell>
                    <TableCell className="max-w-xs text-xs text-destructive">
                      {b.last_error
                        ? `${b.last_error.file_name}: ${b.last_error.error ?? "no reason recorded"}`
                        : <span className="text-muted-foreground">None</span>}
                    </TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={runWorker.isPending}
                        onClick={() => runWorker.mutate(b.batch_id)}
                      >
                        {runWorker.isPending
                          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          : <PlayCircle className="h-4 w-4" aria-hidden="true" />}
                        <span className="ml-1">Run worker</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={requeue.isPending || (b.failed + b.parsing + b.stored) === 0}
                        onClick={() => requeue.mutate({ batchId: b.batch_id, reason: "Requeued from worker monitor" })}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        <span className="ml-1">Requeue batch</span>
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <Link to={`/staff/recruitment/import/${b.batch_id}`}>Open batch</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Per-file processing status</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={focusBatch} onValueChange={setSelectedBatch}>
              <SelectTrigger className="w-64" aria-label="Batch to inspect">
                <SelectValue placeholder="Select a batch" />
              </SelectTrigger>
              <SelectContent>
                {batches.map((b) => (
                  <SelectItem key={b.batch_id} value={b.batch_id}>{b.batch_no} · {b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fileFilter} onValueChange={setFileFilter}>
              <SelectTrigger className="w-52" aria-label="File status filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="attention">Needs attention</SelectItem>
                <SelectItem value="all">All documents</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="parsing">In extraction</SelectItem>
                <SelectItem value="parsed">Parsed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={requeue.isPending || attentionFileIds.length === 0}
              onClick={() => requeue.mutate({ fileIds: attentionFileIds, reason: "Bulk retry of failed and stuck documents" })}
            >
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              Retry all failed and stuck documents
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!focusBatch ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Select a batch to inspect its documents.</p>
          ) : files.isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : visibleFiles.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No documents match this filter — the worker has nothing outstanding here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead>Queued</TableHead>
                  <TableHead>Last error / QA signal</TableHead>
                  <TableHead className="text-right">Retry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleFiles.map((f) => {
                  const qa = auditFile(f);
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="max-w-xs">
                        <div className="truncate font-medium">{f.original_file_name}</div>
                        <div className="text-xs text-muted-foreground">{f.doc_type} · {f.mime_type ?? "unknown type"}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_TONE[f.status]}>{humanise(f.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.attempts}{f.attempts >= 3 && f.status === "failed" ? " (exhausted)" : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{f.page_count ?? "—"}</TableCell>
                      <TableCell className="text-sm">{relative(f.created_at)}</TableCell>
                      <TableCell className="max-w-sm text-xs">
                        {f.parse_error && <div className="text-destructive">{f.parse_error}</div>}
                        {qa.map((q) => (
                          <div key={q.code} className="text-muted-foreground">{q.summary} — {q.action}</div>
                        ))}
                        {!f.parse_error && qa.length === 0 && <span className="text-muted-foreground">Healthy</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={requeue.isPending || f.status === "parsed"}
                          onClick={() => requeue.mutate({ fileIds: [f.id], reason: `Manual retry of ${f.original_file_name}` })}
                        >
                          <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
                          Retry this document
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
