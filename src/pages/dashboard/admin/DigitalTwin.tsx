import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Play, ShieldCheck, XCircle, Database, AlertTriangle, Repeat, Download, GitCompare, RotateCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SeoHead } from "@/components/seo/SeoHead";
import { SideBySideDiff } from "./twin/DiffViewer";
import { exportRunJson, exportRunCsv, type RunLike } from "./twin/exportReport";
import { RegressionAlerts } from "./twin/RegressionAlerts";
import { AppButton } from "@/components/nav/AppButton";

type Scale = "micro" | "tiny" | "small" | "medium" | "large" | "enterprise" | "full";
interface Breakdown {
  domain_score: number; validation_score: number; total: number;
  domain_ok: number; domain_total: number;
  failing_checks: { name: string; severity: string; detail?: string }[];
  passing_checks: { name: string; weight: number }[];
}
interface Idem {
  ok: boolean;
  before: Record<string, number>; after: Record<string, number>;
  deltas: Record<string, number>;
}
interface Artifact { table: string; error: string; attempted: number; sample: Record<string, unknown>[] }
interface DriftEntry { before: number; after: number; delta: number; domain?: string }
interface Run {
  id: string; scale: string; status: string; readiness_score: number | null;
  started_at: string; finished_at: string | null; duration_ms: number | null;
  domains_completed: string[]; rows_by_domain: Record<string, number>;
  rows_by_table: Record<string, number>; validation: Record<string, unknown>;
  error: string | null;
  metadata: {
    logs?: string[]; streaming?: boolean;
    readiness_breakdown?: Breakdown; idempotency?: Idem;
    artifacts?: Record<string, Artifact[]>;
    drift_domains?: string[];
    drift_by_table?: Record<string, DriftEntry>;
    scheduled?: boolean; parent_run_id?: string | null;
  } | null;
}


const SCALES: { value: Scale; label: string; hint: string }[] = [
  { value: "micro",      label: "Micro",      hint: "20 trips · smoke test" },
  { value: "tiny",       label: "Tiny",       hint: "100 trips · demo" },
  { value: "small",      label: "Small",      hint: "5k trips · staging" },
  { value: "medium",     label: "Medium",     hint: "50k trips · load" },
  { value: "large",      label: "Large",      hint: "300k trips · perf" },
  { value: "enterprise", label: "Enterprise", hint: "1M trips · full-scale" },
  { value: "full",       label: "Full",       hint: "alias of enterprise" },
];

