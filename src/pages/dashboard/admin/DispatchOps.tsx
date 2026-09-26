import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Activity, RefreshCw, Zap, Users, MapPin, ListOrdered,
  PlayCircle, RotateCcw, ChevronRight, AlertTriangle, FlaskConical, ShieldCheck, X, Check,
} from "lucide-react";
import {
  getCellDrilldown, getPendingSurgeApprovals, decideSurgeApproval, requestSurgeOverride,
} from "@/domains/dispatch/api";
import { CorporateBookingAssignments } from "@/components/dispatch/CorporateBookingAssignments";



// ---- types (avoid pulling new ones into generated supabase types) ----
interface RequestRow {
  id: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string | null;
  vehicle_category: string | null;
  status: string;
  surge_multiplier: number;
  requested_at: string;
  assigned_driver_id: string | null;
}
interface SupplyCell {
  cell_key: string;
  center_lat: number;
  center_lng: number;
  online_drivers: number;
  available_drivers: number;
  demand_1m: number;
  demand_5m: number;
  demand_15m: number;
  updated_at: string;
}
interface SurgeZone {
  id: string;
  cell_key: string;
  multiplier: number;
  reason: string | null;
  source: string;
  valid_from: string;
  valid_to: string | null;
  active: boolean;
}
interface EngineRun {
  id: string;
  request_id: string;
  rule_version: string | null;
  candidates_considered: number;
  candidates_offered: number;
  winner_driver_id: string | null;
  outcome: string;
  duration_ms: number | null;
  notes: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
}
interface CandidateRow {
  id: string;
  driver_id: string;
  rank: number;
  distance_m: number | null;
  eta_seconds: number | null;
  score: number | null;
  status: string;
  reason: string | null;
}
interface ScoreFactor {
  candidate_id: string;
  factor: string;
  weight: number;
  value: number;
  contribution: number;
}

const OUTCOME_TONE: Record<string, string> = {
  ASSIGNED: "bg-status-success/10 text-status-success",
  NO_SUPPLY: "bg-status-warning/10 text-status-warning",
  EXPIRED: "bg-muted text-muted-foreground",
  ERROR: "bg-status-danger/10 text-status-danger",
  CANCELLED: "bg-muted text-muted-foreground",
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-status-warning/10 text-status-warning",
  OFFERED: "bg-ai/10 text-ai",
  ASSIGNED: "bg-status-success/10 text-status-success",
  COMPLETED: "bg-status-success/10 text-status-success",
  CANCELLED: "bg-muted text-muted-foreground",
};

function fmtAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function heatTone(demand: number, supply: number): string {
  if (supply === 0 && demand > 0) return "bg-status-danger/10";
  if (demand === 0) return "bg-status-success/10";
  const ratio = demand / Math.max(1, supply);
  if (ratio < 0.5) return "bg-status-success/10";
  if (ratio < 1) return "bg-status-warning/10";
  if (ratio < 2) return "bg-status-warning/10";
  return "bg-status-danger/10";
}

