import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ControlTowerKpi } from "@/lib/delivery/controlTower";

const TONE_RING: Record<ControlTowerKpi["tone"], string> = {
  good: "before:bg-status-success",
  warn: "before:bg-status-warning",
  bad: "before:bg-destructive",
  neutral: "before:bg-primary",
};

const TONE_TEXT: Record<ControlTowerKpi["tone"], string> = {
  good: "text-status-success",
  warn: "text-status-warning",
  bad: "text-destructive",
  neutral: "text-primary",
};

function formatValue(kpi: ControlTowerKpi, n: number) {
  switch (kpi.unit) {
    case "pct":
      return `${(Math.round(n * 10) / 10).toLocaleString("en-KE", { minimumFractionDigits: 1 })}%`;
    case "minutes":
      return n >= 60 ? `${Math.floor(n / 60)}h ${Math.round(n % 60)}m` : `${Math.round(n)} min`;
    case "kes":
      return n >= 1_000_000
        ? `KSh ${(Math.round(n / 100_000) / 10).toFixed(1)}M`
        : `KSh ${Math.round(n).toLocaleString("en-KE")}`;
    default:
      return Math.round(n).toLocaleString("en-KE");
  }
}

/** Counts up to the target once the card enters the viewport. */
function useCountUp(target: number, active: boolean) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);
  return value;
}

function KpiCard({ kpi }: { kpi: ControlTowerKpi }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const animated = useCountUp(kpi.value, visible);
  const DeltaIcon = kpi.delta > 0.05 ? ArrowUpRight : kpi.delta < -0.05 ? ArrowDownRight : Minus;

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div ref={ref}>
            <Card
              className={cn(
                "relative overflow-hidden p-4 h-full backdrop-blur-sm bg-card/70 border-border/70",
                "transition-all duration-300 hover:shadow-[var(--shadow-md)] hover:border-primary/40",
                "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:content-['']",
                TONE_RING[kpi.tone],
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">{kpi.label}</div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide",
                    kpi.source === "live"
                      ? "border-status-success/50 text-status-success"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {kpi.source === "live" ? "Live" : "Modelled"}
                </span>
              </div>
              <div className="mt-1.5 flex items-end justify-between gap-2">
                <div className="text-xl font-bold tabular-nums leading-none">{formatValue(kpi, animated)}</div>
                <span className={cn("flex items-center text-[11px] font-semibold", TONE_TEXT[kpi.tone])}>
                  <DeltaIcon className="h-3 w-3" />
                  {Math.abs(kpi.delta).toFixed(1)}%
                </span>
              </div>

            </Card>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px] text-xs">
          {kpi.hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function KpiStrip({ kpis, className }: { kpis: ControlTowerKpi[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3", className)}>
      {kpis.map((k) => (
        <KpiCard key={k.key} kpi={k} />
      ))}
    </div>
  );
}
