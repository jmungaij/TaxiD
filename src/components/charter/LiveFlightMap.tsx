import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Search, Plane, Play, Pause, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { fitProjection, type AirPoint } from "@/lib/charter/airports";
import { buildRoutes, money, summariseNetwork, type FlightHubDataset, type RouteLeg } from "@/lib/charter/flightHub";

const W = 900;
const H = 460;

/** Selectable playback windows for the historical route review. */
export const PLAYBACK_RANGES = [
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7 days", hours: 24 * 7 },
  { key: "30d", label: "30 days", hours: 24 * 30 },
  { key: "all", label: "All time", hours: 0 },
] as const;
export type PlaybackRangeKey = (typeof PLAYBACK_RANGES)[number]["key"];

/** Window start for a range key, given the dataset's earliest booking. */
export function rangeStart(key: PlaybackRangeKey, now: number, earliest: number): number {
  const range = PLAYBACK_RANGES.find((r) => r.key === key);
  if (!range || range.hours === 0) return earliest;
  return now - range.hours * 3_600_000;
}

/** Bookings created up to (and within) the playback cursor. */
export function bookingsUpTo(dataset: FlightHubDataset, fromMs: number, cursorMs: number) {
  return dataset.bookings.filter((b) => {
    const t = Date.parse(b.created_at);
    return Number.isFinite(t) && t >= fromMs && t <= cursorMs;
  });
}

/**
 * Live flight status map — an SVG route network rendered from live bookings.
 * Deliberately key-less (no maps API): it projects the known Yalla Air point
 * registry so the widget always renders inside the dashboard shell.
 *
 * When a `dataset` is supplied the widget also offers playback: pick a time
 * range, scrub or auto-play the cursor and watch the network build up over
 * time, with the summary recomputed at every step.
 */
