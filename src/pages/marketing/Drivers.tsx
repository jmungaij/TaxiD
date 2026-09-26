import { SeoHead } from "@/components/seo/SeoHead";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Wallet, Zap, BarChart3, Shield, GraduationCap, Sparkles, Award, Heart, Smartphone, Map, Calculator, Receipt, Headphones, Activity, ShieldCheck, FileCheck, Car, Users, TrendingUp, Building2, Banknote, PiggyBank, Briefcase, Crown, Plane, Bot, HandHeart, Check, X, Network, LineChart, Compass, Lock, Star } from "lucide-react";
import { MarketingPage } from "@/components/marketing/PageHero";
import { CrossLinks } from "@/components/marketing/CrossLinks";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { EarningsCalculator } from "@/components/marketing/EarningsCalculator";
import { SuccessStories } from "@/components/marketing/SuccessStories";
import { Counter } from "@/components/marketing/Counter";
import { trackDriverEvent } from "@/lib/driverAnalytics";
import { supabase } from "@/integrations/supabase/client";
import driversImg from "@/assets/drivers.jpg";

/* ============================================================
   YALLA DRIVER SUCCESS ECOSYSTEM
   Positioning: Earn. Grow. Protect. Build Wealth. Operate Smarter. Scale.
   ============================================================ */

const ecosystemPillars = [
  {
    icon: Zap, t: "Instant Earnings & Same-Day Payouts",
    d: "M-Pesa payouts within minutes of every trip — track income in real time.",
    href: "/driver/earnings",
  },
  {
    icon: Building2, t: "From Driver to Fleet Owner",
    d: "Savings programs, vehicle financing and fleet growth pathways turn driving into ownership.",
    href: "/driver/benefits",
  },
  {
    icon: Plane, t: "Premium & Corporate Trips",
    d: "Airport, executive, tourism and corporate contracts unlocked for top drivers.",
    href: "/driver/benefits",
  },
  {
    icon: PiggyBank, t: "Driver Wealth & Financial Freedom",
    d: "Automated savings, tax reporting, budgeting and investment tools build real security.",
    href: "/dashboard/driver/tax",
  },
  {
    icon: ShieldCheck, t: "Driver Protection Guarantee",
    d: "Passenger verification, live monitoring, SOS, dispute management and 24/7 ops.",
    href: "/driver/safety",
  },
  {
    icon: GraduationCap, t: "Yalla Driver Academy",
    d: "Certifications in service, executive transport, tourism, safety and business.",
    href: "/driver/training",
  },
  {
    icon: Bot, t: "AI-Powered Business Dashboard",
    d: "Track revenue, expenses, tax, profitability and growth from one command center.",
    href: "/driver/dashboard",
  },
  {
    icon: Network, t: "Community & Recognition",
    d: "Local chapters, mentorship, rewards and leadership across Kenya and beyond.",
    href: "/driver/benefits",
  },
];

const driverToOwnerSteps = [
  { icon: Car,          t: "Drive",    d: "Start earning with Yalla from day one." },
  { icon: PiggyBank,    t: "Save",     d: "Automated micro-savings on every trip." },
  { icon: Award,        t: "Qualify",  d: "Build a strong performance record through trip history." },
  { icon: Banknote,     t: "Finance",  d: "Access partner vehicle financing." },
  { icon: Car,          t: "Own",      d: "Your first vehicle. Your asset." },
  { icon: Building2,    t: "Scale",    d: "Grow a fleet. Become an operator." },
];

const prosperityModules = [
  { icon: PiggyBank, t: "Retirement Savings",  d: "Long-term savings auto-funded by trips." },
  { icon: LineChart, t: "Investment Wallet",   d: "Grow earnings into diversified assets." },
  { icon: Wallet,    t: "Emergency Fund",      d: "Cushion for repairs, illness, downtime." },
  { icon: Shield,    t: "Insurance Benefits",  d: "Medical, accident and income protection." },
];

