/**
 * DELIVERY & LOGISTICS — MARKETPLACE, VALUE, JOURNEY, TRUST & ASSISTANT SECTIONS
 *
 * Presentation layer only. Every card links to an existing route; no new
 * booking engine, no operational metrics (dispatch load, warehouse alerts,
 * revenue, cost analytics) are surfaced on the public site.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Package, FileText, Bike, Truck, Warehouse, Building2, ShoppingCart, MapPin,
  ArrowRight, ShieldCheck, Clock, Camera, Wallet, Bot, Search, PhoneCall,
  MessageSquare, FileCheck2, Layers, Route as RouteIcon, CheckCircle2, Quote,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppButton } from "@/components/nav/AppButton";
import { AiAssistantPanel, type AiAssistantMessage } from "@/components/layout/AiAssistantPanel";
import { AfricaMap } from "@/components/marketing/AfricaMap";
import { Counter } from "@/components/marketing/Counter";
import { cn } from "@/lib/utils";
import { trackBookingHandoff } from "@/lib/marketing/bookingFunnel";
import warehouseImg from "@/assets/delivery/taxid-logistics-scene.jpg";
import freightImg from "@/assets/delivery/taxid-delivery-scene.jpg";
import courierImg from "@/assets/delivery/taxid-parcel-scene.jpg";

/* ------------------------------------------------------------------ */
/* Section shell                                                       */
/* ------------------------------------------------------------------ */

