/**
 * GUIDED BULK LEAD INTAKE — leadership only.
 *
 * Three steps: take the template, put the rows in, then review and import.
 * Every row is checked before anything is sent, problems are named against a
 * line number in plain words, and only clean rows are submitted — so an import
 * never half-succeeds because of a typo. Duplicates already on the desk are
 * skipped by the server rather than merged.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { untypedDb } from "@/integrations/supabase/untyped";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { bulkImportLeads, type BulkImportResult, type BulkImportRow } from "@/lib/sales/journey";
import {
  IMPORT_COLUMNS,
  TEMPLATE_CSV,
  downloadTemplate,
  parseSheet,
  skipReasonLabel,
} from "@/lib/sales/leadImport";

interface Specialist {
  id: string;
  full_name: string;
}

async function listSpecialists(): Promise<Specialist[]> {
  const { data, error } = await untypedDb
    .from("staff_members")
    .select("id,full_name,employment_status")
    .order("full_name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as (Specialist & { employment_status: string })[])
    .filter((s) => s.employment_status !== "exited")
    .map((s) => ({ id: s.id, full_name: s.full_name }));
}

export default function BulkLeadImportPanel() {
  const qc = useQueryClient();
  const [text, setText] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [owners, setOwners] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<BulkImportResult | null>(null);

  const staff = useQuery({ queryKey: ["sales-specialists"], queryFn: listSpecialists });
  const sheet = React.useMemo(() => parseSheet(text), [text]);

  const importer = useMutation({
    mutationFn: () =>
      bulkImportLeads(
        sheet.ready.map((r) => r.row) as BulkImportRow[],
        owners,
        { label: label.trim() || undefined, source: fileName ? "FILE" : "PASTE" },
      ),
    onSuccess: (res) => {
      setResult(res);
      setText("");
      setFileName(null);
      toast({
        title: `${res.created} lead${res.created === 1 ? "" : "s"} added`,
        description: res.skipped ? `${res.skipped} already on the desk and skipped` : undefined,
      });
      void qc.invalidateQueries({ queryKey: ["lead-journey"] });
      void qc.invalidateQueries({ queryKey: ["sales-desk-figures"] });
      void qc.invalidateQueries({ queryKey: ["sales-stage-detail"] });
      void qc.invalidateQueries({ queryKey: ["lead-desk-kpis"] });
    },
    onError: (e: Error) =>
      toast({ title: "Nothing imported", description: e.message, variant: "destructive" }),
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setText(await file.text());
    setFileName(file.name);
    setResult(null);
  };

  const toggle = (id: string) =>
    setOwners((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  const warned = sheet.ready.filter((r) => r.warnings.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add leads in bulk</CardTitle>
        <CardDescription>
          Start from the template so the columns are right. Every row is checked before anything is
          saved — you will see exactly which line has a problem and why.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {/* Step 1 — template */}
        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Step 1 · Take the template
          </p>
          <Button
            size="sm"
            variant="outline"
            data-analytics="sales_lead_import_template_download"
            onClick={() => downloadTemplate()}
          >
            <Download className="mr-1.5 h-4 w-4" aria-hidden /> Download the template
          </Button>
          <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            {IMPORT_COLUMNS.map((c) => (
              <li key={c.key}>
                <span className="font-medium text-foreground">{c.header}</span>
                {c.required ? " (required)" : ""} — {c.hint}
              </li>
            ))}
          </ul>
        </section>

        {/* Step 2 — the rows */}
        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Step 2 · Put the rows in
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grow">
              <Label htmlFor="batch-label">Name this batch (optional)</Label>
              <Input
                id="batch-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Industrial Area walk list, September"
              />
            </div>
            <div>
              <Label htmlFor="lead-csv">Upload the filled template</Label>
              <Input
                id="lead-csv"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={onFile}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="lead-rows">Or paste the rows here</Label>
            <Textarea
              id="lead-rows"
              rows={7}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFileName(null);
                setResult(null);
              }}
              placeholder={TEMPLATE_CSV}
              className="font-mono text-xs"
            />
          </div>
          {fileName && <p className="text-xs text-muted-foreground">Reading {fileName}.</p>}
        </section>

        {/* Step 3 — review */}
        {sheet.rows.length > 0 && (
          <section className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Step 3 · Review before importing
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                {sheet.ready.length} ready
              </Badge>
              {sheet.rejected.length > 0 && (
                <Badge variant="outline" className="border-destructive/30 text-destructive">
                  {sheet.rejected.length} need fixing
                </Badge>
              )}
              {warned.length > 0 && <Badge variant="outline">{warned.length} incomplete</Badge>}
              {sheet.headerDetected && <Badge variant="outline">header row recognised</Badge>}
            </div>

            {sheet.unknownColumns.length > 0 && (
              <p className="text-xs text-muted-foreground">
                These columns were not recognised and were ignored:{" "}
                {sheet.unknownColumns.join(", ")}.
              </p>
            )}

            {sheet.rejected.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="flex items-center gap-1.5 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" aria-hidden /> These rows will not be imported
                </p>
                <ul className="mt-1 space-y-1 text-xs">
                  {sheet.rejected.slice(0, 25).map((r) => (
                    <li key={r.line}>
                      Line {r.line}
                      {r.row.organisation_name ? ` (${r.row.organisation_name})` : ""}:{" "}
                      {r.errors.join("; ")}
                    </li>
                  ))}
                </ul>
                {sheet.rejected.length > 25 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    …and {sheet.rejected.length - 25} more.
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Fix them in your sheet and paste again — the clean rows below can go in now.
                </p>
              </div>
            )}

            {warned.length > 0 && (
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="font-medium">Going in, but incomplete</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {warned.slice(0, 15).map((r) => (
                    <li key={r.line}>
                      Line {r.line} ({r.row.organisation_name}): {r.warnings.join("; ")}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nothing is invented for a blank field.
                </p>
              </div>
            )}
          </section>
        )}

        {/* assignment */}
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Assign to
          </p>
          {staff.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : staff.error ? (
            <p className="text-muted-foreground">
              The staff list could not be read: {(staff.error as Error).message}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(staff.data ?? []).map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded-md border p-2">
                  <Checkbox checked={owners.includes(s.id)} onCheckedChange={() => toggle(s.id)} />
                  <span>{s.full_name}</span>
                </label>
              ))}
            </div>
          )}
          {owners.length > 1 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Leads will be split evenly across the {owners.length} people selected.
            </p>
          )}
          {sheet.ready.length > 0 && owners.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Choose at least one person — a lead is never left without an owner.
            </p>
          )}
        </section>

        <Button
          disabled={sheet.ready.length === 0 || owners.length === 0 || importer.isPending}
          onClick={() => importer.mutate()}
        >
          <Upload className="mr-1.5 h-4 w-4" aria-hidden />
          {importer.isPending
            ? "Importing…"
            : `Import ${sheet.ready.length || ""} clean lead${sheet.ready.length === 1 ? "" : "s"}`}
        </Button>

        {result && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{result.submitted} submitted</Badge>
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                {result.created} created
              </Badge>
              <Badge variant="outline">{result.skipped} skipped</Badge>
            </div>
            {result.skips.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {result.skips.map((s, i) => (
                  <li key={`${s.row}-${i}`}>
                    Row {s.row + 1}
                    {s.organisation ? ` (${s.organisation})` : ""}: {skipReasonLabel(s.reason)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
