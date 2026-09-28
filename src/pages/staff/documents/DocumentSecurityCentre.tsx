/**
 * Document Security Centre — the forensic control plane for every document
 * TaxiD issues. Registry, tamper investigation and the full identity,
 * provenance, distribution and event record for a selected document.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, ShieldAlert } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppButton } from "@/components/nav/AppButton";
import ForensicSecurityPanel from "@/components/documents/ForensicSecurityPanel";
import * as forensics from "@/lib/documents/forensics";
import type { TamperReport } from "@/lib/documents/forensics";

const TONE: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/10 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border",
};

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function DocumentSecurityCentre() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [docNumber, setDocNumber] = useState("");
  const [securityNumber, setSecurityNumber] = useState("");
  const [documentHash, setDocumentHash] = useState("");
  const [report, setReport] = useState<TamperReport | null>(null);
  const [checking, setChecking] = useState(false);

  const metricsQ = useQuery({ queryKey: ["doc-forensics", "metrics"], queryFn: forensics.securityMetrics });
  const marksQ = useQuery({
    queryKey: ["doc-forensics", "marks", search],
    queryFn: () => forensics.listSecurityMarks({ search }),
  });

  const marks = marksQ.data ?? [];
  const selected = useMemo(() => marks.find((m) => m.id === selectedId) ?? null, [marks, selectedId]);
  const metrics = metricsQ.data;

  const runCheck = async () => {
    if (!docNumber.trim()) return;
    setChecking(true);
    try {
      const result = await forensics.tamperCheck({
        docNumber: docNumber.trim(),
        securityNumber: securityNumber.trim() || null,
        documentHash: documentHash.trim() || null,
      });
      setReport(result);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const verdict = report ? forensics.forensicVerdict(report.state) : null;

  return (
    <AdminOnly>
      <div className="space-y-8">
        <StaffPageHeader
          eyebrow="Document OS"
          title="Document Security Centre"
          lede="Forensic identity, provenance and authenticity for every document TaxiD issues."
        />

        {metricsQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : metrics ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Documents issued" value={metrics.documents_generated} />
            <Metric label="Cryptographically sealed" value={metrics.sealed_documents} />
            <Metric label="Restricted profiles" value={metrics.restricted_documents} />
            <Metric label="Integrity failures" value={metrics.integrity_failures} />
          </div>
        ) : null}

        <Tabs defaultValue="registry">
          <TabsList>
            <TabsTrigger value="registry">Registry</TabsTrigger>
            <TabsTrigger value="investigate">Tamper investigation</TabsTrigger>
          </TabsList>

          <TabsContent value="registry" className="space-y-6 pt-4">
            <div className="flex items-end gap-3">
              <div className="max-w-md flex-1">
                <Label htmlFor="doc-registry-search">Search by document, security number or origin</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    id="doc-registry-search"
                    className="pl-8"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="YML-HR-INT-2026-000421"
                  />
                </div>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Issued documents</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {marksQ.isLoading ? (
                  <Skeleton className="m-4 h-32" />
                ) : marks.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground">
                    No documents have been issued a forensic identity yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document number</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Origin</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Profile</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Inspect</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {marks.map((m) => (
                        <TableRow key={m.id} data-state={m.id === selectedId ? "selected" : undefined}>
                          <TableCell className="font-mono text-xs">{m.doc_number}</TableCell>
                          <TableCell>{m.source_system}</TableCell>
                          <TableCell className="font-mono text-xs">{m.origin_ref}</TableCell>
                          <TableCell>V{String(m.doc_version).padStart(2, "0")}</TableCell>
                          <TableCell>{forensics.titleiseCode(m.profile_code)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={TONE[forensics.markStatusTone(m.status)]}>
                              {forensics.titleiseCode(m.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <AppButton
                              analytics="doc_forensics_inspect"
                              action="navigate"
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedId(m.id)}
                            >
                              Inspect document
                            </AppButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {selected && <ForensicSecurityPanel mark={selected} />}
          </TabsContent>

          <TabsContent value="investigate" className="space-y-6 pt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="h-4 w-4 text-primary" aria-hidden /> Verify a presented document
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="tamper-doc">Document number</Label>
                    <Input id="tamper-doc" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="tamper-sec">Security number (optional)</Label>
                    <Input id="tamper-sec" value={securityNumber} onChange={(e) => setSecurityNumber(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="tamper-hash">File hash (optional)</Label>
                    <Input id="tamper-hash" value={documentHash} onChange={(e) => setDocumentHash(e.target.value)} />
                  </div>
                </div>
                <AppButton
                  analytics="doc_forensics_tamper_check"
                  action="submit"
                  size="sm"
                  disabled={!docNumber.trim() || checking}
                  onClick={runCheck}
                >
                  {checking ? "Checking registry…" : "Run forensic check"}
                </AppButton>

                {report && verdict && (
                  <div className="space-y-3 rounded-lg border border-border p-4" role="alert" aria-live="polite">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant="outline" className={TONE[verdict.tone]}>{verdict.label}</Badge>
                      <span className="text-sm text-muted-foreground">
                        Integrity confidence {forensics.integrityConfidence(report.signals ?? [])}%
                      </span>
                    </div>
                    <p className="text-sm">{verdict.advice}</p>
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {(report.signals ?? []).map((s) => (
                        <li key={s.label} className="flex items-center gap-2 text-sm">
                          <span
                            className={`h-2 w-2 rounded-full ${s.passed ? "bg-success" : "bg-destructive"}`}
                            aria-hidden
                          />
                          {s.label}
                          <span className="sr-only">{s.passed ? "passed" : "failed"}</span>
                        </li>
                      ))}
                    </ul>
                    {report.mark && (
                      <p className="font-mono text-xs text-muted-foreground">
                        {report.mark.doc_number} · {report.mark.security_number} · V
                        {String(report.mark.version).padStart(2, "0")} · {report.mark.source_system}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminOnly>
  );
}
