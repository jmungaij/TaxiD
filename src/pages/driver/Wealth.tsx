import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase as supabaseClient } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { PiggyBank, Banknote, Car, HeartHandshake, ArrowRight, ShieldCheck } from "lucide-react";
import MarketingHeader from "@/components/marketing/MarketingHeader";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { RouteSEO } from "@/components/marketing/RouteSEO";
import { simulate, type PricingModel, type CityRule } from "@/lib/earningsMath";
import { trackDriverEvent } from "@/lib/driverAnalytics";

const supabase: any = supabaseClient;

const CITIES = ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret"];
const fmt = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

// NSSF Act 2013: Tier I on first KES 7,000; Tier II on 7,001-36,000. Employee 6% each tier.
const NSSF_TIER1_CAP = 7000;
const NSSF_TIER2_CAP = 36000;
function nssfEmployee(monthlyPensionable: number) {
  const t1 = Math.min(monthlyPensionable, NSSF_TIER1_CAP) * 0.06;
  const t2 = Math.max(0, Math.min(monthlyPensionable, NSSF_TIER2_CAP) - NSSF_TIER1_CAP) * 0.06;
  return { t1, t2, total: t1 + t2 };
}
// Standard amortising loan installment
function pmt(principal: number, annualRatePct: number, months: number) {
  if (months <= 0) return principal;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}
// Compound monthly contributions with annual rate
function projectSavings(monthlyContribution: number, annualRatePct: number, years: number) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return monthlyContribution * n;
  return monthlyContribution * ((Math.pow(1 + r, n) - 1) / r);
}

