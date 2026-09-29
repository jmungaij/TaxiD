import { SeoHead } from "@/components/seo/SeoHead";
import { Link } from "react-router-dom";
import { MapPin, Calendar, Plane, Shield, Heart, CreditCard, CheckCircle2, Wallet, Building2, FileCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarketingPage } from "@/components/marketing/PageHero";
import { CrossLinks } from "@/components/marketing/CrossLinks";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import RiderHero from "@/components/rider/landing/RiderHero";
import RiderMarketplace from "@/components/rider/landing/RiderMarketplace";
import RiderValue from "@/components/rider/landing/RiderValue";
import RiderTrustSafety from "@/components/rider/landing/RiderTrustSafety";
import RiderCorporatePreview from "@/components/rider/landing/RiderCorporatePreview";
import RiderAssistant from "@/components/rider/landing/RiderAssistant";
import RiderSupport from "@/components/rider/landing/RiderSupport";
import { AppDownloadCard } from "@/components/apps/AppDownloadCard";

const TABS = ["individual", "corporate"] as const;

type Feature = {
  icon: typeof MapPin;
  t: string;
  d: string;
  to: string;
  tab: (typeof TABS)[number];
  section: string;
};

const individualFeatures: Feature[] = [
  { icon: MapPin, t: "Ride booking", d: "Tap-to-ride with live ETA.", to: "/rider", tab: "individual", section: "how-it-works" },
  { icon: Calendar, t: "Scheduled rides", d: "Plan trips up to 30 days ahead.", to: "/rider/schedule", tab: "individual", section: "how-it-works" },
  { icon: Plane, t: "Airport transfers", d: "Flat fares, flight tracking, meet-and-greet.", to: "/rider/airport", tab: "individual", section: "how-it-works" },
  { icon: Shield, t: "Safety monitoring", d: "SOS button, share trip, 24/7 support.", to: "/rider/safety", tab: "individual", section: "how-it-works" },
  { icon: Heart, t: "Favorite destinations", d: "One-tap rebooking of common trips.", to: "/rider/favorites", tab: "individual", section: "how-it-works" },
  { icon: CreditCard, t: "Multiple payment methods", d: "M-Pesa, card, wallet, cash.", to: "/rider/wallet", tab: "individual", section: "get-the-app" },
];

const corporateFeatures: Feature[] = [
  { icon: Building2, t: "Business trip booking", d: "Trips charged to corporate wallet with policy checks.", to: "/dashboard/corporate", tab: "corporate", section: "business-trip-flow" },
  { icon: Wallet, t: "Personal trip booking", d: "Same app, personal wallet — no employer involvement.", to: "/rider", tab: "corporate", section: "business-trip-flow" },
  { icon: CreditCard, t: "Dual wallets", d: "Corporate and personal balances kept fully separate.", to: "/dashboard/corporate/wallet", tab: "corporate", section: "business-trip-flow" },
  { icon: FileCheck, t: "Travel policy enforcement", d: "Geofencing, time windows, vehicle tiers, budget caps.", to: "/dashboard/corporate/policies", tab: "corporate", section: "business-trip-flow" },
  { icon: CheckCircle2, t: "Manager approvals", d: "Pre-trip, mid-trip and post-trip approval flows.", to: "/dashboard/corporate/approvals", tab: "corporate", section: "business-trip-flow" },
  { icon: ArrowRight, t: "Expense automation", d: "Auto-categorised expenses pushed to your ERP.", to: "/dashboard/corporate/invoicing", tab: "corporate", section: "corporate-demo" },
];

const steps = ["Download app","Set destination","Choose ride","Confirm booking","Track ride","Complete payment"];

