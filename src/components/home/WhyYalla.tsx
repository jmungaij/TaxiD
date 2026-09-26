/**
 * "Why Choose SAFARID", "How It Works" and "Built on Trust" — the
 * confidence layer of the homepage. Presentation only.
 */
import {
  BadgeCheck,
  Banknote,
  Bot,
  Building2,
  CheckCircle2,
  CreditCard,
  Layers,
  LifeBuoy,
  Lock,
  Radar,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

const REASONS = [
  { icon: Layers, title: "Everything Connected", desc: "Book rides, charter, rentals, leasing and logistics from one secure account, with one consistent experience." },
  { icon: BadgeCheck, title: "Trusted Operators", desc: "Verified driver partners, licensed transport providers, charter operators and professional fleet operators." },
  { icon: Banknote, title: "Transparent Pricing", desc: "See what you will pay before you commit, with clear rates and secure digital payments." },
  { icon: SlidersHorizontal, title: "Flexible Mobility", desc: "Choose the option that fits the requirement — from a single city ride to a chartered aircraft or a leased fleet." },
  { icon: Building2, title: "Enterprise Ready", desc: "Centralised booking, travel policy, approvals, reporting, invoicing and account management for organisations." },
  { icon: Bot, title: "Intelligent Assistance", desc: "Live updates, booking notifications, tracking and guided support from request to completion." },
];

const STEPS = [
  { n: 1, t: "Choose your category", d: "Choose a ride, delivery, charter, rental or lease — whatever the requirement calls for." },
  { n: 2, t: "Compare your options", d: "Compare verified providers, available capacity, timing and pricing side by side." },
  { n: 3, t: "Book securely", d: "Pay by M-Pesa, card or corporate wallet and receive immediate confirmation." },
  { n: 4, t: "Track and close out", d: "Follow the movement live, collect digital receipts and invoices, then rate the service." },
];

const TRUST = [
  { icon: ShieldCheck, label: "Verified providers" },
  { icon: CreditCard, label: "Secure digital payments" },
  { icon: Radar, label: "Real-time tracking" },
  { icon: Lock, label: "Privacy protection" },
  { icon: CheckCircle2, label: "Transparent pricing" },
  { icon: LifeBuoy, label: "Responsive customer support" },
];

export function WhyYalla() {
  return (
    <>
      <section className="border-y border-border bg-secondary/30 py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Why SAFARID</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              One marketplace, many ways to move — with the confidence of verified providers.
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {REASONS.map((r) => (
              <div
                key={r.title}
                className="rounded-2xl border border-border bg-card/80 p-6 backdrop-blur-sm transition-all hover:shadow-[var(--shadow-elegant)]"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <r.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-semibold">{r.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-20">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">How it works</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Book in four steps.</h2>
            <p className="mt-4 text-muted-foreground">
              The same clear process whether you are booking a personal ride, chartering a coach or running
              a corporate mobility programme.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {TRUST.map((t) => (
                <span
                  key={t.label}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium"
                >
                  <t.icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          <ol className="space-y-4">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-4 rounded-2xl border border-border bg-card p-5">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-glow text-sm font-semibold text-primary-foreground">
                  {s.n}
                </span>
                <div>
                  <h3 className="font-semibold">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}

export default WhyYalla;
