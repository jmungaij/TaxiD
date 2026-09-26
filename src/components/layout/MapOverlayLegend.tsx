import React from "react";
import { cn } from "@/lib/utils";

/**
 * MapOverlayLegend — Phase 2 (presentation-only)
 * -------------------------------------------------------------
 * Legend chip overlay for map surfaces. Consumes design tokens
 * (--map-*) so colors follow theme. Reuses existing map state
 * upstream — this component renders only.
 */
export interface MapLegendItem {
  id: string;
  label: string;
  /** design-token color class, e.g. "bg-map-driver" */
  swatchClass: string;
  count?: number;
  active?: boolean;
  onToggle?: (id: string) => void;
}

export interface MapOverlayLegendProps {
  items: MapLegendItem[];
  title?: string;
  className?: string;
  align?: "start" | "end";
}

const defaultItems: MapLegendItem[] = [
  { id: "driver",   label: "Drivers online",  swatchClass: "bg-map-driver" },
  { id: "rider",    label: "Rider pickup",    swatchClass: "bg-map-rider" },
  { id: "route",    label: "Active route",    swatchClass: "bg-map-route" },
  { id: "idle",     label: "Idle",            swatchClass: "bg-map-idle" },
  { id: "incident", label: "Incident",        swatchClass: "bg-map-incident" },
];

export function MapOverlayLegend({
  items = defaultItems,
  title = "Legend",
  className,
  align = "end",
}: MapOverlayLegendProps) {
  return (
    <div
      className={cn(
        "pointer-events-auto rounded-xl border border-border bg-card/90 backdrop-blur-md p-3 shadow-enterprise",
        align === "end" ? "ml-auto" : "",
        className,
      )}
      role="group"
      aria-label={title}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((it) => {
          const interactive = typeof it.onToggle === "function";
          const Row: React.ElementType = interactive ? "button" : "div";
          return (
            <li key={it.id}>
              <Row
                {...(interactive
                  ? {
                      type: "button",
                      onClick: () => it.onToggle?.(it.id),
                      "aria-pressed": it.active ?? true,
                    }
                  : {})}
                className={cn(
                  "w-full flex items-center gap-2 text-xs text-foreground rounded-md px-1.5 py-1",
                  interactive && "hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  it.active === false && "opacity-45",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-card", it.swatchClass)}
                />
                <span className="flex-1 text-left">{it.label}</span>
                {typeof it.count === "number" && (
                  <span className="text-muted-foreground tabular-nums">{it.count}</span>
                )}
              </Row>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default MapOverlayLegend;