export function Section({
  id, eyebrow, title, lead, children, tone = "default",
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
  tone?: "default" | "muted";
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className={cn("py-16 md:py-20", tone === "muted" && "bg-muted/40")}
    >
      <div className="container mx-auto px-4">
        <header className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{eyebrow}</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">{title}</h2>
          {lead && <p className="mt-3 text-muted-foreground">{lead}</p>}
        </header>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 1 · Service marketplace                                             */
/* ------------------------------------------------------------------ */

type Audience = "all" | "personal" | "business" | "enterprise";

const SERVICES: {
  title: string; blurb: string; icon: typeof Package; to: string;
  audience: Exclude<Audience, "all">[]; from: string; eta: string;
}[] = [
  { title: "Package Delivery", blurb: "Parcels moved across the city same day, with live tracking and photo proof of delivery.", icon: Package, to: "/delivery/package", audience: ["personal", "business"], from: "From KES 250", eta: "Same day" },
  { title: "Courier Services", blurb: "Confidential documents and urgent items delivered by verified, vetted couriers.", icon: FileText, to: "/delivery/courier?offering=COURIER_DOCUMENT", audience: ["personal", "business"], from: "From KES 300", eta: "≤ 60 min" },
  { title: "Express City Delivery", blurb: "Sub-hour bike and compact-vehicle pickups for time-critical drops.", icon: Bike, to: "/delivery/courier?offering=EXPRESS_CITY", audience: ["personal", "business"], from: "From KES 350", eta: "≤ 60 min" },
  { title: "Freight & Cargo", blurb: "Palletised, containerised and bulk cargo across Kenya and regional corridors.", icon: Truck, to: "/delivery/logistics", audience: ["business", "enterprise"], from: "Quoted per route", eta: "1–3 days" },
  { title: "Fleet & Truck Dispatch", blurb: "On-demand and contracted trucks from 3-tonne vans to container haulers.", icon: RouteIcon, to: "/delivery/fleet", audience: ["business", "enterprise"], from: "Quoted per load", eta: "Scheduled" },
  { title: "Warehousing & Fulfilment", blurb: "Storage, pick-and-pack and outbound distribution from managed hubs.", icon: Warehouse, to: "/delivery/logistics", audience: ["enterprise"], from: "Contracted", eta: "Continuous" },
  { title: "E-commerce Fulfilment", blurb: "Order-to-doorstep delivery for online stores, with returns handled end to end.", icon: ShoppingCart, to: "/delivery/logistics", audience: ["business", "enterprise"], from: "Volume pricing", eta: "Next day" },
  { title: "Corporate Logistics", blurb: "Recurring routes, department billing, SLAs and consolidated reporting.", icon: Building2, to: "/corporates", audience: ["enterprise"], from: "Contracted", eta: "Managed" },
];

const AUDIENCES: { key: Audience; label: string }[] = [
  { key: "all", label: "All services" },
  { key: "personal", label: "Personal" },
  { key: "business", label: "Business" },
  { key: "enterprise", label: "Enterprise" },
];

export function DeliveryMarketplace() {
  const [audience, setAudience] = useState<Audience>("all");
  const list = useMemo(
    () => (audience === "all" ? SERVICES : SERVICES.filter((s) => s.audience.includes(audience))),
    [audience],
  );

  return (
    <Section
      id="services"
       eyebrow="Delivery services"
       title="The right service for every delivery"
      lead="Choose by what you are sending, not by our internal departments. Every service shares the same tracking, proof of delivery and payment experience."
    >
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter services by audience">
        {AUDIENCES.map((a) => (
          <button
            key={a.key}
            role="tab"
            aria-selected={a.key === audience}
            onClick={() => setAudience(a.key)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors",
              a.key === audience
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s) => (
          <Card
            key={s.title}
            className="group flex flex-col overflow-hidden transition-all hover:shadow-lg"
          >
            <div className="flex flex-1 flex-col p-5">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-primary/10 p-2 text-primary">
                  <s.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-base font-semibold">{s.title}</h3>
              </div>
              <p className="mt-3 flex-1 text-sm text-muted-foreground">{s.blurb}</p>
              <div className="mt-4 flex items-center gap-2">
                <Badge variant="secondary" className="text-[11px]">{s.from}</Badge>
                <Badge variant="outline" className="text-[11px]">{s.eta}</Badge>
              </div>
              <Link
                to={s.to}
                onClick={() => trackBookingHandoff(`delivery_service_${s.title}`, s.to, { serviceCategory: "delivery" })}
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary"
              >
                Explore <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Why choose TaxiD                                                */
/* ------------------------------------------------------------------ */

const VALUE = [
  { icon: Clock, title: "Speed you can plan around", body: "Express, same-day, next-day and scheduled windows — chosen before you pay, not after." },
  { icon: MapPin, title: "Live visibility", body: "Track every shipment on a live map from pickup to signature, and share the link with your recipient." },
  { icon: Camera, title: "Digital proof of delivery", body: "Photo, signature and timestamp captured at the door and attached to the shipment record." },
  { icon: ShieldCheck, title: "Vetted, accountable handling", body: "Identity- and conduct-checked couriers, chain-of-custody records and clear escalation for exceptions." },
  { icon: Wallet, title: "Transparent pricing", body: "M-Pesa, card and corporate invoicing with the price agreed up front — no surprise surcharges." },
  { icon: FileCheck2, title: "Business-grade records", body: "Downloadable receipts, KRA eTIMS invoicing on registered accounts and consolidated monthly statements. Subject to terms and conditions." },
];

export function DeliveryValue() {
  return (
    <Section
      eyebrow="Why TaxiD"
      title="Built for the customer outcome, not the logistics jargon"
      lead="What matters is that it arrives, on time, provably, at a price you agreed to."
      tone="muted"
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {VALUE.map((v) => (
          <Card key={v.title} className="p-5">
            <span className="inline-flex rounded-xl bg-primary/10 p-2 text-primary">
              <v.icon className="h-5 w-5" aria-hidden />
            </span>
            <h3 className="mt-3 text-base font-semibold">{v.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{v.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · How it works                                                    */
/* ------------------------------------------------------------------ */

const STEPS = [
  { title: "Tell us what you're sending", body: "Pick the service, enter pickup and destination." },
  { title: "See the price instantly", body: "Distance, weight and speed produce a quoted, agreed price." },
  { title: "Confirm and pay", body: "M-Pesa, card or corporate account — your choice." },
  { title: "We collect", body: "A verified courier or truck arrives in the pickup window." },
  { title: "Track live", body: "Follow the shipment on the map and share tracking with the recipient." },
  { title: "Proof on delivery", body: "Photo, signature and timestamp are recorded and stored." },
];

export function DeliveryJourney() {
  return (
    <Section
      eyebrow="How it works"
      title="From request to proof of delivery in six steps"
    >
      <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-2xl border bg-card p-5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {i + 1}
            </span>
            <h3 className="mt-3 text-base font-semibold">{s.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · Tracking                                                        */
/* ------------------------------------------------------------------ */

export function DeliveryTracking() {
  const navigate = useNavigate();
  const [ref, setRef] = useState("");

  return (
    <Section
      id="track"
      eyebrow="Tracking"
      title="Know exactly where it is"
      lead="Every TaxiD shipment carries a reference. Enter it to open the live status, courier details and proof of delivery."
      tone="muted"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr] lg:items-start">
        <Card className="p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = ref.trim();
              if (!q) return;
              trackBookingHandoff("delivery_track_lookup", "/delivery/ops/packages", { serviceCategory: "delivery" });
              navigate(`/delivery/ops/packages?ref=${encodeURIComponent(q)}`);
            }}
          >
            <label htmlFor="track-ref" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Shipment reference
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="track-ref"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="e.g. YM-2R4K9P"
                className="h-11 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="submit"
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                <Search className="h-4 w-4" aria-hidden /> Track
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Sign in with the account that booked the shipment to see full history and download proof of delivery.
            </p>
          </form>
        </Card>

        <ul className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: MapPin, t: "Live location", b: "Map view updated as the courier moves." },
            { icon: Clock, t: "ETA updates", b: "Revised arrival windows when traffic shifts." },
            { icon: Camera, t: "Delivery proof", b: "Photo and signature attached on completion." },
          ].map((x) => (
            <li key={x.t} className="rounded-2xl border bg-card p-5">
              <x.icon className="h-5 w-5 text-primary" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold">{x.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{x.b}</p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · Business logistics                                              */
/* ------------------------------------------------------------------ */

const BUSINESS = [
  { icon: Layers, t: "Recurring & scheduled routes", b: "Fixed daily or weekly runs between your branches, stores and customers." },
  { icon: Warehouse, t: "Warehousing & fulfilment", b: "Store with us, and we pick, pack and dispatch on every order." },
  { icon: Wallet, t: "Corporate billing", b: "Consolidated invoicing, cost centres and department-level reporting." },
  { icon: ShieldCheck, t: "SLAs and accountability", b: "Agreed delivery windows with performance reporting you can audit." },
];

export function DeliveryBusiness() {
  return (
    <Section
      id="business"
      eyebrow="Business & enterprise logistics"
      title="Logistics that scales with your business"
      lead="Retailers, distributors, hospitals, e-commerce brands and corporates run daily volume on TaxiD."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2 grid gap-5 sm:grid-cols-3">
            {[
              { src: warehouseImg, alt: "Fulfilment centre with pallets and conveyor lines" },
              { src: freightImg, alt: "Cargo truck on an open highway at golden hour" },
              { src: courierImg, alt: "Courier riding through city traffic with a cargo box" },
            ].map((img) => (
              <img
                key={img.src}
                src={img.src}
                alt={img.alt}
                width={960}
                height={540}
                loading="lazy"
                className="h-32 w-full rounded-2xl object-cover"
              />
            ))}
          </div>
          {BUSINESS.map((b) => (
            <Card key={b.t} className="p-5">
              <b.icon className="h-5 w-5 text-primary" aria-hidden />
              <h3 className="mt-3 text-base font-semibold">{b.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{b.b}</p>
            </Card>
          ))}
        </div>
        <Card className="flex flex-col justify-between gap-5 bg-primary/5 p-6">
          <div>
            <h3 className="text-lg font-semibold">Talk to logistics sales</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Share your volumes and routes and we will return a costed logistics proposal, including SLAs and
              billing structure.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {["Dedicated account manager", "Volume-based pricing", "Onboarding in under 5 days"].map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden /> {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <AppButton analytics="delivery_business_contact" action="navigate" target="/contact">
              Request a proposal
            </AppButton>
            <AppButton analytics="delivery_business_portal" action="navigate" target="/corporates" variant="outline">
              Corporate logistics portal
            </AppButton>
          </div>
        </Card>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · Network & coverage                                              */
/* ------------------------------------------------------------------ */

export function DeliveryNetwork() {
  return (
    <Section
      eyebrow="Network"
      title="A delivery network across Kenya and the region"
      lead="Metro coverage in the major cities, corridor freight between them, and partner reach beyond the border."
      tone="muted"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {[
            { to: 12, suffix: "+", label: "Cities served" },
            { to: 40, suffix: "+", label: "Partner hubs" },
            { to: 98, suffix: "%", label: "On-time target" },
            { to: 24, suffix: "/7", label: "Support coverage" },
          ].map((m) => (
            <Card key={m.label} className="p-5">
              <p className="text-2xl font-bold text-primary">
                <Counter to={m.to} suffix={m.suffix} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{m.label}</p>
            </Card>
          ))}
          <div className="col-span-2 sm:col-span-4">
            <p className="text-sm text-muted-foreground">
              Nairobi, Mombasa, Kisumu, Nakuru, Eldoret and Thika metros, with scheduled corridor freight linking
              the coast, capital and lake regions.
            </p>
          </div>
        </div>
        <AfricaMap />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 7 · Customer proof                                                  */
/* ------------------------------------------------------------------ */

const STORIES = [
  { quote: "Our pharmacy deliveries used to slip past closing time. Now every drop lands inside the window and we can prove it.", who: "Operations lead, retail pharmacy chain", segment: "Business" },
  { quote: "We moved 300 orders a week onto TaxiD and our delivery complaints dropped to almost nothing.", who: "Founder, online fashion store", segment: "E-commerce" },
  { quote: "Corridor freight from Mombasa arrives on schedule and the invoicing finally matches our cost centres.", who: "Supply chain manager, FMCG distributor", segment: "Enterprise" },
];

export function DeliveryStories() {
  return (
    <Section eyebrow="Customer proof" title="Trusted with deliveries that cannot fail">
      <div className="grid gap-5 md:grid-cols-3">
        {STORIES.map((s) => (
          <Card key={s.who} className="flex flex-col p-6">
            <Quote className="h-6 w-6 text-primary/40" aria-hidden />
            <blockquote className="mt-3 flex-1 text-sm">{s.quote}</blockquote>
            <footer className="mt-4">
              <Badge variant="secondary" className="text-[11px]">{s.segment}</Badge>
              <p className="mt-2 text-xs text-muted-foreground">{s.who}</p>
            </footer>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 8 · AI logistics assistant                                          */
/* ------------------------------------------------------------------ */

const KB: { match: RegExp; answer: string }[] = [
  { match: /price|cost|how much|quote/i, answer: "Pricing depends on distance, weight and how fast you need it. Parcels start around KES 250 and express courier around KES 350; freight and truck loads are quoted per route. Enter your pickup and destination in the Send panel to get a quoted price before you pay." },
  { match: /track|where is|status/i, answer: "Every shipment has a reference like YM-2R4K9P. Enter it in the Tracking section to see live location, ETA and proof of delivery, and sign in with the booking account for full history." },
  { match: /document|legal|confidential/i, answer: "Use Courier Services for documents. They are carried by vetted couriers with recipient confirmation, and delivery is recorded with signature and timestamp." },
  { match: /fragile|electronics|perishable|cold/i, answer: "Select the matching parcel type when you book — fragile, electronics and perishable items are routed to couriers and vehicles equipped for them, including refrigerated vans for cold chain." },
  { match: /freight|cargo|truck|tonne|container/i, answer: "Freight and truck dispatch cover palletised, containerised and bulk cargo from 3-tonne vans to container haulers. Tell us origin, destination, cargo type and tonnage and we will return a costed route." },
  { match: /business|corporate|invoice|account|volume/i, answer: "Business logistics gives you recurring routes, warehousing, consolidated invoicing, cost centres and SLA reporting. Request a proposal and an account manager will scope it with you." },
  { match: /insur|damage|claim|lost/i, answer: "If something is damaged, lost or delayed, raise it from the shipment record — our team opens a claim, reviews the custody and proof-of-delivery evidence and responds under the published claims policy. Any compensation is governed by your contract, so ask us to confirm the terms that apply to your shipment before you send it." },
  { match: /pay|mpesa|m-pesa|card/i, answer: "You can pay by M-Pesa, card, or on a corporate account with monthly invoicing. The price is agreed before dispatch." },
];

export function DeliveryAssistant() {
  const [messages, setMessages] = useState<AiAssistantMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "I can help you choose a service, estimate cost, understand tracking, or route you to business logistics. What are you sending?",
    },
  ]);

  const onSubmit = (prompt: string) => {
    const hit = KB.find((k) => k.match.test(prompt));
    setMessages((m) => [
      ...m,
      { id: `u-${m.length}`, role: "user", content: prompt },
      {
        id: `a-${m.length}`,
        role: "assistant",
        content:
          hit?.answer ??
          "I can help with pricing, service choice, tracking, claims and business logistics. For anything more specific, our team can pick it up from the contact page.",
      },
    ]);
  };

  return (
    <Section
      eyebrow="AI logistics assistant"
      title="Not sure which service you need?"
      lead="Describe the shipment in your own words and the assistant will point you to the right service, cost basis and timeline."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,34rem)_1fr] lg:items-start">
        <AiAssistantPanel
          title="TaxiD Logistics Assistant"
          subtitle="Service guidance, pricing basis and tracking help"
          messages={messages}
          onSubmit={onSubmit}
          placeholder="e.g. I need to send fragile electronics to Kisumu tomorrow"
          suggestions={[
            "How much to send a 5 kg parcel across Nairobi?",
            "I need documents delivered within the hour",
            "We ship 200 orders a week — what do you offer?",
            "How do I track my shipment?",
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { icon: Bot, t: "Service matching", b: "Describe the shipment; get the right service without reading a price list." },
            { icon: MessageSquare, t: "Human handover", b: "Anything commercial or unusual goes straight to a real logistics specialist." },
            { icon: PhoneCall, t: "Support that answers", b: "Live chat, phone and email support across business hours, with out-of-hours escalation for contracted enterprise routes." },
            { icon: FileCheck2, t: "Records on request", b: "Receipts, invoices and proof of delivery available for every shipment." },
          ].map((x) => (
            <Card key={x.t} className="p-5">
              <x.icon className="h-5 w-5 text-primary" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold">{x.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{x.b}</p>
            </Card>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 9 · Closing CTA                                                     */
/* ------------------------------------------------------------------ */

export function DeliveryFinalCta() {
  return (
    <section aria-label="Start sending with TaxiD" className="border-t bg-primary/5 py-16">
      <div className="container mx-auto flex flex-col items-start gap-6 px-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold md:text-3xl">Ready to send?</h2>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Book a single parcel in under a minute, or set up business logistics with a dedicated account manager.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <AppButton
            analytics="delivery_final_send"
            action="scroll"
            size="lg"
            onClick={() => document.getElementById("send")?.scrollIntoView({ behavior: "smooth" })}
          >
            Send a package <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
          </AppButton>
          <AppButton analytics="delivery_final_sales" action="navigate" target="/contact" variant="outline" size="lg">
            Talk to logistics sales
          </AppButton>
        </div>
      </div>
    </section>
  );
}
