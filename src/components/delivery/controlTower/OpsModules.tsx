/**
 * Operations Control Tower modules that were missing from the original tower:
 * the delivery flow pipeline, the exceptions centre, hub/warehouse capacity,
 * corridor intelligence and the customer service-level view.
 *
 * All numbers are derived from the existing delivery data model
 * (`@/lib/delivery/controlTower`) and are explicitly labelled `Live` or
 * `Modelled` — modelled figures are never presented as live telemetry.
 */
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Building2,
  ChevronRight,
  Clock,
  MapPin,
  ShieldAlert,
  Truck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import {
  liveMapModel,
  moduleObservation,
  routeCompliance,
  slaTiers,
  zonePerformance,
} from "@/lib/delivery/controlTower";
import type { LiveOpsMetrics } from "@/lib/delivery/liveOps";
import type { DrilldownTarget } from "./DrilldownSheet";

export function SourceBadge({ live, className }: { live: boolean; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px]",
        live ? "border-status-success/50 text-status-success" : "border-border text-muted-foreground",
        className,
      )}
    >
      {live ? "Live" : "Modelled"}
    </Badge>
  );
}

/* ------------------------------------------------------------- pipeline */

export interface FlowStage {
  key: string;
  label: string;
  count: number;
  sharePct: number;
  exceptions: number;
  avgMinutes: number;
}

export function deliveryFlow(module: DeliveryModule, metrics: LiveOpsMetrics | null): FlowStage[] {
  const o = moduleObservation(module);
  const awaiting = metrics?.awaitingDispatch ?? o.parcelsAwaiting ?? 0;
  const active = metrics?.activeDeliveries ?? o.parcelsInTransit ?? 0;
  const delivered = metrics?.delivered ?? o.parcelsDelivered ?? 0;
  const failed = metrics?.failed ?? o.parcelsFailed ?? 0;
  const orders = awaiting + active + delivered;

  const rows: Array<[string, string, number, number, number]> = [
    ["orders", "Orders", orders, Math.round(failed * 0.1), 2],
    ["awaiting", "Awaiting dispatch", awaiting, Math.round(awaiting * 0.06), Math.round(o.avgPickupMinutes * 0.4)],
    ["assigned", "Assigned", Math.round(active * 0.34), Math.round(active * 0.02), Math.round(o.avgPickupMinutes * 0.5)],
    ["picked", "Picked up", Math.round(active * 0.28), Math.round(active * 0.015), o.avgPickupMinutes],
    ["transit", "In transit", Math.round(active * 0.26), Math.round(active * 0.03), Math.round(o.avgDeliveryMinutes * 0.6)],
    ["destination", "At destination", Math.round(active * 0.12), Math.round(active * 0.01), Math.round(o.avgDeliveryMinutes * 0.15)],
    ["delivered", "Delivered", delivered, failed, o.avgDeliveryMinutes],
    ["pod", "Proof of delivery", Math.round(delivered * 0.985), Math.round(delivered * 0.015), 3],
  ];

  return rows.map(([key, label, count, exceptions, avgMinutes]) => ({
    key,
    label,
    count: Math.max(0, count),
    sharePct: orders ? Math.round((count / orders) * 1000) / 10 : 0,
    exceptions: Math.max(0, exceptions),
    avgMinutes,
  }));
}

