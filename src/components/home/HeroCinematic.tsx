/**
 * CINEMATIC MOBILITY INTERFACE — production-grade spatial booking surface.
 *
 * Hierarchy (never inverted): 1 booking · 2 message · 3 atmosphere · 4 effects.
 *
 * Adaptive rendering (see useRenderTier):
 *   full    — 3 parallax layers + pointer light field (capable desktop only)
 *   reduced — 2 layers, no pointer field (tablets / mid devices)
 *   lite    — static premium presentation (mobile, constrained, reduced-motion)
 * Booking functionality is identical in every tier.
 *
 * Service intent layer: Ride · Deliver · Rent · Lease · Charter · Corporate.
 * Selecting an intent reshapes the fields, note, CTA and destination.
 * Funnel telemetry: booking_started → service_selected → search_submitted.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Briefcase, Car, KeyRound, MapPin, Package, Plane, Radio, Wrench } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";
import { cn } from "@/lib/utils";
import { useRenderTier } from "@/hooks/useRenderTier";
import { trackBookingStep, trackBookingHandoff } from "@/lib/marketing/bookingFunnel";
import {
  fetchMobilityStatus,
  freshnessLabel,
  statusChip,
  type MobilityStatus,
} from "@/lib/marketing/mobilityStatus";
import taxidHero from "@/assets/home/taxid-network-hero.jpg";

/* Identity v5.0 — daylight Executive Mobility photography is the hero frame.
   The night cinematic loop (HeroVideoLoop) is retained in the library for
   dark surfaces but is not composited over the daylight plate. */


type ModeKey = "ride" | "deliver" | "rent" | "lease" | "charter" | "corporate";

interface Mode {
  key: ModeKey;
  tab: string;
  icon: typeof Car;
  cta: string;
  to: string;
  analytics: string;
  fields: { label: string; placeholder: string }[];
  note: string;
}

const MODES: Mode[] = [
  {
    key: "ride",
    tab: "Ride",
    icon: Car,
    cta: "Book a Ride",
    to: "/riders",
    analytics: "hero_book_ride",
    fields: [
      { label: "Pickup", placeholder: "Current location" },
      { label: "Destination", placeholder: "Where to?" },
      { label: "When", placeholder: "Now or schedule" },
    ],
    note: "City rides, airport transfers and executive travel with upfront fares.",
  },
  {
    key: "deliver",
    tab: "Deliver",
    icon: Package,
    cta: "Deliver & Ship",
    to: "/delivery",
    analytics: "hero_deliver_ship",
    fields: [
      { label: "Collect from", placeholder: "Sender address" },
      { label: "Deliver to", placeholder: "Recipient address" },
      { label: "Package", placeholder: "Parcel, pallet, freight" },
    ],
    note: "Parcels, courier, freight and dedicated truck dispatch with proof of delivery.",
  },
  {
    key: "rent",
    tab: "Rent",
    icon: KeyRound,
    cta: "Rent a Vehicle",
    to: "/rentals",
    analytics: "hero_rent_vehicle",
    fields: [
      { label: "Pick-up location", placeholder: "City or airport" },
      { label: "Start & return", placeholder: "Dates" },
      { label: "Vehicle & driver", placeholder: "Category · self-drive" },
    ],
    note: "Self-drive or chauffeured rentals, daily to monthly, insured fleets.",
  },
  {
    key: "lease",
    tab: "Lease",
    icon: Wrench,
    cta: "Lease Equipment",
    to: "/charter/heavy-machinery-leasing",
    analytics: "hero_lease_equipment",
    fields: [
      { label: "Equipment", placeholder: "Excavator, coach, hauler…" },
      { label: "Site / base", placeholder: "Where it operates" },
      { label: "Duration", placeholder: "e.g. 6 months" },
    ],
    note: "Fleet, heavy equipment, aircraft and event leasing with contract governance.",
  },
  {
    key: "charter",
    tab: "Charter",
    icon: Plane,
    cta: "Request Charter Quote",
    to: "/charter",
    analytics: "hero_charter_transport",
    fields: [
      { label: "Origin", placeholder: "Nairobi" },
      { label: "Destination", placeholder: "Maasai Mara" },
      { label: "Passengers & date", placeholder: "8 passengers · date" },
    ],
    note: "Bus, air, helicopter and marine charter with transparent per-segment pricing.",
  },
  {
    key: "corporate",
    tab: "Corporate Mobility",
    icon: Briefcase,
    cta: "Talk to Enterprise",
    to: "/corporates",
    analytics: "hero_corporate_demo",
    fields: [
      { label: "Company", placeholder: "Organisation name" },
      { label: "Programme", placeholder: "Employee transport, guests, events" },
      { label: "Monthly volume", placeholder: "e.g. 400 trips" },
    ],
    note: "Policies, budgets, approvals, invoicing and audit trails built in.",
  },
];

