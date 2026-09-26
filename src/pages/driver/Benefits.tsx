import { ArrowRight, Wallet, PiggyBank, Gift, Shield, Siren, Activity, Umbrella, GraduationCap, Map, Heart, Building2, Car, Banknote } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { AppButton } from "@/components/nav/AppButton";

const groups = [
  { title: "Financial Benefits", color: "from-primary to-primary-glow", items: [
    { icon: Wallet,    t: "Instant Payouts",  d: "Earnings to M-Pesa in under 2 minutes per trip." },
    { icon: Banknote,  t: "Driver Wallet",    d: "Track every fare, tip and bonus in real time." },
    { icon: PiggyBank, t: "Micro Savings",    d: "Auto-save a slice of every trip into a goal." },
    { icon: Gift,      t: "Bonus Programs",   d: "Daily streaks, weekly quests, city-wide surges." },
  ]},
  { title: "Safety Benefits", color: "from-primary to-primary-glow", items: [
    { icon: Siren,    t: "SOS Assistance",     d: "One-tap emergency button to our 24/7 ops team." },
    { icon: Activity, t: "Trip Monitoring",    d: "Real-time route, speed and anomaly alerts." },
    { icon: Heart,    t: "Emergency Contacts", d: "Notify trusted contacts automatically." },
    { icon: Umbrella, t: "Insurance Support",  d: "In-trip insurance for every booked ride." },
  ]},
  { title: "Professional Benefits", color: "from-primary to-primary-glow", items: [
    { icon: GraduationCap, t: "Driver Academy",     d: "Certifications in safety, service and ops." },
    { icon: Map,           t: "Route Optimization", d: "Heat maps and surge prediction training." },
    { icon: Heart,         t: "Customer Service",   d: "Five-star greetings and conflict resolution." },
  ]},
  { title: "Business Benefits", color: "from-primary to-primary-glow", items: [
    { icon: Building2, t: "Fleet Opportunities",   d: "Lease a second vehicle and onboard sub-drivers." },
    { icon: Shield,    t: "Corporate Ride Access", d: "Guaranteed trips from 850+ enterprise clients." },
    { icon: Car,       t: "Vehicle Financing",     d: "Partnerships with lenders for asset finance." },
  ]},
];

export default function DriverBenefits() {
  return (
    <MarketingPage>
      <PageHero eyebrow="Driver Benefits" title="A complete benefits platform for drivers"
        subtitle="Financial, safety, professional and business benefits — built into every SAFARID driver account.">
        <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90"
          analytics="driver.benefits.join" action="navigate" target="/driver/onboarding">
          Join SAFARID <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </AppButton>
      </PageHero>

      {groups.map((g, idx) => (
        <section key={g.title} className={idx % 2 === 1 ? "bg-secondary/30" : ""}>
          <div className="container mx-auto px-4 py-16">
            <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
              <h2 className="text-2xl md:text-3xl font-bold">{g.title}</h2>
              <div className={`h-1 w-24 rounded-full bg-primary`} />
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
              {g.items.map((it) => (
                <div key={it.t} className="p-6 rounded-xl bg-card border border-border hover:border-primary hover:shadow-lg transition-all">
                  <it.icon className="h-7 w-7 text-primary mb-3" />
                  <h3 className="font-semibold mb-2">{it.t}</h3>
                  <p className="text-sm text-muted-foreground">{it.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className="bg-primary text-primary-foreground py-14">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-3">Unlock every benefit</h2>
          <p className="opacity-90 mb-6">Approved drivers get access to the full benefits platform from day one.</p>
          <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90"
            analytics="driver.benefits.apply" action="navigate" target="/driver/onboarding">
            Apply now <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </AppButton>
        </div>
      </section>
    </MarketingPage>
  );
}
