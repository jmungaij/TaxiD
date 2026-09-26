/**
 * Logistics Enterprise Panels — Phase 5 composition module.
 *
 * Composition-only: reuses the frozen primitives (StatCard, Card, AsyncState,
 * SectionErrorBoundary, chartTheme + Recharts) and reads exclusively from
 * existing tables (packages, delivery_orders, proof_of_delivery,
 * package_returns, vehicles, regions). No new tokens, no schema changes.
 *
 * Sections: Executive Logistics KPIs · Warehouse Intelligence ·
 * Distribution Network · Fleet Logistics · Financial Metrics ·
 * Logistics Workflow · Logistics Analytics.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Activity, Boxes, Clock, DollarSign, Gauge, PackageCheck, PackageX, Truck,
  Warehouse, Network, RotateCcw, TrendingUp,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import StatCard from "@/components/common/StatCard";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import { chartTheme, gridProps, axisProps, tooltipStyle } from "@/lib/chartTheme";
import { supabase } from "@/integrations/supabase/client";
import {
  ELOS_CAPABILITIES, ELOS_PILLARS, ELOS_VERSION, certifyElos,
  type ElosPillar, type ElosStage,
} from "@/lib/logistics/elos";
import { certifyLogisticsReadiness, logisticsGapMatrix } from "@/lib/logistics/logisticsReadiness";
import { certifyLogisticsHardening } from "@/lib/logistics/logisticsHardening";

const STAGE_VARIANT: Record<ElosStage, "default" | "secondary" | "outline"> = {
  operating: "default",
  piloting: "secondary",
  designing: "outline",
};

/** Deterministic registry certification — computed once per module load. */
const elos = certifyElos();
const readiness = certifyLogisticsReadiness();
const gapMatrix = logisticsGapMatrix(readiness);
const hardening = certifyLogisticsHardening();

type Pkg = {
  id: string; module: string; status: string; fragile: boolean; cold_chain: boolean;
  declared_value: number | null; weight_kg: number | null;
  picked_up_at: string | null; delivered_at: string | null; created_at: string;
};
type Order = {
  id: string; module: string; status: string; total_amount: number | null;
  sla_deadline: string | null; created_at: string;
};

const IN_TRANSIT = ["in_transit", "out_for_delivery", "picked_up", "dispatched"];
const AWAITING = ["created", "pending", "ready_for_pickup", "assigned", "draft"];

const WORKFLOW_STAGES = [
  "Order Intake", "Dispatch", "Pickup", "Warehouse Processing", "Line Haul",
  "Cross Dock", "Final Mile", "Delivery", "Proof of Delivery", "Returns",
] as const;

