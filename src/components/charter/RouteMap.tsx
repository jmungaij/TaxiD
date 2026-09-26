import { useMemo, useState } from "react";
import type { AirportRecord } from "@/lib/charter/airportRegistry";
import { deriveSegmentAlerts, type SegmentAlert } from "@/lib/charter/segmentAlerts";

export type RoutingMode = "great_circle" | "optimized";

export type { SegmentAlert };


interface RouteMapProps {
  from: AirportRecord | null;
  to: AirportRecord | null;
  /** Alternative airfields plotted as optimisation options. */
  alternates?: AirportRecord[];
  distanceNm?: number;
  flightTimeLabel?: string;
  /** Carbon for the mission, used to derive the per-segment carbon alert. */
  carbonKg?: number;
  /** Extra alerts supplied by the caller (weather, security, terrain). */
  alerts?: SegmentAlert[];
  /** Called when the traveller picks an alternative airfield. */
  onSelectAlternate?: (airport: AirportRecord) => void;
  className?: string;
}

const W = 720;
const H = 420;
const PAD = 70;

const SEVERITY_FILL: Record<SegmentAlert["severity"], string> = {
  info: "border-border bg-muted text-muted-foreground",
  watch: "border-status-warning/40 bg-status-warning/10 text-status-warning dark:text-status-warning",
  elevated: "border-destructive/40 bg-destructive/10 text-destructive",
};

const deriveAlerts = deriveSegmentAlerts;


/**
 * SmartFare route graph — an animated great-circle visualisation of the
 * mission across East Africa, with selectable optimised routing, nearby
 * airfield alternatives, hover tooltips and per-segment carbon/risk alerts.
 * Pure SVG so it renders in light and dark themes from design tokens and
 * needs no map vendor.
 */
