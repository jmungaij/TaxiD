import type { LooseRow } from "@/lib/types/loose";
// Slice A — Forensics panel embedded in Payment Operations Center.
// Uses:
//   • RPC payment_digital_twin_v2
//   • RPC payment_build_decision_tree
//   • edge payment-callback-certify
//   • edge payment-replay-simulator
// All read-only or safely isolated (replay writes only to
// payment_replay_simulations, never to production tables).
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Search, ShieldCheck, GitBranch, Repeat, Beaker, CheckCircle2, AlertTriangle } from "lucide-react";

const SCENARIOS = [
  "baseline","oauth_outage","callback_delay","duplicate_callback",
  "daraja_5xx","wallet_failure","ledger_failure","slow_db",
] as const;

function verdictBadge(v: string) {
  if (v === "pass" || v === "passed") return <Badge className="bg-status-success hover:bg-status-success">pass</Badge>;
  if (v === "warn") return <Badge className="bg-status-warning hover:bg-status-warning">warn</Badge>;
  if (v === "skipped") return <Badge variant="outline">skipped</Badge>;
  return <Badge variant="destructive">{v}</Badge>;
}

export default function PaymentForensicsPanel() {
  const [corrId, setCorrId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [twin, setTwin] = useState<any>(null);
  const [cert, setCert] = useState<any>(null);
  const [decisionId, setDecisionId] = useState("");
  const [tree, setTree] = useState<any>(null);
  const [scenario, setScenario] = useState<string>("baseline");
  const [replay, setReplay] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };

  const loadTwin = () => run("twin", async () => {
    const { data, error } = await supabase.rpc("payment_digital_twin_v2", { _identifier: corrId } as never);
    if (error) throw error;
    setTwin(data);
  });
  const certifyCallback = () => run("cert", async () => {
    const { data, error } = await supabase.functions.invoke("payment-callback-certify", { body: { correlation_id: corrId } });
    if (error) throw error;
    setCert(data);
  });
  const buildTree = () => run("tree", async () => {
    const { data, error } = await supabase.rpc("payment_build_decision_tree", { _decision_id: decisionId } as never);
    if (error) throw error;
    setTree(data);
  });
  const runReplay = () => run("replay", async () => {
    const { data, error } = await supabase.functions.invoke("payment-replay-simulator", {
      body: { correlation_id: corrId, scenario },
    });
    if (error) throw error;
    setReplay(data);
  });

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {/* Twin v2 + Callback Certification */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Digital Twin v2 & Callback Certification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="correlation_id / checkout_request_id / payment_attempt_id"
              value={corrId} onChange={e => setCorrId(e.target.value)} />
            <Button onClick={loadTwin} disabled={!corrId || !!busy}>
              <Search className="h-4 w-4 mr-1" /> Load Twin
            </Button>
            <Button variant="secondary" onClick={certifyCallback} disabled={!corrId || !!busy}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Certify
            </Button>
          </div>

          {cert && (
            <div className="rounded border p-3 text-sm space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">Callback certification:</span>
                <Badge className="bg-status-success hover:bg-status-success">{cert.passed} passed</Badge>
                {cert.failed > 0 && <Badge variant="destructive">{cert.failed} failed</Badge>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-1 mt-2">
                {cert.results?.map((r: LooseRow) => (
                  <div key={r.stage} className="flex items-center gap-2">
                    {verdictBadge(r.status)}
                    <span className="text-xs">{r.stage}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {twin && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-medium mb-1 flex items-center gap-1">
                  <GitBranch className="h-3.5 w-3.5" /> Dependency graph (derived from telemetry)
                </div>
                <ScrollArea className="h-56 rounded border p-2 text-xs">
                  <div>Nodes: {twin.dependency_graph?.nodes?.length ?? 0}</div>
                  <ul className="mt-1 space-y-0.5">
                    {(twin.dependency_graph?.edges ?? []).map((e: LooseRow, i: number) => (
                      <li key={i} className="font-mono">
                        {e.from} → {e.to} <span className="text-muted-foreground">({Math.round(e.gap_ms ?? 0)}ms)</span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
              <div>
                <div className="text-xs font-medium mb-1">Financial mutations</div>
                <ScrollArea className="h-56 rounded border p-2 text-xs">
                  <div>Wallet txns: {twin.financial_mutations?.wallet_transactions?.length ?? 0}</div>
                  <div>Journal lines: {twin.financial_mutations?.journal_lines?.length ?? 0}</div>
                  <div>Callbacks: {twin.financial_mutations?.callbacks?.length ?? 0}</div>
                </ScrollArea>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Decision tree explainability */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Orchestrator Decision Tree
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="decision_id (payment_orchestrator_decisions.id)"
              value={decisionId} onChange={e => setDecisionId(e.target.value)} />
            <Button onClick={buildTree} disabled={!decisionId || !!busy}>Build tree</Button>
          </div>
          {tree?.tree && (
            <div className="rounded border p-3 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">Verdict:</span>
                <Badge>{tree.tree.verdict}</Badge>
                <span className="text-xs text-muted-foreground">confidence {tree.tree.confidence ?? "—"}</span>
              </div>
              <div className="text-xs text-muted-foreground">{tree.tree.reason}</div>
              <div className="space-y-1 mt-2">
                {tree.tree.children?.map((c: LooseRow) => (
                  <div key={c.name} className="flex items-center justify-between text-xs border-l-2 pl-2"
                    style={{ borderColor: c.verdict === "pass" ? "hsl(var(--primary))" : c.verdict === "warn" ? "orange" : "hsl(var(--destructive))" }}>
                    <div>
                      <span className="font-mono">{c.name}</span>
                      <span className="text-muted-foreground ml-2">actual: {String(c.actual ?? "—")} / threshold: {String(c.threshold)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">weight {c.weight}</span>
                      {verdictBadge(c.verdict)}
                    </div>
                  </div>
                ))}
              </div>
              {tree.recommendations?.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs font-medium mb-1">Recommendations</div>
                  <ul className="text-xs space-y-1">
                    {tree.recommendations.map((r: LooseRow, i: number) => (
                      <li key={i}>
                        <Badge variant="outline" className="mr-1">{r.priority}</Badge>
                        {r.action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {tree.historical_comparison && (
                <div className="text-xs text-muted-foreground mt-2">
                  vs last {tree.historical_comparison.sample_size ?? 0} decisions —
                  avg confidence {Number(tree.historical_comparison.avg_confidence ?? 0).toFixed(1)},
                  avg reliability {Number(tree.historical_comparison.avg_reliability ?? 0).toFixed(1)}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Replay simulator */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Beaker className="h-4 w-4" /> Digital Twin Replay Simulator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="correlation_id" value={corrId} onChange={e => setCorrId(e.target.value)} />
            <Select value={scenario} onValueChange={setScenario}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCENARIOS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={runReplay} disabled={!corrId || !!busy}>
              <Repeat className="h-4 w-4 mr-1" /> Replay
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Replay is fully isolated — no writes to wallets, ledger, or M-Pesa. Used to validate fixes before production.
          </div>
          {replay && (
            <div className="rounded border p-3 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <Badge className={replay.status === "passed" ? "bg-status-success hover:bg-status-success" : "bg-destructive"}>
                  {replay.status}
                </Badge>
                <span className="text-xs">{replay.summary}</span>
              </div>
              <ScrollArea className="h-48 rounded border p-2 text-xs">
                <table className="w-full">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left">stage</th><th className="text-left">original</th><th className="text-left">simulated</th><th className="text-right">Δ ms</th></tr>
                  </thead>
                  <tbody>
                    {(replay.divergence ?? []).map((d: LooseRow, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="font-mono">{d.stage}</td>
                        <td>{d.original_status}</td>
                        <td className={d.simulated_status === "failed" ? "text-destructive" : ""}>{d.simulated_status}</td>
                        <td className="text-right">{Math.round(d.time_delta_ms ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
