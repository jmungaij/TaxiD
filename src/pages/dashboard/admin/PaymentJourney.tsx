// Payment Journey Explorer — Phase 0 admin certification view.
//
// Provides end-to-end visibility for a payment attempt keyed by
// correlation_id: client events, function invocations, journey stages,
// state transitions, and root-cause classifications.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCcw, Search } from "lucide-react";

type Row = Record<string, unknown> & { id: string };

interface JourneyData {
  invocations: Row[];
  stages: Row[];
  events: Row[];
  transitions: Row[];
  clientEvents: Row[];
  rca: Row[];
  steps: Row[];
  health: Row[];
  fraud: Row[];
}

interface InfraRow extends Row {
  callback_url: string;
  overall_ok: boolean;
  http_status: number | null;
  latency_ms: number;
  failure_reason: string | null;
  ran_at: string;
}

function statusVariant(s: unknown): "default" | "secondary" | "destructive" | "outline" {
  const v = String(s ?? "").toUpperCase();
  if (["OK", "SUCCEEDED", "COMPLETED"].includes(v)) return "default";
  if (["FAILED", "TIMED_OUT", "ABORTED"].includes(v)) return "destructive";
  if (["WAITING", "STARTED", "INVOKED"].includes(v)) return "secondary";
  return "outline";
}

async function loadJourney(correlationId: string): Promise<JourneyData> {
  const [inv, st, ev, tr, ce, rca, steps, health, fraud] = await Promise.all([
    supabase.from("workflow_invocations").select("*").eq("correlation_id", correlationId).order("started_at", { ascending: true }),
    supabase.from("payment_journey_stages").select("*").eq("correlation_id", correlationId).order("occurred_at", { ascending: true }),
    supabase.from("payment_journey_events").select("*").eq("correlation_id", correlationId).order("occurred_at", { ascending: true }),
    supabase.from("payment_state_transitions").select("*").eq("correlation_id", correlationId).order("occurred_at", { ascending: true }),
    supabase.from("client_journey_events").select("*").eq("correlation_id", correlationId).order("occurred_at", { ascending: true }),
    supabase.from("payment_rca_classifications").select("*").eq("correlation_id", correlationId),
    supabase.from("payment_step_traces").select("*").eq("correlation_id", correlationId).order("step_number", { ascending: true }).order("occurred_at", { ascending: true }),
    supabase.from("journey_health_snapshots").select("*").eq("correlation_id", correlationId).order("computed_at", { ascending: false }),
    supabase.from("fraud_engine_traces").select("*").eq("correlation_id", correlationId).order("occurred_at", { ascending: false }),
  ]);
  return {
    invocations: (inv.data ?? []) as Row[],
    stages: (st.data ?? []) as Row[],
    events: (ev.data ?? []) as Row[],
    transitions: (tr.data ?? []) as Row[],
    clientEvents: (ce.data ?? []) as Row[],
    rca: (rca.data ?? []) as Row[],
    steps: (steps.data ?? []) as Row[],
    health: (health.data ?? []) as Row[],
    fraud: (fraud.data ?? []) as Row[],
  };
}

async function loadInfraCert(): Promise<InfraRow[]> {
  const { data } = await supabase
    .from("infrastructure_certification_runs")
    .select("*")
    .order("ran_at", { ascending: false })
    .limit(10);
  return (data ?? []) as InfraRow[];
}

async function loadRecent(): Promise<{ correlation_id: string; occurred_at: string; route: string | null }[]> {
  const { data } = await supabase
    .from("client_journey_events")
    .select("correlation_id, occurred_at, route")
    .eq("event_key", "button_clicked")
    .order("occurred_at", { ascending: false })
    .limit(25);
  return (data ?? []) as { correlation_id: string; occurred_at: string; route: string | null }[];
}

