import type { LooseRow } from "@/lib/types/loose";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { Loader2, ShieldCheck, AlertTriangle, XCircle, FileDown, RefreshCcw, Download } from "lucide-react";
import { SeoHead } from "@/components/seo/SeoHead";
import { useToast } from "@/hooks/use-toast";

interface Run {
  id: string; sha: string | null; branch: string | null; status: string;
  production_score: number | null; indices: Record<string, number>;
  kpi_snapshot: Record<string, number>; failing_modules: string[];
  artifacts: Record<string, string>; run_url: string | null;
  started_at: string; finished_at: string | null;
  parent_run_id?: string | null; rerun_modules?: string[] | null;
}
interface Decision { decision: string; reason: string; scores: Record<string, number>; created_at: string; run_id: string }
interface Flaky { scenario: string; domain: string | null; flips: number; last_10: boolean[]; quarantined_at: string | null }
interface MocEvent {
  id: string; incident_id: string | null; incident_code: string | null; event_type: string;
  actor: string | null; channel: string | null; target: string | null; runbook_key: string | null;
  latency_ms: number | null; succeeded: boolean | null; payload: Record<string, unknown>; occurred_at: string;
}

const DecisionBadge = ({ d }: { d: string }) => {
  if (d === "APPROVED") return <Badge className="bg-status-success/10 text-status-success gap-1"><ShieldCheck className="h-3 w-3" />APPROVED</Badge>;
  if (d === "WARNING") return <Badge className="bg-status-warning/10 text-status-warning gap-1"><AlertTriangle className="h-3 w-3" />WARNING</Badge>;
  return <Badge className="bg-status-danger/10 text-status-danger gap-1"><XCircle className="h-3 w-3" />BLOCKED</Badge>;
};

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

