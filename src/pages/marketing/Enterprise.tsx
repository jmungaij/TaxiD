import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, AlertTriangle, Fingerprint, Radar, Lock, Sparkles, Building2, Globe2 } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { ContactForm } from "@/components/marketing/ContactForm";
import { SeoHead } from "@/components/seo/SeoHead";

const pillars = [
  { icon: ShieldCheck, title: "Trust & Safety", desc: "Case management, chain-of-custody, watchlists, SLA-tracked incidents." },
  { icon: AlertTriangle, title: "Fraud & Financial Crime", desc: "Real-time transaction scoring, velocity checks, wallet abuse detection." },
  { icon: Fingerprint, title: "Identity Assurance", desc: "Device fingerprinting, login risk, account takeover defense, GPS integrity." },
  { icon: Radar, title: "National Operations Center", desc: "Live distribution view, runbooks, anomaly detection across regions." },
  { icon: Lock, title: "SOC, BCP & Governance", desc: "Threat intel, encrypted backups, DR tests, data classification, DSAR workflows." },
  { icon: Sparkles, title: "AI Orchestration", desc: "Dispatch, surge, ETA, risk and fraud models trained on Kenyan conditions." },
];

const proofs = [
  { value: "Kenya DPA", label: "Registered controller" },
  { value: "ISO 27001", label: "Readiness" },
  { value: "99.95%", label: "Platform uptime SLA" },
  { value: "24/7", label: "NOC + SOC" },
];

const audiences = [
  { icon: Building2, title: "Corporate travel", desc: "Policy-aware bookings, dual wallets, cost-center allocation, eTIMS invoices." },
  { icon: Globe2, title: "Logistics & distribution", desc: "Same-day, intra-city and inter-city, with chain-of-custody on every parcel." },
];

export default function Enterprise() {
  return (
    <MarketingPage>
      <SeoHead
        title="Enterprise mobility & logistics platform | TaxiD"
        description="National logistics & mobility operating system: trust, fraud, identity, NOC and SOC built in. Book a demo with the TaxiD enterprise team."
        path="/enterprise"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: "TaxiD Enterprise Platform",
          provider: { "@type": "Organization", name: "TaxiD" },
          areaServed: "KE",
          description:
            "Enterprise mobility, logistics and rental operating system with built-in trust, fraud, identity, NOC and governance.",
        }}
      />
      <PageHero
        eyebrow="Enterprise"
        title="The operating system for national mobility & logistics"
        subtitle="One platform for corporate travel, package delivery, fleet leasing and distribution — with trust, fraud, identity, NOC and governance built in, not bolted on."
      >
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="bg-ice text-primary hover:bg-ice/90">
            <a href="#demo">Book a demo <ArrowRight className="ml-2 h-4 w-4" /></a>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-ice/70 text-ice hover:bg-ice/20">
            <Link to="/developers">Read the APIs</Link>
          </Button>
        </div>
      </PageHero>

      <section className="border-y border-border bg-secondary/30">
        <div className="container mx-auto px-4 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
          {proofs.map((p) => (
            <div key={p.label}>
              <div className="text-2xl md:text-3xl font-bold text-primary">{p.value}</div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{p.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl mb-10">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Platform</span>
            <h2 className="text-3xl font-bold mt-2 mb-3">An enterprise platform, not an app</h2>
            <p className="text-muted-foreground text-lg">
              TaxiD is engineered as digital infrastructure for mobility and logistics. Every transaction is signed, every device is fingerprinted, every package is traced.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {pillars.map((p) => (
              <div key={p.title} className="p-6 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors">
                <p.icon className="h-7 w-7 text-primary mb-3" />
                <h3 className="font-semibold mb-2">{p.title}</h3>
                <p className="text-sm text-muted-foreground">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-secondary/30">
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl mb-10">
            <h2 className="text-3xl font-bold mb-3">Built for the work that runs a country</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {audiences.map((a) => (
              <div key={a.title} className="p-6 rounded-xl bg-card border border-border">
                <a.icon className="h-7 w-7 text-primary mb-3" />
                <h3 className="font-semibold mb-2">{a.title}</h3>
                <p className="text-sm text-muted-foreground">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="demo">
        <div className="container mx-auto px-4 py-16 grid lg:grid-cols-2 gap-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Talk to us</span>
            <h2 className="text-3xl font-bold mt-2 mb-3">Book an enterprise demo</h2>
            <p className="text-muted-foreground mb-6">
              Tell us about your travel program, fleet, or distribution network. We'll walk you through the platform and a proposal in one session.
            </p>
            <ul className="space-y-3 text-sm">
              <li className="flex gap-3"><ShieldCheck className="h-5 w-5 text-primary shrink-0" /><span>Dedicated CSM and SLA-backed APIs</span></li>
              <li className="flex gap-3"><Lock className="h-5 w-5 text-primary shrink-0" /><span>Kenya data residency, eTIMS compliance</span></li>
              <li className="flex gap-3"><Building2 className="h-5 w-5 text-primary shrink-0" /><span>Single-sign-on, cost centers, approval workflows</span></li>
            </ul>
          </div>
          <ContactForm
            type="demo"
            sourcePage="/enterprise"
            showCompany
            showEmployeeCount
            submitLabel="Request demo"
            heading="Request a demo"
            subheading="A specialist will respond within one business day."
          />
        </div>
      </section>
    </MarketingPage>
  );
}
