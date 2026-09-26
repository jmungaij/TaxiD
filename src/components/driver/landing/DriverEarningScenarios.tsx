/**
 * DriverEarningScenarios — dynamic earning illustrations derived from the
 * existing active `driver_earnings_models` marketplace records. No hardcoded
 * money values and no new earnings engine.
 */
import { useEffect, useMemo, useState } from "react";
import { Plane, Building2, Crown, Package, Bus, Flame, CalendarRange } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

interface Model { hourly_average_cents: number; surge_multiplier: number; incentive_per_week_cents: number; currency: string }

const SCENARIOS = [
  { icon: Plane, t: "Airport Transfer", hours: 1.6, factor: 1.35, note: "Scheduled pickup, fixed route" },
  { icon: Building2, t: "Corporate Staff Shuttle", hours: 3, factor: 1.1, note: "Contracted account run" },
  { icon: Crown, t: "Executive Ride", hours: 2, factor: 1.5, note: "Chauffeur-grade assignment" },
  { icon: Package, t: "Delivery Assignment", hours: 2.5, factor: 0.85, note: "Parcel and courier batch" },
  { icon: Bus, t: "Charter Assignment", hours: 8, factor: 1.2, note: "Full-day group charter" },
  { icon: Flame, t: "Weekend Peak Shift", hours: 8, factor: 1.4, note: "Surge windows included" },
  { icon: CalendarRange, t: "Monthly Projection", hours: 8 * 24, factor: 1, note: "26 active days" },
];

export function DriverEarningScenarios() {
  const [models, setModels] = useState<Model[] | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from("driver_earnings_models")
      .select("hourly_average_cents,surge_multiplier,incentive_per_week_cents,currency")
      .eq("is_active", true)
      .then(({ data }) => { if (alive) setModels((data as Model[]) ?? []); });
    return () => { alive = false; };
  }, []);

  const { hourly, currency } = useMemo(() => {
    if (!models?.length) return { hourly: 0, currency: "KES" };
    const avg = models.reduce((a, m) => a + m.hourly_average_cents * Number(m.surge_multiplier), 0) / models.length;
    return { hourly: avg / 100, currency: models[0].currency || "KES" };
  }, [models]);

  const fmt = (n: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.round(n));

  return (
    <section className="bg-secondary/30 py-16 md:py-20" aria-labelledby="earning-scenarios-title">
      <div className="container mx-auto px-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Driver earnings</p>
        <h2 id="earning-scenarios-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
          What different assignments can pay
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Calculated live from current marketplace earnings models across active cities and vehicle classes.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {models === null
            ? Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
            : SCENARIOS.map((s) => (
                <div key={s.t} className="rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-lg">
                  <s.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  <div className="mt-3 text-xl font-bold tracking-tight">
                    {hourly > 0 ? fmt(hourly * s.hours * s.factor) : "Awaiting live rates"}
                  </div>
                  <div className="mt-1 text-sm font-medium">{s.t}</div>
                  <div className="text-xs text-muted-foreground">{s.note}</div>
                </div>
              ))}
        </div>

        <p className="mt-5 text-xs text-muted-foreground">
          Illustrative estimate based on current marketplace activity. Actual earnings vary by city, demand,
          vehicle class, hours worked and operating costs.
        </p>
      </div>
    </section>
  );
}

export default DriverEarningScenarios;