const familyProtection = [
  { icon: HandHeart,   t: "Emergency Assistance",  d: "Rapid response for you and your family." },
  { icon: Users,       t: "Family Support Programs", d: "Education and welfare partnerships." },
  { icon: Heart,       t: "Medical Cover",         d: "Health protection that travels with you." },
  { icon: ShieldCheck, t: "Accident Cover",        d: "On and off trip accident protection." },
  { icon: Banknote,    t: "Income Protection",     d: "Stay paid through unexpected events." },
];

const prestigeCerts = [
  { icon: Crown,        t: "VIP Chauffeur Certification" },
  { icon: Briefcase,    t: "Corporate Service Certification" },
  { icon: Plane,        t: "Tourism Mobility Certification" },
  { icon: Shield,       t: "Defensive & Safety Certification" },
  { icon: Award,        t: "National Mobility Professional" },
  { icon: GraduationCap,t: "Business Management for Drivers" },
];

const premiumNetwork = [
  { icon: Briefcase, t: "Corporate Travel" },
  { icon: Plane,     t: "Airport Transfers" },
  { icon: Crown,     t: "VIP Transport" },
  { icon: Building2, t: "Executive Mobility" },
  { icon: Compass,   t: "Tourism Transfers" },
];

const aiAssistant = [
  { icon: LineChart, t: "Earnings Forecasts",   d: "Predict today and this week's income." },
  { icon: Receipt,   t: "Tax Reports",          d: "Auto-prepared, KRA-ready statements." },
  { icon: Calculator,t: "Expense Tracking",     d: "Fuel, maintenance, fees in one place." },
  { icon: BarChart3, t: "Profit Analysis",      d: "Net profit per trip, per hour, per day." },
  { icon: Activity,  t: "Business Insights",    d: "Smart suggestions for higher earnings." },
];

const trustGuarantee = [
  { icon: Headphones, t: "24/7 Emergency Response" },
  { icon: Lock,       t: "Dispute Resolution" },
  { icon: ShieldCheck,t: "Fraud Protection" },
  { icon: Users,      t: "Passenger Verification" },
  { icon: Activity,   t: "Live Trip Monitoring" },
];

const comparisonRows: Array<{ feature: string; typical: string; yalla: string }> = [
  { feature: "Instant Payouts",         typical: "Sometimes",     yalla: "Every Trip" },
  { feature: "Wealth Building",         typical: "No",            yalla: "Yes" },
  { feature: "Fleet Ownership Pathway", typical: "No",            yalla: "Yes" },
  { feature: "Driver Academy",          typical: "Limited",       yalla: "Full Academy" },
  { feature: "Financial Literacy",      typical: "No",            yalla: "Yes" },
  { feature: "Corporate Trip Access",   typical: "Limited",       yalla: "Yes" },
  { feature: "Family Protection",       typical: "Limited",       yalla: "Yes" },
  { feature: "Driver Business Tools",   typical: "Basic",         yalla: "Advanced" },
  { feature: "AI Driver Assistant",     typical: "No",            yalla: "Yes" },
  { feature: "Community & Recognition", typical: "No",            yalla: "Yes" },
];

const appModules = [
  { icon: BarChart3, t: "Earnings Dashboard",  href: "/driver/dashboard" },
  { icon: Map,       t: "Ride Requests",       href: "/driver/dashboard" },
  { icon: Activity,  t: "Heat Maps",           href: "/driver/training" },
  { icon: Map,       t: "Route Optimization",  href: "/driver/training" },
  { icon: Wallet,    t: "Driver Wallet",       href: "/driver/dashboard" },
  { icon: TrendingUp,t: "Driver Analytics",    href: "/driver/dashboard" },
  { icon: GraduationCap, t: "Academy",         href: "/driver/training" },
  { icon: Headphones,t: "Support Center",      href: "/driver/support" },
  { icon: ShieldCheck,t: "Safety Center",      href: "/driver/safety" },
  { icon: Car,       t: "Vehicle Management",  href: "/driver/dashboard" },
  { icon: FileCheck, t: "Document Center",     href: "/driver/onboarding" },
  { icon: Receipt,   t: "Tax Reports",         href: "/dashboard/driver/tax" },
  { icon: Briefcase, t: "Corporate Marketplace", href: "/driver/benefits" },
  { icon: Bot,       t: "AI Assistant",        href: "/driver/dashboard" },
  { icon: PiggyBank, t: "Savings & Wealth",    href: "/driver/benefits" },
];

