/**
 * Recruitment 360 — Import Batch Console.
 *
 * The decision surface for a migration batch: review queues, duplicate
 * resolution, evidence inspection, commit preview, verification and rollback.
 * Every action here is server-authorised and audited; the console only asks.
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, ShieldAlert, Undo2, FileSearch, PlayCircle, CheckCircle2, Users,
} from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import MigrationQaPanel from "@/components/staff/recruitment/MigrationQaPanel";
import BatchProgressPanel from "@/components/staff/recruitment/BatchProgressPanel";
import ScreeningIntelligencePanel from "@/components/staff/recruitment/ScreeningIntelligencePanel";

import * as mig from "@/lib/recruitment/migration";
import { batchVacancyId } from "@/lib/recruitment/screening";

import * as rec from "@/lib/recruitment/api";

const QUEUES: mig.MigrationQueue[] = [
  "ready", "needs_review", "duplicates", "unmatched_vacancy", "low_confidence", "parsing_failed",
  "approved", "imported", "rejected", "all",
];

const humanise = (v: string) => v.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

const BAND_TONE: Record<string, string> = {
  high: "bg-success/10 text-success border-success/30",
  medium: "bg-warning/10 text-warning-foreground border-warning/30",
  low: "bg-destructive/10 text-destructive border-destructive/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

export default function RecruitmentImportBatchConsole() {
  const { batchId = "" } = useParams();
  const qc = useQueryClient();

  const [queue, setQueue] = useState<mig.MigrationQueue>("ready");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [assignVacancyId, setAssignVacancyId] = useState<string>("");
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackReason, setRollbackReason] = useState("");
  const [historicalTitle, setHistoricalTitle] = useState("");

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["rec", "migration"] });
  };

  const batch = useQuery({
    queryKey: ["rec", "migration", "batch", batchId],
    queryFn: () => mig.getBatch(batchId),
    enabled: !!batchId,
  });
  const rows = useQuery({
    queryKey: ["rec", "migration", "queue", batchId, queue, search],
    queryFn: () => mig.loadQueue(batchId, queue, search),
    enabled: !!batchId,
  });
  const preview = useQuery({
    queryKey: ["rec", "migration", "preview", batchId],
    queryFn: () => mig.previewBatch(batchId),
    enabled: !!batchId,
  });
  const verification = useQuery({
    queryKey: ["rec", "migration", "verify", batchId],
    queryFn: () => mig.verifyBatch(batchId),
    enabled: !!batchId,
  });
  const duplicates = useQuery({
    queryKey: ["rec", "migration", "duplicates", batchId],
    queryFn: () => mig.listDuplicates(batchId),
    enabled: !!batchId,
  });
  const files = useQuery({
    queryKey: ["rec", "migration", "files", batchId],
    queryFn: () => mig.listBatchFiles(batchId),
    enabled: !!batchId,
  });
  const events = useQuery({
    queryKey: ["rec", "migration", "events", batchId],
    queryFn: () => mig.listBatchEvents(batchId),
    enabled: !!batchId,
  });
  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });
  const batchVacancy = useQuery({
    queryKey: ["rec", "migration", "batch-vacancy", batchId],
    queryFn: () => batchVacancyId(batchId),
    enabled: !!batchId,
  });

  const detail = useQuery({
    queryKey: ["rec", "migration", "record", detailId],
    queryFn: () => mig.getRecord(detailId as string),
    enabled: !!detailId,
  });
  const detailDocs = useQuery({
    queryKey: ["rec", "migration", "record-docs", detailId],
    queryFn: () => mig.listRecordDocuments(detailId as string),
    enabled: !!detailId,
  });

  const review = useMutation({
    mutationFn: ({ action, reason, vacancyId, ids }: {
      action: mig.ReviewAction; reason?: string; vacancyId?: string; ids?: string[];
    }) => mig.reviewRecords(ids ?? selected, action, { reason, vacancyId }),
    onSuccess: (result) => {
      toast.success(`${humanise(result.action)} applied to ${result.affected} record(s)`);
      setSelected([]);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolveDup = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "merge" | "keep_separate" }) =>
      mig.resolveDuplicate(id, action),
    onSuccess: () => { toast.success("Duplicate resolved"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const runWorker = useMutation({
    mutationFn: async () => {
      const worker = await mig.runDocumentWorker(batchId, 15);
      const processed = await mig.processBatch(batchId, 500);
      return { worker, processed };
    },
    onSuccess: ({ worker }) => {
      toast.success(`${worker.parsed} document(s) parsed, ${worker.failed} failed`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const commit = useMutation({
    mutationFn: () => mig.commitBatch(batchId, 500),
    onSuccess: (result) => {
      toast.success(`Imported ${result.imported ?? 0} record(s)`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rollback = useMutation({
    mutationFn: () => mig.rollbackBatch(batchId, rollbackReason.trim()),
    onSuccess: () => {
      toast.success("Batch rolled back");
      setRollbackOpen(false);
      setRollbackReason("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createHistorical = useMutation({
    mutationFn: () => mig.createHistoricalVacancy(batchId, historicalTitle.trim()),
    onSuccess: (vacancyId) => {
      toast.success("Historical vacancy created");
      setHistoricalTitle("");
      setAssignVacancyId(vacancyId);
      void qc.invalidateQueries({ queryKey: ["rec", "vacancies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = rows.data ?? [];
  const allSelected = list.length > 0 && selected.length === list.length;

  const vacancyOptions = useMemo(
    () => (vacancies.data ?? []).map((v) => ({ id: v.id, label: v.title })),
    [vacancies.data],
  );

  if (batch.isLoading) {
    return <div className="p-6 lg:p-8 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }
  if (!batch.data) {
    return (
      <div className="p-6 lg:p-8">
        <Alert variant="destructive">
          <AlertTitle>Batch not found</AlertTitle>
          <AlertDescription>This import batch does not exist or you do not have access to it.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const b = batch.data;
  const v = verification.data;

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow={`Batch ${b.batch_no} · ${humanise(b.status)}`}
        title={b.name}
        lede={`Source: ${b.source_platform || humanise(b.source_kind)}${b.source_organization ? ` · ${b.source_organization}` : ""}. Original application status, dates and references are preserved on import.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/staff/recruitment/import">
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                Back to Import Centre
              </Link>
            </Button>
            <Button variant="outline" disabled={runWorker.isPending} onClick={() => runWorker.mutate()}>
              {runWorker.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                : <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />}
              Run extraction and re-processing
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Records staged" value={preview.data?.records ?? 0} />
        <Stat label="Ready to import" value={preview.data?.by_state?.READY_FOR_REVIEW ?? 0} />
        <Stat label="Approved" value={preview.data?.approved ?? 0} />
        <Stat label="Pending duplicates" value={preview.data?.possible_duplicates ?? 0} />
        <Stat label="Exceptions" value={preview.data?.exceptions ?? 0} />
      </div>

      <Tabs defaultValue="records">
        <TabsList className="mb-4">
          <TabsTrigger value="records">Review queues</TabsTrigger>
          <TabsTrigger value="progress">Batch progress</TabsTrigger>
          <TabsTrigger value="duplicates">Duplicate resolution</TabsTrigger>
          <TabsTrigger value="documents">Source documents</TabsTrigger>
          <TabsTrigger value="qa">Forensic QA</TabsTrigger>
          <TabsTrigger value="screening">Screening &amp; adjudication</TabsTrigger>
          <TabsTrigger value="commit">Import &amp; verification</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
        </TabsList>

        <TabsContent value="progress">
          <BatchProgressPanel batchId={batchId} />
        </TabsContent>

        <TabsContent value="screening">
          {batchVacancy.data ? (
            <ScreeningIntelligencePanel
              vacancyId={batchVacancy.data}
              batchId={batchId}
              unresolvedDuplicates={(duplicates.data ?? []).length}
            />
          ) : (
            <Alert>
              <AlertTitle>No screened applications yet</AlertTitle>
              <AlertDescription>
                Commit the batch so candidates and applications exist, then run screening to see
                rankings, discrepancies and the adjudication workflow here.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>


        {/* ------------------------------ records ------------------------------ */}
        <TabsContent value="records">
          <Card>
            <CardHeader className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {QUEUES.map((q) => (
                  <Button
                    key={q}
                    size="sm"
                    variant={queue === q ? "default" : "outline"}
                    onClick={() => { setQueue(q); setSelected([]); }}
                  >
                    {mig.QUEUE_LABELS[q]}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, email, phone or source vacancy"
                  className="w-72"
                  aria-label="Search staged records"
                />
                {selected.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
                    <span className="text-sm font-medium">{selected.length} selected</span>
                    <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ action: "approve" })}>
                      Approve for import
                    </Button>
                    <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ action: "reject", reason: "Rejected during migration review" })}>
                      Reject these records
                    </Button>
                    <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ action: "retry" })}>
                      Retry extraction
                    </Button>
                    <Select value={assignVacancyId} onValueChange={setAssignVacancyId}>
                      <SelectTrigger className="w-56" aria-label="Vacancy to assign">
                        <SelectValue placeholder="Assign to vacancy" />
                      </SelectTrigger>
                      <SelectContent>
                        {vacancyOptions.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <AppButton
                      analytics="rec_migration_assign_vacancy"
                      action="submit"
                      size="sm"
                      variant="outline"
                      disabled={!assignVacancyId || review.isPending}
                      onClick={() => review.mutate({ action: "assign_vacancy", vacancyId: assignVacancyId })}
                    >
                      Apply vacancy mapping
                    </AppButton>
                  </div>
                )}
              </div>
              {queue === "unmatched_vacancy" && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
                  <div>
                    <Label htmlFor="hist-title">Reconstruct a historical vacancy</Label>
                    <Input
                      id="hist-title"
                      value={historicalTitle}
                      onChange={(e) => setHistoricalTitle(e.target.value)}
                      placeholder="e.g. Driver Partner — Nairobi (2024 intake)"
                      className="w-80"
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={!historicalTitle.trim() || createHistorical.isPending}
                    onClick={() => createHistorical.mutate()}
                  >
                    Create historical vacancy record
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {rows.isLoading ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : list.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nothing in the {mig.QUEUE_LABELS[queue].toLowerCase()} queue.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          aria-label="Select all records in this queue"
                          onCheckedChange={(c) => setSelected(c ? list.map((r) => r.id) : [])}
                        />
                      </TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Identity</TableHead>
                      <TableHead>Vacancy</TableHead>
                      <TableHead className="text-right">Match</TableHead>
                      <TableHead>Extraction</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">Evidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((r) => {
                      const band = mig.confidenceBand(r.extraction_confidence);
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Checkbox
                              checked={selected.includes(r.id)}
                              aria-label={`Select ${r.full_name ?? "record"}`}
                              onCheckedChange={(c) =>
                                setSelected((prev) => (c ? [...prev, r.id] : prev.filter((x) => x !== r.id)))
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{r.full_name ?? <span className="text-muted-foreground">Name not evidenced</span>}</div>
                            <div className="text-xs text-muted-foreground">{r.email ?? r.phone ?? "No contact detail"}</div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.identity_match_kind ? (
                              <>
                                <div>{humanise(r.identity_match_kind)}</div>
                                <div className="text-xs text-muted-foreground">
                                  {r.identity_similarity != null ? `${Math.round(Number(r.identity_similarity))}% similarity` : "—"}
                                </div>
                              </>
                            ) : <span className="text-muted-foreground">New identity</span>}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.vacancy_title ?? <span className="text-destructive">Unmatched</span>}
                            {r.vacancy_map_kind && (
                              <div className="text-xs text-muted-foreground">{humanise(r.vacancy_map_kind)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.match_score != null ? `${Math.round(Number(r.match_score))}` : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={BAND_TONE[band]}>
                              {band === "unknown" ? "No document" : `${humanise(band)} confidence`}
                            </Badge>
                            {r.document_count > 0 && (
                              <div className="mt-1 text-xs text-muted-foreground">{r.document_count} document(s)</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{humanise(r.state)}</div>
                            {r.exception_reason && (
                              <div className="text-xs text-destructive">{r.exception_reason}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => setDetailId(r.id)}>
                              <FileSearch className="mr-1 h-4 w-4" aria-hidden="true" />
                              Inspect evidence
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
        </TabsContent>

        {/* ----------------------------- duplicates ---------------------------- */}
        <TabsContent value="duplicates">
          <Card>
            <CardHeader><CardTitle className="text-base">Duplicate resolution — never automatic</CardTitle></CardHeader>
            <CardContent>
              <Alert className="mb-4">
                <AlertTitle>Human decision required</AlertTitle>
                <AlertDescription>
                  The engine detects and explains likely duplicates but never merges candidates on its own. Merging attaches this
                  application and its documents to the existing candidate; keeping them separate creates a new candidate record.
                </AlertDescription>
              </Alert>
              {(duplicates.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No pending duplicate decisions.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Classification</TableHead>
                      <TableHead className="text-right">Similarity</TableHead>
                      <TableHead>Matching signals</TableHead>
                      <TableHead className="text-right">Decision</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(duplicates.data ?? []).map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Badge variant="outline">{humanise(d.classification)}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {d.similarity != null ? `${Math.round(Number(d.similarity))}%` : "—"}
                        </TableCell>
                        <TableCell className="max-w-md text-xs text-muted-foreground">
                          {Object.entries(d.signals ?? {}).map(([k, val]) => `${humanise(k)}: ${String(val)}`).join(" · ") || "—"}
                        </TableCell>
                        <TableCell className="space-x-2 text-right">
                          <Button size="sm" variant="outline" disabled={resolveDup.isPending}
                            onClick={() => resolveDup.mutate({ id: d.id, action: "merge" })}>
                            <Users className="mr-1 h-4 w-4" aria-hidden="true" />
                            Merge into existing candidate
                          </Button>
                          <Button size="sm" variant="ghost" disabled={resolveDup.isPending}
                            onClick={() => resolveDup.mutate({ id: d.id, action: "keep_separate" })}>
                            Keep as a separate candidate
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------- documents ---------------------------- */}
        <TabsContent value="documents">
          <Card>
            <CardHeader><CardTitle className="text-base">Source documents ({(files.data ?? []).length})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Pages</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead>Failure reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(files.data ?? []).map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.original_file_name}</TableCell>
                      <TableCell className="text-sm capitalize">{f.file_kind} · {f.doc_type}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={f.status === "failed" ? BAND_TONE.low : f.status === "parsed" ? BAND_TONE.high : ""}>
                          {humanise(f.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{f.page_count ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.attempts}</TableCell>
                      <TableCell className="max-w-sm text-xs text-destructive">{f.parse_error ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------- commit ----------------------------- */}
        <TabsContent value="commit">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Import preview</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Records staged" value={preview.data?.records ?? 0} />
                <Row label="Approved and ready" value={preview.data?.approved ?? 0} />
                <Row label="New candidates to create" value={preview.data?.new_candidates ?? 0} />
                <Row label="Existing candidates to extend" value={preview.data?.existing_candidates ?? 0} />
                <Row label="Unresolved duplicates" value={preview.data?.possible_duplicates ?? 0} />
                <Row label="Exceptions blocking import" value={preview.data?.exceptions ?? 0} />
                <div className="pt-2">
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Applications by vacancy</div>
                  <ul className="space-y-1">
                    {Object.entries(preview.data?.applications_by_vacancy ?? {}).map(([title, count]) => (
                      <li key={title} className="flex justify-between">
                        <span>{title}</span><span className="tabular-nums">{count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button className="w-full" disabled={commit.isPending || (preview.data?.approved ?? 0) === 0}
                  onClick={() => commit.mutate()}>
                  {commit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Import {preview.data?.approved ?? 0} approved record(s)
                </Button>
                <p className="text-xs text-muted-foreground">
                  Import is idempotent — running it again never duplicates a candidate or an application.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Post-import verification</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Candidates created" value={v?.candidates_created ?? 0} />
                <Row label="Applications created" value={v?.applications_created ?? 0} />
                <Row label="Documents attached" value={v?.documents_attached ?? 0} />
                <Row label="Vacancies linked" value={v?.vacancies_linked ?? 0} />
                <Row label="Duplicates resolved" value={v?.duplicates_resolved ?? 0} />
                <Row label="Records failed" value={v?.records_failed ?? 0} />
                <div className="flex items-center gap-2">
                  {v?.provenance_complete
                    ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                    : <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" />}
                  <span>{v?.provenance_complete ? "Provenance complete on every imported application" : "Provenance incomplete — investigate before closing the batch"}</span>
                </div>
                {(v?.orphan_applications ?? 0) > 0 && (
                  <Alert variant="destructive">
                    <AlertTitle>Orphan applications detected</AlertTitle>
                    <AlertDescription>{v?.orphan_applications} application(s) have no candidate record.</AlertDescription>
                  </Alert>
                )}
                <div className="pt-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!v?.rollback_available}
                    onClick={() => setRollbackOpen(true)}
                  >
                    <Undo2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Roll back this import batch
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Rollback removes only the candidates, applications and documents this batch created. Pre-existing candidate data is never touched, and administrators only.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* -------------------------------- audit ----------------------------- */}
        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle className="text-base">Batch audit trail</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {(events.data ?? []).map((e) => (
                  <li key={e.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{humanise(e.action)}</span>
                      <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                    </div>
                    {e.reason && <p className="mt-1 text-sm text-muted-foreground">{e.reason}</p>}
                    {e.detail && Object.keys(e.detail).length > 0 && (
                      <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-xs">
                        {JSON.stringify(e.detail, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
                {(events.data ?? []).length === 0 && (
                  <li className="py-8 text-center text-sm text-muted-foreground">No audit events recorded yet.</li>
                )}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------- QA -------------------------------- */}
        <TabsContent value="qa">
          <MigrationQaPanel batchId={batchId!} />
        </TabsContent>
      </Tabs>


      {/* ---------------------------- evidence drawer --------------------------- */}
      <Sheet open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Record evidence</SheetTitle>
            <SheetDescription>
              Original source values, inferred fields and the text that supports each inference.
            </SheetDescription>
          </SheetHeader>
          {detail.isLoading ? (
            <div className="mt-6 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : detail.data ? (
            <div className="mt-6 space-y-6 text-sm">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provenance</h3>
                <Row label="Source platform" value={detail.data.source_platform ?? "—"} />
                <Row label="Original status" value={detail.data.source_status ?? "—"} />
                <Row label="Original application date" value={detail.data.source_applied_at ? new Date(detail.data.source_applied_at).toLocaleDateString() : "—"} />
                <Row label="Source candidate reference" value={detail.data.source_candidate_ref ?? "—"} />
                <Row label="Source application reference" value={detail.data.source_application_ref ?? "—"} />
                <Row label="Source vacancy reference" value={detail.data.source_vacancy_ref ?? "—"} />
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Match explanation</h3>
                {detail.data.match_breakdown
                  ? (
                    <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-xs">
                      {JSON.stringify(detail.data.match_breakdown, null, 2)}
                    </pre>
                  )
                  : <p className="text-muted-foreground">Not yet scored.</p>}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Extracted fields and evidence</h3>
                <pre className="max-h-72 overflow-auto rounded bg-muted/50 p-2 text-xs">
                  {JSON.stringify(detail.data.extraction ?? {}, null, 2)}
                </pre>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Original source row</h3>
                <pre className="max-h-56 overflow-auto rounded bg-muted/50 p-2 text-xs">
                  {JSON.stringify(detail.data.raw_payload ?? {}, null, 2)}
                </pre>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attached documents</h3>
                <ul className="space-y-2">
                  {(detailDocs.data ?? []).map((f) => (
                    <li key={f.id} className="flex items-center justify-between rounded border p-2">
                      <span className="truncate">{f.original_file_name}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const url = await mig.documentUrl(f.storage_path);
                          if (url) window.open(url, "_blank", "noopener");
                          else toast.error("Could not open this document");
                        }}
                      >
                        Open source document
                      </Button>
                    </li>
                  ))}
                  {(detailDocs.data ?? []).length === 0 && (
                    <li className="text-muted-foreground">No documents attached to this record.</li>
                  )}
                </ul>
              </section>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => review.mutate({ action: "approve", ids: [detail.data!.id] })}>
                  Approve this record for import
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => review.mutate({ action: "reject", ids: [detail.data!.id], reason: "Rejected on evidence review" })}>
                  Reject this record
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ------------------------------ rollback ------------------------------ */}
      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll back this import batch</DialogTitle>
            <DialogDescription>
              This removes the candidates, applications and documents created by batch {b.batch_no} only. A reason is
              mandatory and is written to the permanent audit trail.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="rollback-reason">Reason for rollback</Label>
            <Textarea
              id="rollback-reason"
              value={rollbackReason}
              onChange={(e) => setRollbackReason(e.target.value)}
              placeholder="e.g. Source file was the wrong campaign export"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackOpen(false)}>Keep this import</Button>
            <Button
              variant="destructive"
              disabled={!rollbackReason.trim() || rollback.isPending}
              onClick={() => rollback.mutate()}
            >
              {rollback.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Confirm rollback of batch {b.batch_no}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between border-b py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