export default function DriverWealth() {
  const [city, setCity] = useState("Nairobi");
  const [model, setModel] = useState<PricingModel | null>(null);
  const [rule, setRule] = useState<CityRule | null>(null);
  const [surge, setSurge] = useState(1.0);
  const [loading, setLoading] = useState(true);

  // user state
  const [userId, setUserId] = useState<string | null>(null);
  const [savings, setSavings] = useState<{ balance_cents: number; goal_cents: number | null; goal_label: string | null } | null>(null);
  const [activeLoan, setActiveLoan] = useState<{ outstanding_cents: number; interest_rate_bps: number; term_months: number } | null>(null);

  // inputs
  const [savingsRate, setSavingsRate] = useState(15); // %
  const [savingsApr, setSavingsApr] = useState(8);    // SACCO-style
  const [vehiclePrincipal, setVehiclePrincipal] = useState(1_500_000);
  const [vehicleTermM, setVehicleTermM] = useState(48);
  const [vehicleApr, setVehicleApr] = useState(15);   // KCB / Stanbic vehicle finance
  const [pensionTopUp, setPensionTopUp] = useState(0);

  // Pull live pricing for SAFARID Standard in the chosen city (baseline)
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const slug = "yalla-standard";
      const [{ data: pm }, { data: cr }, { data: surgeValue }] = await Promise.all([
        // Published fare + commission feed; the pricing tables themselves are staff-only.
        supabase.rpc("pricing_models_public"),
        supabase.rpc("city_pricing_public"),
        // Server-resolved effective multiplier — the full surge rule set is staff-only.
        supabase.rpc("active_surge_multiplier", { p_city: city, p_category_slug: slug }),
      ]);
      if (!alive) return;
      const models = (pm ?? []) as PricingModel[];
      const rules = (cr ?? []) as CityRule[];
      setModel(models.find((m: any) => m.category_slug === slug) ?? null);
      setRule(rules.find((r: any) => r.category_slug === slug && r.city === city) ?? null);

      setSurge(Number(surgeValue) > 0 ? Number(surgeValue) : 1.0);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [city]);

  // Pull driver context if signed in
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data: d } = await supabase.from("drivers").select("id").eq("user_id", user.id).maybeSingle();
      if (!d?.id) return;
      const [{ data: s }, { data: l }] = await Promise.all([
        supabase.from("driver_savings").select("balance_cents,goal_cents,goal_label").eq("driver_id", d.id).maybeSingle(),
        supabase.from("driver_loans").select("outstanding_cents,interest_rate_bps,term_months").eq("driver_id", d.id).eq("status", "active").order("disbursed_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setSavings(s as any);
      setActiveLoan(l as any);
    })();
  }, []);

  useEffect(() => {
    trackDriverEvent("wealth_dashboard_view", { funnel_stage: "wealth", metadata: { city } });
  }, [city]);

  // Compute baseline net monthly using simulator with reasonable defaults
  const sim = useMemo(() => {
    if (!model || !rule) return null;
    return simulate(
      { city, categorySlug: "yalla-standard", hoursPerDay: 9, daysPerWeek: 6, ownsVehicle: true },
      model, rule, surge,
    );
  }, [model, rule, surge, city]);

  const netMonthly = sim?.perMonth.netProfit ?? 0;
  const monthlyContribution = (netMonthly * savingsRate) / 100;
  const horizons = [1, 3, 5, 10];

  // Loan eligibility — 3x net monthly capped at 36-month repayment with 30% DTI
  const maxLoan = useMemo(() => {
    const maxInstallment = netMonthly * 0.3;
    // Solve principal from PMT formula at chosen vehicleApr / vehicleTermM
    const r = vehicleApr / 100 / 12;
    const n = vehicleTermM;
    if (r === 0) return maxInstallment * n;
    return maxInstallment * (1 - Math.pow(1 + r, -n)) / r;
  }, [netMonthly, vehicleApr, vehicleTermM]);

  const vehicleInstallment = pmt(vehiclePrincipal, vehicleApr, vehicleTermM);
  const pensionBase = Math.min(netMonthly, NSSF_TIER2_CAP);
  const nssf = nssfEmployee(pensionBase);
  const pensionMonthly = nssf.total + pensionTopUp;
  const pension30yr = projectSavings(pensionMonthly, 9, 30); // ~9% blended pension fund return

  return (
    <>
      <RouteSEO />

      <MarketingHeader />
      <main className="min-h-[70vh] bg-gradient-to-b from-primary/5 to-background">
        <section className="container mx-auto px-4 py-12">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
            <div>
              <Badge variant="outline" className="mb-2">Driver Wealth</Badge>
              <h1 className="text-3xl md:text-4xl font-bold">Turn driving into long-term wealth</h1>
              <p className="text-muted-foreground mt-2 max-w-2xl">
                Your live earnings projected into savings, loan capacity, vehicle ownership and retirement — using {city} pricing.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground">City</Label>
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!userId && (
            <Card className="mb-6 border-primary/30 bg-primary/5">
              <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  <div className="text-sm">
                    <div className="font-medium">Sign in to use your real balances</div>
                    <div className="text-muted-foreground">You're currently seeing baseline projections for a typical {city} driver.</div>
                  </div>
                </div>
                <Button asChild size="sm"><Link to="/auth">Sign in <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
              </CardContent>
            </Card>
          )}

          {loading || !sim ? (
            <Skeleton className="h-32 w-full rounded-xl mb-6" />
          ) : (
            <Card className="mb-8 bg-primary text-primary-foreground">
              <CardContent className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                <Stat label="Net monthly" value={fmt(netMonthly)} />
                <Stat label="Net annual" value={fmt(sim.perYear.netProfit)} />
                <Stat label="Effective surge" value={`${sim.effectiveSurge.toFixed(2)}×`} />
                <Stat label="Trips / hour" value={sim.perHour.trips.toFixed(1)} />
              </CardContent>
            </Card>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            {/* SAVINGS PROJECTOR */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <PiggyBank className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-base">Savings projector</CardTitle>
                    <CardDescription>Pay yourself first. Compound monthly.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {savings && (
                  <div className="rounded-lg border p-3 bg-secondary/40 text-sm flex justify-between">
                    <span className="text-muted-foreground">Current balance</span>
                    <span className="font-semibold tabular-nums">{fmt(savings.balance_cents / 100)}</span>
                  </div>
                )}
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <Label>Savings rate</Label>
                    <span className="tabular-nums font-medium">{savingsRate}% · {fmt(monthlyContribution)}/mo</span>
                  </div>
                  <Slider value={[savingsRate]} min={5} max={40} step={1} onValueChange={(v) => setSavingsRate(v[0])} />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <Label>SACCO / money-market APR</Label>
                    <span className="tabular-nums font-medium">{savingsApr}%</span>
                  </div>
                  <Slider value={[savingsApr]} min={3} max={14} step={0.5} onValueChange={(v) => setSavingsApr(v[0])} />
                </div>
                <Separator />
                <div className="grid grid-cols-4 gap-2">
                  {horizons.map((y) => (
                    <div key={y} className="rounded-lg border p-3 text-center">
                      <div className="text-[11px] text-muted-foreground">{y}y</div>
                      <div className="text-sm font-bold tabular-nums">{fmt(projectSavings(monthlyContribution, savingsApr, y))}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* LOAN ELIGIBILITY */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Banknote className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-base">Loan eligibility</CardTitle>
                    <CardDescription>30% debt-to-income cap, KCB/Stanbic-style rates.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {activeLoan && (
                  <div className="rounded-lg border p-3 bg-status-warning/10 dark:bg-status-warning/30 border-status-warning/30 dark:border-status-warning/30">
                    <div className="flex justify-between"><span>Outstanding loan</span><span className="font-semibold tabular-nums">{fmt(activeLoan.outstanding_cents / 100)}</span></div>
                    <div className="flex justify-between text-xs text-muted-foreground"><span>Rate</span><span>{(activeLoan.interest_rate_bps / 100).toFixed(2)}% · {activeLoan.term_months}mo</span></div>
                  </div>
                )}
                <div className="flex justify-between items-baseline">
                  <span className="text-muted-foreground">Max monthly repayment</span>
                  <span className="font-semibold tabular-nums">{fmt(netMonthly * 0.3)}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-muted-foreground">Max loan principal</span>
                  <span className="font-bold text-lg tabular-nums text-primary">{fmt(maxLoan)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Based on {vehicleTermM}-month tenure at {vehicleApr}% APR. Adjust below to see different scenarios.
                </div>
              </CardContent>
            </Card>

            {/* VEHICLE FINANCING */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Car className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-base">Vehicle financing</CardTitle>
                    <CardDescription>Plan your next vehicle. Net of repayments.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Vehicle price (KES)</Label>
                    <Input type="number" value={vehiclePrincipal} onChange={(e) => setVehiclePrincipal(Number(e.target.value) || 0)} />
                  </div>
                  <div>
                    <Label className="text-xs">Term (months)</Label>
                    <Input type="number" value={vehicleTermM} onChange={(e) => setVehicleTermM(Number(e.target.value) || 0)} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <Label>Interest rate APR</Label>
                    <span className="tabular-nums font-medium">{vehicleApr}%</span>
                  </div>
                  <Slider value={[vehicleApr]} min={8} max={22} step={0.5} onValueChange={(v) => setVehicleApr(v[0])} />
                </div>
                <Separator />
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <Box label="Monthly" value={fmt(vehicleInstallment)} />
                  <Box label="Net after repayment" value={fmt(netMonthly - vehicleInstallment)} highlight={netMonthly - vehicleInstallment > 0} />
                  <Box label="Total repaid" value={fmt(vehicleInstallment * vehicleTermM)} />
                </div>
                {vehicleInstallment > netMonthly * 0.3 && (
                  <div className="text-xs text-destructive">Repayment exceeds 30% of net income — most lenders will decline.</div>
                )}
              </CardContent>
            </Card>

            {/* PENSION */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <HeartHandshake className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-base">NSSF + retirement</CardTitle>
                    <CardDescription>Tier I + II per NSSF Act 2013, plus voluntary top-up.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Tier I (first KES {NSSF_TIER1_CAP.toLocaleString()})</span><span className="tabular-nums">{fmt(nssf.t1)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tier II (up to KES {NSSF_TIER2_CAP.toLocaleString()})</span><span className="tabular-nums">{fmt(nssf.t2)}</span></div>
                <div className="flex justify-between font-medium"><span>NSSF total / month</span><span className="tabular-nums">{fmt(nssf.total)}</span></div>
                <Separator />
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <Label>Voluntary top-up</Label>
                    <span className="tabular-nums font-medium">{fmt(pensionTopUp)}/mo</span>
                  </div>
                  <Slider value={[pensionTopUp]} min={0} max={10000} step={250} onValueChange={(v) => setPensionTopUp(v[0])} />
                </div>
                <div className="rounded-lg border p-3 bg-primary/5 mt-2">
                  <div className="text-xs text-muted-foreground">Projected balance at retirement (30 years, ~9% blended return)</div>
                  <div className="text-2xl font-bold tabular-nums text-primary">{fmt(pension30yr)}</div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-8 text-xs text-muted-foreground max-w-3xl">
            Projections use live {city} pricing for SAFARID Standard at 9 hrs/day × 6 days/week, with KRA 3% Turnover Tax and your city's
            fuel/maintenance/insurance cost assumptions. Adjust your actual hours in the
            <Link to="/driver/earnings" className="text-primary underline ml-1">earnings simulator</Link>.
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
function Box({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 text-center ${highlight ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
