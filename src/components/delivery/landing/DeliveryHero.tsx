/**
 * DELIVERY & LOGISTICS — CINEMATIC HERO
 *
 * Presentation only. Reuses the existing cinematic design tokens
 * (`cine-glass`, `cine-drift`, `cine-breathe`, `--cine-night`, `--signal`),
 * the governed `AppButton` CTA wrapper and the existing booking funnel
 * telemetry. The glass widget is an intent capture surface that hands off to
 * the existing booking surfaces — it never creates a second booking engine and
 * never exposes dispatch, warehouse or operational settings.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, Package, FileText, Truck, Building2, Bike,
  ShieldCheck, Navigation, BadgeCheck, CreditCard, Radio, Loader2,
} from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";
import { cn } from "@/lib/utils";
import { trackBookingStep, trackBookingHandoff } from "@/lib/marketing/bookingFunnel";
import { buildHandoffUrl, validateHero, type HeroIntent } from "@/lib/logistics/heroHandoff";
import taxiDDeliveryScene from "@/assets/delivery/taxid-delivery-scene.jpg";

type Field = { id: string; label: string; placeholder: string; type?: string; options?: string[] };

export type SendIntent = "parcel" | "documents" | "express" | "freight" | "truck" | "business";

interface IntentDef {
  key: SendIntent;
  tab: string;
  icon: typeof Package;
  cta: string;
  to: string;
  note: string;
  /** Only the fields that matter for this intent are ever rendered. */
  fields: Field[];
}

const SPEEDS = ["Express (≤ 60 min)", "Same day", "Next day", "Scheduled"];

export const SEND_INTENTS: IntentDef[] = [
  {
    key: "parcel", tab: "Parcel", icon: Package, cta: "Book Delivery", to: "/delivery/book?offering=PARCEL_STANDARD",
    note: "Same-day and scheduled parcels with live tracking and digital proof of delivery.",
    fields: [
      { id: "pickup", label: "Pickup", placeholder: "Sender address or landmark" },
      { id: "dropoff", label: "Delivery address", placeholder: "Recipient address" },
      { id: "parcelType", label: "Parcel type", placeholder: "Select", options: ["Small parcel", "Box", "Electronics", "Fragile", "Perishable"] },
      { id: "weight", label: "Weight", placeholder: "e.g. 4 kg" },
      { id: "speed", label: "Delivery speed", placeholder: "Select", options: SPEEDS },
    ],
  },
  {
    key: "documents", tab: "Documents", icon: FileText, cta: "Send Documents", to: "/delivery/book?offering=COURIER_DOCUMENT",
    note: "Legal, medical and confidential documents, hand-delivered with recipient confirmation.",
    fields: [
      { id: "pickup", label: "Pickup", placeholder: "Collect from" },
      { id: "dropoff", label: "Delivery address", placeholder: "Deliver to" },
      { id: "docType", label: "Document type", placeholder: "Select", options: ["Legal", "Medical", "Financial", "Government", "General"] },
      { id: "speed", label: "Delivery speed", placeholder: "Select", options: SPEEDS.slice(0, 3) },
    ],
  },
  {
    key: "express", tab: "Express", icon: Bike, cta: "Book Express Courier", to: "/delivery/book?offering=EXPRESS_CITY",
    note: "City pickups on bikes and compact vehicles, targeting 60 minutes, by identity-checked couriers.",
    fields: [
      { id: "pickup", label: "Pickup", placeholder: "Where should we collect?" },
      { id: "dropoff", label: "Delivery address", placeholder: "Where is it going?" },
      { id: "weight", label: "Weight", placeholder: "e.g. 2 kg" },
    ],
  },
  {
    // Freight is quoted by a specialist, so the CTA opens the enquiry desk —
    // never a booking flow that cannot price it.
    key: "freight", tab: "Freight", icon: Truck, cta: "Request Freight Quote", to: "/delivery/enquiry?topic=freight",
    note: "Palletised and bulk cargo across Kenya and the region, priced per route and load by our freight desk.",
    fields: [
      { id: "origin", label: "Origin", placeholder: "e.g. Mombasa port" },
      { id: "destination", label: "Destination", placeholder: "e.g. Nairobi ICD" },
      { id: "cargo", label: "Cargo type", placeholder: "Select", options: ["General cargo", "Palletised", "Containerised", "Cold chain", "Hazardous"] },
      { id: "tonnage", label: "Tonnage", placeholder: "e.g. 8 tonnes" },
    ],
  },
  {
    key: "truck", tab: "Truck dispatch", icon: Truck, cta: "Request a Truck", to: "/delivery/enquiry?topic=truck",
    note: "On-demand and contracted trucks, from 3-tonne to container haulers, confirmed against live capacity.",
    fields: [
      { id: "origin", label: "Loading point", placeholder: "Where do we load?" },
      { id: "destination", label: "Offloading point", placeholder: "Where do we offload?" },
      { id: "vehicle", label: "Vehicle class", placeholder: "Select", options: ["3-tonne", "5-tonne", "10-tonne", "Refrigerated", "Container hauler"] },
      { id: "date", label: "Pickup date", placeholder: "Select date", type: "date" },
    ],
  },
  {
    key: "business", tab: "Business", icon: Building2, cta: "Open Business Logistics", to: "/corporates",
    note: "Retail fulfilment, recurring routes, corporate billing and department reporting.",
    fields: [
      { id: "company", label: "Company", placeholder: "Registered business name" },
      { id: "volume", label: "Monthly volume", placeholder: "e.g. 1,200 shipments" },
      { id: "service", label: "Requirement", placeholder: "Select", options: ["Retail fulfilment", "Warehousing", "Regional distribution", "Dedicated fleet", "Scheduled pickups"] },
    ],
  },
];

