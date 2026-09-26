/**
 * Security findings console.
 *
 * Summarises every tracked scanner finding by `internal_id` — severity,
 * lifecycle status (open / fixed / regressed / ignored), first & last seen,
 * and the last scan time — plus the scheduled re-scan history and the
 * sensitive-read audit trail for role-restricted resources.
 */
import { useEffect, useMemo, useState } from "react";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ShieldCheck, RefreshCw, Download, Eye } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { AUDITED_RESOURCES, fetchSensitiveReadAudit, type SensitiveReadAuditRow } from "@/lib/security/auditedReads";

interface FindingRow {
  internal_id: string;
  scanner_name: string;
  finding_code: string | null;
  name: string;
  description: string | null;
  severity: string;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  fixed_at: string | null;
  regressed_at: string | null;
  last_scan_at: string;
  occurrences: number;
  resolution_note: string | null;
}

interface ScanRunRow {
  id: string;
  scanner_name: string;
  trigger_source: string;
  started_at: string;
  finished_at: string | null;
  total_findings: number;
  new_findings: number;
  regressed_findings: number;
  resolved_findings: number;
  alerted: boolean;
}

const statusVariant = (s: string) =>
  s === "regressed" ? "destructive" : s === "open" ? "secondary" : s === "fixed" ? "outline" : "outline";

const sevVariant = (s: string) =>
  ["critical", "error", "high"].includes(s) ? "destructive" : s === "warn" || s === "warning" ? "secondary" : "outline";

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

