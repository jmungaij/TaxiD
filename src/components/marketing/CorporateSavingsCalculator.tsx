/**
 * CorporateSavingsCalculator — Employee Mobility ROI widget.
 *
 * Commercial intelligence for the buyer: it compares the company's current
 * transport arrangement (owned fleet, reimbursements or ad-hoc taxis) with a
 * managed TaxiD programme priced through the governed rate engine
 * (`estimateDailyRate`), then reports savings, admin time recovered, carbon
 * reduction, cost per employee trip and the payback period.
 *
 * The scenario is handed to the enterprise reporting surfaces by way of the
 * existing funnel telemetry, and the CTA deep-links into the real planner.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Download, Leaf, PiggyBank, Timer, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { estimateDailyRate } from "@/lib/charter/estimatedDailyRate";
import { charterPlannerPath, portalEntryHref } from "@/lib/charter/portalRoutes";
import { trackEmCta, trackEmStep } from "@/lib/marketing/employeeMobilityFunnel";

export interface SavingsInputs {
  employees: number;
  tripsPerEmployeePerMonth: number;
  currentCostPerTripKes: number;
  adminHoursPerMonth: number;
  adminHourlyCostKes: number;
  /** One-off onboarding / migration cost used for the payback period. */
  switchingCostKes: number;
}

export interface SavingsResult {
  monthlyTrips: number;
  currentMonthlyKes: number;
  currentAnnualKes: number;
  yallaCostPerTripKes: number;
  yallaMonthlyKes: number;
  yallaAnnualKes: number;
  monthlySavingKes: number;
  annualSavingKes: number;
  savingPct: number;
  adminHoursSavedPerYear: number;
  adminValueSavedKes: number;
  co2SavedKg: number;
  costPerEmployeeKes: number;
  paybackMonths: number | null;
  seatsPerVehicle: number;
  vehiclesPerDay: number;
}

/** Share of manual coordination the platform removes (booking, reconciliation). */
const ADMIN_TIME_RECOVERED = 0.7;
/** Avoided kg CO₂e per pooled trip versus single-occupancy travel. */
const CO2_SAVED_PER_POOLED_TRIP_KG = 1.8;
const WORKING_DAYS_PER_MONTH = 22;

export function computeSavings(input: SavingsInputs): SavingsResult {
  const employees = Math.max(1, input.employees);
  const trips = Math.max(1, input.tripsPerEmployeePerMonth);
  const monthlyTrips = employees * trips;
  const currentMonthly = monthlyTrips * Math.max(0, input.currentCostPerTripKes);

  // Pooled shuttle capacity: how many vehicles are needed per working day.
  const seatsPerVehicle = employees >= 40 ? 49 : employees >= 20 ? 25 : employees >= 10 ? 14 : 8;
  const dailyRiders = Math.ceil((monthlyTrips / WORKING_DAYS_PER_MONTH) / 2) || 1; // 2 legs/day
  const vehiclesPerDay = Math.max(1, Math.ceil(dailyRiders / seatsPerVehicle));

  const estimate = estimateDailyRate({
    assetClass: seatsPerVehicle >= 49 ? "coach" : seatsPerVehicle >= 25 ? "bus" : seatsPerVehicle >= 14 ? "shuttle" : "van",
    assetLabel: `${seatsPerVehicle}-seat pooled shuttle`,
    seats: seatsPerVehicle,
    passengers: Math.min(seatsPerVehicle, dailyRiders),
    days: 1,
    corporate: true,
  });

  const yallaMonthly = estimate.expectedKes * vehiclesPerDay * WORKING_DAYS_PER_MONTH;
  const yallaCostPerTrip = Math.round(yallaMonthly / monthlyTrips);
  const monthlySaving = currentMonthly - yallaMonthly;

  const adminHoursSavedPerMonth = Math.max(0, input.adminHoursPerMonth) * ADMIN_TIME_RECOVERED;
  const adminValueSaved = adminHoursSavedPerMonth * 12 * Math.max(0, input.adminHourlyCostKes);
  const totalAnnualBenefit = monthlySaving * 12 + adminValueSaved;

  return {
    monthlyTrips,
    currentMonthlyKes: Math.round(currentMonthly),
    currentAnnualKes: Math.round(currentMonthly * 12),
    yallaCostPerTripKes: yallaCostPerTrip,
    yallaMonthlyKes: Math.round(yallaMonthly),
    yallaAnnualKes: Math.round(yallaMonthly * 12),
    monthlySavingKes: Math.round(monthlySaving),
    annualSavingKes: Math.round(monthlySaving * 12),
    savingPct: currentMonthly ? (monthlySaving / currentMonthly) * 100 : 0,
    adminHoursSavedPerYear: Math.round(adminHoursSavedPerMonth * 12),
    adminValueSavedKes: Math.round(adminValueSaved),
    co2SavedKg: Math.round(monthlyTrips * 12 * CO2_SAVED_PER_POOLED_TRIP_KG),
    costPerEmployeeKes: Math.round(yallaMonthly / employees),
    paybackMonths:
      totalAnnualBenefit > 0 && input.switchingCostKes > 0
        ? Math.max(0.1, Number((input.switchingCostKes / (totalAnnualBenefit / 12)).toFixed(1)))
        : null,
    seatsPerVehicle,
    vehiclesPerDay,
  };
}

