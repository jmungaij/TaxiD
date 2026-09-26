/**
 * Driver Experience Platform — recruitment-first landing page.
 *
 * Orchestration and presentation only: every section composes existing modules
 * (onboarding wizard, earnings models, AI assistant shell, success stories,
 * academy, safety, support, analytics). No new business logic is introduced.
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BadgeCheck, FileCheck, Car, ShieldCheck, Siren, Umbrella,
  GraduationCap, Scale, LifeBuoy, MessageSquare, Phone, Mail, BookOpen,
  PlayCircle, CalendarClock, Award, Star, Users, TrendingUp,
} from "lucide-react";
import { MarketingPage } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { CrossLinks } from "@/components/marketing/CrossLinks";
import { AppButton } from "@/components/nav/AppButton";
import { Counter } from "@/components/marketing/Counter";
import { SuccessStories } from "@/components/marketing/SuccessStories";
import OnboardingWizard from "@/components/driver/OnboardingWizard";
import { DriverLandingHero } from "@/components/driver/landing/DriverLandingHero";
import { DriverDashboardPreview } from "@/components/driver/landing/DriverDashboardPreview";
import { DriverBenefitGrid } from "@/components/driver/landing/DriverBenefitGrid";
import { DriverEarningScenarios } from "@/components/driver/landing/DriverEarningScenarios";
import { DriverNetworkCategories } from "@/components/driver/landing/DriverNetworkCategories";
import { DriverApplicationTimeline } from "@/components/driver/landing/DriverApplicationTimeline";
import { DriverLiveApplicationStatus } from "@/components/driver/landing/DriverLiveApplicationStatus";
import { DriverAssistantSection } from "@/components/driver/landing/DriverAssistantSection";
import { DriverStickyCta } from "@/components/driver/landing/DriverStickyCta";
import { useDriverApplicationStatus } from "@/hooks/useDriverApplicationStatus";
import { trackDriverEvent } from "@/lib/driverAnalytics";
import OnboardingWelcome from "@/components/marketing/OnboardingWelcome";

const TRUST = [
  { icon: BadgeCheck, t: "Verified Drivers", d: "Every driver on the network is identity-verified." },
  { icon: FileCheck, t: "Document Verification", d: "Licences, insurance and permits validated and monitored." },
  { icon: Car, t: "Vehicle Inspection", d: "Roadworthiness checks before activation and on renewal." },
  { icon: ShieldCheck, t: "Background Checks", d: "Screening completed before any passenger trip." },
  { icon: Siren, t: "Emergency Support", d: "In-trip SOS routed to our 24/7 operations team." },
  { icon: Umbrella, t: "Insurance", d: "Cover in place for every booked assignment." },
  { icon: GraduationCap, t: "Training", d: "Safety and service modules required for activation." },
  { icon: Scale, t: "Code of Conduct", d: "Clear professional standards, fairly enforced." },
];

const TRAINING = [
  { icon: TrendingUp, t: "Training Progress", d: "Track completion across every required module.", href: "/driver/training" },
  { icon: CalendarClock, t: "Upcoming Sessions", d: "Live classes and partner-centre workshops.", href: "/driver/training" },
  { icon: Award, t: "Completed Certifications", d: "Credentials that unlock premium categories.", href: "/driver/training" },
  { icon: GraduationCap, t: "Driver Academy", d: "Structured courses from safety to business skills.", href: "/driver/training" },
  { icon: BookOpen, t: "Knowledge Base", d: "Platform rules, payouts and compliance guides.", href: "/driver/support" },
  { icon: PlayCircle, t: "Video Tutorials", d: "Short walkthroughs of every driver tool.", href: "/driver/training" },
];

const SUPPORT = [
  { icon: MessageSquare, t: "Live Chat", d: "Fast answers inside the driver app.", href: "/driver/support" },
  { icon: LifeBuoy, t: "AI Assistant", d: "Self-service answers, any time.", href: "#driver-assistant-title" },
  { icon: Phone, t: "Phone Support", d: "Talk to a driver specialist.", href: "/driver/support" },
  { icon: Mail, t: "Email", d: "Documented follow-up on any case.", href: "/contact" },
  { icon: BookOpen, t: "Knowledge Centre", d: "Guides, policies and payout rules.", href: "/driver/support" },
  { icon: Siren, t: "Emergency Support", d: "Priority escalation while on trip.", href: "/driver/safety" },
];

export default function DriverExperienceLanding() {
  const status = useDriverApplicationStatus();
  const resumeAvailable = status.status === "DRAFT" || status.hasLocalDraft;

  useEffect(() => {
    trackDriverEvent("onboarding_page_view", { funnel_stage: "recruitment_landing" });
  }, []);

  return (
    <MarketingPage>
      <SeoHead
        path="/driver/onboarding"
        title="Drive with Yalla Mobility — Driver Application"
        description="Join Yalla Mobility's professional driver network: corporate travel, airport transfers, executive mobility, charter and logistics. Apply in minutes, approval within 24 hours."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "JobPosting",
          title: "Professional Driver — Yalla Mobility",
          description: "Drive for corporate travel, airport transfers, executive mobility, charter operations and logistics across East Africa.",
          employmentType: "CONTRACTOR",
          hiringOrganization: { "@type": "Organization", name: "Yalla Mobility" },
          jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "KE" } },
        }}
      />

      <DriverLandingHero resumeAvailable={resumeAvailable} />
      <DriverDashboardPreview />
      <DriverBenefitGrid />
      <DriverEarningScenarios />
      <DriverNetworkCategories />

      {/* ---------- APPLICATION JOURNEY ---------- */}
      <section id="application-journey" className="scroll-mt-24 bg-secondary/30 py-16 md:py-20" aria-labelledby="application-journey-title">
        <div className="container mx-auto px-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Application journey</p>
          <h2 id="application-journey-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            Seven guided steps, one saved application
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Work through it in one sitting or across a few days — your progress is saved on this device and to your
            account.
          </p>

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <DriverApplicationTimeline status={status} />
            </div>
            <div className="space-y-4">
              <OnboardingWelcome />
              <div className="rounded-3xl border border-border bg-card p-4 shadow-sm md:p-6">
                <OnboardingWizard />
              </div>
            </div>
          </div>
        </div>
      </section>

      <DriverLiveApplicationStatus status={status} />

      {/* ---------- TRUST & SAFETY ---------- */}
      <section className="container mx-auto px-4 py-16 md:py-20" aria-labelledby="trust-title">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Trust and safety</p>
        <h2 id="trust-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
          A network passengers and businesses trust
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((t) => (
            <div key={t.t} className="rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-md">
              <t.icon className="h-6 w-6 text-primary" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-semibold">{t.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <AppButton variant="outline" analytics="driver_landing_safety_centre" action="navigate" target="/driver/safety">
            Visit the Safety Centre <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </AppButton>
        </div>
      </section>

      <DriverAssistantSection status={status} />

      {/* ---------- COMMUNITY ---------- */}
      <section className="bg-secondary/30 py-16 md:py-20" aria-labelledby="community-title">
        <div className="container mx-auto px-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Driver community</p>
          <h2 id="community-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            Drivers building real businesses
          </h2>
          <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { icon: Users, v: <Counter to={12400} suffix="+" />, l: "Drivers in the network" },
              { icon: Car, v: <Counter to={1850000} suffix="+" />, l: "Trips completed" },
              { icon: Star, v: "4.91 ★", l: "Average driver rating" },
              { icon: Award, v: <Counter to={6} suffix="+" />, l: "Average years driving" },
            ].map((s, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-5">
                <s.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <div className="mt-3 text-2xl font-bold tracking-tight">{s.v}</div>
                <div className="text-xs text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <SuccessStories />
          </div>
          <ul className="mt-6 flex flex-wrap gap-2">
            {["Corporate Drivers", "Top Earners", "Fleet Partners", "Airport Specialists"].map((g) => (
              <li key={g} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">{g}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- TRAINING ---------- */}
      <section className="container mx-auto px-4 py-16 md:py-20" aria-labelledby="training-title">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Training</p>
        <h2 id="training-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
          Learn once, earn in more categories
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRAINING.map((t) => (
            <Link key={t.t} to={t.href} className="group rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-md">
              <t.icon className="h-6 w-6 text-primary" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-semibold">{t.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t.d}</p>
              <span className="mt-3 inline-flex items-center text-xs font-medium text-primary">
                Open <ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- SUPPORT ---------- */}
      <section className="bg-secondary/30 py-16 md:py-20" aria-labelledby="support-title">
        <div className="container mx-auto px-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Support</p>
          <h2 id="support-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            Help on every channel, around the clock
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SUPPORT.map((s) => (
              s.href.startsWith("#") ? (
                <a key={s.t} href={s.href} className="rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-md">
                  <s.icon className="h-6 w-6 text-primary" aria-hidden="true" />
                  <h3 className="mt-3 text-sm font-semibold">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
                </a>
              ) : (
                <Link key={s.t} to={s.href} className="rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-md">
                  <s.icon className="h-6 w-6 text-primary" aria-hidden="true" />
                  <h3 className="mt-3 text-sm font-semibold">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
                </Link>
              )
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FINAL CTA ---------- */}
      <section className="relative overflow-hidden bg-primary py-20 text-primary-foreground">
        <div className="container relative mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Ready to Start Driving?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-primary-foreground/90">
            Complete your application today and become part of Africa's trusted professional mobility network.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <AppButton
              size="lg"
              className="bg-ice text-primary hover:bg-ice/90"
              analytics="driver_landing_final_apply"
              action="scroll"
              target="#application-journey"
            >
              Complete Application <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </AppButton>
            <AppButton
              size="lg"
              variant="outline"
              className="border-ice/70 bg-transparent text-primary-foreground hover:bg-ice/20"
              analytics="driver_landing_final_resume"
              action="scroll"
              target="#application-journey"
            >
              Resume Application
            </AppButton>
          </div>
        </div>
      </section>

      <div className="pb-20 md:pb-0">
        <CrossLinks keys={["riders", "corporates", "delivery", "rentals", "careers", "support"]} />
      </div>

      <DriverStickyCta resumeAvailable={resumeAvailable} />
    </MarketingPage>
  );
}
