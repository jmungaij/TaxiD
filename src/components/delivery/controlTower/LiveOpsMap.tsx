import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CloudRain, Flame, Gauge, MapPin, Route as RouteIcon, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { liveMapModel, type MapUnit } from "@/lib/delivery/controlTower";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";

type Overlay = "heat" | "routes" | "units" | "zones";

const UNIT_FILL: Record<MapUnit["kind"], string> = {
  courier: "hsl(var(--map-driver))",
  vehicle: "hsl(var(--map-route))",
  pickup: "hsl(var(--map-rider))",
  hub: "hsl(var(--primary))",
  depot: "hsl(var(--accent))",
};

const RISK_STROKE = {
  low: "hsl(var(--status-success))",
  medium: "hsl(var(--status-warning))",
  high: "hsl(var(--map-incident))",
} as const;

/**
 * Live operations map. A deterministic SVG surface (no external map SDK) that
 * renders service zones, demand heat, active corridors, couriers, vehicles,
 * pickups, hubs and depots for the selected delivery module.
 */
export function LiveOpsMap({
  module,
  onDrilldown,
}: {
  module: DeliveryModule;
  onDrilldown?: (target: { scope: "zone" | "corridor"; id: string }) => void;
}) {

  const model = useMemo(() => liveMapModel(module), [module]);
  const [overlays, setOverlays] = useState<Record<Overlay, boolean>>({ heat: true, routes: true, units: true, zones: true });
  const [selected, setSelected] = useState<string | null>(null);

  const toggle = (o: Overlay) => setOverlays((prev) => ({ ...prev, [o]: !prev[o] }));
  const selectedUnit = model.units.find((u) => u.id === selected);
  const selectedZone = model.zones.find((z) => z.id === selected);

  const overlayButtons: Array<{ id: Overlay; label: string; icon: typeof Flame }> = [
    { id: "heat", label: "Demand heat", icon: Flame },
    { id: "zones", label: "Service zones", icon: MapPin },
    { id: "routes", label: "Corridors", icon: RouteIcon },
    { id: "units", label: "Units", icon: Truck },
  ];

  return (
    <Card className="overflow-hidden border-border/70">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b bg-card/70 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-status-success" />
          </span>
          <div className="text-sm font-semibold">Live operations map</div>
          <Badge variant="secondary" className="text-[10px]">Nairobi metro</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {overlayButtons.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              size="sm"
              variant={overlays[id] ? "secondary" : "ghost"}
              className="h-7 px-2 text-[11px]"
              onClick={() => toggle(id)}
              aria-pressed={overlays[id]}
            >
              <Icon className="h-3 w-3 mr-1" /> {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label="Live delivery operations map with service zones, corridors and field units"
          className="w-full h-[380px] md:h-[460px] bg-[hsl(var(--muted))]"
        >
          <defs>
            <radialGradient id="ct-heat">
              <stop offset="0%" stopColor="hsl(var(--map-incident))" stopOpacity="0.5" />
              <stop offset="100%" stopColor="hsl(var(--map-incident))" stopOpacity="0" />
            </radialGradient>
            <pattern id="ct-grid" width="6.25" height="6.25" patternUnits="userSpaceOnUse">
              <path d="M6.25 0H0v6.25" fill="none" stroke="hsl(var(--border))" strokeWidth="0.15" />
            </pattern>
          </defs>

          <rect width="100" height="100" fill="url(#ct-grid)" />

          {/* arterial roads */}
          <g stroke="hsl(var(--border))" strokeWidth="0.7" fill="none" opacity="0.9">
            <path d="M0 46 L38 50 L62 58 L100 62" />
            <path d="M50 0 L52 40 L48 70 L44 100" />
            <path d="M0 80 L34 74 L70 82 L100 74" />
            <path d="M10 10 L40 38 L74 22" />
          </g>

          {overlays.heat &&
            model.heat.map((h) => (
              <circle key={`h-${h.x}-${h.y}`} cx={h.x} cy={h.y} r={6 + h.intensity * 14} fill="url(#ct-heat)" opacity={0.35 + h.intensity * 0.5} />
            ))}

          {overlays.zones &&
            model.zones.map((z) => (
              <g key={z.id} onClick={() => setSelected(z.id)} className="cursor-pointer">
                <circle
                  cx={z.x}
                  cy={z.y}
                  r={7.5}
                  fill="hsl(var(--primary) / 0.06)"
                  stroke={z.surge ? "hsl(var(--status-warning))" : "hsl(var(--primary) / 0.5)"}
                  strokeWidth="0.35"
                  strokeDasharray="1.4 1"
                />
                <text x={z.x} y={z.y - 9} textAnchor="middle" fontSize="2.6" fill="hsl(var(--muted-foreground))">
                  {z.name}
                </text>
              </g>
            ))}

          {overlays.routes &&
            model.routes.map((r) => (
              <g key={r.id}>
                <path
                  d={`M${r.points.map((p) => `${p.x} ${p.y}`).join(" L")}`}
                  fill="none"
                  stroke={RISK_STROKE[r.risk]}
                  strokeWidth="0.7"
                  strokeLinecap="round"
                  opacity="0.85"
                  strokeDasharray="3 2"
                  className="motion-safe:animate-[dash_2.4s_linear_infinite]"
                  style={{ animationName: "ct-dash" }}
                />
              </g>
            ))}

          {overlays.units &&
            model.units.map((u) => (
              <g key={u.id} onClick={() => setSelected(u.id)} className="cursor-pointer">
                {u.status === "delayed" && <circle cx={u.x} cy={u.y} r="2.4" fill="hsl(var(--map-incident) / 0.25)" />}
                {u.kind === "hub" || u.kind === "depot" ? (
                  <rect x={u.x - 1.5} y={u.y - 1.5} width="3" height="3" rx="0.6" fill={UNIT_FILL[u.kind]} stroke="hsl(var(--card))" strokeWidth="0.3" />
                ) : (
                  <circle
                    cx={u.x}
                    cy={u.y}
                    r={selected === u.id ? 1.9 : 1.2}
                    fill={u.status === "delayed" ? "hsl(var(--map-incident))" : u.status === "idle" ? "hsl(var(--map-idle))" : UNIT_FILL[u.kind]}
                    stroke="hsl(var(--card))"
                    strokeWidth="0.3"
                  />
                )}
              </g>
            ))}
        </svg>
        <style>{`@keyframes ct-dash { to { stroke-dashoffset: -10; } }`}</style>

        {/* environment chips */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
          <span className="flex items-center gap-1 rounded-md bg-card/85 backdrop-blur px-2 py-1 text-[11px] font-medium border">
            <Gauge className="h-3 w-3 text-status-warning" /> Traffic {Math.round(model.trafficIndex * 100)}%
          </span>
          <span className="flex items-center gap-1 rounded-md bg-card/85 backdrop-blur px-2 py-1 text-[11px] font-medium border">
            <CloudRain className="h-3 w-3 text-primary" /> Weather {Math.round(model.weatherIndex * 100)}%
          </span>
        </div>

        {/* legend */}
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 rounded-md bg-card/85 backdrop-blur border px-2 py-1.5 text-[10px]">
          {[
            ["Courier", UNIT_FILL.courier],
            ["Vehicle", UNIT_FILL.vehicle],
            ["Pickup", UNIT_FILL.pickup],
            ["Hub / depot", UNIT_FILL.hub],
            ["Delayed", "hsl(var(--map-incident))"],
          ].map(([label, color]) => (
            <span key={label} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
            </span>
          ))}
        </div>

        {/* inspector */}
        {(selectedUnit || selectedZone) && (
          <div className="absolute top-3 right-3 w-56 rounded-lg border bg-card/90 backdrop-blur p-3 text-xs shadow-[var(--shadow-md)]">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-sm">{selectedUnit?.label ?? selectedZone?.name}</div>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)} aria-label="Close">
                ×
              </button>
            </div>
            {selectedUnit && (
              <dl className="mt-2 space-y-1">
                <Row k="Type" v={selectedUnit.kind} />
                <Row k="Status" v={selectedUnit.status} />
              </dl>
            )}
            {selectedZone && (
              <dl className="mt-2 space-y-1">
                <Row k="Couriers" v={String(selectedZone.couriers)} />
                <Row k="Open requests" v={String(selectedZone.openRequests)} />
                <Row k="Avg ETA" v={`${selectedZone.avgEtaMinutes} min`} />
                <Row k="Demand index" v={selectedZone.demandIndex.toFixed(2)} />
                <Row k="Pricing" v={selectedZone.surge ? "Surge active" : "Base rate"} />
              </dl>
            )}
            {onDrilldown && (
              <Button
                size="sm"
                className="mt-2 h-7 w-full text-[11px]"
                onClick={() =>
                  onDrilldown(
                    selectedZone
                      ? { scope: "zone", id: selectedZone.id }
                      : { scope: "zone", id: model.zones[0]?.id ?? "" },
                  )
                }
              >
                Open underlying records
              </Button>
            )}
          </div>
        )}

      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4 border-t bg-card/60">
        {model.routes.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onDrilldown?.({ scope: "corridor", id: r.id })}
            className={cn(
              "rounded-md border p-2.5 text-left transition-colors",
              onDrilldown ? "hover:border-primary/50 hover:bg-primary/5" : "cursor-default",
            )}
          >
            <div className="text-[11px] font-semibold truncate">
              {r.from} → {r.to}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>ETA {r.etaMinutes} min</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] capitalize",
                  r.risk === "high" && "border-destructive/50 text-destructive",
                  r.risk === "medium" && "border-status-warning/50 text-status-warning",
                  r.risk === "low" && "border-status-success/50 text-status-success",
                )}
              >
                {r.risk} risk
              </Badge>
            </div>
          </button>
        ))}

      </div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium capitalize">{v}</dd>
    </div>
  );
}