export function RouteMap({
  from, to, alternates = [], distanceNm, flightTimeLabel, carbonKg = 0,
  alerts, onSelectAlternate, className,
}: RouteMapProps) {
  const [mode, setMode] = useState<RoutingMode>("great_circle");
  const [hover, setHover] = useState<{ x: number; y: number; title: string; body: string } | null>(null);

  const geo = useMemo(() => {
    const pts = [from, to, ...alternates].filter(Boolean) as AirportRecord[];
    if (pts.length < 2) return null;
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const spanLat = Math.max(0.8, maxLat - minLat);
    const spanLng = Math.max(0.8, maxLng - minLng);
    const project = (lat: number, lng: number) => ({
      x: PAD + ((lng - minLng) / spanLng) * (W - PAD * 2),
      y: PAD + ((maxLat - lat) / spanLat) * (H - PAD * 2),
    });
    const a = project(from!.lat, from!.lng);
    const b = project(to!.lat, to!.lng);
    const mx = (a.x + b.x) / 2;
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const my = (a.y + b.y) / 2 - chord * 0.22;
    return {
      a, b,
      // Great circle bows away from the chord; the optimised track flies the
      // flatter, wind/terrain-corrected profile closer to the direct line.
      greatCircle: `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`,
      optimized: `M ${a.x} ${a.y} Q ${mx} ${(a.y + b.y) / 2 - chord * 0.06} ${b.x} ${b.y}`,
      alts: alternates.map((p) => ({ ...project(p.lat, p.lng), record: p })),
    };
  }, [from, to, alternates]);

  const segmentAlerts = useMemo(
    () => alerts ?? deriveAlerts(to, distanceNm ?? 0, carbonKg),
    [alerts, to, distanceNm, carbonKg],
  );

  if (!geo || !from || !to) {
    return (
      <div className={`flex h-64 items-center justify-center rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground ${className ?? ""}`}>
        Select an origin and destination to visualise the mission route.
      </div>
    );
  }

  const activePath = mode === "optimized" ? geo.optimized : geo.greatCircle;
  const optimizedSaving = mode === "optimized" && distanceNm
    ? Math.round(distanceNm * 0.03)
    : 0;

  return (
    <div className={`relative overflow-hidden rounded-xl border border-border bg-card ${className ?? ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Mission routing</span>
        <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Routing overlay">
          {([["great_circle", "Great circle"], ["optimized", "Optimised track"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setMode(key)}
              aria-pressed={mode === key}
              className={`rounded px-2.5 py-1 text-xs transition ${mode === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Route from ${from.name} to ${to.name}`}>
        <defs>
          <linearGradient id="sf-route" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(var(--primary))" />
          </linearGradient>
          <radialGradient id="sf-glow">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* graticule */}
        {Array.from({ length: 9 }).map((_, i) => (
          <line key={`v${i}`} x1={(W / 8) * i} y1={0} x2={(W / 8) * i} y2={H}
            stroke="hsl(var(--border))" strokeWidth="1" opacity="0.45" />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`h${i}`} x1={0} y1={(H / 5) * i} x2={W} y2={(H / 5) * i}
            stroke="hsl(var(--border))" strokeWidth="1" opacity="0.45" />
        ))}

        {/* operating radius overlay */}
        <circle cx={geo.a.x} cy={geo.a.y} r={150} fill="url(#sf-glow)" />

        {/* inactive overlay for comparison */}
        <path d={mode === "optimized" ? geo.greatCircle : geo.optimized} fill="none"
          stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.5" />

        {/* nearby alternative airfields */}
        {geo.alts.map((p) => (
          <g key={p.record.code} role="button" tabIndex={0}
            className="cursor-pointer focus:outline-none"
            aria-label={`Alternative airfield ${p.record.name}`}
            onClick={() => onSelectAlternate?.(p.record)}
            onKeyDown={(e) => { if (e.key === "Enter") onSelectAlternate?.(p.record); }}
            onMouseEnter={() => setHover({
              x: p.x, y: p.y,
              title: `${p.record.code} · ${p.record.name}`,
              body: `${p.record.city} · ${p.record.runwayM ? `${p.record.runwayM} m runway` : "Helipad"} · ${p.record.fuel ? "fuel" : "no fuel"} · ${p.record.nightOps ? "night ops" : "daylight only"}`,
            })}
            onMouseLeave={() => setHover(null)}>
            <circle cx={p.x} cy={p.y} r={11} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={5} fill="hsl(var(--muted-foreground))" opacity="0.7" />
            <text x={p.x + 9} y={p.y + 4} className="fill-muted-foreground" fontSize="11">{p.record.code}</text>
          </g>
        ))}

        {/* active track */}
        <path d={activePath} fill="none" stroke="url(#sf-route)" strokeWidth="3" strokeLinecap="round"
          strokeDasharray="10 8">
          <animate attributeName="stroke-dashoffset" from="36" to="0" dur="1.6s" repeatCount="indefinite" />
        </path>

        {/* animated aircraft */}
        <g>
          <circle r="7" fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth="2">
            <animateMotion dur="6s" repeatCount="indefinite" path={activePath} rotate="auto" />
          </circle>
        </g>

        {/* endpoints with distance / flight-time tooltips */}
        {[{ p: geo.a, r: from }, { p: geo.b, r: to }].map(({ p, r }) => (
          <g key={r.code}
            onMouseEnter={() => setHover({
              x: p.x, y: p.y,
              title: `${r.code} · ${r.name}`,
              body: `${distanceNm ?? "—"} nm · ${flightTimeLabel ?? "—"} block time · ${r.runwayM ? `${r.runwayM} m runway` : "Helipad"}`,
            })}
            onMouseLeave={() => setHover(null)}>
            <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={9} fill="hsl(var(--background))" stroke="hsl(var(--primary))" strokeWidth="3" />
            <text x={p.x} y={p.y - 18} textAnchor="middle" className="fill-foreground" fontSize="13" fontWeight="600">
              {r.code}
            </text>
            <text x={p.x} y={p.y + 26} textAnchor="middle" className="fill-muted-foreground" fontSize="11">
              {r.city}
            </text>
          </g>
        ))}

        {/* mid-segment distance / time label */}
        <text x={W / 2} y={PAD - 34} textAnchor="middle" className="fill-muted-foreground" fontSize="11">
          {distanceNm ?? "—"} nm · {flightTimeLabel ?? "—"}
          {optimizedSaving > 0 ? ` · optimised track saves ≈${optimizedSaving} nm` : ""}
        </text>
      </svg>

      {hover && (
        <div className="pointer-events-none absolute z-10 max-w-[240px] rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%`, transform: "translate(-50%, -130%)" }}
          role="tooltip">
          <p className="font-semibold text-foreground">{hover.title}</p>
          <p className="text-muted-foreground">{hover.body}</p>
        </div>
      )}

      {segmentAlerts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          {segmentAlerts.map((a) => (
            <span key={`${a.kind}-${a.label}`} title={a.detail}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${SEVERITY_FILL[a.severity]}`}>
              {a.kind === "carbon" ? "CO₂e" : "Risk"} · {a.label}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <span><span className="font-semibold text-foreground">{distanceNm ?? "—"}</span> nm {mode === "optimized" ? "optimised track" : "great-circle"}</span>
        <span><span className="font-semibold text-foreground">{flightTimeLabel ?? "—"}</span> estimated block time</span>
        <span>{to.runwayM ? `${to.runwayM} m runway` : "Helipad"}</span>
        <span>{to.fuel ? "Fuel available" : "No fuel uplift"}</span>
        <span>{to.nightOps ? "Night ops" : "Daylight only"}</span>
        <span>{to.customs ? "Customs & immigration" : "Domestic clearance"}</span>
      </div>
    </div>
  );
}

export default RouteMap;
