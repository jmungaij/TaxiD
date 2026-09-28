/**
 * CINEMATIC MOBILITY HERO — RIDER EXPERIENCE PLATFORM
 *
 * Presentation-only. Reuses the existing cinematic design tokens/utilities
 * (`cine-glass`, `cine-rise`, `cine-drift`, `--signal`) and routes every action
 * into the existing booking surfaces (/rider, /rider/airport, /charter, …).
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Car, Plane, Bus, KeyRound, Package, MapPin, Radio,
  ShieldCheck, CreditCard, Navigation, Building2, BadgeCheck,
} from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";
import { cn } from "@/lib/utils";
import riderDaylight from "@/assets/rider/taxid-rider-daylight.jpg";

type ModeKey = "ride" | "airport" | "charter" | "rental" | "send";

const MODES: {
  key: ModeKey;
  tab: string;
  icon: typeof Car;
  cta: string;
  to: string;
  analytics: string;
  fields: { label: string; placeholder: string }[];
  note: string;
}[] = [
  {
    key: "ride", tab: "Ride", icon: Car, cta: "Book a Ride", to: "/rider",
    analytics: "rider_hero_book_ride",
    fields: [
      { label: "Pickup", placeholder: "Current location" },
      { label: "Destination", placeholder: "Where to?" },
    ],
    note: "City rides, executive travel and scheduled trips — upfront fares.",
  },
  {
    key: "airport", tab: "Airport", icon: Plane, cta: "Book Airport Transfer", to: "/rider/airport",
    analytics: "rider_hero_airport",
    fields: [
      { label: "Airport", placeholder: "JKIA · NBO" },
      { label: "Flight number", placeholder: "e.g. KQ 100" },
    ],
    note: "Flight tracking, meet & greet and flat airport fares.",
  },
  {
    key: "charter", tab: "Charter", icon: Bus, cta: "Search Charter Fleet", to: "/charter",
    analytics: "rider_hero_charter",
    fields: [
      { label: "Route", placeholder: "Nairobi → Maasai Mara" },
      { label: "Party size", placeholder: "e.g. 32 passengers" },
    ],
    note: "Bus, coach, van, air, helicopter and marine charter in one search.",
  },
  {
    key: "rental", tab: "Rental", icon: KeyRound, cta: "Browse Rentals", to: "/rentals",
    analytics: "rider_hero_rental",
    fields: [
      { label: "Vehicle", placeholder: "SUV, luxury sedan, hauler…" },
      { label: "Duration", placeholder: "e.g. 5 days" },
    ],
    note: "Self-drive, chauffeur-driven, equipment and event rentals.",
  },
  {
    key: "send", tab: "Send", icon: Package, cta: "Send a Package", to: "/delivery",
    analytics: "rider_hero_send",
    fields: [
      { label: "Collect from", placeholder: "Sender address" },
      { label: "Deliver to", placeholder: "Recipient address" },
    ],
    note: "Same-day parcels, courier, freight and tracked logistics.",
  },
];

const TRUST = [
  { icon: BadgeCheck, label: "Verified Operators" },
  { icon: Radio, label: "Live Availability" },
  { icon: CreditCard, label: "Secure Payments" },
  { icon: Navigation, label: "Real-Time Tracking" },
  { icon: Building2, label: "Corporate Ready" },
];

const LIVE = [
  "Executive sedan 3 min away · Westlands",
  "Airport transfers running on schedule · JKIA",
  "48-seat coach available this weekend · Nakuru route",
  "Same-day courier capacity open · Nairobi CBD",
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

export function RiderHero() {
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<ModeKey>("ride");
  const [live, setLive] = useState(0);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [scrolled, setScrolled] = useState(0);

  const active = MODES.find((m) => m.key === mode) ?? MODES[0];

  useEffect(() => {
    if (reduced) return;
    const t = window.setInterval(() => setLive((i) => (i + 1) % LIVE.length), 4200);
    return () => window.clearInterval(t);
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
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
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const el = sectionRef.current;
      if (!el || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        setPointer({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
      });
    };
    const onLeave = () => setPointer(null);
    const el = sectionRef.current;
    el?.addEventListener("pointermove", onMove);
    el?.addEventListener("pointerleave", onLeave);
    return () => {
      el?.removeEventListener("pointermove", onMove);
      el?.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [reduced]);

  const px = pointer ? pointer.x - 0.5 : 0;
  const py = pointer ? pointer.y - 0.5 : 0;

  return (
    <section
      ref={sectionRef}
      aria-label="Book rides, airport transfers, charter, rentals and delivery"
      className="relative isolate flex min-h-[min(92svh,860px)] items-end overflow-hidden bg-[hsl(var(--cine-night))]"
    >
      <img
        src={riderDaylight}
        alt="TaxiD rider welcomed by a professional driver beside a car in Nairobi"
        width={1600}
        height={1008}
        loading="eager"
        decoding="sync"
        className={cn("absolute inset-0 h-full w-full object-cover", !reduced && "cine-drift")}
        style={{
          transform: `translate3d(${px * -26}px, ${py * -16 - scrolled * 80}px, 0) scale(1.08)`,
          transition: "transform 1.1s cubic-bezier(0.16,1,0.3,1)",
          willChange: "transform",
        }}
      />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, hsl(var(--cine-night) / 0.97) 0%, hsl(var(--cine-night) / 0.74) 36%, hsl(var(--cine-night) / 0.26) 64%, hsl(var(--cine-night) / 0.6) 100%)",
        }}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-[26%] top-[62%] h-[24rem] w-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl",
          !reduced && "cine-breathe",
        )}
        style={{ background: "radial-gradient(circle, hsl(200 100% 78% / 0.18), transparent 68%)" }}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-[8%] top-[20%] h-[20rem] w-[20rem] rounded-full blur-3xl",
          !reduced && "cine-breathe",
        )}
        style={{
          background: "radial-gradient(circle, hsl(var(--primary) / 0.18), transparent 70%)",
          animationDelay: "-6s",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-700"
        style={{
          opacity: pointer ? 1 : 0,
          background: pointer
            ? `radial-gradient(20rem 20rem at ${pointer.x * 100}% ${pointer.y * 100}%, hsl(var(--primary) / 0.12), transparent 70%)`
            : undefined,
        }}
      />

      <div
        className="container relative mx-auto px-4 pb-14 pt-32 md:pb-20 md:pt-40"
        style={{ transform: reduced ? undefined : `translate3d(0, ${scrolled * -24}px, 0)` }}
      >
        <div className="max-w-3xl text-ice">
          <span className="cine-glass-soft inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.28em] text-ice/80">
            <Radio className="h-3 w-3 text-[hsl(var(--status-success))]" aria-hidden />
            Riders · Families · Business
          </span>
          <h1 className="cine-rise mt-7 text-[2.6rem] font-semibold leading-[0.98] tracking-[-0.03em] md:text-6xl">
            One Platform. Every Journey.
            <span className="block text-ice/60">Every Destination.</span>
          </h1>
          <p className="cine-rise mt-6 max-w-2xl text-base leading-relaxed text-ice/70 md:text-lg" style={{ animationDelay: "160ms" }}>
            Book rides, airport transfers, executive travel, charter services, vehicle rentals,
            logistics and corporate mobility from one trusted marketplace.
          </p>
        </div>

        {/* Glass command panel — progressive booking, existing engines */}
        <div
          className="cine-glass cine-rise mt-9 max-w-3xl rounded-[28px] p-5 md:p-6"
          style={{
            animationDelay: "260ms",
            transform: reduced ? undefined : `translate3d(${px * 8}px, ${py * 6}px, 0)`,
            transition: "transform 900ms cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <div role="tablist" aria-label="What would you like to book?" className="flex flex-wrap gap-1.5">
            {MODES.map((m) => {
              const on = m.key === mode;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  data-testid={`rider-hero-mode-${m.key}`}
                  onClick={() => setMode(m.key)}
                  className={cn(
                    "cine-magnetic inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
                    on
                      ? "bg-ice text-[hsl(var(--cine-night))] shadow-[0_10px_30px_-12px_hsl(0_0%_100%/0.5)]"
                      : "text-ice/70 hover:bg-ice/10 hover:text-ice",
                  )}
                >
                  <m.icon className="h-4 w-4" aria-hidden />
                  {m.tab}
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {active.fields.map((f) => (
              <label key={f.label} className="cine-glass-soft block rounded-2xl px-4 py-3 transition-colors focus-within:border-ice/60">
                <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-ice/50">
                  <MapPin className="h-3 w-3" aria-hidden />
                  {f.label}
                </span>
                <input
                  type="text"
                  placeholder={f.placeholder}
                  className="mt-1 w-full bg-transparent text-sm text-ice outline-none placeholder:text-ice/40"
                />
              </label>
            ))}
          </div>

          <p className="mt-3 text-xs text-ice/50">{active.note}</p>

          <div data-testid="rider-hero-ctas" className="mt-5 flex flex-wrap items-center gap-3 border-t border-ice/10 pt-5">
            {/* brand-allow-orange — primary conversion CTA (Book Now) */}
            <AppButton
              size="lg"
              className="cine-magnetic rounded-full bg-signal px-6 text-ice hover:bg-signal/90"
              analytics={active.analytics}
              action="navigate"
              target={active.to}
            >
              Book Now
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </AppButton>
            <Link
              to="#marketplace"
              className="cine-magnetic inline-flex items-center gap-2 rounded-full border border-ice/25 bg-ice/5 px-6 py-2.5 text-sm font-medium text-ice hover:bg-ice/15"
            >
              Explore Services
            </Link>
            <span className="inline-flex items-center gap-2 text-xs text-ice/55">
              <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {LIVE[live]}
            </span>
          </div>
        </div>

        <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3" aria-label="Trust indicators">
          {TRUST.map((t) => (
            <li key={t.label} className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-ice/60">
              <t.icon className="h-3.5 w-3.5 text-[hsl(var(--status-success))]" aria-hidden />
              {t.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default RiderHero;