export default function AssuranceDashboard() {
  const { toast } = useToast();
  const [runs, setRuns] = useState<Run[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [flaky, setFlaky] = useState<Flaky[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [mocEvents, setMocEvents] = useState<MocEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);

  useEffect(() => {
    (async () => {
      const [r, d, f, m] = await Promise.all([
        supabase.from("assurance_runs").select("*").order("started_at", { ascending: false }).limit(50),
        supabase.from("assurance_deployment_decisions").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("assurance_flakiness").select("*").order("flips", { ascending: false }).limit(100),
        supabase.from("moc_incident_events").select("*").order("occurred_at", { ascending: false }).limit(200),
      ]);
      setRuns((r.data as LooseRow) ?? []);
      setDecisions((d.data as LooseRow) ?? []);
      setFlaky((f.data as LooseRow) ?? []);
      setMocEvents((m.data as LooseRow) ?? []);
      setSelected(((r.data as LooseRow) ?? [])[0] ?? null);
      setLoading(false);
    })();
  }, []);

  const latestDecision = decisions[0];
  const trendData = runs.slice().reverse().map((r) => ({
    when: new Date(r.started_at).toLocaleDateString(),
    sha: r.sha?.slice(0, 7) ?? "",
    production: r.production_score ?? 0,
    security: r.indices?.security ?? 0,
    marketplace: r.indices?.marketplace_health ?? 0,
    experience: r.indices?.customer_experience ?? 0,
    resilience: r.indices?.resilience ?? 0,
  }));

  const handleExportTrends = () => {
    downloadCsv(`assurance-trends-${new Date().toISOString().slice(0, 10)}.csv`, trendData);
    toast({ title: "CSV exported", description: `${trendData.length} rows` });
  };

  const handleRerunFailing = async () => {
    if (!selected || !selected.failing_modules?.length) return;
    setRerunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("assurance-rerun-failing", {
        body: { run_id: selected.id, modules: selected.failing_modules },
      });
      if (error) throw error;
      toast({
        title: "Re-run queued",
        description: `${selected.failing_modules.length} modules dispatched. Artifacts will attach to this run.`,
      });
      if ((data as LooseRow)?.workflow_run_url) window.open((data as LooseRow).workflow_run_url, "_blank");
    } catch (e) {
      toast({ title: "Re-run failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRerunning(false);
    }
  };

  // Group MOC events by incident for the timeline
  const mocByIncident = mocEvents.reduce<Record<string, MocEvent[]>>((acc, e) => {
    const key = e.incident_code ?? e.incident_id ?? "unassigned";
    (acc[key] ??= []).push(e);
    return acc;
  }, {});

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <SeoHead title="Platform Assurance — SAFARID" description="Browse security validation runs, KPI trends, deployment certification and flaky scenarios." path="/dashboard/admin/assurance" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Platform Assurance</h1>
          <p className="text-muted-foreground text-sm">Continuous security, business and resilience validation.</p>
        </div>
        {latestDecision && (
          <div className="text-right">
            <div className="text-xs text-muted-foreground mb-1">Latest deployment decision</div>
            <DecisionBadge d={latestDecision.decision} />
            <div className="text-xs mt-1 max-w-md">{latestDecision.reason}</div>
          </div>
        )}
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="detail">Run detail</TabsTrigger>
          <TabsTrigger value="flakiness">Flakiness</TabsTrigger>
          <TabsTrigger value="certification">Certification</TabsTrigger>
          <TabsTrigger value="moc">MOC timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Started</TableHead><TableHead>SHA</TableHead><TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead><TableHead>Score</TableHead><TableHead>Modules failing</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                      <TableCell>{new Date(r.started_at).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.sha?.slice(0, 7) ?? "—"}
                        {r.parent_run_id && <Badge variant="outline" className="ml-1 text-[10px]">re-run</Badge>}
                      </TableCell>
                      <TableCell>{r.branch ?? "—"}</TableCell>
                      <TableCell><Badge variant={r.status === "passed" ? "default" : "destructive"}>{r.status}</Badge></TableCell>
                      <TableCell className="font-mono">{r.production_score ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.failing_modules?.length ?? 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Index trends</CardTitle>
              <Button data-analytics="assurancedashboard.export_csv" size="sm" variant="outline" onClick={handleExportTrends} disabled={!trendData.length}>
                <Download className="h-4 w-4 mr-2" />Export CSV
              </Button>
            </CardHeader>
            <CardContent style={{ height: 400 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="when" /><YAxis domain={[0, 100]} /><Tooltip /><Legend />
                  <Line dataKey="production" stroke="hsl(var(--chart-1))" strokeWidth={2} />
                  <Line dataKey="security" stroke="hsl(var(--status-success))" />
                  <Line dataKey="marketplace" stroke="hsl(var(--chart-4))" />
                  <Line dataKey="experience" stroke="hsl(var(--chart-6))" />
                  <Line dataKey="resilience" stroke="hsl(var(--status-danger))" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="detail">
          {!selected ? <p className="text-muted-foreground">Select a run.</p> : (
            <div className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Run {selected.sha?.slice(0, 7)} — {new Date(selected.started_at).toLocaleString()}</CardTitle>
                  <Button size="sm" onClick={handleRerunFailing}
                          disabled={rerunning || !selected.failing_modules?.length}>
                    {rerunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
                    Re-run {selected.failing_modules?.length ?? 0} failing module{selected.failing_modules?.length === 1 ? "" : "s"}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                    {Object.entries(selected.indices ?? {}).map(([k, v]) => (
                      <div key={k} className="border rounded p-3 text-center">
                        <div className="text-xs text-muted-foreground">{k.replace(/_/g, " ")}</div>
                        <div className={`text-2xl font-bold ${v >= 95 ? "text-status-success" : v >= 80 ? "text-status-warning" : "text-status-danger"}`}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {selected.failing_modules?.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">Failing modules / KPIs</h4>
                      <ul className="list-disc pl-5 text-sm">{selected.failing_modules.map((m, i) => <li key={i}>{m}</li>)}</ul>
                    </div>
                  )}
                  <div className="flex gap-3 flex-wrap">
                    {Object.entries(selected.artifacts ?? {}).map(([k]) => (
                      <a key={k} href={selected.run_url ?? "#"} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        <FileDown className="h-4 w-4" />{k}
                      </a>
                    ))}
                    {selected.run_url && <a href={selected.run_url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">Open CI run →</a>}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>KPI snapshot (top 40)</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs font-mono">
                    {Object.entries(selected.kpi_snapshot ?? {}).sort().slice(0, 40).map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b py-1"><span>{k}</span><span className="font-bold">{v}</span></div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="flakiness">
          <Card>
            <CardHeader><CardTitle>Quarantined & flaky scenarios</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Scenario</TableHead><TableHead>Domain</TableHead><TableHead>Flips (last 10)</TableHead>
                  <TableHead>History</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {flaky.map((f) => (
                    <TableRow key={f.scenario}>
                      <TableCell className="font-mono text-xs">{f.scenario}</TableCell>
                      <TableCell>{f.domain ?? "—"}</TableCell>
                      <TableCell>{f.flips}</TableCell>
                      <TableCell className="font-mono">{(f.last_10 ?? []).map((p, i) => <span key={i} className={p ? "text-status-success" : "text-status-danger"}>{p ? "✓" : "✗"}</span>)}</TableCell>
                      <TableCell>{f.quarantined_at ? <Badge variant="destructive">Quarantined</Badge> : <Badge>Active</Badge>}</TableCell>
                    </TableRow>
                  ))}
                  {flaky.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No flaky scenarios recorded.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certification">
          <Card>
            <CardHeader><CardTitle>Deployment decisions</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>When</TableHead><TableHead>Decision</TableHead><TableHead>Reason</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {decisions.map((d) => (
                    <TableRow key={d.run_id}>
                      <TableCell>{new Date(d.created_at).toLocaleString()}</TableCell>
                      <TableCell><DecisionBadge d={d.decision} /></TableCell>
                      <TableCell className="text-sm">{d.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="moc" className="space-y-4">
          {Object.keys(mocByIncident).length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              No MOC incidents recorded yet. Events populate as alerts fire, escalations route, and runbooks are linked.
            </CardContent></Card>
          )}
          {Object.entries(mocByIncident).slice(0, 20).map(([key, events]) => (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="text-base font-mono flex items-center gap-2">
                  {key}
                  <Badge variant="outline">{events.length} events</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="relative border-l-2 border-muted pl-6 space-y-4">
                  {events.slice().reverse().map((e) => (
                    <li key={e.id} className="relative">
                      <span className={`absolute -left-[31px] top-1 h-4 w-4 rounded-full border-2 ${
                        e.succeeded === false ? "bg-status-danger border-status-danger/30"
                          : e.event_type === "acknowledged" ? "bg-status-success border-status-success/30"
                          : e.event_type === "escalation.routed" ? "bg-status-warning border-status-warning/30"
                          : "bg-primary border-primary"}`} />
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{new Date(e.occurred_at).toLocaleString()}</span>
                        {e.latency_ms !== null && <span>· {e.latency_ms}ms</span>}
                        {e.succeeded === false && <Badge variant="destructive" className="text-[10px]">failed</Badge>}
                      </div>
                      <div className="font-medium text-sm mt-1">
                        {e.event_type}
                        {e.channel && <span className="text-muted-foreground"> via {e.channel}</span>}
                        {e.target && <span className="text-muted-foreground"> → {e.target}</span>}
                      </div>
                      {e.actor && <div className="text-xs text-muted-foreground">by {e.actor}</div>}
                      {e.runbook_key && (
                        <div className="text-xs mt-1">
                          Runbook: <span className="font-mono text-primary">{e.runbook_key}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
