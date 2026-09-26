import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Camera, FileText, Fingerprint, Navigation, PenLine, ScanLine, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import {
  corridorDrilldown,
  hydrateDrilldown,
  zoneDrilldown,
  type DrilldownResult,
  type EvidenceItem,
} from "@/lib/delivery/drilldown";

const EVIDENCE_ICON: Record<EvidenceItem["kind"], typeof ScanLine> = {
  scan: ScanLine,
  photo: Camera,
  signature: PenLine,
  gps: Navigation,
  otp: Fingerprint,
  document: FileText,
  sensor: Thermometer,
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short" });

function EvidenceList({ items }: { items: EvidenceItem[] }) {
  return (
    <ol className="mt-2 space-y-1.5 border-l pl-3">
      {items.map((e, i) => {
        const Icon = EVIDENCE_ICON[e.kind];
        return (
          <li key={`${e.label}-${i}`} className="relative text-[11px]">
            <span className="absolute -left-[19px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border bg-card">
              <Icon className="h-2 w-2 text-primary" />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{e.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {day(e.at)} · {time(e.at)}
              </span>
            </div>
            <p className="text-muted-foreground">{e.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

function Row({
  title,
  meta,
  badges,
  evidence,
  facts,
}: {
  title: string;
  meta: string;
  badges: Array<{ label: string; className?: string }>;
  evidence: EvidenceItem[];
  facts: Array<[string, string]>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="text-[11px] text-muted-foreground">{meta}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {badges.map((b) => (
              <Badge key={b.label} variant="outline" className={cn("text-[10px] capitalize", b.className)}>
                {b.label}
              </Badge>
            ))}
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {facts.map(([k, v]) => (
              <div key={k} className="rounded-md border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
                <div className="text-xs font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence & timestamps
          </div>
          <EvidenceList items={evidence} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const SLA_STYLE = {
  on_track: "border-status-success/50 text-status-success",
  at_risk: "border-status-warning/50 text-status-warning",
  breached: "border-destructive/50 text-destructive",
} as const;

export interface DrilldownTarget {
  scope: "zone" | "corridor";
  id: string;
}

/**
 * Drill-down sheet opened from the LiveOpsMap: resolves the selected zone or
 * corridor into its underlying deliveries, parcels and vehicles, each with the
 * evidence artefacts and timestamps that back it.
 */
export function DrilldownSheet({
  module,
  target,
  onOpenChange,
}: {
  module: DeliveryModule;
  target: DrilldownTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const base = useMemo<DrilldownResult | null>(() => {
    if (!target) return null;
    return target.scope === "zone" ? zoneDrilldown(module, target.id) : corridorDrilldown(module, target.id);
  }, [module, target]);
  const [result, setResult] = useState<DrilldownResult | null>(base);

  useEffect(() => {
    setResult(base);
    if (!base) return;
    let cancelled = false;
    void hydrateDrilldown(module, base).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [base, module]);

  return (
    <Sheet open={!!target} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {result && (
          <>
            <SheetHeader className="text-left">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="text-lg">{result.title}</SheetTitle>
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {result.scope}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    result.source === "live"
                      ? "border-status-success/50 text-status-success"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {result.source === "live" ? "Live records" : "Modelled"}
                </Badge>
              </div>
              <SheetDescription>
                {result.subtitle} · generated {time(result.generatedAt)}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {result.metrics.map((m) => (
                <Card key={m.label} className="p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
                  <div className="text-sm font-semibold capitalize tabular-nums">{m.value}</div>
                </Card>
              ))}
            </div>

            <Tabs defaultValue="deliveries" className="mt-4">
              <TabsList className="grid grid-cols-3">
                <TabsTrigger value="deliveries" className="text-[11px]">
                  Deliveries ({result.deliveries.length})
                </TabsTrigger>
                <TabsTrigger value="parcels" className="text-[11px]">
                  Parcels ({result.parcels.length})
                </TabsTrigger>
                <TabsTrigger value="vehicles" className="text-[11px]">
                  Vehicles ({result.vehicles.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="deliveries" className="mt-3 space-y-2">
                {result.deliveries.map((d) => (
                  <Row
                    key={d.id}
                    title={`${d.reference} · ${d.customer}`}
                    meta={`${d.status.replace(/_/g, " ")} · ETA ${d.etaMinutes} min · updated ${time(d.lastUpdate)}`}
                    badges={[
                      { label: d.priority },
                      { label: d.slaState.replace(/_/g, " "), className: SLA_STYLE[d.slaState] },
                    ]}
                    facts={[
                      ["Assigned to", d.assignedTo],
                      ["Cost centre", d.costCentre],
                      ["Declared value", `KSh ${d.valueKes.toLocaleString("en-KE")}`],
                      ["Last update", `${day(d.lastUpdate)} ${time(d.lastUpdate)}`],
                    ]}
                    evidence={d.evidence}
                  />
                ))}
              </TabsContent>

              <TabsContent value="parcels" className="mt-3 space-y-2">
                {result.parcels.map((p) => (
                  <Row
                    key={p.id}
                    title={`${p.waybill} · ${p.contents}`}
                    meta={`${p.weightKg} kg · custody ${p.custodyHolder} · last scan ${time(p.lastScanAt)}`}
                    badges={[{ label: p.handling }]}
                    facts={[
                      ["Scans", String(p.scans)],
                      ["Temperature", p.temperatureC === null ? "n/a" : `${p.temperatureC} °C`],
                      ["Custody holder", p.custodyHolder],
                      ["Last scan", `${day(p.lastScanAt)} ${time(p.lastScanAt)}`],
                    ]}
                    evidence={p.evidence}
                  />
                ))}
              </TabsContent>

              <TabsContent value="vehicles" className="mt-3 space-y-2">
                {result.vehicles.map((v) => (
                  <Row
                    key={v.id}
                    title={`${v.plate} · ${v.type}`}
                    meta={`${v.driver} · ${v.speedKph} km/h · load ${v.loadPct}% · ping ${time(v.lastPingAt)}`}
                    badges={[
                      {
                        label: v.status,
                        className:
                          v.status === "delayed"
                            ? "border-destructive/50 text-destructive"
                            : v.status === "idle"
                              ? "border-border text-muted-foreground"
                              : "border-status-success/50 text-status-success",
                      },
                    ]}
                    facts={[
                      ["Odometer", `${v.odometerKm.toLocaleString("en-KE")} km`],
                      ["Inspection due", day(v.inspectionDue)],
                      ["Insurance to", day(v.insuranceValidTo)],
                      ["Load", `${v.loadPct}%`],
                    ]}
                    evidence={v.evidence}
                  />
                ))}
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