const FeatureCard = ({ f, onExplain }: { f: Feature; onExplain: (f: Feature) => void }) => (
  <div className="group relative p-6 rounded-xl bg-card border border-border hover:border-primary hover:shadow-elegant transition-all">
    <Link
      to={f.to}
      aria-label={`${f.t} — open workspace`}
      data-testid={`feature-link-${f.to}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
    >
      <f.icon className="h-8 w-8 text-primary mb-3" />
      <h3 className="font-semibold mb-1 flex items-center justify-between">
        {f.t}
        <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
      </h3>
      <p className="text-sm text-muted-foreground">{f.d}</p>
    </Link>
    <button
      type="button"
      onClick={() => onExplain(f)}
      data-testid={`feature-section-${f.section}`}
      className="mt-4 text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
    >
      See how it works on this page
    </button>
  </div>
);

const Riders = () => {
  const { tab, onTabChange, goTo } = useTabDeepLink(TABS, "individual");
  const explain = (f: Feature) => goTo(f.tab, f.section);


  return (
    <MarketingPage>
      <SeoHead
        title="Ride with TaxiD — safe, fast, transparent"
        description="Daily rides, airport transfers, scheduled trips, and corporate travel. Upfront pricing, live SOS, multiple payment methods."
        path="/riders"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          serviceType: "Ride-hailing",
          name: "TaxiD Ride-Hailing",
          provider: { "@type": "Organization", name: "TaxiD" },
          areaServed: "Africa",
          description:
            "On-demand ride-hailing with economy, SUV, executive and airport transfer tiers, paid by M-Pesa, card or corporate wallet.",
          url: "https://yalla-africa.lovable.app/riders",
        }}
      />

      <RiderHero />

      <RiderMarketplace />

      <RiderValue />

      <RiderTrustSafety />

      <section className="container mx-auto px-4 py-16">

        <Tabs value={tab} onValueChange={onTabChange} className="max-w-5xl mx-auto">
          <TabsList className="grid w-full grid-cols-2 max-w-md mx-auto mb-10">
            <TabsTrigger value="individual" data-testid="tab-individual">Individual Riders</TabsTrigger>
            <TabsTrigger value="corporate" data-testid="tab-corporate">Corporate Riders</TabsTrigger>
          </TabsList>

          <TabsContent value="individual" className="space-y-16">
            <div className="grid md:grid-cols-3 gap-6">
              {individualFeatures.map((f) => (
                <FeatureCard key={f.t} f={f} onExplain={explain} />
              ))}
            </div>

            <div id="how-it-works" className="scroll-mt-28 focus:outline-none">
              <h2 className="text-2xl font-bold text-center mb-8">How it works</h2>
              <div className="grid md:grid-cols-6 gap-4">
                {steps.map((s, i) => (
                  <div key={s} className="text-center">
                    <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center mx-auto mb-3">{i+1}</div>
                    <p className="text-sm font-medium">{s}</p>
                  </div>
                ))}
              </div>
            </div>

            <div id="get-the-app" className="scroll-mt-28 focus:outline-none rounded-2xl bg-primary p-6 text-primary-foreground sm:p-10">
              <div className="mx-auto grid max-w-3xl items-center gap-6 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <h3 className="text-2xl font-bold mb-3">Get TaxiD Rider</h3>
                  <p className="text-primary-foreground/90">Book and manage TaxiD rides with the official Android app.</p>
                </div>
                <AppDownloadCard audience="rider" placement="riders_page" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="corporate" className="space-y-16">
            <div className="text-center max-w-2xl mx-auto">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">Enterprise mobility</span>
              <h2 className="text-3xl font-bold mt-3 mb-4">Travel that respects your policies and budgets.</h2>
              <p className="text-muted-foreground">Book business or personal trips from a single app — with controls finance teams love.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {corporateFeatures.map((f) => (
                <FeatureCard key={f.t} f={f} onExplain={explain} />
              ))}
            </div>

            <div id="business-trip-flow" className="scroll-mt-28 focus:outline-none rounded-2xl border border-border bg-card p-8">
              <h3 className="text-2xl font-bold mb-6">Business trip flow</h3>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="p-6 rounded-xl bg-primary/5 border border-primary/20">
                  <h4 className="font-semibold text-primary mb-3">Business trip</h4>
                  <ul className="space-y-2 text-sm">
                    {["Policy evaluation","Budget reservation","Approval workflow","Corporate billing"].map(s => (
                      <li key={s} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" />{s}</li>
                    ))}
                  </ul>
                </div>
                <div className="p-6 rounded-xl bg-primary/5 border border-primary/20">
                  <h4 className="font-semibold text-primary mb-3">Personal trip</h4>
                  <ul className="space-y-2 text-sm">
                    {["Personal wallet charge","No policy escalation","Direct settlement"].map(s => (
                      <li key={s} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-status-success" />{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div id="corporate-demo" className="scroll-mt-28 focus:outline-none text-center space-y-3">
              <Button size="lg" asChild>
                <Link to="/corporates#demo">Request Corporate Demo <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <div>
                <Link to="/dashboard/corporate" className="text-sm font-semibold text-primary hover:underline">
                  Open the corporate workspace →
                </Link>
              </div>
            </div>

          </TabsContent>
        </Tabs>
      </section>

      <RiderCorporatePreview />

      <RiderAssistant />

      <RiderSupport />

      <section className="container mx-auto px-4 pb-20">
        <div className="rounded-3xl bg-primary p-10 text-center text-primary-foreground shadow-elegant md:p-16">
          <h2 className="text-3xl font-bold md:text-4xl">Ready to Travel Smarter?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-primary-foreground/90">
            Book your next journey with Africa's trusted mobility marketplace.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90"
              analytics="rider_final_book_journey" action="navigate" target="/rider">
              Book Your Journey
            </AppButton>
            <AppButton size="lg" variant="outline"
              className="border-ice/70 bg-transparent [&]:text-ice hover:bg-ice/20"
              analytics="rider_final_create_account" action="navigate" target="/auth?mode=register">
              Create Free Account
            </AppButton>
          </div>
        </div>
      </section>

      <CrossLinks
        heading="Related on TaxiD"
        keys={["drivers", "corporates", "delivery", "rentals", "pricing", "careers"]}
      />
    </MarketingPage>
  );
};

export default Riders;