// Governed by src/lib/logistics/claimsGovernance.ts (CLM-COU-001, CLM-TRK-001, CLM-INS-002).
const TRUST = [
  { icon: BadgeCheck, label: "Identity-checked couriers" },
  { icon: Navigation, label: "GPS tracking with freshness" },
  { icon: ShieldCheck, label: "Accountable handling" },
  { icon: CreditCard, label: "Price agreed up front" },
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

export interface DeliveryHeroProps {
  /** Eyebrow label above the headline. */
  eyebrow?: string;
  /** Headline node — defaults to the marketplace headline. */
  headline?: React.ReactNode;
  /** Supporting lead paragraph. */
  lead?: string;
  /** Restrict the glass widget to a subset of send intents (module pages). */
  intents?: SendIntent[];
  /** Telemetry scope so module heroes are distinguishable in the funnel. */
  scope?: string;
}

export function DeliveryHero({
  eyebrow = "TaxiD Delivery",
  headline,
  lead = "Send parcels and documents, arrange a courier or request freight. Choose the right service, tell us where it needs to go, and follow the journey.",
  intents,
  scope = "delivery_hero",
}: DeliveryHeroProps = {}) {
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLElement | null>(null);
  const tabs = useMemo(
    () =>
      intents?.length
        ? (intents.map((k) => SEND_INTENTS.find((i) => i.key === k)).filter(Boolean) as IntentDef[])
        : SEND_INTENTS,
    [intents],
  );
  const [intent, setIntent] = useState<SendIntent>(tabs[0]?.key ?? "parcel");
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const active = useMemo(() => tabs.find((i) => i.key === intent) ?? tabs[0], [intent, tabs]);

  useEffect(() => {
    trackBookingStep("booking_started", { serviceCategory: "delivery" });
  }, []);

  const selectIntent = (key: SendIntent) => {
    if (key === intent) return;
    setIntent(key);
    // Carry over facts that mean the same thing across services so switching
    // tabs never silently destroys what the customer already typed.
    setValues((prev) => {
      const carried: Record<string, string> = {};
      const pickup = prev.pickup || prev.origin;
      const dropoff = prev.dropoff || prev.destination;
      const next = SEND_INTENTS.find((i) => i.key === key);
      next?.fields.forEach((f) => {
        if ((f.id === "pickup" || f.id === "origin") && pickup) carried[f.id] = pickup;
        if ((f.id === "dropoff" || f.id === "destination") && dropoff) carried[f.id] = dropoff;
        if (f.id === "weight" && prev.weight) carried.weight = prev.weight;
      });
      return carried;
    });
    setErrors({});
    setSubmitting(false);
    trackBookingStep("service_selected", { serviceCategory: `delivery_${key}` });
  };

  const submit = () => {
    if (submitting) return; // duplicate-submit protection
    const { ok, errors: found } = validateHero(active.key as HeroIntent, values);
    setErrors(found);
    if (!ok) {
      const first = Object.keys(found)[0];
      document.getElementById(`send-${active.key}-${first}`)?.focus();
      return;
    }

    setSubmitting(true);
    trackBookingStep("search_submitted", {
      serviceCategory: `delivery_${active.key}`,
      origin: values.pickup ?? values.origin,
      destination: values.dropoff ?? values.destination,
    });
    const url = buildHandoffUrl(active.key as HeroIntent, active.to, values);
    trackBookingHandoff(`${scope}_${active.key}`, url, {
      serviceCategory: `delivery_${active.key}`,
    });
    navigate(url);
  };

  return (
    <section
      ref={sectionRef}
      aria-label="Send parcels, documents, freight and business shipments"
      className="relative isolate overflow-hidden bg-[hsl(var(--cine-night))]"
    >
      <picture>
        <img
          src={taxiDDeliveryScene}
          alt="A courier motorbike and delivery van on the road in Nairobi"
          width={1600}
          height={1008}
          loading="eager"
          decoding="sync"
          fetchPriority="high"
          className={cn("absolute inset-0 h-full w-full object-cover", !reduced && "cine-drift")}
        />
      </picture>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, hsl(var(--cine-night) / 0.97) 0%, hsl(var(--cine-night) / 0.8) 38%, hsl(var(--cine-night) / 0.34) 68%, hsl(var(--cine-night) / 0.62) 100%)",
        }}
      />
      <div className="container relative mx-auto grid gap-10 px-4 pb-16 pt-24 md:pt-28 lg:grid-cols-[1.05fr_minmax(0,30rem)] lg:items-end lg:pb-20">
        {/* Editorial column */}
        <div className={cn("text-ice", !reduced && "cine-rise")}>
          <span className="inline-flex items-center gap-2 rounded-full border border-ice/20 bg-ice/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] backdrop-blur-sm">
            <Radio className="h-3.5 w-3.5" aria-hidden /> {eyebrow}
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            {headline ?? (
              <>
                 TaxiD Delivery.
                 <span className="block text-ice/70">Send with confidence.</span>
              </>
            )}
          </h1>
          <p className="mt-4 max-w-xl text-base text-ice/80 md:text-lg">{lead}</p>

          <div className="mt-7 flex flex-wrap gap-3">
            <AppButton
              analytics="delivery_hero_send_now"
              action="scroll"
              size="lg"
              onClick={() => document.getElementById("send")?.scrollIntoView({ behavior: "smooth" })}
            >
              Send Now <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
            </AppButton>
            <AppButton
              analytics="delivery_hero_business"
              action="navigate"
              target="/corporates"
              variant="outline"
              size="lg"
              className="border-ice/70 bg-ice/10 text-ice hover:bg-ice/20"
            >
              Business Logistics
            </AppButton>
          </div>

          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            {TRUST.map((t) => (
              <li key={t.label} className="flex items-center gap-2 text-xs text-ice/75">
                <t.icon className="h-4 w-4 text-[hsl(var(--status-success))]" aria-hidden /> {t.label}
              </li>
            ))}
          </ul>

          <p aria-live="polite" className="mt-6 flex items-center gap-2 text-xs text-ice/65">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--status-success))]" aria-hidden />
             Availability is confirmed before a shipment is booked.
          </p>
        </div>

        {/* Glass booking widget */}
        <div id="send" className={cn("cine-glass rounded-3xl border border-ice/15 p-5 shadow-2xl backdrop-blur-xl", !reduced && "cine-rise")}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ice">What are you sending?</h2>
            <Link to="/track" className="text-[11px] font-semibold text-ice/70 underline-offset-2 hover:underline">
              Track a shipment
            </Link>
          </div>

          <div role="tablist" aria-label="Delivery service" className="mt-3 flex flex-wrap gap-1.5">
            {tabs.map((i) => (
              <button
                key={i.key}
                type="button"
                role="tab"
                aria-selected={i.key === intent}
                onClick={() => selectIntent(i.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ice/60",
                  i.key === intent
                    ? "bg-ice text-[hsl(var(--cine-night))]"
                    : "bg-ice/10 text-ice/80 hover:bg-ice/20",
                )}
              >
                <i.icon className="h-3.5 w-3.5" aria-hidden /> {i.tab}
              </button>
            ))}
          </div>

          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {active.fields.map((f) => {
              const id = `send-${active.key}-${f.id}`;
              const err = errors[f.id];
              const errId = `${id}-error`;
              const onChange = (value: string) => {
                setValues((v) => ({ ...v, [f.id]: value }));
                setErrors((e) => {
                  if (!e[f.id]) return e;
                  const { [f.id]: _drop, ...rest } = e;
                  return rest;
                });
              };
              return (
                <div key={f.id}>
                  <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wider text-ice/60">
                    {f.label}
                  </label>
                  {f.options ? (
                    <select
                      id={id}
                      value={values[f.id] ?? ""}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                      onChange={(e) => onChange(e.target.value)}
                      className={cn(
                        "mt-1 h-11 w-full rounded-xl border bg-ice/10 px-3 text-sm text-ice outline-none focus-visible:ring-2 focus-visible:ring-ice/60",
                        err ? "border-[hsl(var(--destructive))]" : "border-ice/20",
                      )}
                    >
                      <option value="" className="text-foreground">{f.placeholder}</option>
                      {f.options.map((o) => (
                        <option key={o} value={o} className="text-foreground">
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      type={f.type ?? "text"}
                      value={values[f.id] ?? ""}
                      placeholder={f.placeholder}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                      onChange={(e) => onChange(e.target.value)}
                      className={cn(
                        "mt-1 h-11 w-full rounded-xl border bg-ice/10 px-3 text-sm text-ice placeholder:text-ice/45 outline-none focus-visible:ring-2 focus-visible:ring-ice/60",
                        err ? "border-[hsl(var(--destructive))]" : "border-ice/20",
                      )}
                    />
                  )}
                  {err && (
                    <p id={errId} className="mt-1 text-[11px] font-medium text-[hsl(var(--destructive))]">
                      {err}
                    </p>
                  )}
                </div>
              );
            })}

            {Object.keys(errors).length > 0 && (
              <p role="alert" className="text-[11px] font-semibold text-[hsl(var(--destructive))]">
                Complete the highlighted fields to continue.
              </p>
            )}

            {/* brand-allow-orange — primary conversion CTA (Send / Get quote) */}
            <button
              type="submit"
              data-testid="hero-submit"
              aria-busy={submitting}
              disabled={submitting}
              className="mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--signal))] text-sm font-semibold text-[hsl(var(--signal-foreground))] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ice/70 disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Preparing your request…
                </>
              ) : (
                <>
                  {active.cta} <ArrowRight className="h-4 w-4" aria-hidden />
                </>
              )}
            </button>
            <p className="text-[11px] text-ice/60">{active.note}</p>
          </form>
        </div>
      </div>
    </section>
  );
}

export default DeliveryHero;