export default function PaymentJourney() {
  const [correlationId, setCorrelationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<JourneyData | null>(null);
  const [recent, setRecent] = useState<{ correlation_id: string; occurred_at: string; route: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [infra, setInfra] = useState<InfraRow[]>([]);

  useEffect(() => {
    loadRecent().then(setRecent).catch(() => {});
    loadInfraCert().then(setInfra).catch(() => {});
  }, []);

  async function runLookup(id: string) {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const d = await loadJourney(id);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const rca = useMemo(() => data?.rca?.[0], [data]);
  const invSummary = useMemo(() => {
    if (!data) return null;
    const counts = { started: 0, succeeded: 0, failed: 0 };
    for (const i of data.invocations) {
      const s = String(i.execution_status ?? "").toUpperCase();
      if (s === "SUCCEEDED") counts.succeeded++;
      else if (s === "FAILED" || s === "TIMED_OUT" || s === "ABORTED") counts.failed++;
      else counts.started++;
    }
    return counts;
  }, [data]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payment Journey Explorer</h1>
        <p className="text-sm text-muted-foreground">
          Phase 0 certification view. Enter a correlation ID or pick a recent checkout to inspect end-to-end evidence.
        </p>
      </div>

      {/* Infrastructure Certification banner (Slice 2) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Callback infrastructure certification</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => loadInfraCert().then(setInfra)}>
            <RefreshCcw className="mr-2 h-3 w-3" />Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {infra.length === 0 ? (
            <p className="text-sm text-muted-foreground">No certification runs yet. The 15-minute scheduler will populate this shortly.</p>
          ) : (
            <div className="space-y-2">
              {infra.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs border-b border-border/40 pb-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.overall_ok ? "default" : "destructive"}>
                      {r.overall_ok ? "PASS" : "FAIL"}
                    </Badge>
                    <span className="font-mono truncate max-w-[420px]" title={r.callback_url}>{r.callback_url}</span>
                  </div>
                  <div className="text-muted-foreground">
                    HTTP {r.http_status ?? "—"} • {r.latency_ms}ms • {new Date(r.ran_at).toLocaleTimeString()}
                    {!r.overall_ok && r.failure_reason && <span className="text-destructive ml-2">({r.failure_reason})</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Lookup</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="correlation_id (uuid)"
              value={correlationId}
              onChange={(e) => setCorrelationId(e.target.value)}
              className="font-mono"
            />
            <Button onClick={() => runLookup(correlationId)} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Inspect
            </Button>
            <Button variant="ghost" onClick={() => loadRecent().then(setRecent)}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
          {error && <div className="mt-2 text-sm text-destructive">{error}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent frontend checkouts</CardTitle></CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No client journey events recorded yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {recent.map((r) => (
                <button
                  key={r.correlation_id}
                  onClick={() => { setCorrelationId(r.correlation_id); runLookup(r.correlation_id); }}
                  className="text-left rounded border border-border p-2 hover:bg-muted/40 transition"
                >
                  <div className="font-mono text-xs truncate">{r.correlation_id}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.occurred_at).toLocaleString()} • {r.route ?? "?"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {data && (
        <>
          {/* Journey health score */}
          {data.health.length > 0 && (() => {
            const h = data.health[0] as unknown as { score: number; grade: string; breakdown: Record<string, unknown> };
            const scoreColor = h.score >= 95 ? "text-status-success" : h.score >= 80 ? "text-status-warning" : "text-destructive";
            return (
              <Card>
                <CardHeader><CardTitle className="text-base">Journey Health Score</CardTitle></CardHeader>
                <CardContent className="flex items-center gap-6">
                  <div className={`text-4xl font-bold ${scoreColor}`}>{h.score}</div>
                  <div>
                    <Badge>{h.grade}</Badge>
                    <div className="text-xs text-muted-foreground mt-1">
                      Breakdown: {JSON.stringify(h.breakdown)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Card><CardHeader><CardTitle className="text-sm">Client events</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{data.clientEvents.length}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Invocations</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{data.invocations.length}</div>
                {invSummary && (
                  <div className="text-xs text-muted-foreground">
                    {invSummary.succeeded} ok • {invSummary.failed} fail • {invSummary.started} in-flight
                  </div>
                )}
              </CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Stages</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{data.stages.length}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Step traces</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{data.steps.length}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Transitions</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{data.transitions.length}</CardContent></Card>
          </div>

          {rca && (
            <Card className="border-status-warning/40">
              <CardHeader><CardTitle className="text-base">Root cause classification</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div><span className="text-muted-foreground">Category:</span> <Badge>{String(rca.category)}</Badge></div>
                <div><span className="text-muted-foreground">Last successful stage:</span> {String(rca.last_successful_stage ?? "—")}</div>
                <div><span className="text-muted-foreground">First failed stage:</span> {String(rca.first_failed_stage ?? "—")}</div>
              </CardContent>
            </Card>
          )}

          <TimelineCard title="Step-level traces (15-step STK push)" rows={data.steps} columns={["occurred_at","function_name","step_number","step_key","status","latency_ms","error_message"]} statusKey="status" />
          <TimelineCard title="Fraud engine decisions" rows={data.fraud} columns={["occurred_at","decision","score","rules_fired","latency_ms"]} statusKey="decision" />
          <TimelineCard title="Client journey" rows={data.clientEvents} columns={["occurred_at","event_key","route","target_function","http_status","duration_ms","success","error_message"]} />
          <TimelineCard title="Function invocations" rows={data.invocations} columns={["started_at","function_name","execution_status","current_state","current_step","duration_ms","error_message"]} statusKey="execution_status" />
          <TimelineCard title="Journey stages" rows={data.stages} columns={["occurred_at","stage_key","status","latency_ms"]} statusKey="status" />
          <TimelineCard title="State transitions" rows={data.transitions} columns={["occurred_at","from_state","to_state","actor","source_function","reason"]} />
          <TimelineCard title="Payment journey events" rows={data.events} columns={["occurred_at","event_key","event_status","source_component","actor","latency_ms"]} statusKey="event_status" />
        </>
      )}
    </div>
  );
}

function TimelineCard({
  title, rows, columns, statusKey,
}: { title: string; rows: Row[]; columns: string[]; statusKey?: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows.</p>
        ) : (
          <ScrollArea className="w-full">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  {columns.map((c) => <th key={c} className="py-1 pr-3 font-medium">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0 align-top">
                    {columns.map((c) => {
                      const v = r[c];
                      const cell = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
                      if (statusKey && c === statusKey) {
                        return <td key={c} className="py-1 pr-3"><Badge variant={statusVariant(v)}>{cell || "—"}</Badge></td>;
                      }
                      if (c.endsWith("_at") && typeof v === "string") {
                        return <td key={c} className="py-1 pr-3 whitespace-nowrap">{new Date(v).toLocaleTimeString()}</td>;
                      }
                      return <td key={c} className="py-1 pr-3 font-mono max-w-[280px] truncate" title={cell}>{cell || "—"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
