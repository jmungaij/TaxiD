import type { LooseRow } from "@/lib/types/loose";
// Slice 4.2 — Enterprise Payment Operations Center
// Single command interface for M-PESA payment operations.
// Read-only. Evidence-driven. Consumes existing views/RPCs — no new tables.
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Radio, Gauge, ShieldCheck,
  Workflow, DollarSign, Cpu, RefreshCcw, Search, ExternalLink, Zap, Heart,
} from "lucide-react";
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import PaymentForensicsPanel from "./PaymentForensicsPanel";
import QualificationGovernancePanel from "./QualificationGovernancePanel";
import ContinuousQualificationPanel from "./ContinuousQualificationPanel";
import { DependencyGraphPanel, RecommendationsPanel, IncidentCorrelationPanel } from "./PaymentInsightsPanels";
import { ForensicCertificationCard } from "@/components/dashboard/ForensicCertificationCard";


// ---------- Types ----------
type Health = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";

interface CallbackHealth {
  inv_15m: number; inv_1h: number; inv_24h: number; ok_24h: number;
  last_invocation_at: string | null; success_rate_24h: number | null; health: Health;
}
interface EdgeFnHealth {
  function_name: string; is_payment_critical: boolean;
  inv_1h: number; inv_24h: number; ok_24h: number;
  last_invocation_at: string | null; last_success_at: string | null;
  avg_latency_1h_ms: number | null; success_rate_24h: number | null; health: Health;
}
interface ReliabilitySnapshot {
  id: string; computed_at: string; reliability_score: number;
  callback_score: number; journey_score: number; edge_function_score: number;
  slo_score: number; certification_score: number; window_minutes: number;
  details: Record<string, unknown>;
}
interface OrchestratorFlag {
  enabled: boolean; shadow_mode: boolean; rollout_percent: number;
  kill_switch: boolean; updated_at: string; note: string | null;
}
interface ShadowDiff {
  id: string; correlation_id: string; is_equivalent: boolean;
  diff_keys: string[] | null; legacy_duration_ms: number | null;
  shadow_duration_ms: number | null; created_at: string;
}
interface JourneyStage {
  id: string; correlation_id: string; stage_key: string; status: string;
  latency_ms: number | null; occurred_at: string;
}
interface GateResult {
  ready: boolean; score: number; critical_failures: number; warnings: number;
  blocking_conditions: Array<{ code: string; detail?: unknown }>;
  failed_checks: string[]; passed_checks: string[]; evaluated_at: string;
}

// ---------- Helpers ----------
const STAGE_ORDER = [
  "checkout", "session", "attempt", "stk_push", "daraja",
  "callback", "wallet", "ledger", "settlement", "notification",
];

