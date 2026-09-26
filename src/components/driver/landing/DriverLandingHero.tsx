/**
 * DriverLandingHero — cinematic recruitment hero for the Driver Experience
 * Platform. Presentation only: rotating photography already in the asset
 * library, brand gradient tokens, and glass surfaces from the design system.
 */
import { useEffect, useState } from "react";
import { ArrowRight, Clock, Headphones, ShieldCheck, Wallet } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";

import driversImg from "@/assets/drivers.jpg";
import corporatesImg from "@/assets/corporates.jpg";
import executiveImg from "@/assets/vehicles/yalla-executive.jpg";
import shuttleImg from "@/assets/vehicles/executive-shuttle.jpg";

const SLIDES = [
  { src: driversImg, alt: "Professional SAFARID driver beside a saloon vehicle" },
  { src: corporatesImg, alt: "Corporate passengers boarding an executive transfer" },
  { src: executiveImg, alt: "Executive class vehicle ready for a premium ride" },
  { src: shuttleImg, alt: "Executive shuttle on a staff transport assignment" },
];

const FACTS = [
  { icon: Clock, label: "Application review", value: "Within 24 hours" },
  { icon: Wallet, label: "Wallet activation", value: "Instant on approval" },
  { icon: ShieldCheck, label: "Onboarding completion", value: "Avg. 12 minutes" },
  { icon: Headphones, label: "Driver support", value: "24/7, all week" },
];

export function DriverLandingHero({ resumeAvailable }: { resumeAvailable?: boolean }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), 7000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section className="relative isolate overflow-hidden">
      {SLIDES.map((s, i) => (
        <img
          key={s.src}
          src={s.src}
          alt={i === idx ? s.alt : ""}
          aria-hidden={i !== idx}
          width={1600}
          height={900}
          loading={i === 0 ? "eager" : "lazy"}
          decoding={i === 0 ? "sync" : "async"}
          className={`absolute inset-0 h-full w-full object-cover ${i === idx ? "opacity-100 scale-105" : "opacity-0"}`}
          style={{ transition: "opacity 1.8s ease-in-out, transform 12s ease-out" }}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-r from-primary/95 via-primary/80 to-primary/35" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background/90 to-transparent" aria-hidden />

      <div className="container relative mx-auto px-4 py-20 md:py-28">
        <div className="max-w-3xl text-primary-foreground">
          <span className="inline-flex items-center gap-2 rounded-full border border-ice/25 bg-ice/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] backdrop-blur-md">
            Driver Experience Platform
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            Drive Your Business Forward with SAFARID
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-primary-foreground/90 md:text-xl">
            Join a trusted network serving corporate travel, airport transfers, executive mobility,
            charter operations, rentals, logistics and everyday transportation across East Africa.
          </p>
        </div>

        <div className="mt-10 max-w-4xl rounded-3xl border border-ice/20 bg-ice/10 p-5 shadow-[var(--shadow-elegant)] backdrop-blur-xl md:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-foreground/70">
            {resumeAvailable ? "You have a saved application" : "Start your driver application"}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <AppButton
              size="lg"
              className="bg-ice text-primary hover:bg-ice/90"
              analytics="driver_landing_complete_application"
              action="scroll"
              target="#application-journey"
            >
              {resumeAvailable ? "Resume Application" : "Complete Application"}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </AppButton>
            <AppButton
              size="lg"
              variant="outline"
              className="border-ice/40 bg-transparent text-primary-foreground hover:bg-ice/10"
              analytics="driver_landing_view_benefits"
              action="navigate"
              target="/driver/benefits"
            >
              View Driver Benefits
            </AppButton>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-ice/20 pt-5 md:grid-cols-4">
            {FACTS.map((f) => (
              <div key={f.label} className="flex items-start gap-2.5">
                <f.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-foreground/80" aria-hidden="true" />
                <div>
                  <dt className="text-xs text-primary-foreground/70">{f.label}</dt>
                  <dd className="text-sm font-semibold text-primary-foreground">{f.value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

export default DriverLandingHero;
