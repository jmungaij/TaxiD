import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Plane, MapPin, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { money, type RouteLeg } from "@/lib/charter/flightHub";
import type { CharterInventoryRow } from "@/lib/charter/api";

/** Cinematic aircraft card used across the Flight Hub (presentation only). */
export function AircraftCard({ item }: { item: CharterInventoryRow }) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:shadow-[var(--shadow-elegant)]">
      <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_20%_0%,hsl(var(--primary)/0.22),transparent_70%)]" />
      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{item.operator_name || "Yalla Air partner"}</p>
            <h3 className="mt-1 truncate text-base font-semibold tracking-tight">{item.name}</h3>
          </div>
          <span className="rounded-xl bg-primary/10 p-2 text-primary transition-transform duration-300 group-hover:rotate-12">
            <Plane className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.spec}</p>
        <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border/70 text-center">
          <Cell label="Capacity" value={item.capacity} />
          <Cell label="Base" value={item.home_base || "—"} />
          <Cell label="From" value={money(item.base_rate, item.currency)} />
        </dl>
        <div className="mt-4 flex items-center justify-between">
          <Badge variant={item.active ? "default" : "outline"}>{item.active ? "Available" : item.status}</Badge>
          {item.offer_label && (
            <span className="text-xs font-medium text-status-success">{item.offer_label} · −{item.offer_discount_pct}%</span>
          )}
        </div>
      </div>
    </article>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-2 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-xs font-semibold">{value}</dd>
    </div>
  );
}

/** Journey visualisation — an animated origin → destination ribbon. */
export function JourneyRibbon({ legs, limit = 5 }: { legs: RouteLeg[]; limit?: number }) {
  const rows = legs.slice(0, limit);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No journeys recorded yet.</p>;
  return (
    <ol className="space-y-3">
      {rows.map((l) => (
        <li key={l.key} className="rounded-xl border border-border bg-card/70 p-4">
          <div className="flex items-center gap-3">
            <Node label={l.originLabel} />
            <div className="relative h-px flex-1 bg-gradient-to-r from-primary/30 via-primary to-[hsl(var(--ai-accent))]">
              <span className={cn("absolute -top-1.5 left-0 text-primary", l.airborne > 0 && "animate-pulse")}>
                <Plane className="h-3 w-3" aria-hidden="true" />
              </span>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <Node label={l.destinationLabel} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {l.flights} flights · {l.airborne} airborne · {money(l.value, l.currency)}
          </p>
        </li>
      ))}
    </ol>
  );
}

const Node = ({ label }: { label: string }) => (
  <span className="max-w-[38%] truncate rounded-full bg-muted px-3 py-1 text-xs font-medium">{label}</span>
);

/** Destination strip — most-flown arrival points. */
export function DestinationsStrip({ legs }: { legs: RouteLeg[] }) {
  const tally = new Map<string, number>();
  legs.forEach((l) => tally.set(l.destinationLabel, (tally.get(l.destinationLabel) ?? 0) + l.flights));
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length === 0) return <p className="text-sm text-muted-foreground">Destinations appear once flights are booked.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {top.map(([name, count]) => (
        <span key={name} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
          <MapPin className="h-3 w-3 text-primary" aria-hidden="true" />
          <span className="font-medium">{name}</span>
          <span className="tabular-nums text-muted-foreground">{count}</span>
        </span>
      ))}
    </div>
  );
}

/** Cinematic sub-heading used inside hub sections. */
export function CinematicHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2>
      {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
