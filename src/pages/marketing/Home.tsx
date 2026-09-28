import { Link } from "react-router-dom";
import { ArrowRight, Shield, Zap, BarChart3, MapPin, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { CrossLinks } from "@/components/marketing/CrossLinks";
import HeroCinematic from "@/components/home/HeroCinematic";
import ServiceUniverse from "@/components/home/ServiceUniverse";
import WhyYalla from "@/components/home/WhyYalla";
import TrustStories from "@/components/home/TrustStories";
import TalkToSales from "@/components/home/TalkToSales";
import HomeFaq from "@/components/home/HomeFaq";
import TrustProof from "@/components/home/TrustProof";
import TrustedPartners from "@/components/home/TrustedPartners";
import HomeQuickActions from "@/components/home/HomeQuickActions";


const trust = [
  { icon: Shield, title: "Enterprise-grade security", desc: "Strong authentication, role-based access and ISO 27001-aligned controls." },
  { icon: Zap, title: "Fast, traceable payments", desc: "M-Pesa and card payments with driver partner payouts settled promptly." },
  { icon: BarChart3, title: "Travel governance built in", desc: "Travel policies, budgets, approvals and full audit trails for business customers." },
  { icon: MapPin, title: "Live visibility", desc: "Real-time tracking, status alerts and operational control on every movement." },
];

const Home = () => (
  <MarketingLayout>
    <HeroCinematic />

    <HomeQuickActions />

    {/* VERIFIED TRUST PROOF (real platform data, no invented metrics) */}
    <TrustProof />

    <TrustedPartners />

    <ServiceUniverse />

    <WhyYalla />


    {/* TRUST */}
    <section className="bg-gradient-to-b from-secondary/30 to-background py-20">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Built for business. Simple for everyone.</h2>
          <p className="text-muted-foreground">The assurances customers and organisations ask for before they commit.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {trust.map((t) => (
            <div key={t.title} className="p-6 rounded-xl bg-card border border-border">
              <t.icon className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-2">{t.title}</h3>
              <p className="text-sm text-muted-foreground">{t.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    <TrustStories />

    {/* CORPORATE PREVIEW */}
    <section className="container mx-auto px-4 py-20">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Corporate Mobility</span>
          <h2 className="text-3xl md:text-4xl font-bold mt-3 mb-6">Stay in control of every trip your company pays for.</h2>
          <p className="text-muted-foreground mb-6">
            Give finance, operations and HR one clear view of business mobility — from travel policy and
            approvals through to invoicing and reconciliation.
          </p>
          <ul className="space-y-3 mb-8">
            {["Separate corporate and personal wallets on one account", "Manager approvals before a trip is authorised", "M-Pesa and card settlement with itemised receipts", "Tamper-evident audit trails and finance system exports", "Live spend tracking by department and cost centre"].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-status-success shrink-0 mt-0.5" />
                <span className="text-sm">{f}</span>
              </li>
            ))}
          </ul>
          <Button size="lg" asChild>
            <Link to="/corporates">Explore Corporate Mobility <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
        <div className="rounded-2xl bg-primary p-1 shadow-elegant">
          <div className="rounded-2xl bg-card p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-xs text-muted-foreground">Spend this month</p>
                <p className="text-3xl font-bold">KSh 2,840,500</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Active trips</p>
                <p className="text-3xl font-bold text-primary">142</p>
              </div>
            </div>
            <div className="space-y-3">
              {[
                { dep: "Sales", pct: 78, val: "KSh 980K" },
                { dep: "Operations", pct: 56, val: "KSh 720K" },
                { dep: "Engineering", pct: 34, val: "KSh 440K" },
                { dep: "Executive", pct: 92, val: "KSh 700K" },
              ].map((d) => (
                <div key={d.dep}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium">{d.dep}</span><span className="text-muted-foreground">{d.val}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${d.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>

    <TalkToSales />

    <HomeFaq />

    <CrossLinks
      heading="Explore the TaxiD ecosystem"
      keys={["drivers", "corporates", "delivery", "rentals", "careers", "developers"]}
    />


    {/* CTA */}
    <section className="container mx-auto px-4 pb-20">
      <div className="rounded-3xl bg-primary p-10 text-center text-primary-foreground shadow-elegant md:p-16">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary-foreground/80">
          Ride • Deliver • Charter • Lease
        </p>
        <h2 className="mt-4 text-3xl font-bold md:text-4xl">One marketplace. Every way to move.</h2>
        <p className="mx-auto mt-4 max-w-2xl text-primary-foreground/90">
          TaxiD connects mobility demand with transportation supply, bringing customers and
          professional mobility providers together on one digital platform — for rides, corporate travel,
          charter, rental, leasing, delivery and logistics.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90"
            analytics="marketing.get_started" action="navigate" target="/auth?mode=register">
            Create an Account
          </AppButton>
          <AppButton size="lg" variant="outline" className="bg-transparent border-ice/70 text-ice hover:bg-ice/20"
            analytics="marketing.talk_to_sales" action="navigate" target="/contact">
            Talk to TaxiD
          </AppButton>
        </div>
      </div>
    </section>

  </MarketingLayout>
);

export default Home;
