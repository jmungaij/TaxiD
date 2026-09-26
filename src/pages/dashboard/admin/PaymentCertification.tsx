// Slice 3 — Enterprise Certification Center.
// Answers "Is the platform ready to accept payments?" — not just diagnostics.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, PlayCircle, RefreshCcw, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";

type Row = Record<string, unknown> & { id: string };

interface ReadinessRow extends Row {
  ready: boolean; readiness_score: number; computed_at: string;
  signal_scores: Record<string, number>;
  reasons: Array<{ signal: string; ok: boolean; detail: string }>;
  failed_signals: string[];
}
interface WorkflowRow extends Row {
  workflow_key: string; workflow_name: string; status: string;
  criticality: string; score: number | null; last_certified_at: string | null; last_run_id: string | null;
}
interface RunRow extends Row {
  status: string; total_scenarios: number; passed_scenarios: number; failed_scenarios: number;
  overall_score: number | null; started_at: string; completed_at: string | null; suite_version: string;
}
interface ScenarioRow extends Row {
  scenario_key: string; scenario_name: string; status: string; expected_outcome: string;
  observed_outcome: string | null; duration_ms: number | null; correlation_id: string | null;
  gate_results: Array<{ key: string; ok: boolean; detail?: unknown }>;
}
interface RegistryRow extends Row {
  scenario_key: string; scenario_name: string; workflow_key: string;
  severity: string; enabled: boolean; last_run_at: string | null; last_run_status: string | null;
}

function scoreClass(n: number | null | undefined) {
  const v = n ?? 0;
  if (v >= 95) return "text-status-success";
  if (v >= 80) return "text-status-warning";
  return "text-destructive";
}
function statusBadge(status: string) {
  const v = (status || "").toUpperCase();
  if (["PASS","PASSED","OK","CERTIFIED"].includes(v)) return <Badge className="bg-status-success hover:bg-status-success">{v}</Badge>;
  if (["FAIL","FAILED"].includes(v)) return <Badge variant="destructive">{v}</Badge>;
  if (v === "DEGRADED") return <Badge className="bg-status-warning hover:bg-status-warning">{v}</Badge>;
  if (v === "RUNNING") return <Badge variant="secondary">{v}</Badge>;
  return <Badge variant="outline">{v || "UNKNOWN"}</Badge>;
}

interface GateResult {
  ready: boolean; score: number; critical_failures: number; warnings: number;
  blocking_conditions: Array<{ code: string; detail?: unknown; workflow?: string }>;
  failed_checks: string[]; passed_checks: string[];
  evaluated_at: string;
}
interface BaselineCompare {
  has_current: boolean; has_baseline: boolean; environment?: string;
  regressed?: boolean;
  regressions?: Array<{ metric: string; baseline: number; current: number; delta: number }>;
  improvements?: Array<{ metric: string; baseline: number; current: number; delta: number }>;
  unchanged?: Array<{ metric: string; value: number }>;
  baseline?: { certified_at: string; deployment_version: string | null; git_revision: string | null; readiness_score: number };
  current?: { deployment_version: string | null; git_revision: string | null; overall_score: number };
}

