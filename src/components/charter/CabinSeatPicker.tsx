/**
 * Cabin arrangement + seat selection for the booking flow.
 *
 * The customer first chooses a seating arrangement (club four, conference,
 * VIP lounge …) with a photographic preview, then picks the specific seats
 * their party will occupy.
 */
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { layoutsFor, seatsForLayout, type CabinLayout } from "@/lib/charter/cabinLayouts";

interface Props {
  aircraftKey: string;
  aircraftLabel: string;
  capacity: number;
  layoutKey: string;
  onLayoutChange: (key: string) => void;
  selectedSeats: string[];
  onToggleSeat: (id: string) => void;
  maxSeats: number;
}

export function CabinSeatPicker({
  aircraftKey, aircraftLabel, capacity, layoutKey, onLayoutChange,
  selectedSeats, onToggleSeat, maxSeats,
}: Props) {
  const layouts = layoutsFor(aircraftKey, capacity);
  const layout: CabinLayout = layouts.find((l) => l.key === layoutKey) ?? layouts[0];
  const { seats, windows } = seatsForLayout(layout, capacity);

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-sm font-semibold">Cabin arrangement</Label>
        <p className="text-xs text-muted-foreground">
          {aircraftLabel} · {capacity} cabin seats. Operations configures the cabin before departure.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {layouts.map((l) => {
            const active = l.key === layout.key;
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => onLayoutChange(l.key)}
                aria-pressed={active}
                className={`overflow-hidden rounded-xl border text-left transition ${
                  active ? "border-primary ring-2 ring-primary/25" : "border-border hover:border-primary/50"
                }`}
              >
                <img src={l.image} alt={`${l.label} cabin preview`} loading="lazy" className="h-28 w-full object-cover" />
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{l.label}</span>
                    {active && <Badge variant="outline">Selected</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{l.blurb}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-secondary/20 p-4">
        <p className="mb-3 text-center text-xs uppercase tracking-wide text-muted-foreground">Flight deck</p>
        <div
          className="mx-auto grid max-w-xs gap-2"
          style={{ gridTemplateColumns: `repeat(${layout.perRow}, minmax(0,1fr))` }}
        >
          {seats.map((id) => {
            const chosen = selectedSeats.includes(id);
            const full = !chosen && selectedSeats.length >= maxSeats;
            return (
              <button
                key={id}
                type="button"
                disabled={full}
                onClick={() => onToggleSeat(id)}
                aria-pressed={chosen}
                aria-label={`Seat ${id}${windows.includes(id) ? " (window)" : ""}`}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition disabled:opacity-40 ${
                  chosen
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary/60"
                }`}
              >
                {id}
                {windows.includes(id) && <span className="ml-1 opacity-70">◻</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          ◻ window seat · {selectedSeats.length}/{maxSeats} selected
        </p>
      </div>
    </div>
  );
}
