/**
 * Forensic QA panel for a candidate migration batch.
 *
 * Re-derives the engine's inferences (confidence, evidence, duplicate bands,
 * scoring, provenance, worker health) and presents every discrepancy with the
 * evidence that proves it, the action to take, and a downloadable report.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import * as mig from "@/lib/recruitment/migration";
import {
  QA_DOMAIN_LABELS, QA_SEVERITY_LABELS, runQaSuite, toDiscrepancyCsv,
  type QaDomain, type QaSeverity,
} from "@/lib/recruitment/migrationQa";

const SEVERITY_TONE: Record<QaSeverity, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  high: "bg-warning/10 text-warning-foreground border-warning/30",
  medium: "bg-muted text-foreground border-border",
  low: "bg-muted/50 text-muted-foreground border-border",
};

export default function MigrationQaPanel({ batchId }: { batchId: string }) {
  const [domainFilter, setDomainFilter] = useState<QaDomain | "all">("all");

  const records = useQuery({
    queryKey: ["rec", "migration", "qa-records", batchId],
    queryFn: () => mig.listBatchRecords(batchId),
  });
  const duplicates = useQuery({
    queryKey: ["rec", "migration", "qa-duplicates", batchId],
    queryFn: () => mig.listDuplicates(batchId, false),
  });
  const files = useQuery({
    queryKey: ["rec", "migration", "files", batchId],
    queryFn: () => mig.listBatchFiles(batchId),
  });
  const counts = useQuery({
    queryKey: ["rec", "migration", "qa-doc-counts", batchId],
    queryFn: () => mig.documentCounts(batchId),
  });

  const loading = records.isLoading || duplicates.isLoading || files.isLoading;

  const report = useMemo(() => runQaSuite({
    records: records.data ?? [],
    duplicates: duplicates.data ?? [],
    files: files.data ?? [],
    documentCounts: counts.data ?? {},
  }), [records.data, duplicates.data, files.data, counts.data]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof report.findings>();
    for (const f of report.findings) {
      if (domainFilter !== "all" && f.domain !== domainFilter) continue;
      const bucket = map.get(f.code) ?? [];
      bucket.push(f);
      map.set(f.code, bucket);
    }
    return [...map.entries()];
  }, [report.findings, domainFilter]);

  const download = (kind: "csv" | "json") => {
    const body = kind === "csv" ? toDiscrepancyCsv(report) : JSON.stringify(report, null, 2);
    const blob = new Blob([body], { type: kind === "csv" ? "text/csv" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `migration-qa-${batchId}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Discrepancy report downloaded as ${kind.toUpperCase()}`);
  };

  const refresh = () => {
    void records.refetch();
    void duplicates.refetch();
    void files.refetch();
    void counts.refetch();
  };

  if (loading) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {report.blocking
                ? <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
                : <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />}
              Extraction and decision integrity
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {report.scanned.records} record(s), {report.scanned.duplicates} duplicate decision(s) and{" "}
              {report.scanned.files} source file(s) independently re-checked.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Re-run QA checks
            </Button>
            <AppButton analytics="rec_migration_qa_download_csv" action="submit" variant="outline" size="sm" onClick={() => download("csv")}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Download discrepancy report (CSV)
            </AppButton>
            <AppButton analytics="rec_migration_qa_download_json" action="submit" variant="ghost" size="sm" onClick={() => download("json")}>
              Download evidence bundle (JSON)
            </AppButton>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-md border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Integrity score</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{report.integrityScore}/100</div>
            </div>
            {(["critical", "high", "medium", "low"] as QaSeverity[]).map((s) => (
              <div key={s} className="rounded-md border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{QA_SEVERITY_LABELS[s]}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{report.countsBySeverity[s]}</div>
              </div>
            ))}
          </div>

          {report.blocking ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Import is not safe yet</AlertTitle>
              <AlertDescription>
                Blocking discrepancies were found. Resolve them before importing — an import that runs over these
                findings can misattribute an application to the wrong person.
              </AlertDescription>
            </Alert>
          ) : report.findings.length === 0 ? (
            <Alert role="status">
              <AlertTitle>No discrepancies detected</AlertTitle>
              <AlertDescription>
                Every confidence score, evidenced field, duplicate classification and match score in this batch is
                internally consistent and fully attributable.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={domainFilter === "all" ? "default" : "outline"} onClick={() => setDomainFilter("all")}>
              All domains ({report.findings.length})
            </Button>
            {(Object.keys(QA_DOMAIN_LABELS) as QaDomain[]).map((d) => (
              <Button
                key={d}
                size="sm"
                variant={domainFilter === d ? "default" : "outline"}
                onClick={() => setDomainFilter(d)}
              >
                {QA_DOMAIN_LABELS[d]} ({report.countsByDomain[d]})
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {grouped.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Discrepancies and required actions</CardTitle></CardHeader>
          <CardContent>
            <Accordion type="multiple">
              {grouped.map(([code, items]) => (
                <AccordionItem key={code} value={code}>
                  <AccordionTrigger>
                    <span className="flex flex-1 flex-wrap items-center gap-2 pr-3 text-left">
                      <Badge variant="outline" className={SEVERITY_TONE[items[0].severity]}>
                        {QA_SEVERITY_LABELS[items[0].severity]}
                      </Badge>
                      <span className="font-medium">{items[0].summary}</span>
                      <span className="text-xs text-muted-foreground">
                        {QA_DOMAIN_LABELS[items[0].domain]} · {items.length} occurrence(s) · {code}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="mb-3 text-sm">
                      <span className="font-medium">Action: </span>{items[0].action}
                    </p>
                    <ul className="space-y-2">
                      {items.slice(0, 25).map((f, i) => (
                        <li key={`${f.code}-${f.recordId ?? f.fileId ?? f.duplicateId ?? i}`} className="rounded border p-2">
                          <div className="text-sm font-medium">{f.subject ?? "Unlabelled subject"}</div>
                          <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-xs">
                            {JSON.stringify(f.evidence, null, 2)}
                          </pre>
                        </li>
                      ))}
                      {items.length > 25 && (
                        <li className="text-xs text-muted-foreground">
                          {items.length - 25} further occurrence(s) — download the report to see them all.
                        </li>
                      )}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