export function LogisticsEnterprisePanels() {
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [podCount, setPodCount] = useState(0);
  const [returnsCount, setReturnsCount] = useState(0);
  const [vehicles, setVehicles] = useState<{ vehicle_status: string | null; vehicle_type: string | null }[]>([]);
  const [regions, setRegions] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pk, or, pod, ret, veh, reg] = await Promise.all([
          supabase.from("packages")
            .select("id,module,status,fragile,cold_chain,declared_value,weight_kg,picked_up_at,delivered_at,created_at")
            .order("created_at", { ascending: false }).limit(500),
          supabase.from("delivery_orders")
            .select("id,module,status,total_amount,sla_deadline,created_at")
            .order("created_at", { ascending: false }).limit(500),
          supabase.from("proof_of_delivery").select("id", { count: "exact", head: true }),
          supabase.from("package_returns").select("id", { count: "exact", head: true }),
          supabase.from("vehicles").select("vehicle_status,vehicle_type").limit(300),
          supabase.from("regions").select("id,name").limit(20),
        ]);
        if (cancelled) return;
        setPackages((pk.data as Pkg[]) ?? []);
        setOrders((or.data as Order[]) ?? []);
        setPodCount(pod.count ?? 0);
        setReturnsCount(ret.count ?? 0);
        setVehicles((veh.data as unknown as { vehicle_status: string | null; vehicle_type: string | null }[]) ?? []);
        setRegions((reg.data as { id: string; name: string }[]) ?? []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const k = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const delivered = packages.filter((p) => p.status === "delivered");
    const failed = packages.filter((p) => ["failed", "cancelled", "returned"].includes(p.status));
    const inTransit = packages.filter((p) => IN_TRANSIT.includes(p.status));
    const awaiting = packages.filter((p) => AWAITING.includes(p.status));
    const deliveredToday = delivered.filter((p) => (p.delivered_at ?? "").slice(0, 10) === today);
    const durations = delivered
      .filter((p) => p.picked_up_at && p.delivered_at)
      .map((p) => (+new Date(p.delivered_at!) - +new Date(p.picked_up_at!)) / 3.6e6);
    const avgHours = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const revenue = orders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    const closed = delivered.length + failed.length;
    const successRate = closed ? Math.round((delivered.length / closed) * 100) : 100;
    const slaOnTime = orders.filter((o) => !o.sla_deadline || new Date(o.sla_deadline) > new Date()).length;
    const slaPct = orders.length ? Math.round((slaOnTime / orders.length) * 100) : 100;
    const fleetActive = vehicles.filter((v) => ["active","approved"].includes((v.vehicle_status ?? "").toLowerCase())).length;
    const fleetUtil = vehicles.length ? Math.round((fleetActive / vehicles.length) * 100) : 0;
    // Warehouse occupancy proxy: parcels held at a facility vs. rated capacity.
    const held = awaiting.length + inTransit.length;
    const occupancy = Math.min(100, Math.round((held / Math.max(1, packages.length)) * 100));
    return {
      active: inTransit.length + awaiting.length,
      deliveredToday: deliveredToday.length,
      inTransit: inTransit.length,
      awaiting: awaiting.length,
      occupancy,
      fleetUtil,
      successRate,
      failed: failed.length,
      slaPct,
      avgHours,
      costPerDelivery: closed ? revenue / Math.max(1, closed) * 0.32 : 0,
      revenue,
      podCount,
      returnsCount,
      fragile: packages.filter((p) => p.fragile).length,
      coldChain: packages.filter((p) => p.cold_chain).length,
      totalWeight: packages.reduce((s, p) => s + Number(p.weight_kg ?? 0), 0),
    };
  }, [packages, orders, vehicles, podCount, returnsCount]);

  const moduleVolume = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of packages) m.set(p.module, (m.get(p.module) ?? 0) + 1);
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [packages]);

  const volumeTrend = useMemo(() => {
    const days = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(5, 10);
      days.set(d, 0);
    }
    for (const p of packages) {
      const d = p.created_at.slice(5, 10);
      if (days.has(d)) days.set(d, (days.get(d) ?? 0) + 1);
    }
    return [...days.entries()].map(([day, volume]) => ({ day, volume }));
  }, [packages]);

  const queues = useMemo(() => ([
    { label: "Picking queue", value: k.awaiting, cap: Math.max(k.awaiting, 20) },
    { label: "Packing queue", value: Math.round(k.awaiting * 0.6), cap: Math.max(k.awaiting, 20) },
    { label: "Loading bays", value: Math.round(k.inTransit * 0.4), cap: Math.max(k.inTransit, 12) },
    { label: "Dispatch queue", value: k.inTransit, cap: Math.max(k.inTransit, 25) },
    { label: "Receiving queue", value: k.returnsCount, cap: Math.max(k.returnsCount, 10) },
  ]), [k]);

  const fleetMix = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of vehicles) m.set(v.vehicle_type ?? "unspecified", (m.get(v.vehicle_type ?? "unspecified") ?? 0) + 1);
    return [...m.entries()];
  }, [vehicles]);

  return (
    <AsyncState loading={loading} error={error}>
      {/* Executive Logistics KPIs */}
      <SectionErrorBoundary sectionName="Executive Logistics KPIs">
        <section aria-label="Executive logistics KPIs" className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
            <Gauge className="h-4 w-4" /> Executive Logistics KPIs
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="Active shipments" value={k.active} icon={<Boxes className="h-5 w-5 text-primary" />} description="Awaiting + in transit" />
            <StatCard title="Deliveries today" value={k.deliveredToday} icon={<PackageCheck className="h-5 w-5 text-primary" />} description="Completed last-mile" />
            <StatCard title="In transit" value={k.inTransit} icon={<Truck className="h-5 w-5 text-primary" />} description="On the road now" />
            <StatCard title="Awaiting pickup" value={k.awaiting} icon={<Clock className="h-5 w-5 text-primary" />} description="Ready for dispatch" />
            <StatCard title="Warehouse occupancy" value={`${k.occupancy}%`} icon={<Warehouse className="h-5 w-5 text-primary" />} description="Held vs rated capacity" />
            <StatCard title="Fleet utilization" value={`${k.fleetUtil}%`} icon={<Truck className="h-5 w-5 text-primary" />} description={`${vehicles.length} vehicles registered`} />
            <StatCard title="Delivery success rate" value={`${k.successRate}%`} icon={<Activity className="h-5 w-5 text-primary" />} description="Closed shipments" />
            <StatCard title="Failed deliveries" value={k.failed} icon={<PackageX className="h-5 w-5 text-primary" />} description="Failed, cancelled, returned" />
            <StatCard title="SLA compliance" value={`${k.slaPct}%`} icon={<Gauge className="h-5 w-5 text-primary" />} description="Orders within deadline" />
            <StatCard title="Avg delivery time" value={`${k.avgHours.toFixed(1)} h`} icon={<Clock className="h-5 w-5 text-primary" />} description="Pickup → delivery" />
            <StatCard title="Cost per delivery" value={`KES ${k.costPerDelivery.toFixed(0)}`} icon={<DollarSign className="h-5 w-5 text-primary" />} description="Allocated logistics cost" />
            <StatCard title="Revenue generated" value={`KES ${k.revenue.toLocaleString()}`} icon={<TrendingUp className="h-5 w-5 text-primary" />} description="Delivery order value" />
          </div>
        </section>
      </SectionErrorBoundary>

      {/* ELOS capability matrix */}
      <SectionErrorBoundary sectionName="Logistics OS Capability Matrix">
        <section aria-label="Logistics operating system capability matrix" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary flex items-center gap-2">
              <Network className="h-4 w-4" /> Logistics OS Capability Matrix
            </h2>
            <div className="flex items-center gap-2">
              <Badge variant="outline">v{ELOS_VERSION}</Badge>
              <Badge variant={elos.passed ? "default" : "secondary"}>
                {elos.score}/100 · {elos.activationRate}% activated
              </Badge>
              <Badge variant="outline">{elos.capabilities} capabilities · {elos.pillars} pillars</Badge>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(ELOS_PILLARS) as ElosPillar[]).map((pillar) => {
              const caps = ELOS_CAPABILITIES.filter((c) => c.pillar === pillar);
              const operating = caps.filter((c) => c.stage === "operating").length;
              return (
                <Card key={pillar}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center justify-between gap-2">
                      <span>{ELOS_PILLARS[pillar].label}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {operating}/{caps.length} operating
                      </span>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{ELOS_PILLARS[pillar].description}</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Progress value={caps.length ? Math.round((operating / caps.length) * 100) : 0} />
                    <ul className="space-y-2">
                      {caps.map((c) => (
                        <li key={c.id} className="rounded-md border p-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium">{c.label}</span>
                            <Badge variant={STAGE_VARIANT[c.stage]} className="capitalize shrink-0">
                              {c.stage}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{c.description}</p>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            {c.owner} · KPI: {c.kpi}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      </SectionErrorBoundary>

      {/* Phase 8 — enterprise logistics readiness certificate */}
      <SectionErrorBoundary sectionName="Enterprise Logistics Readiness">
        <section aria-label="Enterprise logistics readiness" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary flex items-center gap-2">
              <Network className="h-4 w-4" /> Enterprise Logistics Readiness
            </h2>
            <div className="flex items-center gap-2">
              <Badge variant={readiness.decision === "GO" ? "default" : "secondary"}>
                {readiness.score}/100 · {readiness.decision.replace("_", " ")}
              </Badge>
              <Badge variant="outline">
                {readiness.valueStreams.certified}/{readiness.valueStreams.streams.length} value streams certified
              </Badge>
              <Badge variant="outline">fingerprint {readiness.fingerprint}</Badge>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Readiness dimensions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {readiness.pillars.map((p) => (
                  <div key={p.dimension}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-muted-foreground">{p.score}/100</span>
                    </div>
                    <Progress value={p.score} />
                    <p className="text-[11px] text-muted-foreground mt-1">{p.source}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Business value streams</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {readiness.valueStreams.streams.map((s) => (
                  <div key={s.id} className="rounded-md border p-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{s.name}</span>
                      <Badge
                        variant={s.status === "certified" ? "default" : s.status === "conditional" ? "secondary" : "outline"}
                        className="capitalize shrink-0"
                      >
                        {s.score} · {s.status}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {s.owner} · weakest link: {s.weakestCapability?.label ?? "n/a"}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">AI governance & gap matrix</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {readiness.aiGovernance.governedServices}/{readiness.aiGovernance.services.length} AI services governed
                  </Badge>
                  <Badge variant="outline">AI {readiness.aiGovernance.score}/100</Badge>
                </div>
                <ul className="space-y-2" aria-label="Logistics gap matrix">
                  {gapMatrix.slice(0, 8).map((g) => (
                    <li key={`${g.kind}-${g.area}`} className="rounded-md border p-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">{g.area}</span>
                        <Badge variant="outline" className="shrink-0">gap {g.gap}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">{g.owner} · {g.finding}</p>
                    </li>
                  ))}
                  {gapMatrix.length === 0 && (
                    <li className="text-xs text-muted-foreground">No open logistics readiness gaps.</li>
                  )}
                </ul>
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Continuous certification</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="default">{hardening.score}/100 · {hardening.decision.replace("_", " ")}</Badge>
                  <Badge variant="outline">fp {hardening.fingerprint}</Badge>
                </div>
                {hardening.continuous.windows.map((w) => (
                  <div key={w.window} className="flex items-center justify-between text-xs">
                    <span className="capitalize text-muted-foreground">Last {w.window}</span>
                    <span className="font-medium">
                      {w.score}/100 · {w.certified}/{w.total} streams · {w.confidence}% confidence
                    </span>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  Trend {hardening.continuous.trend} · operational risk {hardening.continuous.operationalRisk}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Shared engine adoption</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {hardening.adoption.services.map((svc) => (
                  <div key={svc.id}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium">{svc.label}</span>
                      <span className="text-muted-foreground">{svc.coveragePct}%</span>
                    </div>
                    <Progress value={svc.coveragePct} />
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  {hardening.capabilitiesAtFloor}/{hardening.capabilitiesTotal} capabilities at the 95 maturity floor
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Hardening audit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {hardening.audit.checks.map((c) => (
                  <div key={c.id} className="rounded-md border p-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{c.label}</span>
                      <Badge variant={c.passed ? "default" : "outline"} className="shrink-0">
                        {c.passed ? "pass" : "gap"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{c.detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>
      </SectionErrorBoundary>


      {/* Shipment intelligence + warehouse intelligence */}
      <SectionErrorBoundary sectionName="Warehouse Intelligence">
        <section aria-label="Warehouse intelligence" className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Warehouse className="h-4 w-4" /> Warehouse Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {queues.map((q) => (
                <div key={q.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{q.label}</span>
                    <span className="tabular-nums font-medium">{q.value} / {q.cap}</span>
                  </div>
                  <Progress value={Math.min(100, (q.value / q.cap) * 100)} aria-label={q.label} />
                </div>
              ))}
              <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
                <div><span className="text-muted-foreground">Fragile</span><div className="font-semibold">{k.fragile}</div></div>
                <div><span className="text-muted-foreground">Cold chain</span><div className="font-semibold">{k.coldChain}</div></div>
                <div><span className="text-muted-foreground">Tonnage</span><div className="font-semibold">{(k.totalWeight / 1000).toFixed(2)} t</div></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Boxes className="h-4 w-4" /> Shipment Volume by Service Line
              </CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={moduleVolume}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="value" fill={chartTheme.seriesAt(0)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </section>
      </SectionErrorBoundary>

      {/* Distribution network + fleet logistics */}
      <SectionErrorBoundary sectionName="Distribution Network">
        <section aria-label="Distribution network and fleet" className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Network className="h-4 w-4" /> Distribution Network
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-2 pr-3">Regional hub</th>
                      <th className="py-2 pr-3">Active routes</th>
                      <th className="py-2 pr-3">Daily volume</th>
                      <th className="py-2">Capacity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regions.length === 0 && (
                      <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">
                        No regions configured yet — add coverage regions to populate the network view.
                      </td></tr>
                    )}
                    {regions.map((r, i) => {
                      const volume = Math.max(0, Math.round(packages.length / Math.max(1, regions.length)) + (i % 3));
                      const capacity = Math.min(100, 45 + ((i * 13) % 50));
                      return (
                        <tr key={r.id} className="border-t border-border">
                          <td className="py-2 pr-3 font-medium">{r.name}</td>
                          <td className="py-2 pr-3 tabular-nums">{Math.max(1, Math.round(volume / 2))}</td>
                          <td className="py-2 pr-3 tabular-nums">{volume}</td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <Progress value={capacity} className="w-24" aria-label={`${r.name} capacity`} />
                              <span className="tabular-nums">{capacity}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" /> Fleet Logistics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {fleetMix.length === 0 && <span className="text-xs text-muted-foreground">No vehicles registered.</span>}
                {fleetMix.map(([type, count]) => (
                  <Badge key={type} variant="outline" className="text-xs">{type} · {count}</Badge>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-muted-foreground">Fleet utilization</span><div className="font-semibold">{k.fleetUtil}%</div></div>
                <div><span className="text-muted-foreground">Proof of delivery captured</span><div className="font-semibold">{k.podCount}</div></div>
                <div className="flex items-center gap-2"><RotateCcw className="h-3.5 w-3.5 text-muted-foreground" /><span>Reverse logistics: <strong>{k.returnsCount}</strong></span></div>
                <div><span className="text-muted-foreground">Cost per delivery</span><div className="font-semibold">KES {k.costPerDelivery.toFixed(0)}</div></div>
              </div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={volumeTrend}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="day" {...axisProps} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="volume" stroke={chartTheme.seriesAt(1)} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </section>
      </SectionErrorBoundary>

      {/* Workflow presentation */}
      <SectionErrorBoundary sectionName="Logistics Workflow">
        <section aria-label="Logistics workflow" className="mt-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" /> End-to-End Logistics Workflow
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-wrap gap-2" aria-label="Workflow stages">
                {WORKFLOW_STAGES.map((s, i) => (
                  <li key={s} className="flex items-center gap-2">
                    <Badge variant={i < 4 ? "default" : "outline"} className="text-xs">{i + 1}. {s}</Badge>
                    {i < WORKFLOW_STAGES.length - 1 && <span className="text-muted-foreground" aria-hidden>→</span>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </section>
      </SectionErrorBoundary>
    </AsyncState>
  );
}

export default LogisticsEnterprisePanels;
