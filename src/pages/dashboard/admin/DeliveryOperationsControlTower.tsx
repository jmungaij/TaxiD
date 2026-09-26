/**
 * Delivery & Logistics Operations Control Tower (Admin).
 *
 * The operational intelligence previously mounted on the public delivery
 * pages now lives here, redistributed across 14 enterprise modules instead of
 * one infinite dashboard. Every panel is the existing, certified component —
 * moved, not rewritten — so data models, analytics and audit trails are
 * preserved.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  BrainCircuit,
  Building2,
  Boxes,
  ClipboardList,
  Gauge,
  LayoutGrid,
  Package,
  RefreshCw,
  Radar,
  Route as RouteIcon,
  ShieldCheck,
  ShieldAlert,
  Store,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { KpiStrip } from "@/components/delivery/controlTower/KpiStrip";
import { LiveOpsMap } from "@/components/delivery/controlTower/LiveOpsMap";
import { AiDispatchActions } from "@/components/delivery/controlTower/AiDispatchActions";
import { DrilldownSheet, type DrilldownTarget } from "@/components/delivery/controlTower/DrilldownSheet";
import { ProcurementWorkbench } from "@/components/delivery/controlTower/ProcurementWorkbench";
import { EnquiryQueue } from "@/components/delivery/controlTower/EnquiryQueue";
import { ComplianceCenter } from "@/components/delivery/controlTower/ComplianceCenter";
import {
  AiDispatchPanel,
  AnalyticsPanel,
  FleetIntelligence,
  GovernancePanel,
  LifecyclePanel,
  MarketplacePanel,
  PricingIntelligence,
  SlaPanel,
} from "@/components/delivery/controlTower/ControlTowerPanels";
import {
  CorridorsPanel,
  CustomerOpsPanel,
  DeliveryFlowPipeline,
  ExceptionsCentre,
  HubsPanel,
  SourceBadge,
} from "@/components/delivery/controlTower/OpsModules";
import { DELIVERY_MODULE_LIST, type DeliveryModule } from "@/components/delivery/ModuleShell";
import { useControlTowerKpis } from "@/lib/delivery/liveOps";

const SECTIONS = [
  { id: "overview", label: "Overview", icon: Radar },
  { id: "dispatch", label: "Live Dispatch", icon: Activity },
  { id: "deliveries", label: "Deliveries", icon: Package },
  { id: "fleet", label: "Fleet & Couriers", icon: Truck },
  { id: "hubs", label: "Hubs & Warehouses", icon: Building2 },
  { id: "routes", label: "Routes & Corridors", icon: RouteIcon },
  { id: "sla", label: "SLA & Exceptions", icon: ShieldAlert },
  { id: "ai", label: "AI Operations", icon: BrainCircuit },
  { id: "customers", label: "Customers", icon: Users },
  { id: "revenue", label: "Pricing & Revenue", icon: Wallet },
  { id: "analytics", label: "Analytics", icon: Gauge },
  { id: "marketplace", label: "Marketplace", icon: Store },
  { id: "procurement", label: "Procurement", icon: Boxes },
  { id: "enquiries", label: "Freight Enquiries", icon: ClipboardList },
  { id: "governance", label: "Governance", icon: ShieldCheck },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function DeliveryOperationsControlTower() {
  const [params, setParams] = useSearchParams();
  const sectionParam = params.get("section") as SectionId | null;
  const section: SectionId =
    sectionParam && SECTIONS.some((s) => s.id === sectionParam) ? sectionParam : "overview";
  const moduleParam = params.get("module") as DeliveryModule | null;
  const [module, setModule] = useState<DeliveryModule>(
    moduleParam && DELIVERY_MODULE_LIST.some((m) => m.id === moduleParam) ? moduleParam : "package",
  );
  const [target, setTarget] = useState<DrilldownTarget | null>(null);

  const { kpis, liveOps } = useControlTowerKpis(module);
  const live = liveOps.status === "live";
  const moduleMeta = useMemo(
    () => DELIVERY_MODULE_LIST.find((m) => m.id === module) ?? DELIVERY_MODULE_LIST[0],
    [module],
  );

  const go = (next: SectionId) => {
    const p = new URLSearchParams(params);
    p.set("section", next);
    p.set("module", module);
    setParams(p, { replace: false });
  };

  const setModuleAndSync = (next: DeliveryModule) => {
    setModule(next);
    const p = new URLSearchParams(params);
    p.set("module", next);
    p.set("section", section);
    setParams(p, { replace: true });
  };

  return (
    <AdminOnly roles={["admin", "super_admin", "operations_admin"]}>
      <div className="space-y-5">
        {/* Command header */}
        <header className="rounded-xl border border-border/70 bg-card/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                    live
                      ? "border-status-success/50 text-status-success"
                      : liveOps.status === "error"
                        ? "border-destructive/50 text-destructive"
                        : "border-border text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      live ? "animate-pulse bg-status-success" : "bg-muted-foreground",
                    )}
                  />
                  {live ? "Live" : liveOps.status === "loading" ? "Connecting" : liveOps.status === "error" ? "Feed unavailable" : "Simulated"}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  Network status
                </Badge>
              </div>
              <h1 className="mt-2 text-xl font-bold tracking-tight">Delivery Operations Control Tower</h1>
              <p className="max-w-2xl text-[13px] text-muted-foreground">
                Real-time visibility and intelligent orchestration across the SAFARID delivery network.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-[11px] text-muted-foreground">
                {liveOps.updatedAt
                  ? `Updated ${liveOps.updatedAt.toLocaleTimeString("en-KE")}`
                  : "Awaiting first sync"}
                {live ? ` · ${liveOps.metrics?.sampleSize ?? 0} operational records today` : ""}
              </div>
              <div className="flex items-center gap-2">
                <SourceBadge live={live} />
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={liveOps.refresh}>
                  <RefreshCw className={cn("mr-1 h-3 w-3", liveOps.status === "loading" && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          {/* Module selector */}
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
            <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Network</span>
            {DELIVERY_MODULE_LIST.map((m) => (
              <Button
                key={m.id}
                size="sm"
                variant={m.id === module ? "default" : "outline"}
                className="h-7 px-2.5 text-[11px]"
                onClick={() => setModuleAndSync(m.id)}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </header>

        {/* Section rail */}
        <nav aria-label="Operations modules" className="overflow-x-auto">
          <ul className="flex min-w-max gap-1 rounded-lg border border-border/70 bg-muted/30 p-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => go(s.id)}
                  aria-current={section === s.id ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                    section === s.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  <s.icon className="h-3.5 w-3.5" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Sections */}
        {section === "overview" && (
          <div className="space-y-4">
            <KpiStrip kpis={kpis} />
            <div className="grid items-start gap-4 lg:grid-cols-[1.55fr_1fr]">
              <LiveOpsMap module={module} onDrilldown={setTarget} />
              <div className="space-y-4">
                <Card className="border-border/70 p-4">
                  <h3 className="text-sm font-semibold">What should we do next?</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Jump straight into the module that answers the question.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {(["dispatch", "sla", "ai", "revenue"] as SectionId[]).map((id) => {
                      const s = SECTIONS.find((x) => x.id === id)!;
                      return (
                        <Button
                          key={id}
                          size="sm"
                          variant="outline"
                          className="justify-start text-[11px]"
                          onClick={() => go(id)}
                        >
                          <s.icon className="mr-1.5 h-3.5 w-3.5" />
                          {s.label}
                        </Button>
                      );
                    })}
                  </div>
                </Card>
                <AiDispatchPanel module={module} />
              </div>
            </div>
            <DeliveryFlowPipeline
              module={module}
              metrics={liveOps.metrics}
              live={live}
              onStage={() => go("deliveries")}
            />
            <ExceptionsCentre module={module} live={live} />
          </div>
        )}

        {section === "dispatch" && (
          <div className="grid items-start gap-4 lg:grid-cols-[1.55fr_1fr]">
            <LiveOpsMap module={module} onDrilldown={setTarget} />
            <AiDispatchActions module={module} />
          </div>
        )}

        {section === "deliveries" && (
          <div className="space-y-4">
            <DeliveryFlowPipeline
              module={module}
              metrics={liveOps.metrics}
              live={live}
              onStage={() => setTarget({ scope: "zone", id: "cbd" })}
            />
            <LifecyclePanel module={module} />
          </div>
        )}

        {section === "fleet" && <FleetIntelligence module={module} />}
        {section === "hubs" && <HubsPanel module={module} live={live} />}
        {section === "routes" && <CorridorsPanel module={module} live={live} onDrilldown={setTarget} />}

        {section === "sla" && (
          <div className="space-y-4">
            <SlaPanel module={module} />
            <ExceptionsCentre module={module} live={live} />
          </div>
        )}

        {section === "ai" && (
          <div className="space-y-4">
            <AiDispatchActions module={module} />
            <AiDispatchPanel module={module} />
          </div>
        )}

        {section === "customers" && <CustomerOpsPanel module={module} live={live} />}
        {section === "revenue" && <PricingIntelligence module={module} />}
        {section === "analytics" && <AnalyticsPanel module={module} />}
        {section === "marketplace" && <MarketplacePanel module={module} />}
        {section === "procurement" && <ProcurementWorkbench module={module} />}
        {section === "enquiries" && <EnquiryQueue />}


        {section === "governance" && (
          <div className="space-y-4">
            <ComplianceCenter module={module} />
            <GovernancePanel module={module} />
          </div>
        )}

        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <LayoutGrid className="h-3 w-3" />
          {moduleMeta.label} network · control tower modules are role-gated and every operational action is written to
          the hash-chained audit trail.
        </p>

        <DrilldownSheet module={module} target={target} onOpenChange={(open) => !open && setTarget(null)} />
      </div>
    </AdminOnly>
  );
}
