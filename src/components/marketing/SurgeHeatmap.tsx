import { useMemo } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function colorFor(mult: number): string {
  // 1.0 → muted, 1.25 → primary/40, 1.5 → primary/70, 1.7+ → primary
  if (mult <= 1.0) return "hsl(var(--muted))";
  if (mult < 1.2) return "hsl(var(--primary) / 0.25)";
  if (mult < 1.4) return "hsl(var(--primary) / 0.45)";
  if (mult < 1.6) return "hsl(var(--primary) / 0.7)";
  return "hsl(var(--primary))";
}

interface Props {
  grid: number[][]; // 7x24
  onPick?: (day: number, hour: number, multiplier: number) => void;
}

export function SurgeHeatmap({ grid, onPick }: Props) {
  const best = useMemo(() => {
    const entries: { day: number; hour: number; mult: number }[] = [];
    grid.forEach((row, d) => row.forEach((m, h) => entries.push({ day: d, hour: h, mult: m })));
    return entries.sort((a, b) => b.mult - a.mult).slice(0, 5);
  }, [grid]);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="grid" style={{ gridTemplateColumns: "48px repeat(24, minmax(18px,1fr))" }}>
            <div />
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="text-[10px] text-muted-foreground text-center">
                {h % 3 === 0 ? h : ""}
              </div>
            ))}
            {grid.map((row, d) => (
              <>
                <div key={`d-${d}`} className="text-xs text-muted-foreground pr-2 flex items-center">
                  {DAYS[d]}
                </div>
                {row.map((m, h) => (
                  <button
                    key={`${d}-${h}`}
                    type="button"
                    title={`${DAYS[d]} ${h.toString().padStart(2, "0")}:00 — ${m.toFixed(2)}×`}
                    onClick={() => onPick?.(d, h, m)}
                    className="aspect-square m-[1px] rounded-[3px] hover:ring-2 hover:ring-primary transition"
                    style={{ background: colorFor(m) }}
                    aria-label={`${DAYS[d]} ${h}:00 surge ${m.toFixed(2)}x`}
                  />
                ))}
              </>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Surge:</span>
        {[1.0, 1.2, 1.4, 1.6, 1.7].map((m) => (
          <span key={m} className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: colorFor(m) }} />
            {m.toFixed(1)}×
          </span>
        ))}
      </div>

      {best.length > 0 && best[0].mult > 1 && (
        <div className="rounded-lg border bg-card p-4">
          <h4 className="text-sm font-semibold mb-2">Top 5 windows to drive</h4>
          <ul className="text-sm space-y-1">
            {best.map((b, i) => (
              <li key={i} className="flex justify-between">
                <span>{DAYS[b.day]} {b.hour.toString().padStart(2, "0")}:00–{(b.hour + 1).toString().padStart(2, "0")}:00</span>
                <span className="font-medium text-primary">{b.mult.toFixed(2)}× fare</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
