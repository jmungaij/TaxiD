/**
 * Enterprise road route visualisation (Document System 2.0).
 *
 * Pure-SVG animated corridor between pickup and drop-off. Renders from design
 * tokens so it works in light, dark and print, and needs no map vendor or API
 * key. When coordinates are known it plots a geographically correct corridor
 * and derives distance, duration and arrival prediction; before then it shows
 * an indicative corridor so the customer still sees their journey take shape.
 */
import { useMemo } from "react";
import { Clock, Gauge, MapPin, Route, Leaf } from "lucide-react";
import type { BookingPoint } from "@/components/rider/bookingTypes";

interface Props {
  origin: string;
  destination: string;
  originPoint?: BookingPoint | null;
  destinationPoint?: BookingPoint | null;
  /** Departure timestamp used for the arrival prediction. */
  departAt?: string;
  className?: string;
}

const W = 640;
const H = 260;
const PAD = 54;
/** Average intercity coach speed on Kenyan trunk roads. */
const AVG_KMH = 62;
/** Diesel coach emissions factor, kg CO2e per km. */
const CO2_PER_KM = 0.82;

function haversineKm(a: BookingPoint, b: BookingPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function durationLabel(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function RoadRouteMap({
  origin, destination, originPoint, destinationPoint, departAt, className,
}: Props) {
  const geo = useMemo(() => {
    if (!originPoint || !destinationPoint) return null;
    const lats = [originPoint.lat, destinationPoint.lat];
    const lngs = [originPoint.lng, destinationPoint.lng];
    const spanLat = Math.max(0.25, Math.max(...lats) - Math.min(...lats));
    const spanLng = Math.max(0.25, Math.max(...lngs) - Math.min(...lngs));
    const project = (p: BookingPoint) => ({
      x: PAD + ((p.lng - Math.min(...lngs)) / spanLng) * (W - PAD * 2),
      y: H - PAD - ((p.lat - Math.min(...lats)) / spanLat) * (H - PAD * 2),
    });
    return { a: project(originPoint), b: project(destinationPoint) };
  }, [originPoint, destinationPoint]);

  const a = geo?.a ?? { x: PAD, y: H - PAD };
  const b = geo?.b ?? { x: W - PAD, y: PAD };
  // Gentle arc so the corridor reads as a road, not a straight ruler line.
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 42 };
  const path = `M ${a.x} ${a.y} Q ${mid.x} ${mid.y} ${b.x} ${b.y}`;

  const distanceKm =
    originPoint && destinationPoint ? haversineKm(originPoint, destinationPoint) : null;
  const hours = distanceKm != null ? distanceKm / AVG_KMH : null;
  const arrival = useMemo(() => {
    if (hours == null || !departAt) return null;
    const t = new Date(departAt);
    if (Number.isNaN(t.getTime())) return null;
    return new Date(t.getTime() + hours * 3600_000);
  }, [hours, departAt]);

  return (
    <section
      className={`rounded-2xl border border-border bg-card/70 backdrop-blur-sm overflow-hidden ${className ?? ""}`}
      aria-label="Route visualisation"
    >
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Route className="h-4 w-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold">Live route intelligence</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {geo ? "Mapped from confirmed coordinates" : "Indicative corridor — select mapped locations"}
        </span>
      </header>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Route from ${origin || "pickup"} to ${destination || "drop-off"}`}
      >
        <defs>
          <linearGradient id="yalla-route-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(var(--primary))" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={`h${i}`}
            x1={0} x2={W} y1={(H / 4) * i} y2={(H / 4) * i}
            stroke="hsl(var(--border))" strokeWidth="0.6" opacity="0.5"
          />
        ))}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <line
            key={`v${i}`}
            y1={0} y2={H} x1={(W / 6) * i} x2={(W / 6) * i}
            stroke="hsl(var(--border))" strokeWidth="0.6" opacity="0.5"
          />
        ))}

        <path d={path} fill="none" stroke="url(#yalla-route-grad)" strokeWidth="4" strokeLinecap="round" />
        <path
          d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth="4"
          strokeLinecap="round" strokeDasharray="14 210" opacity="0.95"
        >
          <animate attributeName="stroke-dashoffset" from="224" to="0" dur="2.6s" repeatCount="indefinite" />
        </path>

        <circle cx={a.x} cy={a.y} r="9" fill="hsl(var(--background))" stroke="hsl(var(--primary))" strokeWidth="3" />
        <text x={a.x} y={a.y + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="hsl(var(--primary))">A</text>
        <circle cx={b.x} cy={b.y} r="9" fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth="3" />
        <text x={b.x} y={b.y + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="hsl(var(--primary-foreground))">B</text>

        <text x={a.x} y={a.y + 24} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">
          {(origin || "Pickup").slice(0, 26)}
        </text>
        <text x={b.x} y={b.y - 16} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">
          {(destination || "Drop-off").slice(0, 26)}
        </text>
      </svg>

      <dl className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
        <Metric icon={<Gauge className="h-3.5 w-3.5" />} label="Distance"
          value={distanceKm != null ? `${distanceKm.toFixed(0)} km` : "—"} />
        <Metric icon={<Clock className="h-3.5 w-3.5" />} label="Est. duration"
          value={hours != null ? durationLabel(hours) : "—"} />
        <Metric icon={<MapPin className="h-3.5 w-3.5" />} label="Arrival prediction"
          value={arrival ? arrival.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "—"} />
        <Metric icon={<Leaf className="h-3.5 w-3.5" />} label="Carbon estimate"
          value={distanceKm != null ? `${(distanceKm * CO2_PER_KM).toFixed(0)} kg CO₂e` : "—"} />
      </dl>

      {(originPoint || destinationPoint) && (
        <p className="px-5 py-3 text-[11px] text-muted-foreground">
          {originPoint
            ? `A ${originPoint.lat.toFixed(5)}, ${originPoint.lng.toFixed(5)}`
            : "A coordinates pending"}
          {"  ·  "}
          {destinationPoint
            ? `B ${destinationPoint.lat.toFixed(5)}, ${destinationPoint.lng.toFixed(5)}`
            : "B coordinates pending"}
        </p>
      )}
    </section>
  );
}

const Metric = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="bg-card px-4 py-3">
    <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
      {icon} {label}
    </dt>
    <dd className="mt-0.5 text-sm font-semibold">{value}</dd>
  </div>
);

export default RoadRouteMap;