export default function DigitalTwin() {
  const { toast } = useToast();
  const [scale, setScale] = useState<Scale>("tiny");
  const [verifyIdem, setVerifyIdem] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("digital_twin_runs")
      .select("*").order("started_at", { ascending: false }).limit(30);
    const rows = (data as Run[] | null) ?? [];
    setRuns(rows);
    if (!selected && rows[0]) setSelected(rows[0]);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const active = running || (runs[0]?.status === "running") || (runs[0]?.metadata?.streaming === true);
    if (!active) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [running, runs]);

  const runSeed = async (
    dry_run = false,
    overrides: { only?: string[]; verify?: boolean; parent_run_id?: string | null } = {}
  ) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("digital-twin-seed", {
        body: {
          scale,
          dry_run,
          verify_idempotent: (overrides.verify ?? verifyIdem) && !dry_run,
          only: overrides.only,
          parent_run_id: overrides.parent_run_id,
        },
      });
      if (error) throw error;
      const d = data as { status: string; readiness_score: number };
      toast({
        title: dry_run ? "Dry-run complete"
          : overrides.only ? `Rerun (${overrides.only.length} drifted domain${overrides.only.length === 1 ? "" : "s"}) complete`
          : verifyIdem ? "Idempotency verify complete" : "Digital twin seed complete",
        description: `${d.status} · readiness ${d.readiness_score}/100`,
        variant: d.status === "succeeded" ? "default" : "destructive",
      });
      await load();
    } catch (e) {
      toast({ title: "Seed failed", description: (e as Error).message, variant: "destructive" });
    } finally { setRunning(false); }
  };

  const view = selected ?? runs[0];
  const breakdown = view?.metadata?.readiness_breakdown;
  const idem = view?.metadata?.idempotency;
  const artifacts = view?.metadata?.artifacts ?? {};
  const driftDomains = view?.metadata?.drift_domains ?? [];
  const driftByTable = view?.metadata?.drift_by_table ?? {};

  const rerunDrift = async () => {
    if (!view || driftDomains.length === 0) return;
    await runSeed(false, { only: driftDomains, verify: true, parent_run_id: view.id });
  };



  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <SeoHead title="Digital Twin · Admin" description="Seed and validate the TaxiD digital twin dataset." path="/dashboard/admin/digital-twin" />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="h-6 w-6" /> Digital Twin Seeder</h1>
          <p className="text-sm text-muted-foreground">
            Schema-aware, idempotent, scale-driven seeding. Seeded rows carry a{" "}
            <code className="font-mono text-xs">seed_tag</code> so they can be wiped without touching real data.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Scale preset</div>
            <Select value={scale} onValueChange={(v) => setScale(v as Scale)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCALES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    <span className="font-medium">{s.label}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{s.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm h-9 px-3 border rounded-md cursor-pointer bg-muted/30">
            <Checkbox checked={verifyIdem} onCheckedChange={(v) => setVerifyIdem(v === true)} />
            <Repeat className="h-3.5 w-3.5" />
            <span>Verify idempotency (run twice)</span>
          </label>
          <Button variant="outline" onClick={() => runSeed(true)} disabled={running}>Dry-run</Button>
          <Button onClick={() => runSeed(false)} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run seed
          </Button>
        </div>
      </div>

      <RegressionAlerts onSelectRun={(id) => {
        const r = runs.find((x) => x.id === id);
        if (r) setSelected(r);
      }} />



      {view && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Latest run {view.metadata?.scheduled && <Badge variant="outline" className="ml-2">nightly</Badge>}</CardTitle>
            <div className="flex items-center gap-2">
              <AppButton analytics="admin_digital_twin_run_json_download" action="submit" variant="outline" size="sm" aria-label="Download digital twin run as JSON" onClick={() => exportRunJson(view as unknown as RunLike)}>
                <Download className="h-3.5 w-3.5 mr-1" /> JSON
              </AppButton>
              <AppButton analytics="admin_digital_twin_run_csv_download" action="submit" variant="outline" size="sm" aria-label="Download digital twin run as CSV" onClick={() => exportRunCsv(view as unknown as RunLike)}>
                <Download className="h-3.5 w-3.5 mr-1" /> CSV
              </AppButton>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Stat label="Status" value={<Badge variant={view.status === "succeeded" ? "default" : "destructive"}>{view.status}</Badge>} />
              <Stat label="Scale" value={view.scale} />
              <Stat label="Duration" value={view.duration_ms ? `${(view.duration_ms / 1000).toFixed(1)}s` : "—"} />
              <Stat label="Readiness" value={
                <span className={`text-2xl font-bold ${
                  (view.readiness_score ?? 0) >= 90 ? "text-status-success"
                    : (view.readiness_score ?? 0) >= 70 ? "text-status-warning" : "text-status-danger"
                }`}>{view.readiness_score ?? "—"}/100</span>
              } />
              <Stat label="Domains OK" value={`${view.domains_completed?.length ?? 0}/16`} />
            </div>
            {view.error && (
              <div className="mt-4 text-sm text-destructive flex items-start gap-2">
                <XCircle className="h-4 w-4 mt-0.5" />{view.error}
              </div>
            )}
            {view.metadata?.parent_run_id && (
              <div className="mt-3 text-xs text-muted-foreground">
                ↳ Targeted rerun of parent run <code className="font-mono">{view.metadata.parent_run_id.slice(0, 8)}</code>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Per-domain drift detection + one-click rerun */}
      {driftDomains.length > 0 && (
        <Card className="border-status-warning/40">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-status-warning" />
              Drift detected in {driftDomains.length} domain{driftDomains.length === 1 ? "" : "s"}
            </CardTitle>
            <Button size="sm" onClick={rerunDrift} disabled={running}>
              <RotateCw className="h-3.5 w-3.5 mr-1" /> Rerun drifted domains
            </Button>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 mb-3">
              {driftDomains.map((d) => (
                <Badge key={d} variant="secondary" className="font-mono">{d}</Badge>
              ))}
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Table</TableHead><TableHead>Domain</TableHead>
                <TableHead className="text-right">Before</TableHead><TableHead className="text-right">After</TableHead>
                <TableHead className="text-right">Δ</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {Object.entries(driftByTable).sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta)).map(([t, v]) => (
                  <TableRow key={t}>
                    <TableCell className="font-mono text-xs">{t}</TableCell>
                    <TableCell className="text-xs">{v.domain ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{v.before.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{v.after.toLocaleString()}</TableCell>
                    <TableCell className={`text-right font-mono ${v.delta === 0 ? "" : "text-status-danger"}`}>
                      {v.delta > 0 ? "+" : ""}{v.delta}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 text-xs text-muted-foreground">
              The rerun uses the same deterministic seed and captures artifacts for every failed upsert — attached to this run's history via <code className="font-mono">parent_run_id</code>.
            </div>
          </CardContent>
        </Card>
      )}


      {/* Readiness score breakdown */}
      {breakdown && (
        <Card>
          <CardHeader><CardTitle>Readiness score breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Domain score (max 70)" value={
                <span className="font-mono">{breakdown.domain_score} · {breakdown.domain_ok}/{breakdown.domain_total} domains ok</span>
              } />
              <Stat label="Validation score (max 30)" value={<span className="font-mono">{breakdown.validation_score}</span>} />
              <Stat label="Total" value={<span className="font-mono font-bold">{breakdown.total}/100</span>} />
            </div>
            {breakdown.failing_checks.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-2">Failing / warning checks</div>
                <ul className="space-y-1 text-sm">
                  {breakdown.failing_checks.map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <AlertTriangle className={`h-4 w-4 mt-0.5 ${c.severity === "critical" ? "text-status-danger" : "text-status-warning"}`} />
                      <div>
                        <span className="font-mono text-xs">{c.name}</span>
                        <Badge variant="outline" className="ml-2 text-[10px]">{c.severity}</Badge>
                        {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {breakdown.passing_checks.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Passing: {breakdown.passing_checks.map((c) => `${c.name} (+${c.weight})`).join(" · ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Idempotency verification result */}
      {idem && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Repeat className="h-4 w-4" /> Idempotency verification</CardTitle>
            <Badge variant={idem.ok ? "default" : "destructive"}>{idem.ok ? "no drift" : "drift detected"}</Badge>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Metric</TableHead><TableHead className="text-right">Before</TableHead><TableHead className="text-right">After</TableHead><TableHead className="text-right">Δ</TableHead></TableRow></TableHeader>
              <TableBody>
                {Object.keys(idem.deltas).map((k) => (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs">{k}</TableCell>
                    <TableCell className="text-right font-mono">{idem.before[k]?.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{idem.after[k]?.toLocaleString()}</TableCell>
                    <TableCell className={`text-right font-mono ${idem.deltas[k] === 0 ? "text-status-success" : "text-status-danger"}`}>
                      {idem.deltas[k] > 0 ? "+" : ""}{idem.deltas[k]}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Rows by domain</CardTitle></CardHeader>
          <CardContent>
            {view && Object.keys(view.rows_by_domain ?? {}).length ? (
              <Table>
                <TableHeader><TableRow><TableHead>Domain</TableHead><TableHead className="text-right">Rows</TableHead></TableRow></TableHeader>
                <TableBody>
                  {Object.entries(view.rows_by_domain).sort((a, b) => b[1] - a[1]).map(([d, n]) => (
                    <TableRow key={d}><TableCell className="font-mono">{d}</TableCell><TableCell className="text-right font-bold">{n.toLocaleString()}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="text-sm text-muted-foreground">Run a seed to populate.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Validation checks</CardTitle></CardHeader>
          <CardContent>
            {view?.validation && (view.validation as { checks?: { name: string; ok: boolean; detail?: string; severity?: string }[] }).checks?.length ? (
              <ul className="space-y-2 text-sm">
                {(view.validation as { checks: { name: string; ok: boolean; detail?: string; severity?: string }[] }).checks.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {c.ok ? <ShieldCheck className="h-4 w-4 text-status-success mt-0.5" /> : <XCircle className="h-4 w-4 text-status-danger mt-0.5" />}
                    <div>
                      <div className="font-mono text-xs">{c.name} {c.severity && <span className="text-muted-foreground">· {c.severity}</span>}</div>
                      {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No validation results yet.</p>}
          </CardContent>
        </Card>
      </div>

      {/* Failure artifacts */}
      {Object.keys(artifacts).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-status-warning" /> Failure artifacts</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(artifacts).map(([domain, arts]) => (
              <div key={domain} className="border rounded-md p-3">
                <div className="text-sm font-semibold mb-2">{domain} <span className="text-muted-foreground text-xs font-normal">({arts.length} table failure{arts.length === 1 ? "" : "s"})</span></div>
                {arts.map((a, i) => (
                  <div key={i} className="mt-2 space-y-2">
                    <div className="text-xs font-mono">
                      <Badge variant="destructive" className="mr-2">{a.table}</Badge>
                      attempted {a.attempted} row{a.attempted === 1 ? "" : "s"} · <span className="text-status-danger">{a.error}</span>
                    </div>
                    {a.sample?.length >= 2 ? (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1">
                          <GitCompare className="h-3 w-3" /> Side-by-side diff of first two sample rows
                        </div>
                        <SideBySideDiff pair={{
                          label: a.table,
                          left: a.sample[0], right: a.sample[1],
                          leftLabel: "sample #1", rightLabel: "sample #2",
                        }} />
                      </div>
                    ) : a.sample?.length > 0 && (
                      <pre className="mt-1 text-[10px] leading-relaxed font-mono bg-muted/40 border rounded p-2 max-h-40 overflow-auto">
{JSON.stringify(a.sample, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}

              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Live run log</CardTitle>
          {view?.metadata?.streaming && <Badge variant="secondary" className="animate-pulse">streaming</Badge>}
        </CardHeader>
        <CardContent>
          <pre className="text-[11px] leading-relaxed font-mono bg-muted/40 border rounded-md p-3 max-h-[360px] overflow-y-auto whitespace-pre-wrap">
{(view?.metadata?.logs ?? []).join("\n") || "No logs yet. Start a run above to stream per-domain progress here."}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Started</TableHead><TableHead>Scale</TableHead><TableHead>Status</TableHead>
              <TableHead>Duration</TableHead><TableHead>Readiness</TableHead><TableHead>Rows</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {runs.map((r) => {
                const total = Object.values(r.rows_by_domain ?? {}).reduce((a, b) => a + b, 0);
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <TableCell className="text-xs">{new Date(r.started_at).toLocaleString()}</TableCell>
                    <TableCell>{r.scale}</TableCell>
                    <TableCell><Badge variant={r.status === "succeeded" ? "default" : r.status === "running" ? "secondary" : "destructive"}>{r.status}</Badge></TableCell>
                    <TableCell>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</TableCell>
                    <TableCell className="font-mono">{r.readiness_score ?? "—"}</TableCell>
                    <TableCell className="font-mono">{total.toLocaleString()}</TableCell>
                  </TableRow>
                );
              })}
              {runs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No runs yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-medium">{value}</div>
    </div>
  );
}