const dashboardWidgets = [
  { l: "Today's earnings",  v: "KES 4,820" },
  { l: "Weekly earnings",   v: "KES 32,140" },
  { l: "Monthly earnings",  v: "KES 138,500" },
  { l: "Savings balance",   v: "KES 24,300" },
  { l: "Investment wallet", v: "KES 11,750" },
  { l: "Acceptance rate",   v: "94%" },
  { l: "Driver rating",     v: "4.92 ★" },
  { l: "Bonus tracker",     v: "KES 3,500" },
  { l: "Tax (period)",      v: "KES 4,155" },
  { l: "Performance score", v: "A+" },
];

const onboardingStages = [
  { icon: Users,         t: "Identity",   d: "National ID, passport, photo + biometric." },
  { icon: FileCheck,     t: "Driving",    d: "Driving licence, PSV, driving history." },
  { icon: Car,           t: "Vehicle",    d: "Registration, inspection, insurance." },
  { icon: ShieldCheck,   t: "Compliance", d: "Background, criminal and fraud screening." },
  { icon: GraduationCap, t: "Training",   d: "Safety and platform training." },
  { icon: Award,         t: "Approval",   d: "Automated review + manual checks." },
  { icon: Sparkles,      t: "Activation", d: "Dashboard + wallet go live." },
];