const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

const DEFAULTS: SavingsInputs = {
  employees: 120,
  tripsPerEmployeePerMonth: 40,
  currentCostPerTripKes: 650,
  adminHoursPerMonth: 30,
  adminHourlyCostKes: 1200,
  switchingCostKes: 150000,
};

export function CorporateSavingsCalculator({ authenticated }: { authenticated: boolean }) {
  const [inputs, setInputs] = React.useState<SavingsInputs>(DEFAULTS);
  const result = React.useMemo(() => computeSavings(inputs), [inputs]);

  const set = <K extends keyof SavingsInputs>(key: K, value: number) =>
    setInputs((prev) => ({ ...prev, [key]: value }));

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      trackEmStep("savings_calculated", {
        employees: inputs.employees,
        current_annual_kes: result.currentAnnualKes,
        annual_saving_kes: result.annualSavingKes,
        saving_pct: Math.round(result.savingPct),
        payback_months: result.paybackMonths,
      });
    }, 900);
    return () => window.clearTimeout(id);
  }, [inputs, result]);

  const proposalHref = portalEntryHref(
    charterPlannerPath(
      "bus-charter",
      `?pax=${Math.min(result.seatsPerVehicle, inputs.employees)}&frequency=daily&intent=quote`,
    ),
    authenticated,
    "employee-mobility-savings",
  );

  function exportScenario() {
    const lines = [
      ["Metric", "Value"],
      ["Employees", inputs.employees],
      ["Trips per employee / month", inputs.tripsPerEmployeePerMonth],
      ["Current cost per trip (KES)", inputs.currentCostPerTripKes],
      ["Current annual spend (KES)", result.currentAnnualKes],
      ["TaxiD annual programme (KES)", result.yallaAnnualKes],
      ["Annual saving (KES)", result.annualSavingKes],
      ["Saving (%)", result.savingPct.toFixed(1)],
      ["Cost per employee / month (KES)", result.costPerEmployeeKes],
      ["Cost per trip (KES)", result.yallaCostPerTripKes],
      ["Admin hours recovered / year", result.adminHoursSavedPerYear],
      ["Admin value recovered (KES)", result.adminValueSavedKes],
      ["CO2e avoided / year (kg)", result.co2SavedKg],
      ["Vehicles per day", `${result.vehiclesPerDay} × ${result.seatsPerVehicle} seats`],
      ["Payback (months)", result.paybackMonths ?? "n/a"],
    ]
      .map((r) => r.join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "yalla-employee-mobility-roi.csv";
    a.click();
    URL.revokeObjectURL(url);
    trackEmCta("employee_mobility.savings.export", {
      actionType: "submit", target: "roi-scenario.csv", step: "savings_calculated",
      metadata: { annual_saving_kes: result.annualSavingKes },
    });
  }

  const positive = result.annualSavingKes >= 0;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Card className="p-6">
        <h3 className="text-lg font-semibold">Your current arrangement</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Four inputs are enough for a defensible business case.
        </p>

        <div className="mt-6 space-y-6">
          <div>
            <Label htmlFor="roi-employees">Employees who travel: <strong>{inputs.employees}</strong></Label>
            <Slider
              id="roi-employees"
              className="mt-3"
              value={[inputs.employees]}
              min={10} max={2000} step={10}
              onValueChange={([v]) => set("employees", v)}
              aria-label="Employees who travel"
            />
          </div>
          <div>
            <Label htmlFor="roi-trips">Trips per employee each month: <strong>{inputs.tripsPerEmployeePerMonth}</strong></Label>
            <Slider
              id="roi-trips"
              className="mt-3"
              value={[inputs.tripsPerEmployeePerMonth]}
              min={2} max={60} step={2}
              onValueChange={([v]) => set("tripsPerEmployeePerMonth", v)}
              aria-label="Trips per employee each month"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="roi-cost">Current cost per trip (KES)</Label>
              <Input
                id="roi-cost" type="number" min={0} inputMode="numeric" className="mt-1.5"
                value={inputs.currentCostPerTripKes}
                onChange={(e) => set("currentCostPerTripKes", Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label htmlFor="roi-admin">Admin hours per month</Label>
              <Input
                id="roi-admin" type="number" min={0} inputMode="numeric" className="mt-1.5"
                value={inputs.adminHoursPerMonth}
                onChange={(e) => set("adminHoursPerMonth", Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label htmlFor="roi-rate">Admin cost per hour (KES)</Label>
              <Input
                id="roi-rate" type="number" min={0} inputMode="numeric" className="mt-1.5"
                value={inputs.adminHourlyCostKes}
                onChange={(e) => set("adminHourlyCostKes", Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label htmlFor="roi-switch">One-off onboarding cost (KES)</Label>
              <Input
                id="roi-switch" type="number" min={0} inputMode="numeric" className="mt-1.5"
                value={inputs.switchingCostKes}
                onChange={(e) => set("switchingCostKes", Number(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Projected outcome</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Priced on the governed corporate rate band — {result.vehiclesPerDay} × {result.seatsPerVehicle}-seat pooled vehicles per day.
            </p>
          </div>
          <Badge variant={positive ? "secondary" : "destructive"} className="shrink-0">
            {positive ? `${result.savingPct.toFixed(0)}% saving` : "Review inputs"}
          </Badge>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          {[
            { icon: TrendingDown, k: "Current annual spend", v: kes(result.currentAnnualKes) },
            { icon: PiggyBank, k: "With TaxiD", v: kes(result.yallaAnnualKes) },
            { icon: PiggyBank, k: "Annual saving", v: kes(result.annualSavingKes) },
            { icon: Timer, k: "Admin hours recovered / year", v: `${result.adminHoursSavedPerYear} h` },
            { icon: Leaf, k: "CO₂e avoided / year", v: `${result.co2SavedKg.toLocaleString("en-KE")} kg` },
            { icon: PiggyBank, k: "Cost per employee / month", v: kes(result.costPerEmployeeKes) },
            { icon: PiggyBank, k: "Cost per trip", v: kes(result.yallaCostPerTripKes) },
            { icon: Timer, k: "Payback period", v: result.paybackMonths ? `${result.paybackMonths} months` : "Immediate" },
          ].map((m) => (
            <div key={m.k} className="rounded-xl border border-border bg-background/60 p-4">
              <m.icon className="mb-2 h-4 w-4 text-primary" aria-hidden />
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{m.k}</dt>
              <dd className="mt-1 font-semibold">{m.v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link
              to={proposalHref}
              onClick={() => trackEmCta("employee_mobility.savings.request_proposal", {
                target: proposalHref, step: "quote_requested",
                metadata: { annual_saving_kes: result.annualSavingKes, employees: inputs.employees },
              })}
            >
              Turn this into a proposal <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button variant="outline" data-analytics="marketing.savings_calculator.export_analysis" onClick={exportScenario}>
            <Download className="mr-2 h-4 w-4" aria-hidden /> Export the analysis
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Indicative modelling. The binding figure is the itemised quotation issued from the planner.
        </p>
      </Card>
    </div>
  );
}

export default CorporateSavingsCalculator;
