import { Link } from "react-router-dom";
import { ArrowRight, TrendingUp, Calculator, Banknote, Receipt } from "lucide-react";
import { SeoHead } from "@/components/seo/SeoHead";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { EarningsSimulator } from "@/components/marketing/EarningsSimulator";
import { VehicleCategoryGrid } from "@/components/marketing/VehicleCategoryGrid";
import { AchievementTiers } from "@/components/marketing/AchievementTiers";
import { IncentivesPanel } from "@/components/marketing/IncentivesPanel";
import { DriverLeaderboard } from "@/components/marketing/DriverLeaderboard";
import { SuccessStoriesStrip } from "@/components/marketing/SuccessStoriesStrip";
import { IncentiveForecast } from "@/components/marketing/IncentiveForecast";
import { TierProgress } from "@/components/marketing/TierProgress";

export default function DriverEarnings() {
  return (
    <MarketingPage>
      <SeoHead
        title="Driver Earnings in Kenya | TaxiD"
        description="See live TaxiD driver earnings by vehicle category, cost of operation and net take-home pay in your city before you start driving."
        path="/driver/earnings"
      />
      <PageHero eyebrow="Driver Income Intelligence" title="Pick your vehicle. See your profit."
        subtitle="From TaxiD Basic to TaxiD Bus — see live earnings, cost-of-operation and net take-home tailored to your city.">
        <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90"
          analytics="driver.earnings.start_driving" action="navigate" target="/driver/onboarding">
          Start Driving Today <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </AppButton>
      </PageHero>

      <section className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Choose your category</h2>
            <p className="text-muted-foreground">Eight vehicle tiers, each with city-specific pricing and cost models.</p>
          </div>
          <VehicleCategoryGrid />
        </div>
      </section>

      <section className="container mx-auto px-4 pb-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold mb-2">Real-time profit simulator</h2>
          <p className="text-muted-foreground mb-6">
            Live pricing, full cost-of-operation, KRA tax and surge — your true take-home, not just gross fares.
          </p>
          <EarningsSimulator />

          <div className="mt-12 grid lg:grid-cols-2 gap-6">
            <IncentiveForecast city="Nairobi" projectedTrips={40} projectedHours={35} />
            <TierProgress />
          </div>
          <div className="mt-6 grid lg:grid-cols-2 gap-6">
            <IncentivesPanel city="Nairobi" />
            <DriverLeaderboard city="Nairobi" />
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 pb-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold mb-2">Climb the tiers, unlock perks</h2>
          <p className="text-muted-foreground mb-6">
            Five achievement levels — every trip moves you up. Higher tiers mean lower commission, weekly bonuses and priority dispatch.
          </p>
          <AchievementTiers />
        </div>
      </section>

      <section className="container mx-auto px-4 pb-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold mb-2">Drivers building real businesses</h2>
          <p className="text-muted-foreground mb-6">Stories from drivers already on the platform.</p>
          <SuccessStoriesStrip />
        </div>
      </section>

      <section className="bg-secondary/40 py-16">
        <div className="container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl md:text-3xl font-bold mb-8">How your earnings work</h2>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { icon: Banknote, t: "Fare per trip",   d: "Distance, time and demand-based pricing per city." },
              { icon: TrendingUp,t:"Surge & bonuses", d: "Peak windows boost fares; weekly incentives reward consistent drivers." },
              { icon: Receipt,  t: "Net of tax",      d: "We auto-calculate TOT/income tax through KRA eTIMS so you keep clean books." },
            ].map((c) => (
              <div key={c.t} className="p-6 rounded-xl bg-card border border-border">
                <c.icon className="h-7 w-7 text-primary mb-3" />
                <h3 className="font-semibold mb-1">{c.t}</h3>
                <p className="text-sm text-muted-foreground">{c.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 p-6 rounded-2xl bg-card border border-border flex items-start gap-4">
            <Calculator className="h-8 w-8 text-primary shrink-0" />
            <div>
              <h3 className="font-semibold mb-1">Need a custom projection?</h3>
              <p className="text-sm text-muted-foreground mb-3">Fleet owners and corporate partners can request a tailored revenue model.</p>
              <Button asChild variant="outline" size="sm"><Link to="/contact">Talk to the team</Link></Button>
            </div>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
