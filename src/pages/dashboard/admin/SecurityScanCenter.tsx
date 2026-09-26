/**
 * Security Scan Center — post-deployment scan status, findings dashboard,
 * scan history and filtered CSV/PDF export.
 *
 * Data source: `paf_runs` (produced by the `paf-scan` edge function).
 * Composition: certified shared primitives only (Wave Gate v1.0.0).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import {
  ShieldCheck, ShieldAlert, Loader2, RefreshCw, Download, FileText, Radio,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import StatCard from "@/components/common/StatCard";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useDeploymentScan } from "@/hooks/useDeploymentScan";
import {
  SEVERITIES, filterFindings, summarize, toExportRows, trackFindings,
  type ScanRun, type Severity, type TrackedFinding,
} from "@/lib/security/scanFindings";
import {
  APPROVED_REALTIME_TABLES, validateRealtimePublication,
} from "@/lib/security/realtimeAllowlist";
import { AppButton } from "@/components/nav/AppButton";

const sevBadge: Record<Severity, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-warning text-warning-foreground",
  medium: "bg-secondary text-secondary-foreground",
  low: "bg-muted text-muted-foreground",
  info: "bg-muted text-muted-foreground",
};

export default function SecurityScanCenter() {
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<"all" | "open" | "resolved" | "suppressed">("open");
  const [search, setSearch] = useState("");
  const [manualScanning, setManualScanning] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("paf_runs")
      .select("id,ran_at,trigger,scores,risk_register,critical_count,high_count,medium_count,low_count,passed")
      .order("ran_at", { ascending: false })
      .limit(30);
    if (error) toast.error(error.message);
    setRuns((data as unknown as ScanRun[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const deployment = useDeploymentScan(true, load);

  const findings = useMemo(() => trackFindings(runs), [runs]);
  const stats = useMemo(() => summarize(findings), [findings]);
  const categories = useMemo(
    () => [...new Set(findings.map((f) => f.category))].sort(),
    [findings],
  );
  const visible = useMemo(
    () => filterFindings(findings, {
      severities: severity === "all" ? [] : [severity],
      categories: category === "all" ? [] : [category],
      status,
      search,
    }),
    [findings, severity, category, status, search],
  );

  const realtimeViolations = useMemo(() => {
    const tables = findings
      .filter((f) => f.category === "sensitive_realtime" || f.category === "realtime_not_allowlisted")
      .map((f) => f.resource);
    return validateRealtimePublication(tables);
  }, [findings]);

  const runScan = async () => {
    setManualScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("paf-scan", { body: { trigger: "manual" } });
      if (error) throw error;
      toast.success(`Scan complete — ${data?.findings_count ?? 0} finding(s)`);
      await load();
    } catch (e) {
      toast.error((e as Error).message ?? "Scan failed");
    } finally {
      setManualScanning(false);
    }
  };

  const exportCsv = () => {
    if (!visible.length) return toast.error("No findings match the current filters");
    const rows = toExportRows(visible);
    downloadCsv(`security-findings-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast.success(`Exported ${rows.length} finding(s) to CSV`);
  };

  const exportPdf = () => {
    if (!visible.length) return toast.error("No findings match the current filters");
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Yalla Mobility — Security Scan Findings", 14, 14);
    doc.setFontSize(9);
    doc.text(
      `Generated ${new Date().toLocaleString()} · severity: ${severity} · category: ${category} · status: ${status} · ${visible.length} row(s)`,
      14, 20,
    );
    autoTable(doc, {
      startY: 26,
      styles: { fontSize: 7, cellPadding: 1.5 },
      head: [["Severity", "Status", "Resource", "Category", "Message", "First seen", "Resolved"]],
      body: visible.map((f) => [
        f.severity, f.status, f.resource, f.category, f.message,
        f.first_seen_at.slice(0, 19).replace("T", " "),
        f.resolved_at ? f.resolved_at.slice(0, 19).replace("T", " ") : "—",
      ]),
    });
    doc.save(`security-findings-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success(`Exported ${visible.length} finding(s) to PDF`);
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Security Scan Center</h1>
          <p className="text-sm text-muted-foreground">
            Automatic re-scan after every deployment, with findings status, resolution history and audit exports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AppButton analytics="admin_security_scan_findings_csv_download" action="submit" variant="outline" aria-label="Download security scan findings as CSV" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </AppButton>
          <AppButton analytics="admin_security_scan_findings_pdf_download" action="submit" variant="outline" aria-label="Download security scan findings as PDF" onClick={exportPdf}>
            <FileText className="mr-2 h-4 w-4" /> PDF
          </AppButton>
          <Button onClick={runScan} disabled={manualScanning || deployment.running}>
            {manualScanning || deployment.running
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <RefreshCw className="mr-2 h-4 w-4" />}
            Run scan
          </Button>
        </div>
      </header>

      {/* Pass / fail summary */}
      <Card className={stats.passed ? "border-success/40" : "border-destructive/40"}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {stats.passed
              ? <ShieldCheck className="h-8 w-8 text-success" aria-hidden />
              : <ShieldAlert className="h-8 w-8 text-destructive" aria-hidden />}
            <div>
              <CardTitle>{stats.passed ? "PASS — no critical or high findings" : "FAIL — action required"}</CardTitle>
              <CardDescription>
                {runs[0]
                  ? `Last scan ${new Date(runs[0].ran_at).toLocaleString()} · trigger: ${runs[0].trigger}`
                  : "No scans recorded yet"}
                {deployment.running && " · deployment re-scan running…"}
                {deployment.error && ` · deployment re-scan failed: ${deployment.error}`}
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline">build {deployment.buildStamp}</Badge>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Open findings" value={String(stats.open)} icon={<ShieldAlert className="h-5 w-5 text-destructive" />} />
          <StatCard title="Critical / High" value={`${stats.counts.critical} / ${stats.counts.high}`} icon={<ShieldAlert className="h-5 w-5 text-destructive" />} />
          <StatCard title="Resolved" value={String(stats.resolved)} icon={<ShieldCheck className="h-5 w-5 text-success" />} />
          <StatCard title="Suppressed by exception" value={String(stats.suppressed)} icon={<ShieldCheck className="h-5 w-5 text-success" />} />
        </CardContent>
      </Card>

      <Tabs defaultValue="findings">
        <TabsList>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="history">Scan history</TabsTrigger>
          <TabsTrigger value="realtime">Realtime allowlist</TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="space-y-4">
          <Card>
            <CardHeader className="gap-3">
              <CardTitle className="text-base">Filters</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  placeholder="Search resource or message…"
                  aria-label="Search findings"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
                  <SelectTrigger className="w-40" aria-label="Filter by severity">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All severities</SelectItem>
                    {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-52" aria-label="Filter by category">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                  <SelectTrigger className="w-40" aria-label="Filter by status">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="suppressed">Suppressed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Severity</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>First seen</TableHead>
                      <TableHead>Resolved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                          No findings match these filters. Run a scan to refresh the register.
                        </TableCell>
                      </TableRow>
                    )}
                    {visible.map((f: TrackedFinding) => (
                      <TableRow key={f.key}>
                        <TableCell><Badge className={sevBadge[f.severity]}>{f.severity}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{f.resource}</TableCell>
                        <TableCell className="text-xs">{f.category}</TableCell>
                        <TableCell className="max-w-md text-xs">{f.message}</TableCell>
                        <TableCell><Badge variant="outline">{f.status}</Badge></TableCell>
                        <TableCell className="text-xs">{new Date(f.first_seen_at).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">
                          {f.resolved_at ? new Date(f.resolved_at).toLocaleString() : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Previous scans</CardTitle>
              <CardDescription>Last {runs.length} recorded scan runs with pass/fail outcome.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ran at</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Critical</TableHead>
                    <TableHead>High</TableHead>
                    <TableHead>Medium</TableHead>
                    <TableHead>Low</TableHead>
                    <TableHead>Readiness</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                        No scan history yet — run the first scan above.
                      </TableCell>
                    </TableRow>
                  )}
                  {runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{new Date(r.ran_at).toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline">{r.trigger}</Badge></TableCell>
                      <TableCell>
                        <Badge className={r.passed ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"}>
                          {r.passed ? "PASS" : "FAIL"}
                        </Badge>
                      </TableCell>
                      <TableCell>{r.critical_count}</TableCell>
                      <TableCell>{r.high_count}</TableCell>
                      <TableCell>{r.medium_count}</TableCell>
                      <TableCell>{r.low_count}</TableCell>
                      <TableCell>{r.scores?.production_readiness ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="realtime">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4" aria-hidden /> Approved broadcast channels
              </CardTitle>
              <CardDescription>
                Only these tables may be published to client subscriptions. Scans flag any publication member that is
                not on this allowlist.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {realtimeViolations.length > 0 ? (
                <div className="rounded-md border border-destructive/40 p-3 text-sm">
                  <p className="font-medium text-destructive">
                    {realtimeViolations.length} non-allowlisted table(s) detected in the realtime publication
                  </p>
                  <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                    {realtimeViolations.map((v) => <li key={v.name}><span className="font-mono">{v.name}</span> — {v.reason}</li>)}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No allowlist violations in the latest scan register.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {APPROVED_REALTIME_TABLES.map((t) => (
                  <Badge key={t} variant="outline" className="font-mono text-xs">{t}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
