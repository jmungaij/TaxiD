import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calculator } from "lucide-react";
import { trackDriverEvent } from "@/lib/driverAnalytics";

interface Model {
  city: string;
  vehicle_type: string;
  hourly_average_cents: number;
  surge_multiplier: number;
  incentive_per_week_cents: number;
  currency: string;
}

const fmtKES = (cents: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 })
    .format(Math.round(cents / 100));

export function EarningsCalculator({ compact = false }: { compact?: boolean }) {
  const [models, setModels] = useState<Model[]>([]);
  const [city, setCity] = useState("Nairobi");
  const [vehicle, setVehicle] = useState("Economy");
  const [hours, setHours] = useState(8);
  const [days, setDays] = useState(6);

  useEffect(() => {
    supabase
      .from("driver_earnings_models")
      .select("city,vehicle_type,hourly_average_cents,surge_multiplier,incentive_per_week_cents,currency")
      .eq("is_active", true)
      .then(({ data }) => { if (data) setModels(data as Model[]); });
  }, []);

  const cities = useMemo(() => Array.from(new Set(models.map(m => m.city))).sort(), [models]);
  const vehicles = useMemo(
    () => Array.from(new Set(models.filter(m => m.city === city).map(m => m.vehicle_type))),
    [models, city],
  );

  const model = models.find(m => m.city === city && m.vehicle_type === vehicle);

  const calc = useMemo(() => {
    if (!model) return null;
    const surged = model.hourly_average_cents * Number(model.surge_multiplier);
    const daily = surged * hours;
    const weekly = daily * days;
    const monthly = weekly * 4.33;
    const incentive = model.incentive_per_week_cents * 4.33;
    return { daily, weekly, monthly: monthly + incentive, incentive };
  }, [model, hours, days]);

  return (
    <div className={compact ? "" : "p-6 md:p-8 rounded-2xl bg-card border border-border shadow-lg"}>
      {!compact && (
        <div className="flex items-center gap-3 mb-6">
          <Calculator className="h-7 w-7 text-primary" />
          <h3 className="text-xl font-bold">Driver Earnings Calculator</h3>
        </div>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div>
          <Label htmlFor="ec-city">City</Label>
          <select
            id="ec-city"
            value={city}
            onChange={(e) => { setCity(e.target.value); setVehicle("Economy"); }}
            className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-background"
          >
            {(cities.length ? cities : ["Nairobi"]).map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="ec-vehicle">Vehicle</Label>
          <select
            id="ec-vehicle"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-background"
          >
            {(vehicles.length ? vehicles : ["Economy"]).map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="ec-hours">Hours / day: <span className="font-semibold text-primary">{hours}</span></Label>
          <input id="ec-hours" type="range" min={2} max={14} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="mt-3 w-full" />
        </div>
        <div>
          <Label htmlFor="ec-days">Days / week: <span className="font-semibold text-primary">{days}</span></Label>
          <input id="ec-days" type="range" min={1} max={7} value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-3 w-full" />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Daily"   value={calc ? fmtKES(calc.daily) : "—"} />
        <Stat label="Weekly"  value={calc ? fmtKES(calc.weekly) : "—"} />
        <Stat label="Monthly" value={calc ? fmtKES(calc.monthly) : "—"} highlight />
        <Stat label="Incentives /mo" value={calc ? fmtKES(calc.incentive) : "—"} />
      </div>

      {!compact && (
        <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-muted-foreground max-w-md">
            Estimates use current platform averages and may vary with demand, supply, fuel and tip earnings.
          </p>
          <Button
            onClick={() => {
              trackDriverEvent("earnings_calc_apply_click", { funnel_stage: "interest", metadata: { city, vehicle, hours, days } });
              window.location.href = "/driver/onboarding";
            }}
          >
            Start Earning Today
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-4 rounded-xl border ${highlight ? "bg-primary text-primary-foreground border-transparent" : "bg-background border-border"}`}>
      <div className={`text-xs uppercase tracking-wider ${highlight ? "opacity-90" : "text-muted-foreground"}`}>{label}</div>
      <div className="text-xl md:text-2xl font-bold mt-1 tabular-nums">{value}</div>
    </div>
  );
}