function healthTone(h: Health | string | null | undefined): string {
  const v = String(h ?? "").toUpperCase();
  if (v === "HEALTHY") return "bg-status-success hover:bg-status-success text-ice";
  if (v === "DEGRADED") return "bg-status-warning hover:bg-status-warning text-ice";
  if (v === "CRITICAL") return "bg-destructive hover:bg-destructive text-ice";
  return "bg-muted text-muted-foreground";
}
function scoreClass(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v >= 95) return "text-status-success";
  if (v >= 80) return "text-status-warning";
  return "text-destructive";
}
function fmtTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString();
}
function fmtAgo(ts: string | null | undefined): string {
  if (!ts) return "never";
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------- Page ----------
interface BuildProvenance {
  deployment_version: string | null;
  git_revision: string | null;
  build_timestamp: string | null;
  certified_at: string | null;
}

interface CriticalCallbackIncident {
  window_minutes: number;
  since: string;
  stk_total: number;
  stk_accepted: number;
  callbacks: number;
  detected: boolean;
  samples: Array<{
    correlation_id: string | null;
    checkout_request_id: string | null;
    merchant_request_id: string | null;
    payment_attempt_id: string | null;
    phone_masked: string | null;
    amount_cents: number | null;
    created_at: string;
  }>;
}

interface SloMeasurement {
  slo_id: string;
  slo_key: string;
  name: string;
  target_value: number;
  actual_value: number;
  compliant: boolean;
  burn_rate: number | null;
  window_minutes: number;
  unit: string;
  comparator: string;
  window_end: string;
}

export default function PaymentOperationsCenter() {
  const [callback, setCallback] = useState<CallbackHealth | null>(null);
  const [fns, setFns] = useState<EdgeFnHealth[]>([]);
  const [snapshots, setSnapshots] = useState<ReliabilitySnapshot[]>([]);
  const [flag, setFlag] = useState<OrchestratorFlag | null>(null);
  const [gate, setGate] = useState<GateResult | null>(null);
  const [diffs, setDiffs] = useState<ShadowDiff[]>([]);
  const [stages, setStages] = useState<JourneyStage[]>([]);
  const [provenance, setProvenance] = useState<BuildProvenance | null>(null);
  const [criticalIncident, setCriticalIncident] = useState<CriticalCallbackIncident | null>(null);
  const [slos, setSlos] = useState<SloMeasurement[]>([]);
  const [projection, setProjection] = useState<{ open_incidents: number; failed_runs_24h: number; last_incident_at: string | null; drift_score: number | null; drift_critical: number; drift_major: number; drift_scanned: number; drift_scan_at: string | null; blocked_promotion: boolean }>({ open_incidents: 0, failed_runs_24h: 0, last_incident_at: null, drift_score: null, drift_critical: 0, drift_major: 0, drift_scanned: 0, drift_scan_at: null, blocked_promotion: false });
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drillCorrelation, setDrillCorrelation] = useState<string | null>(null);
  const [searchCorr, setSearchCorr] = useState("");
  // Slice D4 — server-enforced RBAC for the Forensics tab.
  const [hasForensicAccess, setHasForensicAccess] = useState(false);
  useEffect(() => {
    supabase.rpc("payment_current_user_forensic_access" as never).then(({ data }) => {
      setHasForensicAccess(Boolean(data));
    });
  }, []);


  const loadAll = useCallback(async () => {
    const [cb, ef, rs, fg, sd, jst, prov, inc, sloMeasure, sloDef] = await Promise.all([
      supabase.from("v_callback_invocation_health").select("*").maybeSingle(),
      supabase.from("v_edge_function_health").select("*").order("is_payment_critical", { ascending: false }).order("function_name"),
      supabase.from("payment_reliability_snapshots").select("*").order("computed_at", { ascending: false }).limit(60),
      supabase.from("payment_orchestrator_flag").select("*").limit(1).maybeSingle(),
      supabase.from("payment_orchestrator_shadow_diffs").select("id,correlation_id,is_equivalent,diff_keys,legacy_duration_ms,shadow_duration_ms,created_at").order("created_at", { ascending: false }).limit(50),
      supabase.from("payment_journey_stages").select("*").order("occurred_at", { ascending: false }).limit(500),
      supabase.from("payment_certification_runs").select("deployment_version,git_revision,build_timestamp,started_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.rpc("payment_critical_callback_incident", { p_window_minutes: 15 }),
      supabase.from("payment_slo_measurements").select("slo_id,actual_value,target_value,compliant,burn_rate,window_end").order("window_end", { ascending: false }).limit(200),
      supabase.from("payment_slos").select("id,slo_key,name,target_value,unit,comparator,window_minutes,active").eq("active", true),
    ]);
    setCallback((cb.data as CallbackHealth | null) ?? null);
    setFns((ef.data as EdgeFnHealth[] | null) ?? []);
    setSnapshots((rs.data as ReliabilitySnapshot[] | null) ?? []);
    setFlag((fg.data as OrchestratorFlag | null) ?? null);
    setDiffs((sd.data as ShadowDiff[] | null) ?? []);
    setStages((jst.data as JourneyStage[] | null) ?? []);
    if (prov.data) {
      const p = prov.data as { deployment_version: string | null; git_revision: string | null; build_timestamp: string | null; started_at: string };
      setProvenance({ deployment_version: p.deployment_version, git_revision: p.git_revision, build_timestamp: p.build_timestamp, certified_at: p.started_at });
    }
    if (!inc.error && inc.data) setCriticalIncident(inc.data as unknown as CriticalCallbackIncident);

    // Join latest SLO measurement per slo_id with its definition
    const defs = (sloDef.data ?? []) as Array<{ id: string; slo_key: string; name: string; target_value: number; unit: string; comparator: string; window_minutes: number }>;
    const measurements = (sloMeasure.data ?? []) as Array<{ slo_id: string; actual_value: number; target_value: number; compliant: boolean; burn_rate: number | null; window_end: string }>;
    const latestBySlo = new Map<string, typeof measurements[number]>();
    for (const m of measurements) if (!latestBySlo.has(m.slo_id)) latestBySlo.set(m.slo_id, m);
    setSlos(defs.map(d => {
      const m = latestBySlo.get(d.id);
      return {
        slo_id: d.id, slo_key: d.slo_key, name: d.name, target_value: Number(d.target_value),
        unit: d.unit, comparator: d.comparator, window_minutes: d.window_minutes,
        actual_value: m ? Number(m.actual_value) : NaN,
        compliant: m ? m.compliant : true,
        burn_rate: m?.burn_rate ?? null,
        window_end: m?.window_end ?? "",
      } as SloMeasurement;
    }));

    const g = await supabase.rpc("payment_orchestrator_readiness_gate");
    if (!g.error) setGate(g.data as unknown as GateResult);

    // D5.3/D5.4 — Projection consistency (incidents + drift score).
    const sb = untypedDb;
    const [pInc, pRuns, pScan] = await Promise.all([
      sb.from("payment_projection_incidents").select("id,detected_at").is("resolved_at", null).order("detected_at", { ascending: false }).limit(50),
      sb.from("payment_projection_sync_runs").select("id,started_at,status").eq("status", "failed").gte("started_at", new Date(Date.now() - 24 * 3600_000).toISOString()),
      sb.from("projection_drift_scans").select("id,created_at,drift_score,critical,major,scanned,blocked_promotion").order("created_at", { ascending: false }).limit(1),
    ]);
    const incRows = ((pInc.data ?? []) as unknown) as Array<{ id: string; detected_at: string }>;
    const scanRow = (((pScan.data ?? []) as unknown) as Array<{ id: string; created_at: string; drift_score: number; critical: number; major: number; scanned: number; blocked_promotion: boolean }>)[0];
    setProjection({
      open_incidents: incRows.length,
      failed_runs_24h: (((pRuns.data ?? []) as unknown) as unknown[]).length,
      last_incident_at: incRows[0]?.detected_at ?? null,
      drift_score: scanRow ? Number(scanRow.drift_score) : null,
      drift_critical: scanRow?.critical ?? 0,
      drift_major: scanRow?.major ?? 0,
      drift_scanned: scanRow?.scanned ?? 0,
      drift_scan_at: scanRow?.created_at ?? null,
      blocked_promotion: scanRow?.blocked_promotion ?? false,
    });
    setLoading(false);
  }, []);

  const runDriftScan = useCallback(async () => {
    setScanning(true);
    try {
      const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)(
        "payment_projection_drift_scan",
        { _window: "24 hours", _triggered_by: "manual" }
      );
      if (error) console.error("drift scan failed", error);
      await loadAll();
    } finally {
      setScanning(false);
    }
  }, [loadAll]);



  useEffect(() => {
    void loadAll();
    const timer = window.setInterval(() => void loadAll(), 30_000);
    const ch = supabase
      .channel("ops-center-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_reliability_snapshots" }, () => void loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_orchestrator_flag" }, () => void loadAll())
      .subscribe();
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(ch);
    };
  }, [loadAll]);

  const current = snapshots[0];
  const previous = snapshots[1];
  const avg7d = useMemo(() => avg(snapshots.filter(s => within(s.computed_at, 7 * 24 * 60)).map(s => s.reliability_score)), [snapshots]);
  const avg30d = useMemo(() => avg(snapshots.map(s => s.reliability_score)), [snapshots]);
  const trendData = useMemo(
    () => [...snapshots].reverse().map(s => ({ t: new Date(s.computed_at).toLocaleTimeString(), score: Number(s.reliability_score) })),
    [snapshots]
  );

  // Stage aggregation
  const stageStats = useMemo(() => {
    const map: Record<string, { total: number; ok: number; fail: number; lat: number[]; last?: string; lastOk?: string }> = {};
    for (const s of stages) {
      const k = s.stage_key;
      const entry = map[k] ?? (map[k] = { total: 0, ok: 0, fail: 0, lat: [] });
      entry.total++;
      const st = (s.status || "").toLowerCase();
      if (st === "success" || st === "ok" || st === "completed") { entry.ok++; if (!entry.lastOk) entry.lastOk = s.occurred_at; }
      else if (st === "failed" || st === "error") entry.fail++;
      if (s.latency_ms) entry.lat.push(s.latency_ms);
      if (!entry.last) entry.last = s.occurred_at;
    }
    return map;
  }, [stages]);

  const firstFailedStage = useMemo(() => {
    for (const k of STAGE_ORDER) {
      const e = stageStats[k];
      if (e && e.fail > 0 && e.fail / e.total > 0.1) return k;
    }
    return null;
  }, [stageStats]);

  // Auto-incident grouping
  const incidents = useMemo(() => buildIncidents({ callback, fns, gate, current }), [callback, fns, gate, current]);

  // Shadow equivalence
  const shadowStats = useMemo(() => {
    const total = diffs.length;
    const equiv = diffs.filter(d => d.is_equivalent).length;
    return { total, equiv, divergent: total - equiv, rate: total ? (equiv / total) * 100 : null };
  }, [diffs]);

  const platformStatus: { label: string; tone: string; detail: string } = useMemo(() => {
    if (!gate) return { label: "UNKNOWN", tone: "bg-muted", detail: "Readiness gate unavailable" };
    if (gate.critical_failures > 0) return { label: "BLOCKED", tone: healthTone("CRITICAL"), detail: `${gate.critical_failures} critical failures` };
    if (!gate.ready) return { label: "DEGRADED", tone: healthTone("DEGRADED"), detail: `${gate.warnings} warnings` };
    if ((current?.reliability_score ?? 0) < 95) return { label: "DEGRADED", tone: healthTone("DEGRADED"), detail: `Reliability ${current?.reliability_score.toFixed(1) ?? "?"}` };
    return { label: "READY FOR PRODUCTION", tone: healthTone("HEALTHY"), detail: `Score ${gate.score}/100` };
  }, [gate, current]);

  const canPromote = useMemo(() => promotionEligibility({ gate, current, callback, shadowStats, incidents }), [gate, current, callback, shadowStats, incidents]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary" /> Payment Operations Center
          </h1>
          <p className="text-sm text-muted-foreground">
            Single command interface — engineering, finance, support & operations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8 w-80"
              placeholder="Correlation / Checkout / Merchant / Attempt / Receipt ID"
              value={searchCorr}
              onChange={(e) => setSearchCorr(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && searchCorr.trim()) setDrillCorrelation(searchCorr.trim()); }}
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => void loadAll()} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      {/* CRITICAL INCIDENT BANNER — STK Push activity with zero callbacks */}
      {criticalIncident?.detected && (
        <Card className="border-2 border-destructive bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="destructive" className="text-sm">CRITICAL PAYMENT INCIDENT</Badge>
                  <span className="font-semibold text-destructive">Callbacks not reaching platform</span>
                </div>
                <p className="text-sm">
                  <strong>{criticalIncident.stk_accepted}</strong> STK Push requests accepted by Daraja in the last{" "}
                  {criticalIncident.window_minutes} minutes, but <strong>{criticalIncident.callbacks}</strong> callbacks were received.
                  Customers cannot complete payments.
                </p>
                <div className="text-xs bg-background/60 rounded p-2 border">
                  <div className="font-semibold mb-1">Recommended actions:</div>
                  <ol className="list-decimal ml-4 space-y-0.5">
                    <li>Verify Daraja callback URL points to <code>mpesa-callback</code> and is publicly reachable (HTTP 200).</li>
                    <li>Check firewall / Cloudflare rules blocking Safaricom callback IPs.</li>
                    <li>Inspect <code>callback_endpoint_registry</code> for the last successful heartbeat.</li>
                    <li>Roll back to last known-good deployment ({provenance?.deployment_version ?? "unknown"}).</li>
                  </ol>
                </div>
                {criticalIncident.samples.length > 0 && (
                  <div className="text-xs">
                    <div className="font-semibold mb-1">Affected correlation samples (click to replay):</div>
                    <div className="flex flex-wrap gap-1">
                      {criticalIncident.samples.slice(0, 6).map((s, i) => (
                        <button
                          key={i}
                          className="font-mono text-[11px] bg-background border rounded px-2 py-1 hover:bg-accent"
                          onClick={() => setDrillCorrelation(s.correlation_id ?? s.checkout_request_id ?? s.payment_attempt_id ?? "")}
                        >
                          {(s.correlation_id ?? s.checkout_request_id ?? "").slice(0, 12)}…
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}


      {/* PLATFORM STATUS BANNER */}
      <Card className="border-2">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
            <div className="md:col-span-1">
              <div className="text-xs uppercase text-muted-foreground mb-1">Can customers pay right now?</div>
              <Badge className={`${platformStatus.tone} text-base py-2 px-3`}>{platformStatus.label}</Badge>
              <div className="text-xs text-muted-foreground mt-2">{platformStatus.detail}</div>
            </div>
            <StatusTile
              icon={Heart} label="Callback Health"
              value={callback?.health ?? "UNKNOWN"}
              sub={`${callback?.inv_15m ?? 0} in 15m · ${callback?.inv_1h ?? 0}/1h`}
              tone={healthTone(callback?.health)}
            />
            <StatusTile
              icon={Gauge} label="Reliability Score"
              value={current ? current.reliability_score.toFixed(1) : "—"}
              sub={previous ? `Δ ${(current!.reliability_score - previous.reliability_score).toFixed(1)}` : "no baseline"}
              tone={scoreTone(current?.reliability_score)}
            />
            <StatusTile
              icon={AlertTriangle} label="Active Incidents"
              value={String(incidents.length)}
              sub={incidents.filter(i => i.severity === "critical").length + " critical"}
              tone={incidents.some(i => i.severity === "critical") ? healthTone("CRITICAL") : incidents.length ? healthTone("DEGRADED") : healthTone("HEALTHY")}
            />
          </div>
        </CardContent>
      </Card>

      {/* BUILD PROVENANCE STRIP */}
      <Card className="bg-muted/30">
        <CardContent className="py-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
          <span className="text-muted-foreground uppercase text-[10px]">Build provenance</span>
          <span><strong>Version:</strong> <span className="font-mono">{provenance?.deployment_version ?? "unknown"}</span></span>
          <span><strong>Git:</strong> <span className="font-mono">{provenance?.git_revision?.slice(0, 12) ?? "unknown"}</span></span>
          <span><strong>Built:</strong> {provenance?.build_timestamp ? new Date(provenance.build_timestamp).toLocaleString() : "—"}</span>
          <span><strong>Last certified:</strong> {fmtAgo(provenance?.certified_at)}</span>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="space-y-4">


        <TabsList className={`grid grid-cols-2 w-full ${hasForensicAccess ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
          <TabsTrigger value="overview"><ShieldCheck className="h-4 w-4 mr-1" /> Executive</TabsTrigger>
          <TabsTrigger value="live"><Activity className="h-4 w-4 mr-1" /> Live Operations</TabsTrigger>
          <TabsTrigger value="incidents"><AlertTriangle className="h-4 w-4 mr-1" /> Incidents</TabsTrigger>
          <TabsTrigger value="engineering"><Cpu className="h-4 w-4 mr-1" /> Engineering</TabsTrigger>
          <TabsTrigger value="finance"><DollarSign className="h-4 w-4 mr-1" /> Finance</TabsTrigger>
          {hasForensicAccess && (
            <TabsTrigger value="forensics"><Search className="h-4 w-4 mr-1" /> Forensics</TabsTrigger>
          )}
        </TabsList>

        {/* ===== EXECUTIVE OVERVIEW ===== */}
        <TabsContent value="overview" className="space-y-4">
          <CallbackHeartbeatCard cb={callback} onDrill={() => setDrillCorrelation("callback:latest")} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Workflow className="h-4 w-4" /> Payment Journey Status</CardTitle></CardHeader>
              <CardContent>
                {firstFailedStage && (
                  <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
                    <strong>Stalled at:</strong> {firstFailedStage} (first failed transition)
                  </div>
                )}
                <div className="space-y-1">
                  {STAGE_ORDER.map((k) => {
                    const s = stageStats[k];
                    const rate = s && s.total ? (s.ok / s.total) * 100 : null;
                    const avgLat = s && s.lat.length ? s.lat.reduce((a, b) => a + b, 0) / s.lat.length : null;
                    return (
                      <div key={k} className="flex items-center justify-between gap-2 py-1 border-b border-border/40 text-sm">
                        <span className="font-mono w-24 shrink-0">{k}</span>
                        <span className={`flex-1 ${rate == null ? "text-muted-foreground" : rate >= 95 ? "text-status-success" : rate >= 80 ? "text-status-warning" : "text-destructive"}`}>
                          {rate == null ? "no data" : `${rate.toFixed(0)}% ok`}
                        </span>
                        <span className="text-xs text-muted-foreground w-16 text-right">{avgLat ? `${avgLat.toFixed(0)}ms` : "—"}</span>
                        <span className="text-xs text-muted-foreground w-20 text-right">{s?.total ?? 0} evts</span>
                        <span className="text-xs text-muted-foreground w-20 text-right">{fmtAgo(s?.last)}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Gauge className="h-4 w-4" /> Reliability Score Trend
                  {current && previous && (() => {
                    const delta = current.reliability_score - previous.reliability_score;
                    if (Math.abs(delta) < 0.5) return <Badge variant="outline" className="ml-auto text-[10px]">STABLE</Badge>;
                    if (delta < 0) return <Badge className={`ml-auto ${healthTone("CRITICAL")} text-[10px]`}>REGRESSION {delta.toFixed(1)}</Badge>;
                    return <Badge className={`ml-auto ${healthTone("HEALTHY")} text-[10px]`}>IMPROVING +{delta.toFixed(1)}</Badge>;
                  })()}
                  <Badge variant="outline" className="text-[10px]">
                    Confidence {snapshots.length >= 20 ? "HIGH" : snapshots.length >= 5 ? "MED" : "LOW"} · n={snapshots.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2 text-center mb-3">
                  <MiniStat label="Current" value={current ? current.reliability_score.toFixed(1) : "—"} tone={scoreClass(current?.reliability_score)} />
                  <MiniStat label="Previous" value={previous ? previous.reliability_score.toFixed(1) : "—"} />
                  <MiniStat label="7d avg" value={avg7d != null ? avg7d.toFixed(1) : "—"} />
                  <MiniStat label="30d avg" value={avg30d != null ? avg30d.toFixed(1) : "—"} />
                </div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="t" hide />
                      <YAxis domain={[0, 100]} width={30} />
                      <Tooltip />
                      <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {current && (
                  <div className="grid grid-cols-5 gap-1 text-[10px] uppercase text-muted-foreground mt-2">
                    <MiniStat label="callback" value={current.callback_score.toFixed(0)} compact />
                    <MiniStat label="journey" value={current.journey_score.toFixed(0)} compact />
                    <MiniStat label="edge" value={current.edge_function_score.toFixed(0)} compact />
                    <MiniStat label="slo" value={current.slo_score.toFixed(0)} compact />
                    <MiniStat label="cert" value={current.certification_score.toFixed(0)} compact />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <PromotionPolicyCard flag={flag} gate={gate} eligibility={canPromote} />
        </TabsContent>

        {/* ===== LIVE OPERATIONS ===== */}
        <TabsContent value="live" className="space-y-4">
          <CallbackHeartbeatCard cb={callback} onDrill={() => setDrillCorrelation("callback:latest")} />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <ProjectionConsistencyTile projection={projection} onScan={runDriftScan} scanning={scanning} />

            <MetricCard label="Callback 24h" value={callback?.inv_24h ?? 0} sub={`${callback?.ok_24h ?? 0} ok`} />
            <MetricCard label="Callback Success" value={callback?.success_rate_24h != null ? `${Number(callback.success_rate_24h).toFixed(1)}%` : "—"} />
            <MetricCard label="Journey Stages (24h)" value={stages.length} />
            <MetricCard label="Payment Fns Healthy" value={`${fns.filter(f => f.is_payment_critical && f.health === "HEALTHY").length}/${fns.filter(f => f.is_payment_critical).length}`} />
          </div>

          <ForensicCertificationCard />



          {/* SLOs — leverage payment_slos + payment_slo_measurements */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Gauge className="h-4 w-4" /> Service Level Objectives
              </CardTitle>
            </CardHeader>
            <CardContent>
              {slos.length === 0 ? (
                <div className="text-sm text-muted-foreground">No active SLOs configured.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {slos.map(s => {
                    const hasMeasurement = Number.isFinite(s.actual_value);
                    const tone = !hasMeasurement ? "bg-muted" : s.compliant ? "bg-status-success/10 border-status-success/30" : "bg-destructive/5 border-destructive/30";
                    const unit = s.unit === "percent" ? "%" : s.unit === "ms" ? "ms" : "";
                    return (
                      <div key={s.slo_id} className={`border rounded p-3 ${tone}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-sm font-medium">{s.name}</div>
                          <Badge variant={s.compliant ? "secondary" : "destructive"} className="text-[10px]">
                            {hasMeasurement ? (s.compliant ? "OK" : "BREACH") : "NO DATA"}
                          </Badge>
                        </div>
                        <div className="font-mono text-xs">
                          {hasMeasurement ? `${s.actual_value.toFixed(2)}${unit}` : "—"}
                          <span className="text-muted-foreground"> {s.comparator} {Number(s.target_value).toFixed(2)}{unit}</span>
                        </div>
                        {s.burn_rate != null && s.burn_rate > 0 && (
                          <div className={`text-[10px] mt-1 ${s.burn_rate > 1 ? "text-destructive" : "text-muted-foreground"}`}>
                            burn {Number(s.burn_rate).toFixed(2)}× · {s.window_minutes}m window
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Recent Journey Stages</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-72">
                <table className="w-full text-xs font-mono">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left p-1">Time</th><th className="text-left p-1">Stage</th><th className="text-left p-1">Status</th><th className="text-right p-1">Latency</th><th className="text-left p-1">Correlation</th></tr>
                  </thead>
                  <tbody>
                    {stages.slice(0, 100).map(s => (
                      <tr key={s.id} className="border-t border-border/40">
                        <td className="p-1">{fmtTime(s.occurred_at)}</td>
                        <td className="p-1">{s.stage_key}</td>
                        <td className={`p-1 ${s.status === "success" ? "text-status-success" : s.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{s.status}</td>
                        <td className="p-1 text-right">{s.latency_ms ? `${s.latency_ms}ms` : "—"}</td>
                        <td className="p-1"><button className="hover:underline text-primary" onClick={() => setDrillCorrelation(s.correlation_id)}>{s.correlation_id?.slice(0, 12)}…</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== INCIDENTS ===== */}
        <TabsContent value="incidents" className="space-y-4">
          {incidents.length === 0 && (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-status-success" /> No active operational incidents.
            </CardContent></Card>
          )}
          <div className="space-y-3">
            {incidents.map(inc => (
              <Card key={inc.id} className={inc.severity === "critical" ? "border-destructive/50" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Badge className={inc.severity === "critical" ? "bg-destructive" : inc.severity === "high" ? "bg-status-warning" : "bg-muted"}>{inc.severity.toUpperCase()}</Badge>
                        {inc.title}
                      </CardTitle>
                      <div className="text-xs text-muted-foreground mt-1">
                        Incident {inc.id} · impact: {inc.impact} · classification: {inc.classification}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{inc.detected}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm mb-2">{inc.description}</div>
                  <div className="text-xs text-muted-foreground"><strong>Recommendation:</strong> {inc.recommendation}</div>
                  {inc.evidenceLinks.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {inc.evidenceLinks.map(l => (
                        <Link key={l.href} to={l.href} className="text-primary hover:underline flex items-center gap-1"><ExternalLink className="h-3 w-3" />{l.label}</Link>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ===== ENGINEERING ===== */}
        <TabsContent value="engineering" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Cpu className="h-4 w-4" /> Edge Function Health</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-96">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground text-left">
                    <tr>
                      <th className="p-1">Function</th><th className="p-1">Health</th>
                      <th className="p-1 text-right">1h inv</th><th className="p-1 text-right">24h inv</th>
                      <th className="p-1 text-right">Success</th><th className="p-1 text-right">Avg latency</th>
                      <th className="p-1">Last invocation</th><th className="p-1">Last success</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fns.map(f => (
                      <tr key={f.function_name} className={`border-t border-border/40 ${f.is_payment_critical ? "font-medium" : "opacity-80"}`}>
                        <td className="p-1 font-mono">{f.function_name}{f.is_payment_critical && <span className="ml-1 text-primary">★</span>}</td>
                        <td className="p-1"><Badge className={healthTone(f.health)}>{f.health}</Badge></td>
                        <td className="p-1 text-right">{f.inv_1h}</td>
                        <td className="p-1 text-right">{f.inv_24h}</td>
                        <td className="p-1 text-right">{f.success_rate_24h != null ? `${Number(f.success_rate_24h).toFixed(1)}%` : "—"}</td>
                        <td className="p-1 text-right">{f.avg_latency_1h_ms ? `${Math.round(f.avg_latency_1h_ms)}ms` : "—"}</td>
                        <td className="p-1">{fmtAgo(f.last_invocation_at)}</td>
                        <td className="p-1">{fmtAgo(f.last_success_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Zap className="h-4 w-4" /> Shadow Mode Validation</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3 mb-3">
                <MetricCard label="Compared" value={shadowStats.total} />
                <MetricCard label="Equivalent" value={shadowStats.equiv} />
                <MetricCard label="Divergent" value={shadowStats.divergent} />
                <MetricCard label="Equivalence" value={shadowStats.rate != null ? `${shadowStats.rate.toFixed(1)}%` : "—"} />
              </div>
              <ScrollArea className="h-48">
                <table className="w-full text-xs font-mono">
                  <thead className="text-muted-foreground text-left">
                    <tr><th className="p-1">Time</th><th className="p-1">Correlation</th><th className="p-1">Equivalent</th><th className="p-1">Divergent keys</th><th className="p-1 text-right">Legacy</th><th className="p-1 text-right">Shadow</th></tr>
                  </thead>
                  <tbody>
                    {diffs.map(d => (
                      <tr key={d.id} className="border-t border-border/40">
                        <td className="p-1">{fmtTime(d.created_at)}</td>
                        <td className="p-1"><button className="text-primary hover:underline" onClick={() => setDrillCorrelation(d.correlation_id)}>{d.correlation_id.slice(0, 12)}…</button></td>
                        <td className="p-1">{d.is_equivalent ? <CheckCircle2 className="h-3 w-3 text-status-success inline" /> : <XCircle className="h-3 w-3 text-destructive inline" />}</td>
                        <td className="p-1">{d.diff_keys?.join(", ") || "—"}</td>
                        <td className="p-1 text-right">{d.legacy_duration_ms ?? "—"}ms</td>
                        <td className="p-1 text-right">{d.shadow_duration_ms ?? "—"}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== FINANCE ===== */}
        <TabsContent value="finance" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4" /> Finance & Settlement</CardTitle></CardHeader>
            <CardContent>
              <FinancePanel />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Related dashboards</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              <Link to="/dashboard/admin/payment-journey" className="text-primary hover:underline flex items-center gap-1"><ExternalLink className="h-3 w-3" /> Payment Journey Explorer</Link>
              <Link to="/dashboard/admin/payment-certification" className="text-primary hover:underline flex items-center gap-1"><ExternalLink className="h-3 w-3" /> Certification Center</Link>
              <Link to="/dashboard/admin/payment-dlq" className="text-primary hover:underline flex items-center gap-1"><ExternalLink className="h-3 w-3" /> Payment DLQ</Link>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== FORENSICS (Slice A) — server-enforced RBAC (Slice D4) ===== */}
        {hasForensicAccess && (
          <TabsContent value="forensics" className="space-y-4">
            {/* Panel 1 & 2 — Forensics Explorer + Twin Replay v2 (existing) */}
            <PaymentForensicsPanel />
            {/* Panel 3 — Dependency Graph (Slice C, telemetry-derived) */}
            <DependencyGraphPanel />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Panel 4 — Recommendations (advisory-only) */}
              <RecommendationsPanel />
              {/* Incident Correlation timeline (cause-chain grouping) */}
              <IncidentCorrelationPanel />
            </div>
            {/* D5.1 — Continuous qualification lifecycle (14-step) */}
            <ContinuousQualificationPanel />
            {/* D5 — Continuous qualification manual rerun + forecast drift */}
            <QualificationGovernancePanel />
          </TabsContent>
        )}
      </Tabs>


      <DrillDownDialog correlationId={drillCorrelation} onClose={() => setDrillCorrelation(null)} />
    </div>
  );
}

// ---------- Subcomponents ----------
function StatusTile({ icon: Icon, label, value, sub, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <Badge className={`${tone} text-sm`}>{value}</Badge>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ProjectionConsistencyTile({ projection, onScan, scanning }: {
  projection: { open_incidents: number; failed_runs_24h: number; last_incident_at: string | null; drift_score: number | null; drift_critical: number; drift_major: number; drift_scanned: number; drift_scan_at: string | null; blocked_promotion: boolean };
  onScan?: () => void;
  scanning?: boolean;
}) {
  const score = projection.drift_score;
  const healthy = projection.open_incidents === 0 && projection.failed_runs_24h === 0 && (score === null || score >= 100);
  const scoreLabel = score === null ? "—" : `${score}%`;
  return (
    <Card className={healthy ? "border-status-success/30 bg-status-success/5" : "border-destructive/40 bg-destructive/5"}>
      <CardContent className="pt-4 space-y-1">
        <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" /> Projection Consistency
          {projection.blocked_promotion && <Badge variant="destructive" className="ml-auto text-[10px] px-1">Blocks promotion</Badge>}
        </div>
        <div className={`text-2xl font-bold ${healthy ? "text-status-success" : "text-destructive"}`}>
          {scoreLabel} <span className="text-xs font-normal">{healthy ? "Healthy" : "Drift"}</span>
        </div>
        <div className="text-[11px] text-muted-foreground leading-tight">
          {projection.drift_scanned} scanned · {projection.drift_critical} critical · {projection.drift_major} major
          <div>{projection.open_incidents} open incidents · {projection.failed_runs_24h} failed runs 24h</div>
          {projection.drift_scan_at && <div className="font-mono">scan {fmtTime(projection.drift_scan_at)}</div>}
        </div>
        {onScan && (
          <Button size="sm" variant="outline" className="h-7 text-xs w-full mt-1" onClick={onScan} disabled={scanning}>
            {scanning ? "Scanning…" : "Run drift scan"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}


function MiniStat({ label, value, tone, compact }: { label: string; value: string; tone?: string; compact?: boolean }) {
  return (
    <div className={compact ? "" : "rounded-md border p-2"}>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`font-bold ${compact ? "text-sm" : "text-lg"} ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function CallbackHeartbeatCard({ cb, onDrill }: { cb: CallbackHealth | null; onDrill: () => void }) {
  const alarm = cb && cb.inv_15m === 0 && cb.inv_1h === 0;
  return (
    <Card className={alarm ? "border-destructive border-2" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Heart className={`h-4 w-4 ${alarm ? "text-destructive animate-pulse" : "text-status-success"}`} />
          Callback Heartbeat — Primary KPI
          <Badge className={`ml-auto ${healthTone(cb?.health)}`}>{cb?.health ?? "UNKNOWN"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alarm && (
          <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
            <strong>CRITICAL:</strong> Zero callback invocations detected. This is the original production defect.
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <MetricCard label="15 min" value={cb?.inv_15m ?? 0} />
          <MetricCard label="1 hour" value={cb?.inv_1h ?? 0} />
          <MetricCard label="24 hours" value={cb?.inv_24h ?? 0} sub={`${cb?.ok_24h ?? 0} ok`} />
          <MetricCard label="Success 24h" value={cb?.success_rate_24h != null ? `${Number(cb.success_rate_24h).toFixed(1)}%` : "—"} />
          <MetricCard label="Last callback" value={fmtAgo(cb?.last_invocation_at)} />
          <div className="flex items-center justify-center"><Button size="sm" variant="outline" onClick={onDrill}>Drill down</Button></div>
        </div>
      </CardContent>
    </Card>
  );
}

function PromotionPolicyCard({ flag, gate, eligibility }: { flag: OrchestratorFlag | null; gate: GateResult | null; eligibility: { eligible: boolean; failures: string[] } }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Payment Orchestrator Promotion Policy
          <Badge className={`ml-auto ${eligibility.eligible ? healthTone("HEALTHY") : healthTone("CRITICAL")}`}>
            {eligibility.eligible ? "MAY PROMOTE" : "PROMOTION BLOCKED"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-xs">
          <MiniStat label="Flag" value={flag?.enabled ? "ENABLED" : "OFF"} />
          <MiniStat label="Shadow mode" value={flag?.shadow_mode ? "ON" : "OFF"} />
          <MiniStat label="Rollout %" value={String(flag?.rollout_percent ?? 0)} />
          <MiniStat label="Kill switch" value={flag?.kill_switch ? "ARMED" : "SAFE"} />
        </div>
        {eligibility.failures.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            <strong>Blocking conditions:</strong>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              {eligibility.failures.map(f => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}
        {gate && (
          <div className="mt-3 text-[11px] text-muted-foreground">
            Gate score {gate.score}/100 · {gate.passed_checks.length} passed · {gate.failed_checks.length} failed · evaluated {fmtAgo(gate.evaluated_at)}
          </div>
        )}
        <AutonomousControlPanel />
      </CardContent>
    </Card>
  );
}

function AutonomousControlPanel() {
  const [decisions, setDecisions] = useState<Array<{ id: string; decided_at: string; action: string; from_percent: number; to_percent: number; reason: string; reliability_score: number | null; callback_health: string | null }>>([]);
  const [running, setRunning] = useState(false);
  const [exportId, setExportId] = useState("");
  const [exportKind, setExportKind] = useState<"correlation_id" | "checkout_request_id" | "merchant_request_id" | "payment_attempt_id" | "payment_session_id">("correlation_id");
  const [exportResult, setExportResult] = useState<{ bundle_sha256?: string; row_count?: number; error?: string } | null>(null);

  const load = async () => {
    const { data } = await supabase.from("payment_orchestrator_decisions" as never).select("id,decided_at,action,from_percent,to_percent,reason,reliability_score,callback_health").order("decided_at", { ascending: false }).limit(10);
    setDecisions((data as never) ?? []);
  };
  useEffect(() => { void load(); }, []);

  const runController = async () => {
    setRunning(true);
    try {
      await supabase.functions.invoke("payment-orchestrator-controller", { body: {} });
      await load();
    } finally { setRunning(false); }
  };

  const runExport = async () => {
    setExportResult(null);
    const { data, error } = await supabase.functions.invoke("payment-evidence-export", {
      body: { identifier_kind: exportKind, identifier_value: exportId.trim() },
    });
    if (error) setExportResult({ error: error.message });
    else setExportResult({ bundle_sha256: (data as LooseRow)?.export?.bundle_sha256, row_count: (data as LooseRow)?.export?.row_count });
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Autonomous Control</div>
        <button onClick={runController} disabled={running} className="text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-50">
          {running ? "Evaluating…" : "Evaluate now"}
        </button>
      </div>
      <div className="rounded-md border divide-y max-h-56 overflow-auto">
        {decisions.length === 0 && <div className="p-3 text-xs text-muted-foreground">No autonomous decisions yet.</div>}
        {decisions.map(d => (
          <div key={d.id} className="p-2 text-xs flex items-start gap-2">
            <Badge className={
              d.action === "rollback" ? healthTone("CRITICAL")
              : d.action === "promote" ? healthTone("HEALTHY")
              : d.action === "hold" ? healthTone("DEGRADED") : "bg-muted text-muted-foreground"
            }>{d.action}</Badge>
            <div className="flex-1 min-w-0">
              <div className="truncate"><strong>{d.from_percent}% → {d.to_percent}%</strong> · reliability {d.reliability_score?.toFixed(1) ?? "—"} · cb {d.callback_health ?? "—"}</div>
              <div className="text-muted-foreground truncate">{d.reason}</div>
            </div>
            <div className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtAgo(d.decided_at)}</div>
          </div>
        ))}
      </div>

      <div className="rounded-md border p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Evidence Export</div>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={exportKind} onChange={e => setExportKind(e.target.value as never)} className="text-xs border rounded px-2 py-1 bg-background">
            <option value="correlation_id">Correlation ID</option>
            <option value="checkout_request_id">CheckoutRequestID</option>
            <option value="merchant_request_id">MerchantRequestID</option>
            <option value="payment_attempt_id">Payment Attempt ID</option>
            <option value="payment_session_id">Payment Session ID</option>
          </select>
          <input value={exportId} onChange={e => setExportId(e.target.value)} placeholder="identifier value" className="text-xs border rounded px-2 py-1 flex-1 min-w-[200px] bg-background" />
          <button data-analytics="paymentoperationscenter.export" onClick={runExport} disabled={!exportId.trim()} className="text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-50">Export bundle</button>
        </div>
        {exportResult && (
          <div className="mt-2 text-[11px] font-mono break-all">
            {exportResult.error
              ? <span className="text-destructive">Error: {exportResult.error}</span>
              : <>SHA-256: {exportResult.bundle_sha256} · rows: {exportResult.row_count}</>}
          </div>
        )}
      </div>
      <Phase52Panel />
    </div>
  );
}

// ---------- Phase 5.2 — Production Qualification Panel ----------
function Phase52Panel() {
  const [dryRun, setDryRun] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [forecasts, setForecasts] = useState<LooseRow[]>([]);
  const [approvals, setApprovals] = useState<LooseRow[]>([]);
  const [verifyState, setVerifyState] = useState<{ id: string; stored: string; computed: string; ok: boolean } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const loadAll = useCallback(async () => {
    const [{ data: fRows }, { data: aRows }] = await Promise.all([
      supabase.from("payment_reliability_forecasts" as never).select("*").order("computed_at", { ascending: false }).limit(6),
      supabase.from("payment_orchestrator_approvals" as never).select("id,to_percent,status,approval_expiration,reason,confidence_score,approver_role,created_at").in("status", ["pending", "approved"]).order("created_at", { ascending: false }).limit(5),
    ]);
    setForecasts((fRows as never) ?? []);
    setApprovals((aRows as never) ?? []);
  }, []);
  useEffect(() => { void loadAll(); }, [loadAll]);

  const runDryRun = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("payment-orchestrator-dry-run", { body: {} });
      setDryRun(error ? { error: error.message } : data);
    } finally { setRunning(false); }
  };
  const runForecast = async () => {
    await supabase.functions.invoke("payment-reliability-forecast", { body: {} });
    await loadAll();
  };

  const verifyExport = async (exportId: string) => {
    setVerifying(true);
    try {
      const { data: exp } = await supabase.from("payment_evidence_exports" as never).select("bundle_sha256,bundle").eq("id", exportId).maybeSingle();
      if (!exp) { setVerifyState({ id: exportId, stored: "—", computed: "—", ok: false }); return; }
      // Must match the server canonicalization in payment-evidence-export/index.ts
      // (recursive key sort, JSON.stringify, no whitespace). jsonb drops key
      // insertion order, so a naive JSON.stringify would never match.
      const canonicalStringify = (value: unknown): string => {
        if (value === null || typeof value !== "object") return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
        const entries = Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(",")}}`;
      };
      const bundleStr = canonicalStringify((exp as LooseRow).bundle);
      const buf = new TextEncoder().encode(bundleStr);
      const hashBuf = await crypto.subtle.digest("SHA-256", buf);
      const computed = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
      setVerifyState({ id: exportId, stored: (exp as LooseRow).bundle_sha256, computed, ok: computed === (exp as LooseRow).bundle_sha256 });
    } finally { setVerifying(false); }
  };

  return (
    <div className="mt-4 space-y-3 pt-3 border-t">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Phase 5.2 — Production Qualification
      </div>

      {/* Dry-run */}
      <div className="rounded-md border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold">Promotion Dry-Run</div>
          <button onClick={runDryRun} disabled={running} className="text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-50">
            {running ? "Evaluating…" : "Run dry-run"}
          </button>
        </div>
        {dryRun && !dryRun.error && (
          <div className="text-xs space-y-1">
            <div className="flex items-center gap-2">
              <Badge className={dryRun.would_promote ? healthTone("HEALTHY") : healthTone("DEGRADED")}>
                {dryRun.would_promote ? "WOULD PROMOTE" : "HOLD"}
              </Badge>
              <span>{dryRun.current_stage}% → {dryRun.proposed_stage}%</span>
              <span className="ml-auto font-mono">confidence {dryRun.confidence_score}%</span>
            </div>
            {(dryRun.blocking_conditions ?? []).length > 0 && (
              <ul className="list-disc pl-5 text-muted-foreground">
                {dryRun.blocking_conditions.map((b: string) => <li key={b}>{b}</li>)}
              </ul>
            )}
            {(dryRun.warnings ?? []).length > 0 && (
              <div className="text-status-warning dark:text-status-warning">⚠ {dryRun.warnings.join("; ")}</div>
            )}
            {dryRun.rollback_simulation && (
              <div className="mt-2 rounded-md bg-muted/40 p-2">
                <div className="font-semibold">Rollback impact simulation</div>
                <div className="grid grid-cols-3 gap-2 mt-1 font-mono">
                  <div>active: {dryRun.rollback_simulation.active_sessions}</div>
                  <div>pending: {dryRun.rollback_simulation.pending_stk_attempts}</div>
                  <div>inflight cb: {dryRun.rollback_simulation.inflight_callbacks}</div>
                  <div>users: ~{dryRun.rollback_simulation.estimated_affected_users}</div>
                  <div>recover: ~{dryRun.rollback_simulation.estimated_recovery_seconds}s</div>
                  <div>risk: {dryRun.rollback_simulation.risk_level}</div>
                </div>
              </div>
            )}
          </div>
        )}
        {dryRun?.error && <div className="text-xs text-destructive">Error: {dryRun.error}</div>}
      </div>

      {/* Production approvals */}
      <div className="rounded-md border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold">Production Approvals</div>
          <span className="text-[10px] text-muted-foreground">env-aware promotion governance</span>
        </div>
        {approvals.length === 0 && <div className="text-xs text-muted-foreground">No approvals in-flight.</div>}
        {approvals.map(a => (
          <div key={a.id} className="text-xs py-1 flex items-center gap-2 border-b last:border-b-0">
            <Badge className={a.status === "approved" ? healthTone("HEALTHY") : healthTone("DEGRADED")}>{a.status}</Badge>
            <span>→ {a.to_percent}%</span>
            {a.confidence_score != null && <span className="font-mono text-muted-foreground">c {a.confidence_score}%</span>}
            <span className="truncate flex-1 text-muted-foreground">{a.reason}</span>
            <span className="text-[10px] text-muted-foreground">exp {fmtAgo(a.approval_expiration)}</span>
          </div>
        ))}
      </div>

      {/* Reliability forecasts */}
      <div className="rounded-md border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold">Reliability Forecast</div>
          <button onClick={runForecast} className="text-xs px-2 py-1 rounded border hover:bg-muted">Recompute</button>
        </div>
        {forecasts.length === 0 && <div className="text-xs text-muted-foreground">No forecast yet. Requires ≥3 reliability snapshots.</div>}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {forecasts.map(f => (
            <div key={f.id} className="rounded border p-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-semibold uppercase">{f.component}</span>
                <Badge className={healthTone(f.predicted_status)}>{f.predicted_status}</Badge>
              </div>
              <div className="text-muted-foreground">now: {f.current_status} · p={f.probability}%</div>
              {f.eta_minutes && <div className="text-muted-foreground">ETA ~{f.eta_minutes}m</div>}
              <div className="truncate">{f.likely_cause}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Evidence integrity verify */}
      <div className="rounded-md border p-3">
        <div className="text-xs font-semibold mb-2">Evidence Integrity Verification</div>
        <div className="flex flex-wrap gap-2 items-center">
          <input id="verify-export-id" placeholder="evidence export id (uuid)" className="text-xs border rounded px-2 py-1 flex-1 min-w-[240px] bg-background" />
          <button
            onClick={() => {
              const el = document.getElementById("verify-export-id") as HTMLInputElement | null;
              if (el?.value) void verifyExport(el.value.trim());
            }}
            disabled={verifying}
            className="text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-50"
          >{verifying ? "Verifying…" : "Verify SHA-256"}</button>
        </div>
        {verifyState && (
          <div className={`mt-2 text-[11px] font-mono break-all rounded p-2 ${verifyState.ok ? "bg-status-success/10 border border-status-success/40" : "bg-destructive/10 border border-destructive/40"}`}>
            <div className="font-sans font-semibold">{verifyState.ok ? "PASS — bundle unaltered" : "FAILED — hash mismatch"}</div>
            <div>stored:  {verifyState.stored}</div>
            <div>computed:{verifyState.computed}</div>
          </div>
        )}
      </div>
    </div>
  );
}


function FinancePanel() {
  const [rows, setRows] = useState<{ total: number; wallet_posted: number; completed: number; failed: number; sum_kes: number } | null>(null);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("payment_attempts").select("state,wallet_posted,amount_cents").gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()).limit(1000);
      const list = (data ?? []) as Array<{ state: string; wallet_posted: boolean; amount_cents: number }>;
      setRows({
        total: list.length,
        wallet_posted: list.filter(r => r.wallet_posted).length,
        completed: list.filter(r => r.state === "completed").length,
        failed: list.filter(r => r.state === "failed").length,
        sum_kes: list.filter(r => r.state === "completed").reduce((a, b) => a + (b.amount_cents || 0), 0) / 100,
      });
    })();
  }, []);
  if (!rows) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const gap = rows.completed - rows.wallet_posted;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="Attempts 24h" value={rows.total} />
        <MetricCard label="Completed" value={rows.completed} />
        <MetricCard label="Wallet posted" value={rows.wallet_posted} />
        <MetricCard label="Failed" value={rows.failed} />
        <MetricCard label="Revenue 24h" value={`KES ${rows.sum_kes.toLocaleString()}`} />
      </div>
      {gap > 0 && (
        <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-2 text-xs">
          <strong>Ledger gap:</strong> {gap} completed payments have no wallet posting — investigate settlement reconciliation.
        </div>
      )}
    </div>
  );
}

interface TwinBundle {
  found: boolean;
  identifier: string;
  resolved: { correlation_id: string | null; checkout_request_id: string | null; merchant_request_id: string | null; payment_attempt_id: string | null };
  attempt: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
  traces: Array<Record<string, unknown>>;
  state_transitions: Array<Record<string, unknown>>;
  stk_attempts: Array<Record<string, unknown>>;
  callbacks: Array<Record<string, unknown>>;
  wallet_activity: Array<Record<string, unknown>>;
  latest_certification: Record<string, unknown> | null;
}

function DrillDownDialog({ correlationId, onClose }: { correlationId: string | null; onClose: () => void }) {
  const [twin, setTwin] = useState<TwinBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!correlationId || correlationId.startsWith("callback:")) { setTwin(null); return; }
    setLoading(true); setError(null); setTwin(null);
    void (async () => {
      const { data, error } = await supabase.rpc("payment_digital_twin", { p_identifier: correlationId });
      if (error) setError(error.message);
      else setTwin(data as unknown as TwinBundle);
      setLoading(false);
    })();
  }, [correlationId]);

  const resolved = twin?.resolved;
  return (
    <Dialog open={!!correlationId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Radio className="h-4 w-4" /> Payment Digital Twin
            <span className="font-mono text-xs text-muted-foreground">· {correlationId}</span>
          </DialogTitle>
        </DialogHeader>
        {loading && <div className="text-sm text-muted-foreground">Loading immutable evidence bundle…</div>}
        {error && <div className="text-sm text-destructive">Lookup failed: {error}</div>}
        {twin && !twin.found && <div className="text-sm text-muted-foreground">No payment records matched this identifier.</div>}
        {twin?.found && (
          <ScrollArea className="max-h-[75vh] pr-3">
            {/* Resolved identifiers */}
            <section className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono">
              <TwinKV label="Correlation" value={resolved?.correlation_id} />
              <TwinKV label="Checkout Request" value={resolved?.checkout_request_id} />
              <TwinKV label="Merchant Request" value={resolved?.merchant_request_id} />
              <TwinKV label="Attempt ID" value={resolved?.payment_attempt_id} />
            </section>

            {/* Attempt summary */}
            {twin.attempt && (
              <section className="mb-4 border rounded p-3 bg-muted/30">
                <h3 className="text-sm font-semibold mb-2">Payment Attempt</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <TwinKV label="State" value={String(twin.attempt.state ?? "")} />
                  <TwinKV label="Amount" value={`${(Number(twin.attempt.amount_cents ?? 0) / 100).toFixed(2)} ${String(twin.attempt.currency ?? "KES")}`} />
                  <TwinKV label="Wallet Posted" value={twin.attempt.wallet_posted ? "yes" : "no"} />
                  <TwinKV label="Receipt" value={String(twin.attempt.mpesa_receipt_number ?? "—")} />
                  <TwinKV label="Initiated" value={fmtTime(String(twin.attempt.initiated_at ?? twin.attempt.created_at ?? ""))} />
                  <TwinKV label="Completed" value={twin.attempt.completed_at ? fmtTime(String(twin.attempt.completed_at)) : "—"} />
                  <TwinKV label="Failure" value={String(twin.attempt.failure_reason ?? "—")} />
                  <TwinKV label="Provider" value={String(twin.attempt.provider ?? "mpesa")} />
                </div>
              </section>
            )}

            {/* Timeline: events */}
            <section className="mb-4">
              <h3 className="text-sm font-semibold mb-2">Journey Events ({twin.events.length})</h3>
              {twin.events.length === 0 && <div className="text-xs text-muted-foreground">No events found.</div>}
              <div className="space-y-1 font-mono text-xs">
                {twin.events.map((e, i) => (
                  <div key={i} className="border-l-2 border-primary/40 pl-2 py-1">
                    <div className="flex justify-between">
                      <span>{String(e.event_key)} <Badge variant="outline" className="ml-1 text-[10px]">{String(e.event_status ?? "")}</Badge></span>
                      <span className="text-muted-foreground">{fmtTime(String(e.occurred_at))}</span>
                    </div>
                    <div className="text-muted-foreground">{String(e.source_component ?? "")} · {e.latency_ms ? `${e.latency_ms}ms` : ""}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* State transitions */}
            <section className="mb-4">
              <h3 className="text-sm font-semibold mb-2">State Machine Transitions ({twin.state_transitions.length})</h3>
              {twin.state_transitions.length === 0 && <div className="text-xs text-muted-foreground">No transitions recorded.</div>}
              <div className="space-y-1 font-mono text-xs">
                {twin.state_transitions.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{String(s.from_state ?? "∅")}</Badge>
                    <span>→</span>
                    <Badge className="text-[10px]">{String(s.to_state)}</Badge>
                    <span className="text-muted-foreground">by {String(s.actor ?? s.source_function ?? "?")}</span>
                    <span className="ml-auto text-muted-foreground">{fmtTime(String(s.occurred_at))}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* STK Push attempts */}
            <section className="mb-4">
              <h3 className="text-sm font-semibold mb-2">STK Push Attempts ({twin.stk_attempts.length})</h3>
              {twin.stk_attempts.map((a, i) => (
                <div key={i} className="border rounded p-2 mb-1 text-xs">
                  <div className="flex justify-between">
                    <span>#{String(a.attempt_number ?? 1)} · {String(a.outcome ?? "?")}</span>
                    <span className="text-muted-foreground">{fmtTime(String(a.created_at))}</span>
                  </div>
                  <div className="text-muted-foreground font-mono">
                    HTTP {String(a.http_status ?? "?")} · latency {String(a.latency_ms ?? "?")}ms
                    {a.error_code ? ` · ${String(a.error_code)}` : ""}
                    {a.error_message ? ` — ${String(a.error_message)}` : ""}
                  </div>
                </div>
              ))}
              {twin.stk_attempts.length === 0 && <div className="text-xs text-muted-foreground">No STK Push attempts recorded.</div>}
            </section>

            {/* Callback evidence — headers + payload + source IP */}
            <section className="mb-4">
              <h3 className="text-sm font-semibold mb-2">Callback Evidence ({twin.callbacks.length})</h3>
              {twin.callbacks.length === 0 && (
                <div className="text-xs text-destructive">
                  ⚠ No callback received. If STK was accepted, Daraja could not reach the platform.
                </div>
              )}
              {twin.callbacks.map((c, i) => (
                <details key={i} className="border rounded p-2 mb-1 text-xs">
                  <summary className="cursor-pointer flex justify-between">
                    <span>{fmtTime(String(c.received_at))} · from {String(c.ip_address ?? "unknown")} · {c.verified ? "✓ verified" : "✗ unverified"}</span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    <div>
                      <div className="text-muted-foreground text-[10px] uppercase mb-1">Headers</div>
                      <pre className="bg-muted p-2 rounded overflow-auto text-[10px]">{JSON.stringify(c.headers ?? {}, null, 2)}</pre>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px] uppercase mb-1">Payload</div>
                      <pre className="bg-muted p-2 rounded overflow-auto text-[10px]">{JSON.stringify(c.payload ?? {}, null, 2)}</pre>
                    </div>
                  </div>
                </details>
              ))}
            </section>

            {/* Wallet & ledger */}
            <section className="mb-4">
              <h3 className="text-sm font-semibold mb-2">Wallet & Ledger Activity ({twin.wallet_activity.length})</h3>
              {twin.wallet_activity.length === 0 && <div className="text-xs text-muted-foreground">No wallet posting linked.</div>}
              <div className="space-y-1 font-mono text-xs">
                {twin.wallet_activity.map((w, i) => (
                  <div key={i} className="flex justify-between border-b border-border/40 py-1">
                    <span>
                      <Badge variant="outline" className="text-[10px] mr-1">{String(w.direction ?? "")}</Badge>
                      {String(w.kind ?? "")} · {String(w.status ?? "")}
                    </span>
                    <span>{(Number(w.amount_cents ?? 0) / 100).toFixed(2)}</span>
                    <span className="text-muted-foreground">{fmtTime(String(w.created_at))}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Step traces */}
            <section className="mb-4">
              <h3 className="text-sm font-semibold mb-2">Step Traces ({twin.traces.length})</h3>
              <div className="space-y-1 font-mono text-xs">
                {twin.traces.map((t, i) => (
                  <div key={i} className="border-l-2 border-muted pl-2 py-1">
                    <div className="flex justify-between">
                      <span>{String(t.function_name)} #{String(t.step_number)} — {String(t.step_name)}</span>
                      <Badge variant={String(t.status) === "success" ? "outline" : "destructive"} className="text-[10px]">{String(t.status)}</Badge>
                    </div>
                    {t.error_message ? <div className="text-destructive">{String(t.error_message)}</div> : null}
                  </div>
                ))}
                {twin.traces.length === 0 && <div className="text-xs text-muted-foreground">No step traces.</div>}
              </div>
            </section>

            {/* Certification context */}
            {twin.latest_certification && (
              <section className="mb-2 text-[11px] text-muted-foreground border-t pt-2">
                Latest certification: <span className="font-mono">{String(twin.latest_certification.deployment_version ?? "—")}</span>
                {" · "}score {String(twin.latest_certification.overall_score ?? "?")}
                {" · "}{fmtTime(String(twin.latest_certification.started_at ?? ""))}
              </section>
            )}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TwinKV({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="border rounded px-2 py-1 bg-background">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className="truncate" title={value ?? ""}>{value || "—"}</div>
    </div>
  );
}


// ---------- Business logic ----------
function within(iso: string, minutes: number) {
  return Date.now() - new Date(iso).getTime() <= minutes * 60_000;
}
function avg(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + Number(b), 0) / vals.length;
}
function scoreTone(v: number | undefined | null): string {
  if (v == null) return healthTone("UNKNOWN");
  if (v >= 95) return healthTone("HEALTHY");
  if (v >= 80) return healthTone("DEGRADED");
  return healthTone("CRITICAL");
}

interface OpsIncident {
  id: string; severity: "critical" | "high" | "medium";
  title: string; description: string; classification: string;
  impact: string; detected: string; recommendation: string;
  evidenceLinks: Array<{ label: string; href: string }>;
}

function buildIncidents(input: { callback: CallbackHealth | null; fns: EdgeFnHealth[]; gate: GateResult | null; current: ReliabilitySnapshot | undefined }): OpsIncident[] {
  const out: OpsIncident[] = [];
  const { callback, fns, gate, current } = input;

  if (callback && callback.inv_1h === 0 && callback.inv_15m === 0) {
    out.push({
      id: "INC-CALLBACK-ZERO", severity: "critical",
      title: "Zero callback invocations — production defect signature",
      description: "M-PESA callbacks have not reached the platform in the last hour. Customers may be paying with no receipt.",
      classification: "callback_reachability",
      impact: "All in-flight payments cannot complete", detected: fmtAgo(callback.last_invocation_at),
      recommendation: "Verify Daraja callback URL registration and run callback-certification-run.",
      evidenceLinks: [
        { label: "Journey Explorer", href: "/dashboard/admin/payment-journey" },
        { label: "Certification Center", href: "/dashboard/admin/payment-certification" },
      ],
    });
  }
  if (callback && callback.health === "DEGRADED") {
    out.push({
      id: "INC-CALLBACK-DEGRADED", severity: "high",
      title: "Callback health degraded",
      description: `Callback success rate is ${callback.success_rate_24h?.toFixed(1) ?? "?"}% over 24h.`,
      classification: "callback_reliability",
      impact: "Elevated payment latency & failed completions", detected: fmtAgo(callback.last_invocation_at),
      recommendation: "Inspect mpesa-callback logs and Daraja delivery attempts.",
      evidenceLinks: [{ label: "Journey Explorer", href: "/dashboard/admin/payment-journey" }],
    });
  }

  for (const f of fns.filter(x => x.is_payment_critical)) {
    if (f.inv_1h === 0 && f.inv_24h === 0) {
      out.push({
        id: `INC-FN-ZERO-${f.function_name}`, severity: "critical",
        title: `Edge function ${f.function_name} has zero invocations`,
        description: `${f.function_name} has not been invoked in 24h despite being marked payment-critical.`,
        classification: "edge_function_unreachable",
        impact: "Downstream payment workflow halted", detected: fmtAgo(f.last_invocation_at),
        recommendation: "Check deployment status and routing configuration.",
        evidenceLinks: [{ label: "Certification Center", href: "/dashboard/admin/payment-certification" }],
      });
    } else if (f.health === "CRITICAL") {
      out.push({
        id: `INC-FN-CRIT-${f.function_name}`, severity: "high",
        title: `${f.function_name} health CRITICAL`,
        description: `Success rate ${f.success_rate_24h?.toFixed(1) ?? "?"}% · avg latency ${f.avg_latency_1h_ms ?? "?"}ms`,
        classification: "edge_function_degraded", impact: "Payment reliability regression",
        detected: fmtAgo(f.last_success_at),
        recommendation: "Inspect function logs and recent deployment.",
        evidenceLinks: [{ label: "Journey Explorer", href: "/dashboard/admin/payment-journey" }],
      });
    }
  }

  if (gate && !gate.ready) {
    out.push({
      id: "INC-GATE-BLOCKED", severity: gate.critical_failures > 0 ? "critical" : "high",
      title: "Production Readiness Gate is BLOCKED",
      description: `${gate.critical_failures} critical failures, ${gate.warnings} warnings.`,
      classification: "readiness_gate", impact: "Payment Orchestrator cannot be promoted",
      detected: fmtAgo(gate.evaluated_at),
      recommendation: `Resolve: ${gate.failed_checks.slice(0, 3).join(", ")}`,
      evidenceLinks: [{ label: "Certification Center", href: "/dashboard/admin/payment-certification" }],
    });
  }

  if (current && current.reliability_score < 80) {
    out.push({
      id: "INC-RELIABILITY-LOW", severity: current.reliability_score < 60 ? "critical" : "high",
      title: `Reliability score ${current.reliability_score.toFixed(1)} below threshold`,
      description: "Enterprise Payment Reliability Score has dropped materially.",
      classification: "reliability_regression", impact: "Customer-visible payment issues expected",
      detected: fmtAgo(current.computed_at),
      recommendation: "Review component scores (callback/journey/edge/slo/cert).",
      evidenceLinks: [{ label: "Certification Center", href: "/dashboard/admin/payment-certification" }],
    });
  }

  return out;
}

function promotionEligibility(input: {
  gate: GateResult | null; current: ReliabilitySnapshot | undefined;
  callback: CallbackHealth | null; shadowStats: { rate: number | null; total: number };
  incidents: OpsIncident[];
}): { eligible: boolean; failures: string[] } {
  const failures: string[] = [];
  if (!input.gate?.ready) failures.push("Production Readiness Gate not GREEN");
  if (!input.current || input.current.reliability_score < 95) failures.push(`Reliability score < 95 (current: ${input.current?.reliability_score.toFixed(1) ?? "n/a"})`);
  if (!input.callback || input.callback.health !== "HEALTHY") failures.push(`Callback health not HEALTHY (current: ${input.callback?.health ?? "unknown"})`);
  if (input.incidents.some(i => i.severity === "critical")) failures.push("Active critical incidents present");
  if (input.shadowStats.total < 10) failures.push("Insufficient shadow-mode evidence (min 10 comparisons)");
  else if ((input.shadowStats.rate ?? 0) < 99) failures.push(`Shadow equivalence < 99% (current: ${input.shadowStats.rate?.toFixed(1) ?? "n/a"}%)`);
  return { eligible: failures.length === 0, failures };
}
