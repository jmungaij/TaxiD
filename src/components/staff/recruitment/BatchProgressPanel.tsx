/**
 * Recruitment 360 — batch progress panel.
 *
 * One honest view of where a migration batch actually is: per-file upload and
 * extraction state, migration record states, and screening run completion.
 * Everything is server-computed by `rec_migration_batch_progress`.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, AlertTriangle, FileCheck2, Gauge } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppButton } from "@/components/nav/AppButton";

import { loadBatchProgress, progressLanes } from "@/lib/recruitment/screening";

const FILE_TONE: Record<string, string> = {
  parsed: "bg-success/10 text-success border-success/30",
  stored: "bg-muted text-muted-foreground border-border",
  queued: "bg-info/10 text-info border-info/30",
  parsing: "bg-info/10 text-info border-info/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  skipped: "bg-warning/10 text-warning-foreground border-warning/30",
};

const humanise = (v: string) => v.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
const kb = (n: number | null) => (n == null ? "—" : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function BatchProgressPanel({ batchId }: { batchId: string }) {
  const qc = useQueryClient();
  const progress = useQuery({
    queryKey: ["rec", "migration", "progress", batchId],
    queryFn: () => loadBatchProgress(batchId),
    enabled: !!batchId,
    refetchInterval: 20_000,
  });

  if (progress.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (progress.error || !progress.data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Progress unavailable</AlertTitle>
        <AlertDescription>
          {progress.error instanceof Error ? progress.error.message : "Could not read batch progress."}
        </AlertDescription>
      </Alert>
    );
  }

  const p = progress.data;
  const lanes = progressLanes(p);
  const s = p.screening;
  const failedFiles = (p.files ?? []).filter((f) => f.status === "failed");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{p.batch.name}</h3>
          <p className="text-sm text-muted-foreground">
            {p.batch.batch_no} · status {humanise(p.batch.status)}
            {p.batch.started_at ? ` · started ${new Date(p.batch.started_at).toLocaleString()}` : ""}
          </p>
        </div>
        <AppButton
          analytics="rec_batch_progress_refresh"
          action="submit"
          variant="outline"
          size="sm"
          onClick={() => void qc.invalidateQueries({ queryKey: ["rec", "migration", "progress", batchId] })}
          aria-label="Refresh batch progress"
        >
          {progress.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh progress
        </AppButton>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {lanes.map((lane) => (
          <Card key={lane.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{lane.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">{lane.done}</span>
                <span className="text-sm text-muted-foreground">of {lane.total}</span>
              </div>
              <Progress value={lane.pct} aria-label={`${lane.label} ${lane.pct}% complete`} />
              <p className="text-xs text-muted-foreground">{lane.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" /> Screening run
          </CardTitle>
          <Badge variant="outline">
            {s.evaluated} of {s.applications} evaluated
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Applications", s.applications],
            ["Evaluated", s.evaluated],
            ["Awaiting run", s.pending],
            ["Eligible", s.eligible],
            ["Requires review", s.requires_review],
            ["Gate failures", s.not_eligible],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{Number(value)}</p>
            </div>
          ))}
          <div className="sm:col-span-3 lg:col-span-6 flex flex-wrap gap-4 border-t border-border pt-3 text-sm text-muted-foreground">
            <span>Average score: {s.avg_score == null ? "—" : Number(s.avg_score).toFixed(1)}</span>
            <span>Manual adjudications recorded: {s.adjudications}</span>
            <span>
              Record states:{" "}
              {Object.entries(p.records?.by_state ?? {})
                .map(([k, v]) => `${humanise(k)} ${v}`)
                .join(" · ") || "none"}
            </span>
          </div>
        </CardContent>
      </Card>

      {failedFiles.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{failedFiles.length} file(s) failed extraction</AlertTitle>
          <AlertDescription>
            Retry them from the worker monitor; the last error for each is shown in the table below.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck2 className="h-4 w-4" /> Per-file status
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Upload / extraction</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Text</TableHead>
                <TableHead>Linked candidate</TableHead>
                <TableHead>Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(p.files ?? []).map((f) => (
                <TableRow key={f.file_id}>
                  <TableCell className="max-w-[18rem] truncate font-medium">{f.file_name}</TableCell>
                  <TableCell>{humanise(f.doc_type)}</TableCell>
                  <TableCell className="tabular-nums">{kb(f.size_bytes)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={FILE_TONE[f.status] ?? ""}>
                      {humanise(f.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{f.attempts}</TableCell>
                  <TableCell>{f.text_extracted ? "Extracted" : "None"}</TableCell>
                  <TableCell>{f.candidate_name ?? "Unlinked"}</TableCell>
                  <TableCell className="max-w-[16rem] truncate text-destructive">
                    {f.parse_error ?? ""}
                  </TableCell>
                </TableRow>
              ))}
              {(p.files ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No files registered for this batch yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