const SECONDARY = [
  { label: "Explore All Services", to: "/pricing" },
  { label: "Business Solutions", to: "/corporates" },
];

export function HeroCinematic() {
  const { tier, still, finePointer } = useRenderTier();
  const sectionRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<ModeKey>("ride");
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [scrolled, setScrolled] = useState(0);
  const [status, setStatus] = useState<MobilityStatus | null>(null);
  const [reading, setReading] = useState(0);
  const [focused, setFocused] = useState(false);

  const active = useMemo(() => MODES.find((m) => m.key === mode) ?? MODES[0], [mode]);

  // Funnel: hero available → booking journey open.
  useEffect(() => {
    trackBookingStep("booking_started", { serviceCategory: "hero" });
  }, []);

  // Verified mobility status — real platform supply, honestly labelled.
  useEffect(() => {
    let alive = true;
    void fetchMobilityStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Rotate readings only when motion is allowed.
  useEffect(() => {
    if (still || !status?.readings.length) return;
    const t = window.setInterval(
      () => setReading((i) => (i + 1) % status.readings.length),
      5200,
    );
    return () => window.clearInterval(t);
  }, [still, status]);

  // Controlled spatial transition on scroll (rAF, no layout reads per frame).
  useEffect(() => {
    if (still) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const h = sectionRef.current?.offsetHeight ?? window.innerHeight;
        setScrolled(Math.min(1, window.scrollY / Math.max(1, h)));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [still]);

  // Pointer light field — capable desktop only, and never over the form.
  useEffect(() => {
    if (!finePointer || focused) {
      setPointer(null);
      return;
    }
    let frame = 0;
    const el = sectionRef.current;
    const onMove = (e: PointerEvent) => {
      if (!el || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        setPointer({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
      });
    };
    const onLeave = () => setPointer(null);
    el?.addEventListener("pointermove", onMove);
    el?.addEventListener("pointerleave", onLeave);
    return () => {
      el?.removeEventListener("pointermove", onMove);
      el?.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [finePointer, focused]);

  const px = pointer ? pointer.x - 0.5 : 0;
  const py = pointer ? pointer.y - 0.5 : 0;
  const chip = statusChip(status?.status ?? "unavailable");

  const selectMode = (m: Mode) => {
    setMode(m.key);
    trackBookingStep("service_selected", { serviceCategory: m.key, vehicleCategory: m.tab });
  };

  return (
    <section
      ref={sectionRef}
      aria-label="TaxiD — book rides, deliveries, rentals, leasing, charter and corporate mobility"
      className="relative isolate flex min-h-[min(92svh,860px)] items-end overflow-hidden bg-background"
    >
      <img src={taxidHero} alt="TaxiD connects rides, coach travel and delivery at an airport" width={1600} height={1008} {...({ fetchpriority: "high" } as Record<string, string>)} className="absolute inset-0 h-full w-full object-cover object-[55%_center]" />

      {/* 2 — readability scrim only: subtle Executive Blue wash + light lift
          behind the editorial column. The photography is never darkened. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, hsl(var(--background) / 0.90), hsl(var(--background) / 0.65) 48%, hsl(var(--background) / 0.02) 78%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, hsl(var(--background) / 0.92) 0%, hsl(var(--background) / 0.20) 24%, transparent 58%)",
        }}
      />


      {/* 4 — ambient lighting (blur stacks only above the lite tier) */}
      {tier !== "lite" && (
        <>
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-[28%] top-[58%] h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl",
              tier === "full" && "cine-breathe",
            )}
            style={{ background: "radial-gradient(circle, hsl(200 100% 78% / 0.20), transparent 68%)" }}
          />
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute right-[6%] top-[18%] h-[22rem] w-[22rem] rounded-full blur-3xl",
              tier === "full" && "cine-breathe",
            )}
            style={{
              background: "radial-gradient(circle, hsl(var(--primary) / 0.20), transparent 70%)",
              animationDelay: "-6s",
            }}
          />
        </>
      )}

      {/* 5 — pointer light field */}
      {finePointer && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity duration-700"
          style={{
            opacity: pointer ? 1 : 0,
            background: pointer
              ? `radial-gradient(22rem 22rem at ${pointer.x * 100}% ${pointer.y * 100}%, hsl(var(--primary) / 0.13), transparent 70%)`
              : undefined,
          }}
        />
      )}

      {/* 6 — content */}
      <div
        className="container relative mx-auto px-4 pb-12 pt-28 md:pb-16 md:pt-32"
        style={still ? undefined : { transform: `translate3d(0, ${scrolled * -26}px, 0)`, opacity: 1 - scrolled * 0.35 }}
      >
        <div className="max-w-3xl text-foreground">
          <span className="cine-glass-day-soft inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.28em] text-primary">
            <Radio className="h-3 w-3 text-[hsl(var(--status-success))]" aria-hidden />
            Ride · Deliver · Rent · Lease · Charter
          </span>
          <h1 className={cn("mt-7 text-[2.75rem] font-semibold leading-[1.05] text-primary md:text-6xl", !still && "cine-rise")}>
            TaxiD
            <span className="block text-foreground">Move <span className="text-status-success">people.</span></span>
            <span className="block text-foreground">Power <span className="text-primary">business.</span></span>
          </h1>

          <p className={cn("mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg", !still && "cine-rise")} style={still ? undefined : { animationDelay: "160ms" }}>
            TaxiD connects individuals, businesses and organisations with trusted mobility and
            transportation providers — from everyday rides and corporate travel to charter, vehicle rental
            and leasing, delivery, freight and specialised transport.
          </p>
        </div>

        {/* Booking command panel — first in the hierarchy */}
        <div
          className={cn("cine-glass-day mt-10 max-w-3xl rounded-[28px] p-5 md:p-6", !still && "cine-rise")}
          style={
            still
              ? undefined
              : {
                  animationDelay: "260ms",
                  transform: `translate3d(${px * 8}px, ${py * 6}px, 0)`,
                  transition: "transform 900ms cubic-bezier(0.16,1,0.3,1)",
                }
          }
        >
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">What do you need today?</p>

          <div role="tablist" aria-label="What do you need today?" className="mt-3 flex flex-wrap gap-1.5">
            {MODES.map((m) => {
              const on = m.key === mode;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => selectMode(m)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
                    tier === "full" && "cine-magnetic",
                    on
                      ? "bg-primary text-primary-foreground shadow-[0_12px_30px_-14px_hsl(var(--primary)/0.65)]"
                      : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                  )}
                >
                  <m.icon className="h-4 w-4" aria-hidden />
                  {m.tab}
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.fields.map((f) => (
              <label
                key={f.label}
                className="cine-glass-day-soft block rounded-2xl px-4 py-3 transition-colors focus-within:border-primary/60"
              >
                <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <MapPin className="h-3 w-3" aria-hidden />
                  {f.label}
                </span>
                <input
                  type="text"
                  placeholder={f.placeholder}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  className="mt-1 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                />
              </label>
            ))}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">{active.note}</p>

          <div data-testid="home-hero-ctas" className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-5">
            {/* brand-allow-orange — primary conversion CTA (Book / Send / Reserve) */}
            <AppButton
              size="lg"
              className={cn("rounded-full bg-signal px-6 text-foreground hover:bg-signal/90", tier === "full" && "cine-magnetic")}
              analytics={active.analytics}
              action="navigate"
              target={active.to}
              onClick={() =>
                trackBookingHandoff(active.analytics, active.to, {
                  serviceCategory: active.key,
                  vehicleCategory: active.tab,
                })
              }
            >
              {active.cta}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </AppButton>
            <AppButton
              size="lg"
              variant="outline"
              className={cn(
                "rounded-full border-primary/25 bg-card/70 px-6 [&]:text-primary hover:bg-primary/10 hover:[&]:text-primary",
                tier === "full" && "cine-magnetic",
              )}
              analytics="hero_become_driver"
              action="navigate"
              target="/drivers"
            >
              Become a Driver
            </AppButton>
            {SECONDARY.map((s) => (
              <Link
                key={s.label}
                to={s.to}
                className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
              >
                {s.label}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            ))}
          </div>
        </div>

        {/* Verified mobility status — honestly labelled, freshness exposed */}
        <div className="mt-6 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground" aria-live="polite">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]",
              chip.tone === "live" && "border-[hsl(var(--status-success))]/40 text-[hsl(var(--status-success))]",
              chip.tone === "demo" && "border-primary/25 text-muted-foreground",
              chip.tone === "off" && "border-border text-muted-foreground",
            )}
          >
            {chip.tone === "live" && <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--status-success))]" aria-hidden />}
            {chip.text}
          </span>
          {status?.status === "live" && status.readings[reading] && (
            <>
              <span>{status.readings[reading].label}</span>
              <span className="text-muted-foreground/70">· {freshnessLabel(status.fetchedAt)}</span>
            </>
          )}
        </div>
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
        style={{ background: "linear-gradient(to top, hsl(var(--background)), transparent)" }}
      />
    </section>
  );
}

export default HeroCinematic;
