// Slice C — Predictive + Correlation panels for the Payment Operations Center.
// Three sibling cards designed to sit under the existing Forensics tab:
//   1) Dependency Graph — telemetry-derived component edges.
//   2) Recommendations  — merges decision-tree recs + advisory forecast +
//      grouped incident cause-chains.
//   3) Incident Correlation Timeline — payment_incident_groups cluster view.
// All read-only; reuses shadcn primitives already used elsewhere in the file.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitBranch, Lightbulb, Layers, RefreshCcw, TrendingUp, TrendingDown } from "lucide-react";

interface DepEdge { from: string; to: string; weight?: number; kind?: string }
interface DepGraph { nodes: string[]; edges: DepEdge[]; derived_at?: string }
interface Advisory { adjustment: number; sample_size: number; worst_component: string | null; worst_probability: number | null }
interface Forecast { component: string; predicted_status: string; probability: number; eta_minutes: number | null; likely_cause: string | null; computed_at: string }
interface IncidentGroup {
  id: string; group_key: string; root_cause: string; severity: string; status: string;
  first_seen_at: string; last_seen_at: string; member_count: number;
}

function tone(sev: string) {
  if (sev === "critical") return "bg-destructive/10 text-destructive border-destructive/30";
  if (sev === "warn" || sev === "warning" || sev === "high") return "bg-status-warning/10 text-status-warning border-status-warning/30";
  return "bg-muted text-muted-foreground border-border";
}
const fmtAgo = (iso?: string | null) => {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

// ============ Dependency Graph ============
export function DependencyGraphPanel() {
  const [corrId, setCorrId] = useState("");
  const [graph, setGraph] = useState<DepGraph | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.rpc("payment_derive_dependency_graph",
        { _correlation_id: corrId || null } as never);
      if (error) throw error;
      setGraph(data as unknown as DepGraph);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }, [corrId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <GitBranch className="h-4 w-4" /> Dependency Graph
          <Badge variant="outline" className="ml-auto text-[10px]">telemetry-derived</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="correlation_id (optional — leave blank for global)" value={corrId} onChange={(e) => setCorrId(e.target.value)} />
          <Button size="sm" onClick={load} disabled={busy}>
            <RefreshCcw className={`h-3 w-3 mr-1 ${busy ? "animate-spin" : ""}`} /> Derive
          </Button>
        </div>
        {err && <div className="text-xs text-destructive">{err}</div>}
        {graph && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {graph.nodes.map((n) => (
                <Badge key={n} variant="outline" className="font-mono text-[11px]">{n}</Badge>
              ))}
            </div>
            <ScrollArea className="h-56 border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5">From</th>
                    <th className="text-left px-2 py-1.5">→ To</th>
                    <th className="text-left px-2 py-1.5">Kind</th>
                    <th className="text-right px-2 py-1.5">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {graph.edges.map((e, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="px-2 py-1 font-mono">{e.from}</td>
                      <td className="px-2 py-1 font-mono">{e.to}</td>
                      <td className="px-2 py-1"><Badge variant="outline" className="text-[10px]">{e.kind ?? "call"}</Badge></td>
                      <td className="px-2 py-1 text-right font-mono">{e.weight ?? 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            {graph.derived_at && <div className="text-[10px] text-muted-foreground">derived {fmtAgo(graph.derived_at)}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============ Recommendations ============
export function RecommendationsPanel() {
  const [advisory, setAdvisory] = useState<Advisory | null>(null);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [recs, setRecs] = useState<Array<{ source: string; text: string; severity?: string }>>([]);

  useEffect(() => {
    (async () => {
      const [{ data: adv }, { data: fc }, { data: trees }] = await Promise.all([
        supabase.rpc("payment_forecast_advisory_signal"),
        supabase.from("payment_reliability_forecasts")
          .select("component,predicted_status,probability,eta_minutes,likely_cause,computed_at")
          .gte("computed_at", new Date(Date.now() - 2 * 3600_000).toISOString())
          .order("probability", { ascending: false }).limit(8),
        supabase.from("payment_decision_trees")
          .select("recommendations,built_at,root_verdict")
          .order("built_at", { ascending: false }).limit(5),
      ]);
      const advRow = Array.isArray(adv) ? (adv as Advisory[])[0] : (adv as Advisory | null);
      setAdvisory(advRow ?? null);
      setForecasts((fc as Forecast[]) ?? []);
      const collected: Array<{ source: string; text: string; severity?: string }> = [];
      for (const t of (trees as Array<{ recommendations: unknown; root_verdict: string }>) ?? []) {
        const arr = Array.isArray(t.recommendations) ? t.recommendations : [];
        for (const r of arr as Array<Record<string, unknown> | string>) {
          const text = typeof r === "string" ? r : String((r as { text?: string }).text ?? JSON.stringify(r));
          collected.push({ source: "decision-tree", text, severity: t.root_verdict });
        }
      }
      setRecs(collected.slice(0, 20));
    })();
  }, []);

  const adj = Number(advisory?.adjustment ?? 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4" /> Recommendations
          <Badge variant="outline" className="ml-auto text-[10px]">advisory only</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`rounded-md border p-3 flex items-start gap-3 text-sm ${adj < 0 ? tone("critical") : adj > 0 ? "bg-status-success/10 border-status-success/30 text-status-success" : "bg-muted/50 border-border"}`}>
          {adj < 0 ? <TrendingDown className="h-4 w-4 mt-0.5" /> : <TrendingUp className="h-4 w-4 mt-0.5" />}
          <div className="flex-1">
            <div className="font-medium">Forecast nudge: {adj > 0 ? "+" : ""}{adj.toFixed(2)} confidence pts</div>
            <div className="text-xs opacity-80">
              {advisory ? `n=${advisory.sample_size} • worst: ${advisory.worst_component ?? "n/a"}${advisory.worst_probability != null ? ` (${(Number(advisory.worst_probability) * 100).toFixed(0)}%)` : ""}` : "no forecast data"}
              {" • never triggers rollback (advisory-only)"}
            </div>
          </div>
        </div>

        {forecasts.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1.5 text-muted-foreground">Predicted degradations (next window)</div>
            <div className="space-y-1">
              {forecasts.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge className={tone(f.predicted_status === "CRITICAL" ? "critical" : f.predicted_status === "DEGRADED" ? "warn" : "info")}>
                    {f.predicted_status}
                  </Badge>
                  <span className="font-mono">{f.component}</span>
                  <span className="text-muted-foreground">p={(Number(f.probability) * 100).toFixed(0)}%</span>
                  {f.eta_minutes != null && <span className="text-muted-foreground">eta {f.eta_minutes}m</span>}
                  {f.likely_cause && <span className="text-muted-foreground truncate">· {f.likely_cause}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-xs font-medium mb-1.5 text-muted-foreground">From recent decision trees</div>
          {recs.length === 0 ? (
            <div className="text-xs text-muted-foreground">No recommendations yet — build a decision tree in the Forensics Explorer above.</div>
          ) : (
            <ScrollArea className="h-40">
              <ul className="space-y-1 text-xs">
                {recs.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 border-l-2 border-primary/40 pl-2">
                    <Badge variant="outline" className="text-[9px] uppercase">{r.severity ?? r.source}</Badge>
                    <span>{r.text}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============ Incident Correlation Timeline ============
export function IncidentCorrelationPanel() {
  const [groups, setGroups] = useState<IncidentGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      // Recluster then read latest groups.
      await supabase.rpc("payment_group_alerts", { _window_minutes: 120 } as never);
      const { data, error } = await supabase.from("payment_incident_groups")
        .select("*").order("last_seen_at", { ascending: false }).limit(20);
      if (error) throw error;
      setGroups((data as IncidentGroup[]) ?? []);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4" /> Incident Correlation
          <Badge variant="outline" className="ml-auto text-[10px]">cause-chain</Badge>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={busy} className="ml-2">
            <RefreshCcw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {err && <div className="text-xs text-destructive mb-2">{err}</div>}
        {groups.length === 0 ? (
          <div className="text-xs text-muted-foreground">No correlated incident groups in the last 2 hours.</div>
        ) : (
          <ScrollArea className="h-72">
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.id} className="border rounded-md p-2 space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge className={tone(g.severity)}>{g.severity}</Badge>
                    <span className="font-mono font-medium">{g.root_cause}</span>
                    <Badge variant="outline" className="text-[10px]">{g.status}</Badge>
                    <span className="ml-auto text-xs text-muted-foreground">×{g.member_count}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex gap-3">
                    <span>first {fmtAgo(g.first_seen_at)}</span>
                    <span>last {fmtAgo(g.last_seen_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