export default function Drivers() {
  const [stats, setStats] = useState({ drivers: 12400, daily: 4820, monthly: 138500, rating: 4.91, cities: 12 });

  useEffect(() => {
    trackDriverEvent("drivers_page_view", { funnel_stage: "awareness" });
    supabase
      .from("driver_earnings_models")
      .select("hourly_average_cents,surge_multiplier")
      .eq("is_active", true)
      .then(({ data }) => {
        if (!data?.length) return;
        const avgHourly = data.reduce((a, m) => a + m.hourly_average_cents * Number(m.surge_multiplier), 0) / data.length;
        setStats((s) => ({
          ...s,
          daily: Math.round(avgHourly * 8 / 100),
          monthly: Math.round(avgHourly * 8 * 26 / 100),
        }));
      });
  }, []);

  return (
    <MarketingPage>
      <SeoHead
        title="Drive with Yalla — Earn, Grow, Build a Transport Business"
        description="Yalla Driver Success Ecosystem: instant payouts, fleet ownership pathway, driver academy, AI business tools, family protection and wealth building across Kenya."
        path="/drivers"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          serviceType: "Driver-partner network",
          name: "Drive with Yalla — Earn, Grow, Build a Transport Business",
          description: "Yalla Driver Success Ecosystem: instant payouts, fleet ownership pathway, driver academy, AI business tools, family protection and wealth building across Kenya.",
          provider: { "@type": "Organization", name: "Yalla Mobility", url: "https://yalla-africa.lovable.app" },
          areaServed: "Africa",
          url: "https://yalla-africa.lovable.app/drivers",
        }}
      />

      {/* ---------- HERO ---------- */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div className="absolute inset-0 opacity-25" aria-hidden>
          <img src={driversImg} alt="" className="h-full w-full object-cover" loading="eager" />
          <div className="absolute inset-0 bg-primary/80" />
        </div>
        <div className="relative container mx-auto px-4 py-24 md:py-32">
          <div className="max-w-3xl">
            <span className="inline-block px-3 py-1 rounded-full bg-ice/20 text-xs font-semibold mb-5 uppercase tracking-wider">Driver Success Ecosystem</span>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-5">
              Build Wealth, Not Just Earnings
            </h1>
            <p className="text-lg md:text-xl text-primary-foreground/90 mb-3">
              Earn today. Save automatically. Access asset financing. Build a transport business. Own vehicles. Grow a fleet.
            </p>
            <p className="text-base text-primary-foreground/80 mb-8">
              Yalla is more than ride-hailing. It is a complete platform designed to help African drivers earn, grow, protect their families and build their own transportation businesses.
            </p>
            <div className="flex flex-wrap gap-3">
              <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90" analytics="driver_hero_apply" action="navigate" target="/driver/onboarding" onClick={() => trackDriverEvent("hero_start_driving_click", { funnel_stage: "intent" })}>
                Start Driving Today <ArrowRight className="ml-2 h-4 w-4" />
              </AppButton>
              <AppButton size="lg" variant="outline" className="border-ice/70 text-ice hover:bg-ice/20" analytics="driver_hero_earnings" action="navigate" target="/driver/earnings">
                Calculate Your Earnings
              </AppButton>
              <AppButton size="lg" variant="ghost" className="text-ice hover:bg-ice/20" analytics="driver_hero_ecosystem" action="navigate" target="/driver/benefits">
                Explore the Ecosystem
              </AppButton>
            </div>
          </div>
          <div className="mt-10 grid grid-cols-2 md:grid-cols-5 gap-4 max-w-4xl">
            {[
              { v: <Counter to={stats.drivers} suffix="+" />, l: "Active drivers" },
              { v: <>KES <Counter to={stats.daily} suffix="+" /></>, l: "Avg daily earnings" },
              { v: <>KES <Counter to={stats.monthly} suffix="+" /></>, l: "Avg monthly earnings" },
              { v: "4.91 ★", l: "Driver satisfaction" },
              { v: <Counter to={stats.cities} suffix="+" />, l: "Cities served" },
            ].map((s, i) => (
              <div key={i} className="p-4 rounded-xl bg-ice/10 backdrop-blur-sm border border-ice/20">
                <div className="text-xl md:text-2xl font-bold">{s.v}</div>
                <div className="text-xs opacity-80 mt-1">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- WHY THOUSANDS ARE BUILDING THEIR FUTURE ---------- */}
      <section className="container mx-auto px-4 py-20">
        <SectionHeader
          eyebrow="Driver Success Ecosystem"
          title="Why Thousands of Drivers Are Building Their Future With Yalla"
          subtitle="Earn More. Grow Faster. Build a Business."
        />
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {ecosystemPillars.map((c) => (
            <Link
              key={c.t}
              to={c.href}
              onClick={() => trackDriverEvent("ecosystem_pillar_click", { funnel_stage: "interest", metadata: { pillar: c.t } })}
              className="group p-6 rounded-xl bg-card border border-border hover:border-primary hover:shadow-lg transition-all"
            >
              <c.icon className="h-8 w-8 text-primary mb-3 group-hover:scale-110 transition-transform" />
              <h3 className="font-semibold mb-2 text-sm">{c.t}</h3>
              <p className="text-sm text-muted-foreground mb-3">{c.d}</p>
              <div className="inline-flex items-center text-sm font-medium text-primary">
                Learn about {c.t.toLowerCase()}
                <ArrowRight className="ml-1 h-3 w-3 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- FROM DRIVER TO FLEET OWNER ---------- */}
      <section className="bg-gradient-to-br from-secondary/40 to-secondary/10 py-20">
        <div className="container mx-auto px-4">
          <SectionHeader
            eyebrow="Driver-to-Owner Program"
            title="From Driver to Fleet Owner"
            subtitle="A pathway no other platform offers — turn driving into ownership."
          />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {driverToOwnerSteps.map((s, i) => (
              <div key={s.t} className="relative p-5 rounded-xl bg-card border border-border hover:border-primary transition-all">
                <div className="absolute -top-3 -left-3 h-8 w-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shadow">{i + 1}</div>
                <s.icon className="h-7 w-7 text-primary mb-2" />
                <h3 className="font-semibold text-sm mb-1">{s.t}</h3>
                <p className="text-xs text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Button asChild size="lg">
              <Link to="/driver/benefits">Start the Ownership Pathway <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ---------- EARNINGS CALCULATOR ---------- */}
      <section className="container mx-auto px-4 py-20">
        <SectionHeader eyebrow="Earnings calculator" title="See what you could earn this week" />
        <EarningsCalculator />
      </section>

      {/* ---------- DRIVER PROSPERITY ---------- */}
      <section className="bg-secondary/40 py-20">
        <div className="container mx-auto px-4">
          <SectionHeader
            eyebrow="Driver Prosperity Program"
            title="Every Trip Builds Your Future"
            subtitle="Retirement, investment, emergency fund and insurance — built into the platform."
          />
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {prosperityModules.map((p) => (
              <div key={p.t} className="p-6 rounded-xl bg-card border border-border hover:border-primary hover:shadow-lg transition-all">
                <p.icon className="h-8 w-8 text-primary mb-3" />
                <h3 className="font-semibold mb-2">{p.t}</h3>
                <p className="text-sm text-muted-foreground">{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FAMILY PROTECTION ---------- */}
      <section className="container mx-auto px-4 py-20">
        <SectionHeader
          eyebrow="Family First"
          title="Protection for You and the People Who Depend on You"
        />
        <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-5">
          {familyProtection.map((f) => (
            <div key={f.t} className="p-6 rounded-xl bg-card border border-border hover:border-primary hover:shadow-lg transition-all">
              <f.icon className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-2 text-sm">{f.t}</h3>
              <p className="text-sm text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- PRESTIGE & CERTIFICATIONS ---------- */}
      <section className="bg-gradient-to-br from-primary/5 to-primary-glow/5 py-20">
        <div className="container mx-auto px-4">
          <SectionHeader
            eyebrow="Become a Certified Mobility Professional"
            title="Build a Respected Career"
            subtitle="National and industry certifications that unlock premium trip categories."
          />
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {prestigeCerts.map((c) => (
              <div key={c.t} className="flex items-center gap-4 p-5 rounded-xl bg-card border border-border hover:border-primary transition-all">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <c.icon className="h-6 w-6 text-primary" />
                </div>
                <div className="font-semibold">{c.t}</div>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Button asChild><Link to="/driver/training">Open Driver Academy <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
          </div>
        </div>
      </section>

      {/* ---------- PREMIUM EARNINGS NETWORK ---------- */}
      <section className="container mx-auto px-4 py-20">
        <SectionHeader
          eyebrow="Premium Earnings Network"
          title="Access High-Value Trips Reserved for Top Drivers"
        />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {premiumNetwork.map((n) => (
            <div key={n.t} className="p-6 rounded-xl bg-gradient-to-br from-card to-secondary/30 border border-border text-center hover:border-primary hover:shadow-lg transition-all">
              <n.icon className="h-9 w-9 text-primary mx-auto mb-3" />
              <p className="font-semibold text-sm">{n.t}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- AI BUSINESS ASSISTANT ---------- */}
      <section className="bg-secondary/40 py-20">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <SectionHeader
                inline
                eyebrow="Your Personal Business Manager"
                title="Run Your Driving Like a Business"
                subtitle="An AI co-pilot Uber doesn't give you."
              />
              <div className="space-y-3">
                {aiAssistant.map((a) => (
                  <div key={a.t} className="flex items-start gap-3 p-4 rounded-lg bg-card border border-border">
                    <a.icon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-sm">{a.t}</div>
                      <div className="text-xs text-muted-foreground">{a.d}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <Button asChild><Link to="/driver/dashboard">Open AI Dashboard <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              </div>
            </div>
            <div className="p-6 rounded-2xl bg-card border border-border shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="font-semibold flex items-center gap-2"><Bot className="h-5 w-5 text-primary" /> Yalla AI · Today</div>
                <span className="text-xs font-semibold text-status-success">+12% vs avg</span>
              </div>
              <div className="space-y-3 text-sm">
                <div className="p-3 rounded-md bg-secondary/40"><strong>Forecast:</strong> KES 5,400 if you drive 6–10pm in Westlands.</div>
                <div className="p-3 rounded-md bg-secondary/40"><strong>Tip:</strong> JKIA airport queue clears at 7:42pm — best ROI window.</div>
                <div className="p-3 rounded-md bg-secondary/40"><strong>Tax:</strong> Set aside KES 540 today to stay current with KRA.</div>
                <div className="p-3 rounded-md bg-secondary/40"><strong>Goal:</strong> 4 trips to reach your weekly savings target.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- COMMUNITY ---------- */}
      <section className="container mx-auto px-4 py-20">
        <SectionHeader
          eyebrow="Yalla Driver Network"
          title="You're Not Alone. You're Part of Africa's Fastest Growing Driver Network."
        />
        <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-5">
          {[
            { icon: Network,   t: "Local Chapters" },
            { icon: Users,     t: "Mentorship" },
            { icon: Building2, t: "Fleet Partnerships" },
            { icon: Award,     t: "Driver Rewards" },
            { icon: Star,      t: "Recognition Programs" },
          ].map((c) => (
            <div key={c.t} className="p-6 rounded-xl bg-card border border-border text-center hover:border-primary transition-all">
              <c.icon className="h-9 w-9 text-primary mx-auto mb-3" />
              <p className="font-semibold text-sm">{c.t}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- SUCCESS STORIES ---------- */}
      <section className="bg-secondary/40 py-20">
        <div className="container mx-auto px-4">
          <SectionHeader eyebrow="Driver success stories" title="Drivers turning trips into businesses" />
          <SuccessStories />
        </div>
      </section>

      {/* ---------- TRUST GUARANTEE ---------- */}
      <section className="container mx-auto px-4 py-20">
        <SectionHeader
          eyebrow="Driver Protection Guarantee"
          title="Every Trip Protected. Every Driver Respected."
        />
        <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-4">
          {trustGuarantee.map((g) => (
            <div key={g.t} className="p-5 rounded-xl bg-card border border-border hover:border-primary transition-all">
              <g.icon className="h-7 w-7 text-primary mb-2" />
              <p className="font-semibold text-sm">{g.t}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- WHY YALLA WINS — COMPARISON ---------- */}
      <section className="bg-gradient-to-br from-primary/5 via-background to-primary-glow/5 py-20">
        <div className="container mx-auto px-4">
          <SectionHeader
            eyebrow="Why Yalla Wins"
            title="What Other Platforms Don't Offer"
            subtitle="A side-by-side look at the Yalla advantage."
          />
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/40 text-left">
                  <th className="p-4 font-semibold">Feature</th>
                  <th className="p-4 font-semibold text-center">Typical Platforms</th>
                  <th className="p-4 font-semibold text-center text-primary">Yalla</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((r, i) => (
                  <tr key={r.feature} className={i % 2 === 0 ? "bg-background" : "bg-secondary/20"}>
                    <td className="p-4 font-medium">{r.feature}</td>
                    <td className="p-4 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {r.typical === "No" ? <X className="h-4 w-4 text-destructive" /> : null}
                        {r.typical}
                      </span>
                    </td>
                    <td className="p-4 text-center font-semibold text-primary">
                      <span className="inline-flex items-center gap-1">
                        <Check className="h-4 w-4" />
                        {r.yalla}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- APP MODULES ---------- */}
      <section className="container mx-auto px-4 py-20">
        <SectionHeader eyebrow="Driver App" title="Everything in one app" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {appModules.map((m) => (
            <Link key={m.t} to={m.href} className="group p-5 rounded-xl bg-card border border-border hover:border-primary hover:shadow-md text-center transition-all">
              <m.icon className="h-7 w-7 text-primary mx-auto mb-2 group-hover:scale-110 transition-transform" />
              <p className="font-medium text-sm">{m.t}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- DASHBOARD PREVIEW ---------- */}
      <section className="bg-primary text-primary-foreground py-20">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-semibold uppercase tracking-wider opacity-90">Your Transportation Business Command Center</span>
            <h2 className="text-3xl md:text-4xl font-bold mt-2 mb-3">Earn More. Grow Faster. Build Wealth.</h2>
            <p className="opacity-90">Live KPIs for every shift, every week, every month — plus savings, investments and tax in one place.</p>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 max-w-6xl mx-auto">
            {dashboardWidgets.map((w) => (
              <div key={w.l} className="p-4 rounded-xl bg-ice/10 backdrop-blur-sm border border-ice/20">
                <div className="text-xs opacity-80">{w.l}</div>
                <div className="text-xl font-bold mt-1 tabular-nums">{w.v}</div>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Button asChild size="lg" className="bg-ice text-primary hover:bg-ice/90">
              <Link to="/dashboard/driver">Open Driver Command Center <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ---------- ACADEMY ---------- */}
      <section className="container mx-auto px-4 py-20">
        <SectionHeader eyebrow="Driver Academy" title="Learn. Earn. Certify." />
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { icon: Heart,    t: "Customer Service",    d: "Five-star greetings, communication and accessibility." },
            { icon: Shield,   t: "Road Safety",         d: "Defensive driving, NTSA rules, incident response." },
            { icon: Map,      t: "Route Optimization",  d: "Heat maps, surge windows, smart positioning." },
            { icon: Smartphone,t:"Platform Operations", d: "Ratings, cancellations, fare disputes." },
            { icon: Calculator,t:"Financial Literacy",  d: "Budgeting, KRA tax, savings, fuel costs." },
            { icon: Award,    t: "Certifications",      d: "Earn and showcase verified credentials." },
          ].map((c) => (
            <Link key={c.t} to="/driver/training" className="p-6 rounded-xl bg-card border border-border hover:border-primary hover:shadow-lg transition-all group">
              <c.icon className="h-7 w-7 text-primary mb-3" />
              <h3 className="font-semibold mb-2">{c.t}</h3>
              <p className="text-sm text-muted-foreground">{c.d}</p>
            </Link>
          ))}
        </div>
        <div className="text-center mt-10">
          <Button asChild><Link to="/driver/training">Open Driver Academy <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
        </div>
      </section>

      {/* ---------- ONBOARDING OVERVIEW ---------- */}
      <section className="bg-secondary/40 py-20">
        <div className="container mx-auto px-4">
          <SectionHeader eyebrow="Driver Registration" title="From sign-up to first trip in 48 hours" />
          <div className="grid sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-10">
            {onboardingStages.map((s, i) => (
              <div key={s.t} className="relative p-5 rounded-xl bg-card border border-border">
                <div className="absolute -top-3 -left-3 h-8 w-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shadow">{i + 1}</div>
                <s.icon className="h-6 w-6 text-primary mb-2" />
                <h3 className="font-semibold text-sm mb-1">{s.t}</h3>
                <p className="text-xs text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
          <div className="text-center">
            <Button asChild size="lg" onClick={() => trackDriverEvent("onboarding_overview_cta_click", { funnel_stage: "intent" })}>
              <Link to="/driver/onboarding">Start your application <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ---------- FINAL CTA ---------- */}
      <section className="bg-primary text-primary-foreground py-16">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <Banknote className="h-12 w-12 mx-auto mb-4 opacity-90" />
          <h2 className="text-3xl font-bold mb-3">Your Future Starts Here</h2>
          <p className="opacity-90 mb-6">
            Whether you want extra income, a full-time career, or your own transport company — Yalla gives you the tools, support and opportunities to grow beyond driving.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <AppButton analytics="driver_start_driving_today" action="navigate" target="/driver/onboarding"
              size="lg" className="bg-ice text-primary hover:bg-ice/90">
              Start Driving Today
            </AppButton>
            <AppButton analytics="driver_talk_to_support" action="navigate" target="/driver/support"
              size="lg" variant="outline" className="border-ice/70 text-ice hover:bg-ice/20">
              Talk to driver support
            </AppButton>
          </div>
        </div>
      </section>
      <CrossLinks
        heading="Related on Yalla"
        keys={["riders", "corporates", "delivery", "rentals", "careers", "support"]}
      />
    </MarketingPage>
  );
}

function SectionHeader({ eyebrow, title, subtitle, inline = false }: { eyebrow: string; title: string; subtitle?: string; inline?: boolean }) {
  return (
    <div className={inline ? "mb-6" : "max-w-3xl mb-12"}>
      <span className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</span>
      <h2 className="text-3xl md:text-4xl font-bold mt-2">{title}</h2>
      {subtitle ? <p className="text-muted-foreground mt-3 text-lg">{subtitle}</p> : null}
    </div>
  );
}