export default function SecurityFindings() {
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [runs, setRuns] = useState<ScanRunRow[]>([]);
  const [audit, setAudit] = useState<SensitiveReadAuditRow[]>([]);
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [search, setSearch] = useState("");
  const [resource, setResource] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const db = untypedDb;
    try {
      const [f, r, a] = await Promise.all([
        db.from("security_findings_registry")
          .select("*").order("last_seen_at", { ascending: false }).limit(500),
        db.from("security_scan_runs")
          .select("*").order("started_at", { ascending: false }).limit(50),
        fetchSensitiveReadAudit({ resource, limit: 300 }),
      ]);
      if (f.error) throw new Error(f.error.message);
      setFindings((f.data ?? []) as FindingRow[]);
      setRuns((r.data ?? []) as ScanRunRow[]);
      setAudit(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource]);

  const filtered = useMemo(
    () =>
      findings.filter((f) => {
        if (status !== "all" && f.status !== status) return false;
        if (severity !== "all" && f.severity !== severity) return false;
        if (search && !`${f.internal_id} ${f.name}`.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [findings, status, severity, search],
  );

  const stats = useMemo(() => {
    const s = { open: 0, fixed: 0, regressed: 0, ignored: 0 };
    for (const f of findings) if (f.status in s) s[f.status as keyof typeof s] += 1;
    return s;
  }, [findings]);

  const lastScan = runs[0]?.started_at ?? findings[0]?.last_scan_at ?? null;

  const exportFindings = () =>
    downloadCsv(
      `security-findings-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        filtered.map((f) => ({
          internal_id: f.internal_id,
          name: f.name,
          scanner: f.scanner_name,
          severity: f.severity,
          status: f.status,
          first_seen_at: f.first_seen_at,
          last_seen_at: f.last_seen_at,
          fixed_at: f.fixed_at ?? "",
          regressed_at: f.regressed_at ?? "",
          last_scan_at: f.last_scan_at,
          occurrences: f.occurrences,
        })),
      ),
    );

  return (
    <AdminOnly>
      <div className="p-6 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Security findings
            </h1>
            <p className="text-sm text-muted-foreground">
              Current and historical findings by <code>internal_id</code>, with scheduled re-scan
              history and the audit trail of privileged reads.
            </p>
          </div>
          <div className="flex gap-2">
            <Button data-analytics="securityfindings.export_csv" variant="outline" onClick={exportFindings} disabled={!filtered.length}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </div>
        </header>

        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-5">
          {[
            ["Open", stats.open],
            ["Fixed", stats.fixed],
            ["Regressed", stats.regressed],
            ["Ignored", stats.ignored],
          ].map(([label, value]) => (
            <Card key={String(label)}>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{label}</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{value}</CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Last scan</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{fmt(lastScan)}</CardContent>
          </Card>
        </div>

        <Tabs defaultValue="findings">
          <TabsList>
            <TabsTrigger value="findings">Findings</TabsTrigger>
            <TabsTrigger value="scans">Scan history</TabsTrigger>
            <TabsTrigger value="audit">Privileged reads</TabsTrigger>
          </TabsList>

          <TabsContent value="findings" className="space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["all", "open", "fixed", "regressed", "ignored"].map((s) => (
                        <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Severity</Label>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["all", "info", "warn", "error", "critical"].map((s) => (
                        <SelectItem key={s} value={s}>{s === "all" ? "All severities" : s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sf-search">Search</Label>
                  <Input
                    id="sf-search"
                    placeholder="internal_id or name"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{filtered.length} finding(s)</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>internal_id</TableHead>
                        <TableHead>Finding</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>First seen</TableHead>
                        <TableHead>Last seen</TableHead>
                        <TableHead>Last scan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((f) => (
                        <TableRow key={f.internal_id}>
                          <TableCell className="font-mono text-xs">{f.internal_id}</TableCell>
                          <TableCell className="max-w-[22rem]">
                            <div className="font-medium">{f.name}</div>
                            {f.resolution_note && (
                              <div className="text-xs text-muted-foreground">{f.resolution_note}</div>
                            )}
                          </TableCell>
                          <TableCell><Badge variant={sevVariant(f.severity)}>{f.severity}</Badge></TableCell>
                          <TableCell><Badge variant={statusVariant(f.status)}>{f.status}</Badge></TableCell>
                          <TableCell className="text-xs">{fmt(f.first_seen_at)}</TableCell>
                          <TableCell className="text-xs">{fmt(f.last_seen_at)}</TableCell>
                          <TableCell className="text-xs">{fmt(f.last_scan_at)}</TableCell>
                        </TableRow>
                      ))}
                      {!filtered.length && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                            No findings match these filters.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scans">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Scheduled re-scans</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Scanner</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">New</TableHead>
                      <TableHead className="text-right">Regressed</TableHead>
                      <TableHead className="text-right">Resolved</TableHead>
                      <TableHead>Alerted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{fmt(r.started_at)}</TableCell>
                        <TableCell>{r.scanner_name}</TableCell>
                        <TableCell>{r.trigger_source}</TableCell>
                        <TableCell className="text-right">{r.total_findings}</TableCell>
                        <TableCell className="text-right">{r.new_findings}</TableCell>
                        <TableCell className="text-right text-destructive">{r.regressed_findings}</TableCell>
                        <TableCell className="text-right">{r.resolved_findings}</TableCell>
                        <TableCell>{r.alerted ? "yes" : "no"}</TableCell>
                      </TableRow>
                    ))}
                    {!runs.length && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No scan runs recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4" /> Privileged reads of role-restricted data
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="max-w-xs space-y-1">
                  <Label>Resource</Label>
                  <Select value={resource} onValueChange={setResource}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All resources</SelectItem>
                      {AUDITED_RESOURCES.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Resource</TableHead>
                        <TableHead>User id</TableHead>
                        <TableHead>Roles</TableHead>
                        <TableHead className="text-right">Rows</TableHead>
                        <TableHead>Outcome</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {audit.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs">{fmt(a.created_at)}</TableCell>
                          <TableCell className="font-mono text-xs">{a.resource}</TableCell>
                          <TableCell className="font-mono text-xs">{a.user_id ?? "anonymous"}</TableCell>
                          <TableCell className="text-xs">{(a.user_roles ?? []).join(", ") || "—"}</TableCell>
                          <TableCell className="text-right">{a.row_count}</TableCell>
                          <TableCell>
                            <Badge variant={a.allowed ? "outline" : "destructive"}>
                              {a.allowed ? "allowed" : "denied"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!audit.length && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No privileged reads recorded yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminOnly>
  );
}
