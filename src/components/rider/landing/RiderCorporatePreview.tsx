import { Building2, Wallet, CheckCircle2, Layers, FileText, PieChart, ShieldCheck, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { AppButton } from "@/components/nav/AppButton";

const CAPABILITIES = [
  { icon: Building2, t: "Employee mobility", d: "Daily staff transport and managed shuttles." },
  { icon: Wallet, t: "Corporate wallet", d: "Primary, department and project balances." },
  { icon: CheckCircle2, t: "Travel approvals", d: "Pre-trip sign-off with manager routing." },
  { icon: Layers, t: "Cost centres", d: "Every trip tagged to the right budget line." },
  { icon: FileText, t: "eTIMS invoicing", d: "Compliant tax invoices issued automatically." },
  { icon: PieChart, t: "Reports & budgets", d: "Spend burn-down per department." },
  { icon: ShieldCheck, t: "Policy management", d: "Vehicle tiers, time windows and caps." },
];

const SEGMENTS = [
  { seg: "Business", quote: "Approvals and reconciliation now happen in one console." },
  { seg: "Families", quote: "Trip sharing means we always know they arrived safely." },
  { seg: "Corporate", quote: "Policy limits removed the monthly expense arguments." },
  { seg: "Tourism", quote: "Coach charter and airport meet & greet in one booking." },
  { seg: "Executive travel", quote: "Protocol-grade chauffeurs, every time." },
  { seg: "Airport transfers", quote: "Flight tracking means no waiting at arrivals." },
  { seg: "Education", quote: "Term-time school runs with attendance visibility." },
  { seg: "Government & NGOs", quote: "Verified fleet with auditable trip records." },
];

export function RiderCorporatePreview() {
  return (
    <>
      <section className="border-y border-border bg-secondary/30 py-20">
        <div className="container mx-auto grid gap-10 px-4 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Corporate mobility</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Travelling on business?</h2>
            <p className="mt-3 text-muted-foreground">
              Keep personal trips personal while your company-paid journeys follow policy, budget and
              approval rules automatically.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <AppButton analytics="rider_corporate_explore" action="navigate" target="/corporates">
                Explore corporate solutions <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </AppButton>
              <Link to="/riders/corporate" className="text-sm font-semibold text-primary hover:underline">
                Employee mobility →
              </Link>
            </div>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <li key={c.t} className="rounded-2xl border border-border bg-card p-5">
                <c.icon className="mb-3 h-5 w-5 text-primary" aria-hidden />
                <h3 className="text-sm font-semibold">{c.t}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{c.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="container mx-auto px-4 py-20">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Customer stories</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Trusted across every kind of journey</h2>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SEGMENTS.map((s) => (
            <li key={s.seg} className="rounded-2xl border border-border bg-card p-5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{s.seg}</span>
              <p className="mt-3 text-sm text-muted-foreground">“{s.quote}”</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export default RiderCorporatePreview;
