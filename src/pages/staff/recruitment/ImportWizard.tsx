/**
 * Recruitment 360 — Candidate Import Wizard.
 *
 * Four governed stages: declare the source, ingest the files, confirm the
 * column mapping, then stage and extract. Nothing is written to the candidate
 * register here — staging populates a review area only, and the recruiter
 * decides in the batch console what actually becomes a candidate record.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, FileSpreadsheet, FileText, FileArchive, Loader2, Trash2, CheckCircle2,
} from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import * as mig from "@/lib/recruitment/migration";

type Stage = 1 | 2 | 3 | 4;

interface StagedUpload {
  name: string;
  size: number;
  mime: string;
  kind: mig.ParsedFileKind;
  bytes: Uint8Array;
  fromArchive?: string;
}

const NONE = "__none__";

const KIND_ICON: Record<mig.ParsedFileKind, React.ReactNode> = {
  structured: <FileSpreadsheet className="h-4 w-4 text-primary" aria-hidden="true" />,
  document: <FileText className="h-4 w-4 text-primary" aria-hidden="true" />,
  archive: <FileArchive className="h-4 w-4 text-primary" aria-hidden="true" />,
  unknown: <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
};

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function RecruitmentImportWizard() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>(1);
  const [batch, setBatch] = useState<mig.MigrationBatch | null>(null);

  const [form, setForm] = useState({
    name: "",
    source_kind: "mixed" as mig.CreateBatchInput["source_kind"],
    source_platform: "",
    source_organization: "",
    original_campaign: "",
    notes: "",
  });

  const [uploads, setUploads] = useState<StagedUpload[]>([]);
  const [sheet, setSheet] = useState<mig.ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<mig.ColumnMapping>({});
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [ingested, setIngested] = useState<{ registered: number; duplicates: number } | null>(null);
  const [staged, setStaged] = useState<{ inserted: number; already_present: number } | null>(null);
  const [extraction, setExtraction] = useState<{ parsed: number; failed: number; remaining: number | null } | null>(null);

  const documents = useMemo(() => uploads.filter((u) => u.kind === "document"), [uploads]);
  const structured = useMemo(() => uploads.filter((u) => u.kind === "structured"), [uploads]);

  /* ------------------------------- stage 1 ------------------------------- */

  const createBatch = useMutation({
    mutationFn: () =>
      mig.createBatch({
        name: form.name.trim(),
        source_kind: form.source_kind,
        source_platform: form.source_platform.trim() || undefined,
        source_organization: form.source_organization.trim() || undefined,
        original_campaign: form.original_campaign.trim() || undefined,
        notes: form.notes.trim() || undefined,
      }),
    onSuccess: (created) => {
      setBatch(created);
      setStage(2);
      toast.success(`Batch ${created.batch_no} created`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ------------------------------- stage 2 ------------------------------- */

  const onFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const next: StagedUpload[] = [];
    for (const file of Array.from(files)) {
      const buffer = await file.arrayBuffer();
      const kind = mig.classifyUpload(file);
      if (kind === "archive") {
        try {
          const entries = mig.expandArchive(buffer);
          for (const entry of entries) {
            if (entry.kind === "unknown") continue;
            next.push({
              name: entry.name,
              size: entry.bytes.byteLength,
              mime: entry.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
              kind: entry.kind,
              bytes: entry.bytes,
              fromArchive: file.name,
            });
          }
          toast.success(`${file.name}: ${entries.length} entries expanded`);
        } catch {
          toast.error(`${file.name} could not be expanded — the archive may be corrupt`);
        }
        continue;
      }
      if (kind === "unknown") {
        toast.error(`${file.name} is not a supported import format`);
        continue;
      }
      next.push({
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
        kind,
        bytes: new Uint8Array(buffer),
      });
    }

    setUploads((prev) => {
      const seen = new Set(prev.map((p) => `${p.name}:${p.size}`));
      return [...prev, ...next.filter((n) => !seen.has(`${n.name}:${n.size}`))];
    });

    // The first structured file defines the mapping surface.
    const firstSheetFile = next.find((n) => n.kind === "structured");
    if (firstSheetFile && !sheet) {
      try {
        const parsed = mig.parseStructured(
          firstSheetFile.name,
          firstSheetFile.bytes.slice().buffer as ArrayBuffer,
        );
        setSheet(parsed);
        setMapping(mig.suggestMapping(parsed.headers));
      } catch {
        toast.error(`${firstSheetFile.name} could not be read as a spreadsheet`);
      }
    }
  }, [sheet]);

  const ingest = useMutation({
    mutationFn: async () => {
      if (!batch) throw new Error("No batch");
      let registered = 0;
      let duplicates = 0;
      for (let i = 0; i < uploads.length; i++) {
        const file = uploads[i];
        setProgress({ done: i, total: uploads.length, label: file.name });
        const result = await mig.uploadAndRegisterFile(batch.id, file.name, file.bytes, {
          mime: file.mime,
          fileKind: file.kind,
          docType: /cover/i.test(file.name) ? "cover_letter" : "cv",
        });
        if (result.duplicate) duplicates += 1;
        else registered += 1;
      }
      setProgress({ done: uploads.length, total: uploads.length, label: "Complete" });
      return { registered, duplicates };
    },
    onSuccess: (result) => {
      setIngested(result);
      setStage(sheet ? 3 : 4);
      toast.success(`${result.registered} files stored${result.duplicates ? `, ${result.duplicates} already present` : ""}`);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setProgress(null),
  });

  /* ------------------------------- stage 3/4 ----------------------------- */

  const stageRecords = useMutation({
    mutationFn: async () => {
      if (!batch) throw new Error("No batch");
      if (!sheet) return { inserted: 0, already_present: 0, documents_linked: 0 };
      const rows = mig.buildStagePayload(sheet.rows, mapping, form.source_platform.trim() || undefined);
      return await mig.stageRecords(batch.id, rows, mapping);
    },
    onSuccess: (result) => {
      setStaged(result);
      setStage(4);
      toast.success(`${result.inserted} records staged for review`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const extract = useMutation({
    mutationFn: async () => {
      if (!batch) throw new Error("No batch");
      let parsed = 0;
      let failed = 0;
      let remaining: number | null = null;
      // Bounded loop: the worker claims a slice per call and reports what is left.
      for (let pass = 0; pass < 40; pass++) {
        const result = await mig.runDocumentWorker(batch.id, 10);
        parsed += result.parsed;
        failed += result.failed;
        remaining = result.remaining;
        setProgress({
          done: parsed + failed,
          total: parsed + failed + (result.remaining ?? 0),
          label: `Extracting documents — ${parsed + failed} processed`,
        });
        if (result.claimed === 0 || (result.remaining ?? 0) === 0) break;
      }
      await mig.processBatch(batch.id, 500);
      return { parsed, failed, remaining };
    },
    onSuccess: (result) => {
      setExtraction(result);
      toast.success(`Extraction complete — ${result.parsed} parsed, ${result.failed} failed`);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setProgress(null),
  });

  const nameMapped = Boolean(mapping.full_name);
  const busy = createBatch.isPending || ingest.isPending || stageRecords.isPending || extract.isPending;

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow={batch ? `Batch ${batch.batch_no}` : "Recruitment 360"}
        title="New candidate import"
        lede="Historical applications keep their original status, dates and references. Candidates are only created after you approve them in the batch console."
        actions={
          <Button variant="outline" onClick={() => navigate("/staff/recruitment/import")}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Back to Import Centre
          </Button>
        }
      />

      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Import stages">
        {[
          { n: 1, label: "Source declaration" },
          { n: 2, label: "File ingestion" },
          { n: 3, label: "Column mapping" },
          { n: 4, label: "Staging & extraction" },
        ].map((s) => (
          <li key={s.n}>
            <Badge
              variant="outline"
              className={
                stage === s.n
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : stage > s.n
                    ? "border-success/30 bg-success/10 text-success"
                    : "text-muted-foreground"
              }
            >
              {stage > s.n && <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />}
              {s.n}. {s.label}
            </Badge>
          </li>
        ))}
      </ol>

      {stage === 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Declare the source of this data</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="batch-name">Batch name</Label>
              <Input
                id="batch-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. 2024 Driver Recruitment Campaign — legacy applications"
              />
            </div>
            <div>
              <Label htmlFor="source-kind">Source format</Label>
              <Select
                value={form.source_kind}
                onValueChange={(v) => setForm({ ...form, source_kind: v as mig.CreateBatchInput["source_kind"] })}
              >
                <SelectTrigger id="source-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV export</SelectItem>
                  <SelectItem value="xlsx">Excel workbook</SelectItem>
                  <SelectItem value="documents">CV documents only</SelectItem>
                  <SelectItem value="archive">ZIP archive</SelectItem>
                  <SelectItem value="mixed">Mixed data and documents</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="source-platform">Originating platform or system</Label>
              <Input
                id="source-platform"
                value={form.source_platform}
                onChange={(e) => setForm({ ...form, source_platform: e.target.value })}
                placeholder="e.g. BrighterMonday, email inbox, legacy spreadsheet"
              />
            </div>
            <div>
              <Label htmlFor="source-org">Source organisation</Label>
              <Input
                id="source-org"
                value={form.source_organization}
                onChange={(e) => setForm({ ...form, source_organization: e.target.value })}
                placeholder="Who held this data before Yalla Mobility"
              />
            </div>
            <div>
              <Label htmlFor="campaign">Original campaign or intake</Label>
              <Input
                id="campaign"
                value={form.original_campaign}
                onChange={(e) => setForm({ ...form, original_campaign: e.target.value })}
                placeholder="e.g. Nairobi driver intake Q3 2024"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes">Provenance notes</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Where the data came from, who supplied it, and any consent context that applies."
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button disabled={!form.name.trim() || createBatch.isPending} onClick={() => createBatch.mutate()}>
                {createBatch.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Create batch and continue to ingestion
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === 2 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add the source files</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTitle>Supported formats</AlertTitle>
              <AlertDescription>
                CSV and Excel for application data; PDF, DOCX and text for CVs; ZIP archives are expanded automatically.
                Files are addressed by content hash, so re-adding the same file never creates a duplicate. Maximum 15MB per file.
              </AlertDescription>
            </Alert>

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                accept=".csv,.tsv,.xlsx,.xls,.pdf,.docx,.doc,.txt,.rtf,.zip"
                onChange={(e) => { void onFilesSelected(e.target.files); e.target.value = ""; }}
              />
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                Choose import files
              </Button>
              <span className="text-sm text-muted-foreground">
                {structured.length} data file(s), {documents.length} document(s) queued
              </span>
            </div>

            {uploads.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Remove</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploads.map((u, i) => (
                    <TableRow key={`${u.name}-${i}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {KIND_ICON[u.kind]}
                          <span className="font-medium">{u.name}</span>
                        </div>
                        {u.fromArchive && (
                          <div className="text-xs text-muted-foreground">from {u.fromArchive}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm capitalize">{u.kind}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{kb(u.size)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${u.name} from this import`}
                          onClick={() => setUploads((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {progress && (
              <div className="space-y-1">
                <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
                <p className="text-xs text-muted-foreground">{progress.label} ({progress.done}/{progress.total})</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStage(1)}>Back to source declaration</Button>
              <Button disabled={uploads.length === 0 || ingest.isPending} onClick={() => ingest.mutate()}>
                {ingest.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Store files and continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === 3 && sheet && (
        <Card>
          <CardHeader><CardTitle className="text-base">Confirm how source columns map to candidate fields</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {sheet.rows.length} rows detected in <span className="font-medium">{sheet.fileName}</span>.
              Suggestions are heuristic — confirm each mapping before staging. Unmapped columns are still preserved in the raw record.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {mig.MAPPING_TARGETS.map((target) => (
                <div key={target.key}>
                  <Label htmlFor={`map-${target.key}`}>
                    {target.label}
                    {"required" in target && target.required && <span className="text-destructive"> *</span>}
                  </Label>
                  <Select
                    value={mapping[target.key] ?? NONE}
                    onValueChange={(v) =>
                      setMapping((prev) => ({ ...prev, [target.key]: v === NONE ? undefined : v }))
                    }
                  >
                    <SelectTrigger id={`map-${target.key}`}>
                      <SelectValue placeholder="Not mapped" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not mapped</SelectItem>
                      {sheet.headers.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {!nameMapped && (
              <Alert variant="destructive">
                <AlertTitle>Candidate name is required</AlertTitle>
                <AlertDescription>
                  A record cannot be imported without a name. Map the name column, or import the documents only and let extraction supply the identity.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStage(2)}>Back to file ingestion</Button>
              <Button disabled={!nameMapped || stageRecords.isPending} onClick={() => stageRecords.mutate()}>
                {stageRecords.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Stage {sheet.rows.length} records for review
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === 4 && batch && (
        <Card>
          <CardHeader><CardTitle className="text-base">Extraction and identity resolution</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Summary label="Files stored" value={ingested ? `${ingested.registered}` : "—"} hint={ingested?.duplicates ? `${ingested.duplicates} already present` : undefined} />
              <Summary label="Records staged" value={staged ? `${staged.inserted}` : "—"} hint={staged?.already_present ? `${staged.already_present} already staged` : undefined} />
              <Summary
                label="Documents extracted"
                value={extraction ? `${extraction.parsed}` : "—"}
                hint={extraction?.failed ? `${extraction.failed} failed extraction` : undefined}
              />
            </div>

            <Alert>
              <AlertTitle>What happens next</AlertTitle>
              <AlertDescription>
                Extraction reads each CV, infers fields with the supporting text as evidence, then resolves candidate identity,
                classifies possible duplicates and scores each record against the vacancy. Nothing is merged and no candidate is
                created — every decision waits for you in the batch console.
              </AlertDescription>
            </Alert>

            {progress && (
              <div className="space-y-1">
                <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
                <p className="text-xs text-muted-foreground">{progress.label}</p>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => extract.mutate()}>
                {extract.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Run extraction and identity resolution
              </Button>
              <Button onClick={() => navigate(`/staff/recruitment/import/${batch.id}`)}>
                Open the batch review console
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