export default function PaymentCertification() {
  const [readiness, setReadiness] = useState<ReadinessRow | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [registry, setRegistry] = useState<RegistryRow[]>([]);
  const [trend, setTrend] = useState<ReadinessRow[]>([]);
  const [gate, setGate] = useState<GateResult | null>(null);
  const [baseline, setBaseline] = useState<BaselineCompare | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function loadAll() {
    const [r1, r2, r3, r4, r5, rg, rb] = await Promise.all([
      supabase.from("platform_readiness_snapshots").select("*").order("computed_at", { ascending: false }).limit(1),
      supabase.from("certification_workflows").select("*").order("workflow_name"),
      supabase.from("payment_certification_runs").select("*").order("started_at", { ascending: false }).limit(10),
      supabase.from("certification_scenarios_registry").select("*").order("workflow_key").order("scenario_name"),
      supabase.from("platform_readiness_snapshots").select("*").order("computed_at", { ascending: false }).limit(20),
      supabase.rpc("payment_orchestrator_readiness_gate"),
      supabase.rpc("payment_certification_baseline_compare", { _environment: "sandbox" }),
    ]);
    setReadiness(((r1.data ?? [])[0] as unknown as ReadinessRow) ?? null);
    setWorkflows((r2.data ?? []) as unknown as WorkflowRow[]);
    setRuns((r3.data ?? []) as unknown as RunRow[]);
    setRegistry((r4.data ?? []) as unknown as RegistryRow[]);
    setTrend(((r5.data ?? []) as unknown as ReadinessRow[]).slice().reverse());
    setGate((rg.data ?? null) as unknown as GateResult);
    setBaseline((rb.data ?? null) as unknown as BaselineCompare);
  }
  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (!selectedRun) return;
    supabase.from("payment_certification_scenarios").select("*")
      .eq("run_id", selectedRun).order("started_at")
      .then(({ data }) => setScenarios((data ?? []) as unknown as ScenarioRow[]));
  }, [selectedRun]);

  async function runSuite(only?: string[]) {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("payment-certification-runner",
        { body: only ? { only } : {} });
      if (error) throw error;
      toast({ title: "Certification complete",
        description: `${data?.passed}/${(data?.passed ?? 0)+(data?.failed ?? 0)} passed · score ${data?.score}% · readiness ${data?.readiness?.readiness_score ?? "—"}%` });
      await loadAll();
      if (data?.run_id) setSelectedRun(data.run_id);
    } catch (e) {
      toast({ title: "Run failed", description: (e as Error).message, variant: "destructive" });
    } finally { setRunning(false); }
  }

  async function recomputeReadiness() {
    setRefreshing(true);
    try {
      await supabase.rpc("compute_platform_health", { _window_minutes: 60 });
      await supabase.rpc("compute_platform_readiness");
      await loadAll();
      toast({ title: "Readiness refreshed" });
    } finally { setRefreshing(false); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Certification Center</h1>
          <p className="text-muted-foreground">Enterprise payment certification — platform readiness at a glance.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={recomputeReadiness} variant="outline" disabled={refreshing}>
            {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
            Refresh readiness
          </Button>
          <Button onClick={() => runSuite()} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
            Run certification suite
          </Button>
        </div>
      </div>

      {/* Platform readiness banner */}
      <Card className={readiness?.ready ? "border-status-success/30" : "border-destructive"}>
        <CardContent className="p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {readiness?.ready
              ? <CheckCircle2 className="w-14 h-14 text-status-success" />
              : <XCircle className="w-14 h-14 text-destructive" />}
            <div>
              <div className="text-sm text-muted-foreground">Platform Ready?</div>
              <div className="text-4xl font-bold">
                {readiness ? (readiness.ready ? "YES" : "NO") : "—"}
                <span className={`ml-3 text-2xl ${scoreClass(readiness?.readiness_score)}`}>
                  {readiness ? `${readiness.readiness_score}%` : ""}
                </span>
              </div>
              {readiness && (
                <div className="text-xs text-muted-foreground mt-1">
                  Last computed {new Date(readiness.computed_at).toLocaleString()}
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 min-w-[260px]">
            {(readiness?.reasons ?? []).map((r, i) => (
              <div key={i} className="flex items-center text-sm">
                {r.ok ? <CheckCircle2 className="w-4 h-4 mr-2 text-status-success" />
                      : <XCircle className="w-4 h-4 mr-2 text-destructive" />}
                <span className="capitalize">{r.signal}</span>
                <span className="ml-2 text-muted-foreground">{r.detail}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Orchestrator Readiness Gate + Baseline comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className={gate?.ready ? "border-status-success/30" : "border-status-warning/30"}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Payment Orchestrator Gate</span>
              {gate ? (
                gate.ready
                  ? <Badge className="bg-status-success hover:bg-status-success">MAY GO LIVE</Badge>
                  : <Badge variant="destructive">BLOCKED</Badge>
              ) : <Badge variant="outline">—</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {gate ? (
              <>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Score <b className={scoreClass(gate.score)}>{gate.score}%</b></span>
                  <span>Critical <b className="text-destructive">{gate.critical_failures}</b></span>
                  <span>Warnings <b className="text-status-warning">{gate.warnings}</b></span>
                </div>
                {gate.blocking_conditions.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1">Blocking:</div>
                    <ul className="text-xs space-y-1">
                      {gate.blocking_conditions.map((b, i) => (
                        <li key={i} className="text-destructive">
                          ✗ {b.code}{b.workflow ? ` · ${b.workflow}` : ""}
                          {typeof b.detail === "string" && <span className="text-muted-foreground"> — {b.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {gate.passed_checks.length > 0 && (
                  <div className="text-xs text-status-success">
                    ✓ {gate.passed_checks.slice(0, 6).join(" · ")}
                    {gate.passed_checks.length > 6 && ` +${gate.passed_checks.length - 6}`}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">Evaluated {new Date(gate.evaluated_at).toLocaleString()}</div>
              </>
            ) : <div className="text-muted-foreground">Run the suite to evaluate the gate.</div>}
          </CardContent>
        </Card>

        <Card className={baseline?.regressed ? "border-destructive" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Baseline Comparison</span>
              {baseline?.has_baseline
                ? (baseline.regressed
                    ? <Badge variant="destructive">REGRESSION</Badge>
                    : <Badge className="bg-status-success hover:bg-status-success">STABLE</Badge>)
                : <Badge variant="outline">No baseline yet</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {baseline?.has_baseline && baseline.baseline && baseline.current ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Baseline</div>
                    <div>Score {baseline.baseline.readiness_score}%</div>
                    <div className="text-[10px] text-muted-foreground">
                      {baseline.baseline.git_revision?.slice(0, 8) ?? "—"} · {new Date(baseline.baseline.certified_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Current</div>
                    <div>Score {baseline.current.overall_score}%</div>
                    <div className="text-[10px] text-muted-foreground">
                      {baseline.current.git_revision?.slice(0, 8) ?? "—"}
                    </div>
                  </div>
                </div>
                {baseline.regressions && baseline.regressions.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-destructive">Regressions</div>
                    {baseline.regressions.map((r) => (
                      <div key={r.metric} className="text-xs text-destructive">
                        ✗ {r.metric}: {r.baseline} → {r.current} ({r.delta > 0 ? "+" : ""}{r.delta})
                      </div>
                    ))}
                  </div>
                )}
                {baseline.improvements && baseline.improvements.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-status-success">Improvements</div>
                    {baseline.improvements.map((r) => (
                      <div key={r.metric} className="text-xs text-status-success">
                        ✓ {r.metric}: {r.baseline} → {r.current} ({r.delta > 0 ? "+" : ""}{r.delta})
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-muted-foreground text-xs">
                A baseline will be captured automatically after the first passing certification with the gate green.
              </div>
            )}
          </CardContent>
        </Card>
      </div>



      {/* Workflow certification tiles */}
      <div>
        <h2 className="text-xl font-semibold mb-3">Workflow Certification</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {workflows.map((w) => (
            <Card key={w.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{w.workflow_name}</div>
                  {statusBadge(w.status)}
                </div>
                <div className={`text-2xl font-bold ${scoreClass(w.score)}`}>{w.score ?? "—"}%</div>
                <div className="text-xs text-muted-foreground">
                  {w.last_certified_at ? `Certified ${new Date(w.last_certified_at).toLocaleString()}` : "Not yet certified"}
                </div>
                <div className="flex justify-between items-center pt-1">
                  <Badge variant="outline" className="text-[10px]">{w.criticality}</Badge>
                  <Button size="sm" variant="ghost" disabled={running}
                    onClick={() => runSuite(registry.filter((s) => s.workflow_key === w.workflow_key && s.enabled).map((s) => s.scenario_key))}>
                    Certify
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Readiness trend + latest runs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Readiness Trend</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {trend.length === 0 && <div className="text-sm text-muted-foreground">No history yet</div>}
              {trend.map((t) => (
                <div key={t.id} title={`${t.readiness_score}% @ ${new Date(t.computed_at).toLocaleString()}`}
                  className={`w-3 rounded-t ${t.ready ? "bg-status-success" : "bg-destructive"}`}
                  style={{ height: `${Math.max(4, t.readiness_score)}%` }} />
              ))}
            </div>
            <div className="text-xs text-muted-foreground mt-2">Last {trend.length} snapshots</div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Latest Certification Runs</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-56">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground text-xs">
                  <tr><th className="py-1">Started</th><th>Status</th><th>Passed</th><th>Failed</th><th>Score</th><th>Suite</th></tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className={`cursor-pointer hover:bg-muted/50 ${selectedRun === r.id ? "bg-muted" : ""}`}
                        onClick={() => setSelectedRun(r.id)}>
                      <td className="py-1">{new Date(r.started_at).toLocaleString()}</td>
                      <td>{statusBadge(r.status)}</td>
                      <td className="text-status-success">{r.passed_scenarios}</td>
                      <td className="text-destructive">{r.failed_scenarios}</td>
                      <td className={scoreClass(r.overall_score)}>{r.overall_score ?? "—"}%</td>
                      <td className="text-xs text-muted-foreground">{r.suite_version}</td>
                    </tr>
                  ))}
                  {runs.length === 0 && <tr><td colSpan={6} className="py-3 text-muted-foreground">No runs yet — click "Run certification suite".</td></tr>}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Selected run scenarios */}
      {selectedRun && (
        <Card>
          <CardHeader><CardTitle>Scenarios — Run {selectedRun.slice(0, 8)}</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-72">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground text-xs">
                  <tr><th className="py-1">Scenario</th><th>Expected</th><th>Observed</th><th>Status</th><th>Gates</th><th>Duration</th><th>Journey</th></tr>
                </thead>
                <tbody>
                  {scenarios.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="py-2">{s.scenario_name}</td>
                      <td className="text-muted-foreground">{s.expected_outcome}</td>
                      <td>{s.observed_outcome ?? "—"}</td>
                      <td>{statusBadge(s.status)}</td>
                      <td className="text-xs">
                        {(s.gate_results ?? []).map((g, i) => (
                          <span key={i} className={`inline-block mr-1 ${g.ok ? "text-status-success" : "text-destructive"}`}>
                            {g.ok ? "✓" : "✗"}{g.key}
                          </span>
                        ))}
                      </td>
                      <td className="text-xs">{s.duration_ms ?? 0}ms</td>
                      <td>
                        {s.correlation_id && (
                          <Link className="text-primary inline-flex items-center text-xs"
                                to={`/dashboard/admin/payment-journey?correlation_id=${s.correlation_id}`}>
                            Open <ExternalLink className="w-3 h-3 ml-1" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Scenario registry */}
      <Card>
        <CardHeader><CardTitle>Scenario Registry ({registry.filter((s) => s.enabled).length} enabled)</CardTitle></CardHeader>
        <CardContent>
          <ScrollArea className="h-72">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground text-xs">
                <tr><th className="py-1">Scenario</th><th>Workflow</th><th>Severity</th><th>Enabled</th><th>Last Run</th><th>Last Status</th></tr>
              </thead>
              <tbody>
                {registry.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="py-1">{s.scenario_name}</td>
                    <td className="text-xs text-muted-foreground">{s.workflow_key}</td>
                    <td><Badge variant="outline" className="text-[10px]">{s.severity}</Badge></td>
                    <td>{s.enabled ? "✓" : "—"}</td>
                    <td className="text-xs">{s.last_run_at ? new Date(s.last_run_at).toLocaleString() : "never"}</td>
                    <td>{s.last_run_status ? statusBadge(s.last_run_status) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
