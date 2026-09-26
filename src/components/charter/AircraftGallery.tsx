/**
 * Aircraft media gallery — interior and exterior imagery of the selected
 * aircraft, reused by search results, the booking flow and the confirmation.
 */
import { useState } from "react";
import { imagesFor } from "@/lib/charter/flightSearch";
import { layoutByKey } from "@/lib/charter/cabinLayouts";

interface Props {
  aircraftKey: string;
  aircraftLabel: string;
  /** Optional chosen cabin layout — adds its preview to the gallery. */
  layoutKey?: string;
  className?: string;
}

export function AircraftGallery({ aircraftKey, aircraftLabel, layoutKey, className }: Props) {
  const base = imagesFor(aircraftKey);
  const layout = layoutKey ? layoutByKey(layoutKey) : undefined;

  const shots = [
    { src: base.exterior, caption: `${aircraftLabel} — exterior` },
    { src: base.interior, caption: `${aircraftLabel} — cabin interior` },
    ...(layout ? [{ src: layout.image, caption: `Cabin experience — ${layout.label}` }] : []),
  ];

  const [active, setActive] = useState(0);
  const current = shots[Math.min(active, shots.length - 1)];

  return (
    <div className={className}>
      <div className="overflow-hidden rounded-xl border border-border">
        <img
          src={current.src}
          alt={current.caption}
          loading="lazy"
          className="h-56 w-full object-cover sm:h-72"
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{current.caption}</p>
      <div className="mt-3 flex gap-2">
        {shots.map((s, i) => (
          <button
            key={s.caption}
            type="button"
            onClick={() => setActive(i)}
            aria-label={s.caption}
            aria-current={i === active}
            className={`h-14 w-20 overflow-hidden rounded-lg border transition ${
              i === active ? "border-primary ring-2 ring-primary/30" : "border-border opacity-75 hover:opacity-100"
            }`}
          >
            <img src={s.src} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
