/**
 * DriverDashboardPreview — shows the future before asking for forms.
 * Mirrors the live driver dashboard widgets using the existing marketplace
 * earnings models (`driver_earnings_models`); no earnings logic is duplicated.
 */
import { useEffect, useState } from "react";
import {
  Wallet, TrendingUp, Car, Building2, Plane, Star, Gift, Trophy, GraduationCap, Headphones,
} from "lucide-react";
import { Counter } from "@/components/marketing/Counter";
import { supabase } from "@/integrations/supabase/client";

const kes = (n: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(Math.max(0, Math.round(n)));

export function DriverDashboardPreview() {
  const [hourly, setHourly] = useState(52000); // cents, fallback until models load
  const [incentive, setIncentive] = useState(350000);

  useEffect(() => {
    let alive = true;
    supabase
      .from("driver_earnings_models")
      .select("hourly_average_cents,surge_multiplier,incentive_per_week_cents")
      .eq("is_active", true)
      .then(({ data }) => {
        if (!alive || !data?.length) return;
        const avg = data.reduce((a, m) => a + m.hourly_average_cents * Number(m.surge_multiplier), 0) / data.length;
        const inc = data.reduce((a, m) => a + (m.incentive_per_week_cents ?? 0), 0) / data.length;
        setHourly(avg);
        setIncentive(inc);
      });
    return () => { alive = false; };
  }, []);

  const daily = hourly * 8 / 100;
  const weekly = daily * 6;

  const money = [
    { icon: Wallet, label: "Driver wallet", value: kes(weekly * 0.35), hint: "Settled daily to M-Pesa" },
    { icon: TrendingUp, label: "Today's earnings", value: kes(daily), hint: "Live per-trip tracking" },
    { icon: TrendingUp, label: "This week", value: kes(weekly), hint: "Fares, tips and bonuses" },
    { icon: Gift, label: "Incentives", value: kes(incentive / 100), hint: "Streaks and peak quests" },
  ];

  const operations = [
    { icon: Car, label: "Trips completed", value: <Counter to={128} />, hint: "Rolling 30 days" },
    { icon: Building2, label: "Corporate jobs", value: <Counter to={26} />, hint: "Contracted accounts" },
    { icon: Plane, label: "Airport transfers", value: <Counter to={14} />, hint: "Scheduled pickups" },
    { icon: Star, label: "Driver rating", value: "4.92 ★", hint: "Passenger feedback" },
    { icon: Trophy, label: "City leaderboard", value: "Top 6%", hint: "Nairobi region" },
    { icon: GraduationCap, label: "Training progress", value: "3 of 5", hint: "Academy certifications" },
    { icon: Headphones, label: "Support", value: "24/7", hint: "Live chat and phone" },
  ];

  return (
    <section className="bg-secondary/30 py-16 md:py-20" aria-labelledby="dashboard-preview-title">
      <div className="container mx-auto px-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Driver success dashboard</p>
        <h2 id="dashboard-preview-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
          This is the cockpit waiting for you
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Every approved driver gets the same command centre: wallet, earnings, corporate assignments,
          ratings, incentives, training and support in one place.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {money.map((m) => (
            <div key={m.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary hover:shadow-lg">
              <m.icon className="h-5 w-5 text-primary" aria-hidden="true" />
              <div className="mt-3 text-2xl font-bold tracking-tight">{m.value}</div>
              <div className="mt-1 text-sm font-medium">{m.label}</div>
              <div className="text-xs text-muted-foreground">{m.hint}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {operations.map((o) => (
            <div key={o.label} className="rounded-2xl border border-border bg-card/70 p-5 backdrop-blur-sm transition-all hover:border-primary">
              <div className="flex items-center justify-between">
                <o.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="text-lg font-semibold">{o.value}</span>
              </div>
              <div className="mt-3 text-sm font-medium">{o.label}</div>
              <div className="text-xs text-muted-foreground">{o.hint}</div>
            </div>
          ))}
        </div>

        <p className="mt-5 text-xs text-muted-foreground">
          Illustrative preview based on current marketplace activity. Your live figures replace these on activation.
        </p>
      </div>
    </section>
  );
}

export default DriverDashboardPreview;