export default function DispatchOps() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [cells, setCells] = useState<SupplyCell[]>([]);
  const [zones, setZones] = useState<SurgeZone[]>([]);
  const [runs, setRuns] = useState<EngineRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [factors, setFactors] = useState<ScoreFactor[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);

  // surge override form
  const [overrideCell, setOverrideCell] = useState("");
  const [overrideMult, setOverrideMult] = useState("1.5");
  const [overrideReason, setOverrideReason] = useState("");

  // pending approvals + drilldown
  const [pending, setPending] = useState<SurgeZone[]>([]);
  const [drillCell, setDrillCell] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<Awaited<ReturnType<typeof getCellDrilldown>> | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: r }, { data: c }, { data: z }, { data: rn }] =
      await Promise.all([
        supabase.from("dispatch_requests").select(
          "id,pickup_lat,pickup_lng,pickup_address,vehicle_category,status,surge_multiplier,requested_at,assigned_driver_id",
        ).order("requested_at", { ascending: false }).limit(25),
        supabase.from("dispatch_supply_cells").select("*")
          .order("updated_at", { ascending: false }).limit(50),
        supabase.from("dispatch_surge_zones").select("*")
          .eq("active", true).order("valid_from", { ascending: false }).limit(50),
        supabase.from("dispatch_engine_runs").select("*")
          .order("started_at", { ascending: false }).limit(30),
      ]);
    setRequests((r ?? []) as RequestRow[]);
    setCells((c ?? []) as SupplyCell[]);
    setZones((z ?? []) as SurgeZone[]);
    setRuns((rn ?? []) as EngineRun[]);
    try {
      setPending(await getPendingSurgeApprovals());
    } catch (e) {
      toast.error(`Pending surge approvals failed to load: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // open drilldown
  useEffect(() => {
    if (!drillCell) { setDrillData(null); return; }
    setDrillLoading(true);
    getCellDrilldown(drillCell)
      .then(setDrillData)
      .catch((e) => toast.error(`Drilldown failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setDrillLoading(false));
  }, [drillCell]);

  // realtime subscriptions for the live feel
  useEffect(() => {
    const ch = supabase
      .channel("dispatch-ops")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "dispatch_engine_runs" },
        () => refresh())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "dispatch_requests" },
        () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh]);

  // load detail when run selected
  useEffect(() => {
    if (!selectedRunId) {
      setCandidates([]); setFactors([]); return;
    }
    const run = runs.find((r) => r.id === selectedRunId);
    if (!run) return;
    (async () => {
      const { data: cands } = await supabase
        .from("dispatch_candidates")
        .select("id,driver_id,rank,distance_m,eta_seconds,score,status,reason")
        .eq("request_id", run.request_id)
        .order("rank", { ascending: true });
      setCandidates((cands ?? []) as CandidateRow[]);
      const ids = (cands ?? []).map((c) => c.id);
      if (ids.length === 0) { setFactors([]); return; }
      const { data: fs } = await supabase
        .from("dispatch_scores")
        .select("candidate_id,factor,weight,value,contribution")
        .in("candidate_id", ids);
      setFactors((fs ?? []) as ScoreFactor[]);
    })();
  }, [selectedRunId, runs]);

  const kpis = useMemo(() => {
    const pending = requests.filter((r) => r.status === "PENDING").length;
    const offered = requests.filter((r) => r.status === "OFFERED").length;
    const supply = cells.reduce((s, c) => s + c.available_drivers, 0);
    const demand = cells.reduce((s, c) => s + c.demand_5m, 0);
    return { pending, offered, supply, demand, activeSurge: zones.length };
  }, [requests, cells, zones]);

  const reinvoke = async (requestId: string, runId: string) => {
    setBusyRunId(runId);
    try {
      const { error } = await supabase.functions.invoke("dispatch-engine", {
        body: { request_id: requestId },
      });
      if (error) throw error;
      toast.success("Engine re-invoked");
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Re-invoke failed: ${msg}`);
    } finally {
      setBusyRunId(null);
    }
  };

  const triggerSurgeRecompute = async () => {
    const { error } = await supabase.functions.invoke("dispatch-surge", { body: {} });
    if (error) toast.error(`Surge recompute failed: ${error.message}`);
    else { toast.success("Surge recomputed"); await refresh(); }
  };

  const triggerSupplyRefresh = async () => {
    const { error } = await supabase.functions.invoke("dispatch-supply-refresh", { body: {} });
    if (error) toast.error(`Supply refresh failed: ${error.message}`);
    else { toast.success("Supply refreshed"); await refresh(); }
  };

  const submitOverride = async () => {
    if (!overrideCell) { toast.error("Cell key required"); return; }
    const mult = parseFloat(overrideMult);
    if (!Number.isFinite(mult) || mult < 1 || mult > 10) {
      toast.error("Multiplier must be 1.0 – 10.0"); return;
    }
    try {
      await requestSurgeOverride({
        cell_key: overrideCell,
        multiplier: mult,
        reason: overrideReason || "manual override",
      });
      toast.success(`Override proposed (awaiting approval)`);
      setOverrideCell(""); setOverrideReason("");
      await refresh();
    } catch (e) {
      toast.error(`Propose failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const decide = async (id: string, action: "approve" | "reject") => {
    try {
      await decideSurgeApproval(id, action);
      toast.success(action === "approve" ? "Override approved" : "Override rejected");
      await refresh();
    } catch (e) {
      toast.error(`Decision failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const deactivateZone = async (id: string) => {
    const { error } = await supabase.from("dispatch_surge_zones")
      .update({ active: false, valid_to: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Zone deactivated"); await refresh(); }
  };

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  const factorsByCandidate = useMemo(() => {
    const m = new Map<string, ScoreFactor[]>();
    for (const f of factors) {
      const arr = m.get(f.candidate_id) ?? [];
      arr.push(f);
      m.set(f.candidate_id, arr);
    }
    return m;
  }, [factors]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-ai" />
            Dispatch Operations
          </h1>
          <p className="text-sm text-muted-foreground">
            Live supply, demand, surge, and engine telemetry.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard/admin/dispatch/sim">
              <FlaskConical className="h-4 w-4 mr-1" /> Simulator
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={triggerSupplyRefresh}>
            <Users className="h-4 w-4 mr-1" /> Refresh supply
          </Button>
          <Button variant="outline" size="sm" onClick={triggerSurgeRecompute}>
            <Zap className="h-4 w-4 mr-1" /> Recompute surge
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Pending requests" value={kpis.pending} tone="bg-status-warning/10" />
        <Kpi label="Active offers" value={kpis.offered} tone="bg-ai/10" />
        <Kpi label="Available drivers" value={kpis.supply} tone="bg-status-success/10" />
        <Kpi label="Demand (5m)" value={kpis.demand} tone="bg-status-warning/10" />
        <Kpi label="Active surge zones" value={kpis.activeSurge} tone="bg-status-danger/10" />
      </div>

      <CorporateBookingAssignments />



      <div className="grid lg:grid-cols-2 gap-6">
        {/* Heatmap */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Supply / demand heatmap
            </h2>
            <span className="text-xs text-muted-foreground">
              {cells.length} cells
            </span>
          </div>
          {cells.length === 0 ? (
            <Empty msg="No supply cells yet. Click Refresh supply to seed." />
          ) : (
            <div className="overflow-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left border-b">
                    <th className="py-2">Cell</th>
                    <th>Online</th>
                    <th>Avail</th>
                    <th>D1m</th>
                    <th>D5m</th>
                    <th>D15m</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {cells.map((c) => (
                    <tr key={c.cell_key}
                        onClick={() => setDrillCell(c.cell_key)}
                        className={`border-b cursor-pointer ${heatTone(c.demand_5m, c.available_drivers)}`}>
                      <td className="py-1 font-mono underline-offset-2 hover:underline">{c.cell_key}</td>
                      <td>{c.online_drivers}</td>
                      <td>{c.available_drivers}</td>
                      <td>{c.demand_1m}</td>
                      <td className="font-semibold">{c.demand_5m}</td>
                      <td>{c.demand_15m}</td>
                      <td className="text-muted-foreground">{fmtAgo(c.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Surge zones + override */}
        <Card className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4" /> Active surge zones
          </h2>
          {zones.length === 0
            ? <Empty msg="No active surge zones." />
            : (
              <div className="space-y-2 mb-4 max-h-64 overflow-auto">
                {zones.map((z) => (
                  <div key={z.id} className="flex items-center justify-between border rounded p-2">
                    <div className="text-sm">
                      <span className="font-mono">{z.cell_key}</span>
                      <Badge className="ml-2 bg-status-danger/10 text-status-danger">
                        {Number(z.multiplier).toFixed(1)}x
                      </Badge>
                      <Badge variant="outline" className="ml-2 text-xs">{z.source}</Badge>
                      {z.reason && <div className="text-xs text-muted-foreground mt-1">{z.reason}</div>}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => deactivateZone(z.id)}>Clear</Button>
                  </div>
                ))}
              </div>
            )}

          <div className="border-t pt-3 space-y-2">
            <h3 className="text-sm font-medium">Manual surge override</h3>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Cell key</Label>
                <Input value={overrideCell} onChange={(e) => setOverrideCell(e.target.value)}
                       placeholder="-1.29:36.82" className="text-xs font-mono" />
              </div>
              <div>
                <Label className="text-xs">Multiplier</Label>
                <Input type="number" step="0.1" min="1" max="10"
                       value={overrideMult} onChange={(e) => setOverrideMult(e.target.value)} />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Reason</Label>
                <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                       placeholder="event / weather / incident" />
              </div>
            </div>
            <Button size="sm" onClick={submitOverride} className="w-full" data-analytics="admin.dispatch.apply_override" aria-label="Apply dispatch override">
              <Zap className="h-4 w-4 mr-1" /> Apply override
            </Button>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Request queue */}
        <Card className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <ListOrdered className="h-4 w-4" /> Recent requests
          </h2>
          {requests.length === 0
            ? <Empty msg="No dispatch requests yet." />
            : (
              <div className="overflow-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background border-b">
                    <tr className="text-left">
                      <th className="py-2">When</th>
                      <th>Pickup</th>
                      <th>Cat</th>
                      <th>Status</th>
                      <th>Surge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id} className="border-b">
                        <td className="py-1">{fmtAgo(r.requested_at)}</td>
                        <td className="font-mono text-[10px]">
                          {r.pickup_address ?? `${r.pickup_lat.toFixed(3)},${r.pickup_lng.toFixed(3)}`}
                        </td>
                        <td>{r.vehicle_category ?? "—"}</td>
                        <td>
                          <Badge className={STATUS_TONE[r.status] ?? "bg-muted"}>
                            {r.status}
                          </Badge>
                        </td>
                        <td>{Number(r.surge_multiplier).toFixed(1)}x</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>

        {/* Engine runs */}
        <Card className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <PlayCircle className="h-4 w-4" /> Engine runs
          </h2>
          {runs.length === 0
            ? <Empty msg="No engine runs yet." />
            : (
              <div className="overflow-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background border-b">
                    <tr className="text-left">
                      <th className="py-2">When</th>
                      <th>Outcome</th>
                      <th>Cand</th>
                      <th>ms</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id}
                          className={`border-b cursor-pointer hover:bg-muted/50 ${
                            r.id === selectedRunId ? "bg-ai/10" : ""}`}
                          onClick={() => setSelectedRunId(r.id)}>
                        <td className="py-1">{fmtAgo(r.started_at)}</td>
                        <td>
                          <Badge className={OUTCOME_TONE[r.outcome] ?? "bg-muted"}>
                            {r.outcome}
                          </Badge>
                        </td>
                        <td>{r.candidates_considered}</td>
                        <td>{r.duration_ms ?? "—"}</td>
                        <td><ChevronRight className="h-3 w-3 text-muted-foreground" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      </div>

      {/* Run inspector */}
      {selectedRun && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4" /> Run inspector
              <Badge variant="outline" className="font-mono text-[10px] ml-2">
                {selectedRun.id.slice(0, 8)}
              </Badge>
              <Badge className={OUTCOME_TONE[selectedRun.outcome] ?? "bg-muted"}>
                {selectedRun.outcome}
              </Badge>
            </h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline"
                      disabled={busyRunId === selectedRun.id}
                      onClick={() => reinvoke(selectedRun.request_id, selectedRun.id)}>
                <RotateCcw className="h-4 w-4 mr-1" /> Re-invoke engine
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedRunId(null)}>
                Close
              </Button>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-3 text-xs mb-4">
            <Meta label="Request" value={selectedRun.request_id.slice(0, 8)} mono />
            <Meta label="Rule version" value={selectedRun.rule_version ?? "—"} />
            <Meta label="Considered" value={String(selectedRun.candidates_considered)} />
            <Meta label="Duration" value={`${selectedRun.duration_ms ?? "—"} ms`} />
          </div>

          {candidates.length === 0 ? (
            <Empty msg="No candidates recorded for this run." />
          ) : (
            <div className="space-y-3">
              {candidates.map((c) => {
                const fs = (factorsByCandidate.get(c.id) ?? [])
                  .sort((a, b) => b.contribution - a.contribution);
                return (
                  <div key={c.id} className="border rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline">#{c.rank}</Badge>
                        <span className="font-mono text-xs">{c.driver_id.slice(0, 8)}</span>
                        <Badge className={STATUS_TONE[c.status] ?? "bg-muted"}>{c.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.distance_m ?? "—"}m · ETA {c.eta_seconds ?? "—"}s ·
                        <span className="ml-1 font-semibold text-foreground">
                          score {c.score?.toFixed(3) ?? "—"}
                        </span>
                      </div>
                    </div>
                    {fs.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                        {fs.map((f) => (
                          <div key={f.factor} className="flex flex-col">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{f.factor}</span>
                              <span className="font-mono">{f.contribution.toFixed(3)}</span>
                            </div>
                            <div className="h-1 bg-muted rounded overflow-hidden">
                              <div className="h-full bg-ai"
                                   style={{ width: `${Math.min(100, f.contribution * 100 / Math.max(0.01, f.weight))}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              w={f.weight} · v={f.value.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {c.reason && (
                      <div className="mt-2 text-xs text-status-danger flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> {c.reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Pending approvals strip */}
      {pending.length > 0 && (
        <Card className="p-4 border-status-warning/30 bg-status-warning/40">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <ShieldCheck className="h-4 w-4 text-status-warning" />
            Pending surge approvals ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center justify-between border rounded p-2 bg-background">
                <div className="text-sm">
                  <span className="font-mono">{p.cell_key}</span>
                  <Badge className="ml-2 bg-status-danger/10 text-status-danger">{Number(p.multiplier).toFixed(1)}x</Badge>
                  <div className="text-xs text-muted-foreground mt-1">{p.reason}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => decide(p.id, "reject")}
                          aria-label={`Reject override for ${p.cell_key}`}>
                    <X className="h-3 w-3 mr-1" /> Reject
                  </Button>
                  <Button size="sm" onClick={() => decide(p.id, "approve")}
                          aria-label={`Approve override for ${p.cell_key}`}>
                    <Check className="h-3 w-3 mr-1" /> Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Heatmap drilldown */}
      <Sheet open={!!drillCell} onOpenChange={(o) => !o && setDrillCell(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-auto">
          <SheetHeader>
            <SheetTitle className="font-mono text-base">{drillCell}</SheetTitle>
            <SheetDescription>Cell drilldown — supply, demand history, and recent requests.</SheetDescription>
          </SheetHeader>
          {drillLoading && <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>}
          {drillData && (
            <div className="space-y-5 mt-4 text-xs">
              <section>
                <h3 className="font-semibold mb-2">Demand signals (last {drillData.signals.length})</h3>
                {drillData.signals.length === 0
                  ? <Empty msg="No signals recorded." />
                  : (
                    <div className="flex gap-1 items-end h-16">
                      {drillData.signals.slice(0, 30).reverse().map((s, i) => {
                        const v = Number((s as { request_count?: number }).request_count ?? 0);
                        const h = Math.min(64, 8 + v * 4);
                        return <div key={i} className="w-2 bg-ai/70 rounded-t" style={{ height: h }} title={String(v)} />;
                      })}
                    </div>
                  )}
              </section>

              <section>
                <h3 className="font-semibold mb-2">Surge history</h3>
                {drillData.surgeHistory.length === 0 ? <Empty msg="No surge history." /> : (
                  <table className="w-full">
                    <thead><tr className="text-left border-b">
                      <th>Mult</th><th>Source</th><th>From</th><th>Active</th>
                    </tr></thead>
                    <tbody>
                      {drillData.surgeHistory.map((z) => (
                        <tr key={(z as { id: string }).id} className="border-b">
                          <td>{Number((z as { multiplier: number }).multiplier).toFixed(1)}x</td>
                          <td>{String((z as { source: string }).source)}</td>
                          <td>{fmtAgo(String((z as { valid_from: string }).valid_from))}</td>
                          <td>{(z as { active: boolean }).active ? "✓" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section>
                <h3 className="font-semibold mb-2">Recent requests ({drillData.requests.length})</h3>
                {drillData.requests.length === 0 ? <Empty msg="No requests." /> : (
                  <table className="w-full">
                    <thead><tr className="text-left border-b"><th>When</th><th>Status</th><th>Surge</th></tr></thead>
                    <tbody>
                      {drillData.requests.map((r) => {
                        const row = r as { id: string; status: string; surge_multiplier: number; requested_at: string };
                        return (
                          <tr key={row.id} className="border-b">
                            <td>{fmtAgo(row.requested_at)}</td>
                            <td><Badge className={STATUS_TONE[row.status] ?? "bg-muted"}>{row.status}</Badge></td>
                            <td>{Number(row.surge_multiplier).toFixed(1)}x</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>

              <Button size="sm" className="w-full"
                      onClick={() => { setOverrideCell(drillCell ?? ""); setDrillCell(null); }}>
                <Zap className="h-4 w-4 mr-1" /> Propose surge override for this cell
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className={`p-3 ${tone}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </Card>
  );
}
function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono" : ""}>{value}</div>
    </div>
  );
}
function Empty({ msg }: { msg: string }) {
  return <div className="text-sm text-muted-foreground italic py-6 text-center">{msg}</div>;
}
