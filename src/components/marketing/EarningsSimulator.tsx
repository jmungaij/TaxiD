import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Fuel, Wrench, ShieldCheck, Receipt, Landmark } from "lucide-react";
import { SurgeHeatmap } from "./SurgeHeatmap";
import { EarningsForecast } from "./EarningsForecast";
import {
  buildSurgeHeatmap, resolveActiveSurge, simulate,
  type CityRule, type PricingModel, type SurgeRule, type SimOutput,
} from "@/lib/earningsMath";

const CITIES = ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret"];

interface Category { slug: string; name: string; seats: number; vehicle_class: string; sort_order: number; }

function fmt(currency: string, n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    Math.max(0, Math.round(n)),
  );
}

function logEvent(name: string, metadata: Record<string, unknown>) {
  // Fire-and-forget. Anon insert is allowed by RLS on driver_analytics_events.
  void supabase.from("driver_analytics_events").insert({
    event_name: name,
    page_route: typeof window !== "undefined" ? window.location.pathname : null,
    funnel_stage: "earnings_simulator",
    metadata: metadata as never,
  });
}

export function EarningsSimulator() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [models, setModels] = useState<PricingModel[]>([]);
  const [rules, setRules] = useState<CityRule[]>([]);
  const [surge, setSurge] = useState<SurgeRule[]>([]);
  const [loading, setLoading] = useState(true);

  const [city, setCity] = useState("Nairobi");
  const [slug, setSlug] = useState("yalla-standard");
  const [hoursPerDay, setHoursPerDay] = useState(10);
  const [daysPerWeek, setDaysPerWeek] = useState(6);
  const [ownsVehicle, setOwnsVehicle] = useState(true);
  const [loanMonthly, setLoanMonthly] = useState(0);

  const lastRunRef = useRef<number>(0);

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("ride_categories").select("slug,name,seats,vehicle_class,sort_order").eq("is_active", true).order("sort_order"),
      // Fares, running costs and surge come from read-only public feeds — the
      // underlying pricing tables are staff-only.
      untypedDb.rpc("pricing_models_public"),
      untypedDb.rpc("city_pricing_public"),
      untypedDb.rpc("surge_rules_public"),

    ]).then(([c, m, r, s]) => {
      if (!alive) return;
      setCategories((c.data as Category[]) ?? []);
      setModels((m.data as PricingModel[]) ?? []);
      setRules((r.data as CityRule[]) ?? []);
      setSurge((s.data as SurgeRule[]) ?? []);
      setLoading(false);
      logEvent("simulator_loaded", { categoryCount: c.data?.length ?? 0 });
    });
    return () => { alive = false; };
  }, []);

  const result: SimOutput | null = useMemo(() => {
    if (loading) return null;
    const model = models.find((m) => m.category_slug === slug);
    const rule = rules.find((r) => r.category_slug === slug && r.city === city);
    if (!model || !rule) return null;
    const effectiveSurge = resolveActiveSurge(surge, city, slug);
    return simulate(
      { city, categorySlug: slug, hoursPerDay, daysPerWeek, ownsVehicle, loanMonthly },
      model, rule, effectiveSurge,
    );
  }, [loading, models, rules, surge, slug, city, hoursPerDay, daysPerWeek, ownsVehicle, loanMonthly]);

  const heatmap = useMemo(() => buildSurgeHeatmap(surge, city, slug), [surge, city, slug]);

  // Throttled analytics on input changes
  useEffect(() => {
    if (!result) return;
    const now = Date.now();
    if (now - lastRunRef.current < 600) return;
    lastRunRef.current = now;
    logEvent("earnings_simulator_run", {
      city, slug, hoursPerDay, daysPerWeek, ownsVehicle, loanMonthly,
      effectiveSurge: result.effectiveSurge,
      profit_per_day: Math.round(result.perDay.netProfit),
      profit_per_month: Math.round(result.perMonth.netProfit),
      profit_per_year: Math.round(result.perYear.netProfit),
    });
  }, [result, city, slug, hoursPerDay, daysPerWeek, ownsVehicle, loanMonthly]);

  if (loading || !categories) {
    return <Skeleton className="h-[600px] w-full rounded-xl" />;
  }

  const currency = result?.currency ?? "KES";

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      {/* INPUTS */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Your driving profile</CardTitle>
          <CardDescription>Live pricing from {city}. Change anything to see your profit update.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label className="text-xs text-muted-foreground">City</Label>
            <Select value={city} onValueChange={(v) => { setCity(v); logEvent("simulator_city_changed", { city: v }); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Vehicle category</Label>
            <Select value={slug} onValueChange={(v) => { setSlug(v); logEvent("simulator_category_changed", { slug: v }); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>{c.name} · {c.seats} seats</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground flex justify-between">
              <span>Hours per day</span><span className="font-medium">{hoursPerDay}h</span>
            </Label>
            <Slider min={2} max={16} step={1} value={[hoursPerDay]} onValueChange={(v) => setHoursPerDay(v[0])} />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground flex justify-between">
              <span>Days per week</span><span className="font-medium">{daysPerWeek}</span>
            </Label>
            <Slider min={1} max={7} step={1} value={[daysPerWeek]} onValueChange={(v) => setDaysPerWeek(v[0])} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">I own / am financing my vehicle</div>
              <div className="text-xs text-muted-foreground">Includes fuel, maintenance, insurance.</div>
            </div>
            <Switch checked={ownsVehicle} onCheckedChange={(v) => { setOwnsVehicle(v); logEvent("simulator_ownership_changed", { ownsVehicle: v }); }} />
          </div>

          {ownsVehicle && (
            <div>
              <Label className="text-xs text-muted-foreground flex justify-between">
                <span>Monthly loan / lease ({currency})</span>
                <span className="font-medium">{fmt(currency, loanMonthly)}</span>
              </Label>
              <Slider min={0} max={80000} step={1000} value={[loanMonthly]} onValueChange={(v) => setLoanMonthly(v[0])} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* RESULTS */}
      <div className="lg:col-span-3 space-y-6">
        {!result ? (
          <Card><CardContent className="p-8 text-sm text-muted-foreground">No pricing configured for {city} · {slug} yet.</CardContent></Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Your projected take-home</CardTitle>
                    <CardDescription>After commission, fuel, maintenance, insurance and KRA TOT (3%).</CardDescription>
                  </div>
                  <Badge variant="secondary" className="gap-1">
                    <TrendingUp className="h-3 w-3" /> {result.effectiveSurge.toFixed(2)}× surge
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    ["Per day",   result.perDay.netProfit,   result.perDay.gross],
                    ["Per week",  result.perWeek.netProfit,  result.perWeek.gross],
                    ["Per month", result.perMonth.netProfit, result.perMonth.gross],
                    ["Per year",  result.perYear.netProfit,  result.perYear.gross],
                  ].map(([label, profit, gross]) => (
                    <div key={String(label)} className="rounded-xl border p-4">
                      <div className="text-xs text-muted-foreground">{label as string}</div>
                      <div className="text-xl font-bold mt-1">{fmt(currency, profit as number)}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">Gross {fmt(currency, gross as number)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily deduction breakdown</CardTitle>
                <CardDescription>
                  {result.perHour.trips.toFixed(1)} trips/h · {fmt(currency, result.perTrip.gross)} gross/trip
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Gross fares" value={fmt(currency, result.perDay.gross)} positive />
                <Row icon={<Landmark className="h-4 w-4" />} label="Platform commission" value={`− ${fmt(currency, result.perDay.commission)}`} />
                {ownsVehicle && <Row icon={<Fuel className="h-4 w-4" />} label="Fuel" value={`− ${fmt(currency, result.perDay.fuel)}`} />}
                {ownsVehicle && <Row icon={<Wrench className="h-4 w-4" />} label="Maintenance" value={`− ${fmt(currency, result.perDay.maintenance)}`} />}
                {ownsVehicle && <Row icon={<ShieldCheck className="h-4 w-4" />} label="Insurance (pro-rated)" value={`− ${fmt(currency, result.perDay.insurance)}`} />}
                <Row icon={<Receipt className="h-4 w-4" />} label={`KRA TOT (${result.assumptions.totRatePct.toFixed(0)}%)`} value={`− ${fmt(currency, result.perDay.tax)}`} />
                {result.perDay.loan > 0 && <Row label="Loan / lease (pro-rated)" value={`− ${fmt(currency, result.perDay.loan)}`} />}
                <div className="border-t pt-2 mt-2">
                  <Row label="Net profit per day" value={fmt(currency, result.perDay.netProfit)} bold positive />
                  <Row label="Effective profit / hour" value={fmt(currency, result.perHour.profit)} muted />
                </div>
              </CardContent>
            </Card>

            <EarningsForecast city={city} categorySlug={slug} />

            <Card>
              <CardHeader>
                <CardTitle className="text-base">When to drive in {city}</CardTitle>
                <CardDescription>Surge multipliers by hour of week from live pricing rules.</CardDescription>
              </CardHeader>
              <CardContent>
                <SurgeHeatmap
                  grid={heatmap}
                  onPick={(d, h, m) => logEvent("simulator_heatmap_cell_clicked", { day: d, hour: h, multiplier: m, city, slug })}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, icon, bold, positive, muted }: {
  label: string; value: string; icon?: React.ReactNode;
  bold?: boolean; positive?: boolean; muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`flex items-center gap-2 ${muted ? "text-muted-foreground text-xs" : ""}`}>
        {icon}{label}
      </span>
      <span className={`tabular-nums ${bold ? "font-bold" : ""} ${positive ? "text-primary" : ""} ${muted ? "text-muted-foreground text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export default EarningsSimulator;