export function LiveFlightMap({ legs, dataset }: { legs: RouteLeg[]; dataset?: FlightHubDataset }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [range, setRange] = useState<PlaybackRangeKey>("all");
  const [progress, setProgress] = useState(100);
  const [playing, setPlaying] = useState(false);

  const now = Date.now();
  const earliest = useMemo(() => {
    const times = (dataset?.bookings ?? []).map((b) => Date.parse(b.created_at)).filter(Number.isFinite);
    return times.length ? Math.min(...times) : now - 30 * 24 * 3_600_000;
  }, [dataset, now]);

  const from = dataset ? rangeStart(range, now, earliest) : now;
  const cursor = from + ((now - from) * progress) / 100;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 100) { setPlaying(false); return 100; }
        return Math.min(100, p + 2);
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [playing]);

  const sourceLegs = useMemo(() => {
    if (!dataset || progress >= 100) return legs;
    return buildRoutes({ ...dataset, bookings: bookingsUpTo(dataset, from, cursor) });
  }, [dataset, legs, from, cursor, progress]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? sourceLegs.filter((l) => `${l.originLabel} ${l.destinationLabel}`.toLowerCase().includes(q)) : sourceLegs),
    [sourceLegs, q],
  );
  const summary = useMemo(() => summariseNetwork(filtered), [filtered]);

  const mapped = filtered.filter((l): l is RouteLeg & { origin: AirPoint; destination: AirPoint } =>
    Boolean(l.origin && l.destination));
  const points = useMemo(() => {
    const seen = new Map<string, AirPoint>();
    mapped.forEach((l) => { seen.set(l.origin.code, l.origin); seen.set(l.destination.code, l.destination); });
    return [...seen.values()];
  }, [mapped]);
  const proj = useMemo(() => fitProjection(points, W, H), [points]);


  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--card))]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Live flight network</h3>
          <p className="text-xs text-muted-foreground">
            {summary.routes} routes · {summary.destinations} destinations · updated{" "}
            {summary.lastUpdate ? new Date(summary.lastUpdate).toLocaleString() : "—"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="gap-1.5 border-status-success/40 text-status-success">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-success/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-status-success" />
            </span>
            {summary.airborne} airborne
          </Badge>
          <Badge variant="secondary">{summary.scheduled} scheduled</Badge>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search routes…"
              aria-label="Search flight routes"
              className="h-9 w-52 pl-8 text-sm"
            />
          </div>
        </div>
      </div>

      {dataset && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border/70 bg-muted/30 px-5 py-3">
          <div className="flex gap-1.5">
            {PLAYBACK_RANGES.map((r) => (
              <Button
                key={r.key}
                size="sm"
                variant={range === r.key ? "default" : "outline"}
                className="h-8"
                onClick={() => { setRange(r.key); setProgress(100); setPlaying(false); }}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <Button
            size="sm" variant="secondary" className="h-8 gap-1.5"
            aria-label={playing ? "Pause playback" : "Play route playback"}
            onClick={() => { if (progress >= 100) setProgress(0); setPlaying((p) => !p); }}
          >
            {playing ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button
            size="sm" variant="ghost" className="h-8 gap-1.5"
            onClick={() => { setPlaying(false); setProgress(100); }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Live
          </Button>
          <div className="flex min-w-[220px] flex-1 items-center gap-3">
            <Slider
              value={[progress]}
              min={0}
              max={100}
              step={1}
              aria-label="Playback position"
              onValueChange={([v]) => { setPlaying(false); setProgress(v); }}
            />
            <span className="w-44 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {progress >= 100 ? "Live now" : new Date(cursor).toLocaleString()}
            </span>
          </div>
        </div>
      )}


      <div className="grid gap-0 lg:grid-cols-[1.6fr_1fr]">
        <div className="relative bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.16),transparent_60%),radial-gradient(circle_at_80%_80%,hsl(var(--ai-accent)/0.14),transparent_55%)]">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Live flight route map">
            <defs>
              <linearGradient id="legGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
                <stop offset="100%" stopColor="hsl(var(--ai-accent))" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            {[...Array(10)].map((_, i) => (
              <line key={`h${i}`} x1="0" y1={(H / 10) * i} x2={W} y2={(H / 10) * i} stroke="hsl(var(--chart-grid))" strokeOpacity="0.35" />
            ))}
            {[...Array(16)].map((_, i) => (
              <line key={`v${i}`} x1={(W / 16) * i} y1="0" x2={(W / 16) * i} y2={H} stroke="hsl(var(--chart-grid))" strokeOpacity="0.25" />
            ))}

            {mapped.map((l) => {
              const x1 = proj.x(l.origin.lng), y1 = proj.y(l.origin.lat);
              const x2 = proj.x(l.destination.lng), y2 = proj.y(l.destination.lat);
              const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.22 - 24;
              const isActive = active === l.key;
              const path = `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
              return (
                <g key={l.key} onMouseEnter={() => setActive(l.key)} onMouseLeave={() => setActive(null)}>
                  <path d={path} fill="none" stroke="url(#legGrad)" strokeWidth={isActive ? 3.5 : l.airborne > 0 ? 2.4 : 1.4}
                    strokeDasharray={l.airborne > 0 ? undefined : "5 6"} strokeLinecap="round" />
                  {l.airborne > 0 && (
                    <circle r="4" fill="hsl(var(--status-success))">
                      <animateMotion dur={`${6 + (l.flights % 4)}s`} repeatCount="indefinite" path={path} />
                    </circle>
                  )}
                </g>
              );
            })}

            {points.map((p) => (
              <g key={p.code}>
                <circle cx={proj.x(p.lng)} cy={proj.y(p.lat)} r="5" fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth="1.5" />
                <text x={proj.x(p.lng) + 9} y={proj.y(p.lat) + 4} fontSize="11" fill="hsl(var(--muted-foreground))">{p.code}</text>
              </g>
            ))}

            {mapped.length === 0 && (
              <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="14" fill="hsl(var(--muted-foreground))">
                No mapped routes for this search
              </text>
            )}
          </svg>
        </div>

        <ul className="max-h-[460px] divide-y divide-border/70 overflow-y-auto border-l border-border/70">
          {filtered.map((l) => (
            <li
              key={l.key}
              onMouseEnter={() => setActive(l.key)}
              onMouseLeave={() => setActive(null)}
              className={cn("px-5 py-3 transition-colors", active === l.key && "bg-muted/60")}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <Plane className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate">{l.originLabel} → {l.destinationLabel}</span>
                </p>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{money(l.value, l.currency)}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-status-success/12 px-2 py-0.5 text-status-success">{l.airborne} airborne</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{l.scheduled} scheduled</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{l.closed} closed</span>
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-muted-foreground">No routes match “{query}”.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
