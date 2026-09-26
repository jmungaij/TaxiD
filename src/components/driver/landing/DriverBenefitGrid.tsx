/**
 * DriverBenefitGrid — premium animated benefit cards. Each card deep-links to
 * the existing module that delivers the benefit (no new features).
 */
import { Link } from "react-router-dom";
import {
  ArrowRight, Clock, Building2, Plane, Crown, Wallet, BarChart3, Bot,
  GraduationCap, Users, Headphones,
} from "lucide-react";
import { trackDriverEvent } from "@/lib/driverAnalytics";

const BENEFITS = [
  { icon: Clock, t: "Flexible Work", d: "Drive on your schedule — accept the jobs that fit your day.", href: "/driver/benefits" },
  { icon: Building2, t: "Corporate Bookings", d: "Contracted staff transport and account travel from verified businesses.", href: "/corporates" },
  { icon: Plane, t: "Airport Transfers", d: "Scheduled, high-value pickups with clear pricing.", href: "/driver/earnings" },
  { icon: Crown, t: "Executive Clients", d: "Chauffeur-grade assignments unlocked by your service record.", href: "/driver/benefits" },
  { icon: Wallet, t: "Daily Wallet Settlement", d: "Earnings settle to your M-Pesa wallet every day.", href: "/dashboard/driver/wallet" },
  { icon: BarChart3, t: "Transparent Earnings", d: "Per-trip breakdowns of fare, commission, incentives and tax.", href: "/driver/earnings" },
  { icon: Bot, t: "AI Driver Assistant", d: "Ask about documents, earnings, compliance and platform rules.", href: "/driver/dashboard" },
  { icon: GraduationCap, t: "Training & Certification", d: "Driver Academy courses that unlock premium categories.", href: "/driver/training" },
  { icon: Users, t: "Professional Community", d: "Local chapters, mentorship and driver recognition.", href: "/driver/benefits" },
  { icon: Headphones, t: "24/7 Support", d: "Live chat, phone and emergency response, any hour.", href: "/driver/support" },
];

export function DriverBenefitGrid() {
  return (
    <section className="container mx-auto px-4 py-16 md:py-20" aria-labelledby="why-drive-title">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Why drive with Yalla Mobility</p>
      <h2 id="why-drive-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
        A professional platform, not just an app
      </h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {BENEFITS.map((b) => (
          <Link
            key={b.t}
            to={b.href}
            onClick={() => trackDriverEvent("landing_benefit_click", { funnel_stage: "interest", metadata: { benefit: b.t } })}
            className="group rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:border-primary hover:shadow-lg"
          >
            <b.icon className="h-7 w-7 text-primary transition-transform duration-300 group-hover:scale-110" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold">{b.t}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{b.d}</p>
            <span className="mt-3 inline-flex items-center text-xs font-medium text-primary">
              Learn more about {b.t.toLowerCase()} <ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default DriverBenefitGrid;