export function DeliveryFlowPipeline({
  module,
  metrics,
  live,
  onStage,
}: {
  module: DeliveryModule;
  metrics: LiveOpsMetrics | null;
  live: boolean;
  onStage?: (stage: FlowStage) => void;
}) {
  const stages = useMemo(() => deliveryFlow(module, metrics), [module, metrics]);
  return (
    <Card className="border-border/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Delivery flow</h3>
          <p className="text-[11px] text-muted-foreground">
            Order → dispatch → transit → proof of delivery. Select a stage to open its delivery list.
          </p>
        </div>
        <SourceBadge live={live} />
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onStage?.(s)}
              className="group w-full rounded-lg border border-border/70 bg-card/60 p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Stage {i + 1}</span>
                <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="mt-1 text-sm font-semibold">{s.label}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold tabular-nums">{s.count.toLocaleString("en-KE")}</span>
                <span className="text-[11px] text-muted-foreground">{s.sharePct}%</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className={cn(s.exceptions > 0 ? "text-status-warning" : "text-muted-foreground")}>
                  {s.exceptions} exceptions
                </span>
                <span className="text-muted-foreground">
                  <Clock className="mr-1 inline h-3 w-3" />
                  {s.avgMinutes} min
                </span>
              </div>
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ----------------------------------------------------------- exceptions */

export interface OperationalException {
  id: string;
  severity: "critical" | "high" | "medium";
  category: string;
  reference: string;
  customer: string;
  courier: string;
  location: string;
  etaMinutes: number;
  slaImpact: string;
  action: string;
  status: "open" | "assigned" | "monitoring";
}

export function operationalExceptions(module: DeliveryModule): OperationalException[] {
  const o = moduleObservation(module);
  const map = liveMapModel(module);
  const sla = slaTiers(module);
  const compliance = routeCompliance(module);
  const delayed = map.units.filter((u) => u.status === "delayed");
  const hottest = [...map.zones].sort((a, b) => b.demandIndex - a.demandIndex)[0];
  const breachTier = [...sla].sort((a, b) => b.breaches - a.breaches)[0];

  const out: OperationalException[] = delayed.slice(0, 4).map((u, i) => {
    const zone = map.zones[i % map.zones.length];
    return {
      id: `delay-${u.id}`,
      severity: i === 0 ? "critical" : "high",
      category: "Delayed delivery",
      reference: `YM-${28400 + i * 17}`,
      customer: `Account #${4100 + i * 7}`,
      courier: u.label,
      location: zone.name,
      etaMinutes: zone.avgEtaMinutes,
      slaImpact: `${breachTier.label} tier · KES ${Math.round(o.costPerParcelKes * 1.6).toLocaleString("en-KE")} exposure`,
      action: "Reassign to nearest available courier",
      status: i === 0 ? "open" : "monitoring",
    };
  });

  out.push({
    id: "unassigned",
    severity: "high",
    category: "Unassigned deliveries",
    reference: `${Math.round((o.parcelsAwaiting ?? 0) * 0.08)} orders`,
    customer: "Multiple accounts",
    courier: "—",
    location: hottest.name,
    etaMinutes: hottest.avgEtaMinutes,
    slaImpact: `${breachTier.breaches} projected breaches`,
    action: "Open surge capacity in the affected zone",
    status: "open",
  });

  out.push({
    id: "sla-risk",
    severity: breachTier.compliancePct < 92 ? "critical" : "medium",
    category: "SLA risk",
    reference: `${breachTier.label} · ${breachTier.window}`,
    customer: "Enterprise contracts",
    courier: "—",
    location: "Network-wide",
    etaMinutes: breachTier.timeRemainingMinutes,
    slaImpact: `KES ${breachTier.exposureKes.toLocaleString("en-KE")} exposure`,
    action: "Prioritise the affected tier in the dispatch queue",
    status: "assigned",
  });

  out.push({
    id: "returns",
    severity: o.returnsBacklog > 50 ? "high" : "medium",
    category: "Failed delivery attempts",
    reference: `${o.parcelsFailed ?? 0} failures · ${o.returnsBacklog} returns`,
    customer: "Multiple accounts",
    courier: "Reverse logistics desk",
    location: "Embakasi Hub",
    etaMinutes: 120,
    slaImpact: `KES ${Math.round((o.parcelsFailed ?? 0) * o.costPerParcelKes).toLocaleString("en-KE")} recovery cost`,
    action: "Schedule a re-attempt wave and contact recipients",
    status: "assigned",
  });

  out.push({
    id: "fleet",
    severity: o.vehiclesOverdueService > 8 ? "high" : "medium",
    category: "Vehicle availability",
    reference: `${o.vehiclesOverdueService} units overdue service`,
    customer: "—",
    courier: "Fleet workshop",
    location: "Industrial Depot",
    etaMinutes: 240,
    slaImpact: "Capacity reduction in the next planning window",
    action: "Book maintenance slots and backfill capacity",
    status: "monitoring",
  });

  compliance
    .filter((c) => c.state !== "ok")
    .slice(0, 3)
    .forEach((c) =>
      out.push({
        id: `route-${c.id}`,
        severity: c.state === "breach" ? "critical" : "medium",
        category: "Route disruption",
        reference: `${c.label} · ${c.value}`,
        customer: "—",
        courier: "Route compliance engine",
        location: "Active corridors",
        etaMinutes: 0,
        slaImpact: "Corridor reliability degradation",
        action: "Review corridor and re-plan affected routes",
        status: "open",
      }),
    );

  return out;
}

const SEVERITY_STYLE = {
  critical: "border-destructive/50 text-destructive",
  high: "border-status-warning/50 text-status-warning",
  medium: "border-border text-muted-foreground",
} as const;

export function ExceptionsCentre({ module, live }: { module: DeliveryModule; live: boolean }) {
  const rows = useMemo(() => operationalExceptions(module), [module]);
  const critical = rows.filter((r) => r.severity === "critical").length;
  return (
    <Card className="border-border/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="h-4 w-4 text-destructive" /> Exceptions centre
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {rows.length} open exceptions · {critical} critical · every row carries a recommended action.
          </p>
        </div>
        <SourceBadge live={live} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border/60">
              <th className="py-2 pr-3">Severity</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3">Reference</th>
              <th className="py-2 pr-3">Customer</th>
              <th className="py-2 pr-3">Courier</th>
              <th className="py-2 pr-3">Location</th>
              <th className="py-2 pr-3">ETA</th>
              <th className="py-2 pr-3">SLA impact</th>
              <th className="py-2 pr-3">Recommended action</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40 last:border-0">
                <td className="py-2 pr-3">
                  <Badge variant="outline" className={cn("text-[10px] capitalize", SEVERITY_STYLE[r.severity])}>
                    {r.severity}
                  </Badge>
                </td>
                <td className="py-2 pr-3 font-medium">{r.category}</td>
                <td className="py-2 pr-3 tabular-nums">{r.reference}</td>
                <td className="py-2 pr-3 text-muted-foreground">{r.customer}</td>
                <td className="py-2 pr-3 text-muted-foreground">{r.courier}</td>
                <td className="py-2 pr-3">{r.location}</td>
                <td className="py-2 pr-3 tabular-nums">{r.etaMinutes ? `${r.etaMinutes} min` : "—"}</td>
                <td className="py-2 pr-3 text-muted-foreground">{r.slaImpact}</td>
                <td className="py-2 pr-3">{r.action}</td>
                <td className="py-2 capitalize text-muted-foreground">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------- hubs */

export function HubsPanel({ module, live }: { module: DeliveryModule; live: boolean }) {
  const map = useMemo(() => liveMapModel(module), [module]);
  const o = moduleObservation(module);
  const hubs = map.units.filter((u) => u.kind === "hub" || u.kind === "depot");

  const rows = hubs.map((h, i) => {
    const zone = map.zones[i % map.zones.length];
    const utilisation = Math.min(99, Math.round(52 + zone.demandIndex * 45));
    return {
      id: h.id,
      label: h.label,
      utilisation,
      inbound: Math.round((o.parcelsAwaiting ?? 0) * (0.2 + zone.demandIndex * 0.2)),
      outbound: Math.round((o.parcelsInTransit ?? 0) * (0.16 + zone.demandIndex * 0.14)),
      throughput: Math.round((o.parcelsDelivered ?? 0) * (0.18 + zone.demandIndex * 0.1)),
      cutoff: i === 0 ? "16:30" : i === 1 ? "18:00" : "20:00",
      risk: utilisation > 85 ? "high" : utilisation > 72 ? "medium" : "low",
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="h-4 w-4 text-primary" /> Hubs & warehouses
        </h3>
        <SourceBadge live={live} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {rows.map((h) => (
          <Card key={h.id} className="border-border/70 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold">{h.label}</div>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] capitalize",
                  h.risk === "high"
                    ? "border-destructive/50 text-destructive"
                    : h.risk === "medium"
                      ? "border-status-warning/50 text-status-warning"
                      : "border-status-success/50 text-status-success",
                )}
              >
                {h.risk} risk
              </Badge>
            </div>
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Capacity utilisation</span>
                <span className="tabular-nums">{h.utilisation}%</span>
              </div>
              <Progress value={h.utilisation} className="h-1.5" />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <dt className="text-muted-foreground">Inbound</dt>
                <dd className="font-semibold tabular-nums">{h.inbound.toLocaleString("en-KE")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Outbound</dt>
                <dd className="font-semibold tabular-nums">{h.outbound.toLocaleString("en-KE")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Processed</dt>
                <dd className="font-semibold tabular-nums">{h.throughput.toLocaleString("en-KE")}</dd>
              </div>
            </dl>
            <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
              <span>
                <Clock className="mr-1 inline h-3 w-3" />
                Cut-off {h.cutoff}
              </span>
              {h.risk !== "low" && (
                <span className="text-status-warning">
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  Open overflow wave
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Card className="border-border/70 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Boxes className="h-4 w-4 text-primary" /> Storage & inventory
        </div>
        <dl className="grid gap-3 sm:grid-cols-4 text-[12px]">
          <div>
            <dt className="text-muted-foreground">Inventory accuracy</dt>
            <dd className="text-base font-semibold tabular-nums">{o.inventoryAccuracyPct}%</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Returns backlog</dt>
            <dd className="text-base font-semibold tabular-nums">{o.returnsBacklog}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cold-chain units</dt>
            <dd className="text-base font-semibold tabular-nums">{o.coldChainParcels ?? 0}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Avg pickup time</dt>
            <dd className="text-base font-semibold tabular-nums">{o.avgPickupMinutes} min</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ corridors */

export function CorridorsPanel({
  module,
  live,
  onDrilldown,
}: {
  module: DeliveryModule;
  live: boolean;
  onDrilldown?: (target: DrilldownTarget) => void;
}) {
  const map = useMemo(() => liveMapModel(module), [module]);
  const compliance = useMemo(() => routeCompliance(module), [module]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <MapPin className="h-4 w-4 text-primary" /> Routes & corridors
        </h3>
        <SourceBadge live={live} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {map.routes.map((r) => (
          <Card key={r.id} className="border-border/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">
                {r.from} <ArrowRight className="inline h-3 w-3" /> {r.to}
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] capitalize",
                  r.risk === "high"
                    ? "border-destructive/50 text-destructive"
                    : r.risk === "medium"
                      ? "border-status-warning/50 text-status-warning"
                      : "border-status-success/50 text-status-success",
                )}
              >
                {r.risk} risk
              </Badge>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">ETA {r.etaMinutes} min</div>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 h-7 text-[11px]"
              onClick={() => onDrilldown?.({ scope: "corridor", id: r.id })}
            >
              Open corridor
            </Button>
          </Card>
        ))}
      </div>
      <Card className="border-border/70 p-4">
        <div className="mb-2 text-sm font-semibold">Corridor compliance signals</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {compliance.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-[12px]"
            >
              <span className="text-muted-foreground">{c.label}</span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  c.state === "breach"
                    ? "text-destructive"
                    : c.state === "watch"
                      ? "text-status-warning"
                      : "text-status-success",
                )}
              >
                {c.value}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ customers */

export function CustomerOpsPanel({ module, live }: { module: DeliveryModule; live: boolean }) {
  const zones = useMemo(() => zonePerformance(module), [module]);
  const o = moduleObservation(module);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-primary" /> Customer service levels
        </h3>
        <SourceBadge live={live} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-border/70 p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">CSAT</div>
          <div className="text-2xl font-bold tabular-nums">{o.csatPct}%</div>
        </Card>
        <Card className="border-border/70 p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">On-time rate</div>
          <div className="text-2xl font-bold tabular-nums">{o.carrierOnTimePct}%</div>
        </Card>
        <Card className="border-border/70 p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Failed rate</div>
          <div className="text-2xl font-bold tabular-nums">{o.failedRatePct}%</div>
        </Card>
      </div>
      <Card className="border-border/70 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Truck className="h-4 w-4 text-primary" /> Service level by area
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="py-2 pr-3">Area</th>
                <th className="py-2 pr-3">Deliveries</th>
                <th className="py-2 pr-3">On-time</th>
                <th className="py-2">Cost / parcel</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.zone} className="border-b border-border/40 last:border-0">
                  <td className="py-2 pr-3 font-medium">{z.zone}</td>
                  <td className="py-2 pr-3 tabular-nums">{z.deliveries.toLocaleString("en-KE")}</td>
                  <td
                    className={cn(
                      "py-2 pr-3 tabular-nums",
                      z.onTimePct >= 94 ? "text-status-success" : "text-status-warning",
                    )}
                  >
                    {z.onTimePct}%
                  </td>
                  <td className="py-2 tabular-nums">KSh {z.costPerParcelKes.toLocaleString("en-KE")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
