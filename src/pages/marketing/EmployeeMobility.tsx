/**
 * Employee Mobility — Corporate Charter Business flagship landing page.
 *
 * Marketing surface only: every CTA routes into existing production surfaces
 * (charter planner, corporate registration, contact desk) through the shared
 * portal route resolver so signed-out visitors land on the corporate login
 * portal, never the admin auth portal.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, Building2, BusFront, CalendarClock, ChartNoAxesCombined, CheckCircle2,
  ClipboardCheck, Clock, CreditCard, Globe2, HeartHandshake, MapPinned, Plane,
  Quote, ShieldCheck, Sparkles, Users, Wallet,
} from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Counter } from "@/components/marketing/Counter";
import { CrossLinks } from "@/components/marketing/CrossLinks";
import { ContactForm } from "@/components/marketing/ContactForm";
import { SeoHead } from "@/components/seo/SeoHead";
import { useAuth } from "@/hooks/useAuth";
import { charterPlannerPath, portalEntryHref } from "@/lib/charter/portalRoutes";
import { VEHICLE_IMAGES } from "@/lib/charter/vehicleImages";
import { FleetCarousel, type FleetVehicle } from "@/components/marketing/FleetCarousel";
import { MobilityConcierge } from "@/components/marketing/MobilityConcierge";
import { CorporateSavingsCalculator } from "@/components/marketing/CorporateSavingsCalculator";
import type { ConciergeVehicle } from "@/lib/marketing/mobilityConcierge";
import {
  clearDraft, describeSearch, draftIsEmpty, loadDraft, removeSearch,
  saveDraft, saveSearch, savedSearches, watchConnectivity, type SavedSearch,
} from "@/lib/marketing/bookingResume";
import {
  trackEmCta, trackEmStep, watchEmAbandonment, watchEmScrollDepth,
} from "@/lib/marketing/employeeMobilityFunnel";
import heroImg from "@/assets/employee-mobility-hero.jpg";
import corporatesImg from "@/assets/corporates.jpg";

const PATH = "/riders/corporate";

const stats = [
  { value: 99.9, suffix: "%", label: "Booking reliability", decimals: true },
  { value: 24, suffix: "/7", label: "Operations support" },
  { value: 12000, suffix: "+", label: "Verified drivers" },
  { value: 100, suffix: "%", label: "eTIMS tax invoices" },
];

const trustSegments = [
  "Corporate clients", "Government institutions", "NGOs & missions",
  "Universities", "Financial institutions", "Verified operators",
];

const solutions: Array<{ title: string; desc: string; icon: typeof BusFront; fleetKey: string }> = [
  { title: "Employee daily transport", desc: "Fixed-route staff shuttles with attendance-grade manifests.", icon: BusFront, fleetKey: "staff_shuttle_25" },
  { title: "Executive chauffeur", desc: "Discreet, vetted chauffeurs for leadership and board travel.", icon: Sparkles, fleetKey: "executive_van_8" },
  { title: "Airport transfers", desc: "Meet & greet, flight-aware pickups and late-night cover.", icon: Plane, fleetKey: "luxury_van_10" },
  { title: "Corporate events", desc: "Conference, AGM and offsite movement managed end to end.", icon: CalendarClock, fleetKey: "executive_coach_49" },
  { title: "Project field teams", desc: "Rotational crew movement to sites across the country.", icon: MapPinned, fleetKey: "safari_land_cruiser_5" },
  { title: "Long-term dedicated fleet", desc: "Assigned vehicles and drivers on a monthly contract.", icon: Building2, fleetKey: "executive_shuttle_14" },
];

const steps = [
  { t: "Choose transport", d: "Tell us the movement: shuttle, executive, airport or event." },
  { t: "Select fleet", d: "Pick the vehicle class that fits comfort and capacity." },
  { t: "Configure employees", d: "Add passengers, cost centres and travel frequency." },
  { t: "Receive quote", d: "Transparent, itemised pricing in minutes — not days." },
  { t: "Approve", d: "Managers approve inside your governance workflow." },
  { t: "Track every journey", d: "Live tracking, arrival proof and monthly reporting." },
];

const values = [
  { icon: Globe2, t: "One platform", d: "Every movement, invoice and approval in one place." },
  { icon: ClipboardCheck, t: "Corporate governance", d: "Policy limits, approvals, budgets and audit trails." },
  { icon: Sparkles, t: "Executive fleet", d: "Premium, well-maintained vehicles with vetted drivers." },
  { icon: HeartHandshake, t: "Dedicated support", d: "A named account manager and 24/7 operations desk." },
  { icon: MapPinned, t: "Live tracking", d: "Employees and managers see every journey in real time." },
  { icon: Wallet, t: "Corporate wallet", d: "Centralised billing with department-level allocation." },
  { icon: ChartNoAxesCombined, t: "Spend intelligence", d: "Cost per trip, per department, per project code." },
  { icon: ShieldCheck, t: "Safety first", d: "Verified operators, duty-of-care and incident response." },
];

const fleet: FleetVehicle[] = [
  { key: "executive_van_8", name: "Executive van", seats: "Up to 8 seats", capacity: 8, category: "executive", rating: 4.9, reviews: 214, fromKes: 18500, note: "Leather interiors, Wi-Fi, privacy glass", amenities: ["Wi-Fi", "Leather", "Privacy glass", "Chauffeur"] },
  { key: "luxury_van_10", name: "Luxury van", seats: "Up to 10 seats", capacity: 10, category: "executive", rating: 4.9, reviews: 168, fromKes: 22000, note: "Airport meet & greet ready", amenities: ["Meet & greet", "Wi-Fi", "Cooler box", "USB"] },
  { key: "executive_shuttle_14", name: "Executive shuttle", seats: "Up to 14 seats", capacity: 14, category: "staff_transport", rating: 4.8, reviews: 391, fromKes: 26500, note: "Daily staff routes, USB charging", amenities: ["USB charging", "Reclining seats", "Live tracking"] },
  { key: "staff_shuttle_25", name: "Staff shuttle", seats: "Up to 25 seats", capacity: 25, category: "staff_transport", rating: 4.7, reviews: 512, fromKes: 34000, note: "Shift movement with manifests", amenities: ["Manifests", "Route optimisation", "Night cover"] },
  { key: "minibus_25", name: "Premium minibus", seats: "Up to 25 seats", capacity: 25, category: "events", rating: 4.8, reviews: 143, fromKes: 36500, note: "Events and team travel", amenities: ["PA system", "Luggage space", "Wi-Fi"] },
  { key: "executive_coach_49", name: "Luxury coach", seats: "Up to 49 seats", capacity: 49, category: "events", rating: 4.9, reviews: 97, fromKes: 62000, note: "Conferences and delegations", amenities: ["Onboard washroom", "Reclining seats", "PA system", "Wi-Fi"] },
];

/** The concierge prices from the same fleet the carousel shows. */
const conciergeFleet: ConciergeVehicle[] = fleet.map((v) => ({
  key: v.key, name: v.name, capacity: v.capacity, category: v.category, fromKes: v.fromKes,
}));

const compliance = [
  "KRA registered", "eTIMS tax invoices", "Kenya Data Protection Act",
  "ISO 27001 readiness", "Encrypted payments", "Verified drivers", "Corporate audit trail",
];

const testimonials = [
  { q: "Our staff shuttles have not missed a single morning run since we moved across. Attendance improved in the first month.", n: "Head of Human Resources", c: "Financial services group, Nairobi" },
  { q: "Procurement finally has one itemised invoice and a dashboard we can audit. Approvals used to take days.", n: "Procurement Manager", c: "Regional manufacturing company" },
  { q: "Executive airport transfers are handled without a single phone call from my office. That is the real value.", n: "Operations Director", c: "Development organisation" },
];

const benefits = [
  "Lower cost per employee trip", "Higher employee satisfaction", "Demonstrable duty of care",
  "One central invoice", "Travel policy enforced automatically", "Board-ready reporting",
];

export default function EmployeeMobility() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const authenticated = !!user;

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [passengers, setPassengers] = useState("12");
  const [frequency, setFrequency] = useState("daily");
  const [online, setOnline] = useState(true);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [resumed, setResumed] = useState<string | null>(null);

  useEffect(() => {
    trackEmStep("hero_impression", { viewport: typeof window !== "undefined" ? window.innerWidth : null });
    const stopDepth = watchEmScrollDepth();
    const stopAbandon = watchEmAbandonment();
    return () => { stopDepth(); stopAbandon(); };
  }, []);

  // Offline-friendly resume: restore the last draft and recent searches.
  useEffect(() => {
    setSearches(savedSearches());
    const draft = loadDraft();
    if (draft && !draftIsEmpty(draft)) {
      setPickup(draft.pickup);
      setDropoff(draft.dropoff);
      setDate(draft.date);
      setTime(draft.time);
      setPassengers(draft.passengers || "12");
      setFrequency(draft.frequency || "daily");
      setResumed(describeSearch(draft));
      trackEmStep("draft_resumed", { age_ms: Date.now() - Date.parse(draft.updatedAt) });
    }
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    return watchConnectivity((isOnline) => {
      setOnline(isOnline);
      if (!isOnline) trackEmStep("offline_parked", {});
    });
  }, []);

  // Park the widget state so a lost connection never costs the visitor a form.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const draft = { pickup, dropoff, date, time, passengers, frequency };
      if (draftIsEmpty(draft)) return;
      saveDraft(draft);
    }, 600);
    return () => window.clearTimeout(id);
  }, [pickup, dropoff, date, time, passengers, frequency]);

  const bookHref = useMemo(
    () => portalEntryHref(charterPlannerPath("bus-charter"), authenticated, "employee-mobility-hero"),
    [authenticated],
  );

  function startBooking() {
    const params = new URLSearchParams({ pax: passengers, frequency });
    trackEmStep("quote_requested", {
      has_pickup: !!pickup, has_destination: !!dropoff, has_date: !!date,
      passengers: Number(passengers) || 0, frequency,
    });
    if (pickup) params.set("origin", pickup);
    if (dropoff) params.set("destination", dropoff);
    if (date) params.set("date", date);
    if (time) params.set("time", time);
    const target = portalEntryHref(
      charterPlannerPath("bus-charter", `?${params.toString()}`),
      authenticated,
      "employee-mobility-widget",
    );
    trackEmCta("employee_mobility.widget.get_quote", {
      step: "booking_handoff", target,
      metadata: { passengers: Number(passengers) || 0, frequency, authenticated },
    });
    setSearches(saveSearch({ pickup, dropoff, date, time, passengers, frequency }));
    trackEmStep("search_saved", { has_pickup: !!pickup, has_destination: !!dropoff });
    clearDraft();
    navigate(target);
  }

  function applySearch(s: SavedSearch) {
    setPickup(s.pickup); setDropoff(s.dropoff); setDate(s.date); setTime(s.time);
    setPassengers(s.passengers || "12"); setFrequency(s.frequency || "daily");
    setResumed(describeSearch(s));
    trackEmStep("draft_resumed", { source: "saved_search" });
  }

  return (
    <MarketingPage>
      <SeoHead
        title="Employee Mobility | TaxiD Corporate"
        description="Enterprise employee transport in Kenya: staff shuttles, executive chauffeur, airport transfers and event movement — booked, approved and billed on one platform."
        path={PATH}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: "TaxiD Employee Mobility",
          serviceType: "Corporate employee transport",
          provider: { "@type": "Organization", name: "TaxiD" },
          areaServed: "KE",
          description:
            "Managed employee transport: daily staff shuttles, executive chauffeur, airport transfers, corporate events and dedicated fleet contracts.",
        }}
      />

      <PageHero
        eyebrow="Corporate Charter Business · Employee Mobility"
        title="Move your workforce with confidence"
        subtitle="Safe, reliable and professionally managed transport — from daily staff shuttles and executive travel to airport transfers and nationwide corporate mobility, all on one intelligent platform."
        image={heroImg}
        imageAlt="Chauffeur opening the door of a premium executive shuttle outside a corporate headquarters at sunrise"
      >
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="bg-ice text-primary hover:bg-ice/90">
            <Link to={bookHref} onClick={() => trackEmCta("employee_mobility.hero.book", { target: bookHref, step: "hero_cta_click" })}>
              Book employee transport <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-ice/70 bg-transparent text-primary-foreground hover:bg-ice/20 hover:text-primary-foreground">
            <Link to="/corporate/register" onClick={() => trackEmCta("employee_mobility.hero.open_account", { target: "/corporate/register" })}>Open business account</Link>
          </Button>
          <Button asChild size="lg" variant="ghost" className="text-primary-foreground hover:bg-ice/20">
            <a href="#consultant" onClick={() => trackEmCta("employee_mobility.hero.talk_to_consultant", { actionType: "scroll", target: "#consultant", step: "consultant_form_opened" })}>Talk to a mobility consultant</a>
          </Button>
        </div>
      </PageHero>

      {/* Trust bar + animated statistics */}
      <section className="border-y border-border bg-secondary/30">
        <div className="container mx-auto px-4 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((s) => (
              <div key={s.label}>
                <div className="text-2xl md:text-3xl font-bold text-primary">
                  {s.decimals ? "99.9" : <Counter to={s.value} />}{s.suffix}
                </div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-2">
            {trustSegments.map((t) => (
              <Badge key={t} variant="outline" className="bg-card/60 backdrop-blur-sm">{t}</Badge>
            ))}
          </div>
        </div>
      </section>

      {/* Floating glass booking panel */}
      <section id="book" className="relative">
        <div className="container mx-auto px-4 -mt-6 md:-mt-10 pb-16 pt-12">
          <Card className="mx-auto max-w-5xl border-border/70 bg-card/80 p-6 shadow-xl backdrop-blur-md md:p-8">
            <div className="mb-6">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">Instant request</span>
              <h2 className="mt-2 text-2xl font-bold">Plan a movement in under a minute</h2>
              <p className="text-sm text-muted-foreground">Tell us the essentials — we price and confirm inside the corporate portal.</p>
            </div>
            {(!online || resumed || searches.length > 0) && (
              <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-secondary/40 p-3">
                {!online && (
                  <Badge variant="outline" className="gap-1 border-status-warning/50 text-status-warning">
                    Offline — your request is saved on this device
                  </Badge>
                )}
                {resumed && (
                  <span className="text-xs text-muted-foreground">Resumed: {resumed}</span>
                )}
                {searches.map((s) => (
                  <span key={s.id} className="flex items-center gap-1">
                    <Button type="button" size="sm" variant="secondary" className="h-7 text-xs" onClick={() => applySearch(s)}>
                      {describeSearch(s)}
                    </Button>
                    <button
                      type="button"
                      aria-label={`Remove saved search ${describeSearch(s)}`}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setSearches(removeSearch(s.id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="em-pickup">Pickup</Label>
                <Input id="em-pickup" value={pickup} onChange={(e) => setPickup(e.target.value)} onFocus={() => trackEmStep("widget_opened", { field: "pickup" })} onBlur={(e) => e.target.value && trackEmStep("pickup_entered")} placeholder="Head office, estate or hub" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="em-dropoff">Destination</Label>
                <Input id="em-dropoff" value={dropoff} onChange={(e) => setDropoff(e.target.value)} onBlur={(e) => e.target.value && trackEmStep("destination_entered")} placeholder="Office, site, airport or venue" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="em-pax">Passengers</Label>
                <Input id="em-pax" type="number" min={1} value={passengers} onChange={(e) => setPassengers(e.target.value)} onBlur={(e) => e.target.value && trackEmStep("passengers_entered", { passengers: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="em-date">Start date</Label>
                <Input id="em-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); if (e.target.value) trackEmStep("date_selected", { date: e.target.value }); }} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="em-time">Pickup time</Label>
                <Input id="em-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="em-frequency">Frequency</Label>
                <Select value={frequency} onValueChange={(v) => { setFrequency(v); trackEmStep("frequency_selected", { frequency: v }); }}>
                  <SelectTrigger id="em-frequency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one-off">One-off</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={startBooking}>Get instant quote <ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Button>
              <p className="text-xs text-muted-foreground">Cost centre, department and project code are captured in the portal.</p>
            </div>
          </Card>
        </div>
      </section>

      {/* Enterprise mobility solutions */}
      <section className="bg-secondary/20 border-y border-border">
        <div className="container mx-auto px-4 py-20">
          <div className="max-w-2xl mb-12">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Solutions</span>
            <h2 className="mt-2 text-3xl font-bold">Transport for every part of your organisation</h2>
            <p className="mt-3 text-muted-foreground">One account, one invoice — whatever the movement.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {solutions.map((s) => (
              <article key={s.title} className="group overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/40 hover:shadow-lg">
                <div className="aspect-[16/9] overflow-hidden bg-muted">
                  <img
                    src={VEHICLE_IMAGES[s.fleetKey] ?? corporatesImg}
                    alt={`${s.title} — TaxiD corporate fleet`}
                    loading="lazy"
                    width={640}
                    height={360}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="p-6">
                  <s.icon className="mb-3 h-6 w-6 text-primary" aria-hidden />
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
                  <div className="mt-4 flex gap-2">
                    <Button asChild size="sm">
                      <Link to={portalEntryHref(charterPlannerPath("bus-charter"), authenticated, `employee-mobility-${s.fleetKey}`)}>Book</Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost"><a href="#consultant">Learn more about our mobility consultants</a></Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-2xl mb-12">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">How it works</span>
          <h2 className="mt-2 text-3xl font-bold">Six steps from request to arrival</h2>
        </div>
        <ol className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.t} className="relative rounded-2xl border border-border bg-card p-6">
              <span className="text-xs font-semibold text-primary">Step {i + 1}</span>
              <h3 className="mt-2 font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Why TaxiD */}
      <section className="bg-secondary/20 border-y border-border">
        <div className="container mx-auto px-4 py-20">
          <div className="max-w-2xl mb-12">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Why TaxiD</span>
            <h2 className="mt-2 text-3xl font-bold">Built for the people who answer for transport</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((v) => (
              <div key={v.t} className="rounded-2xl border border-border bg-card/80 p-6 backdrop-blur-sm transition-colors hover:border-primary/40">
                <v.icon className="mb-3 h-6 w-6 text-primary" aria-hidden />
                <h3 className="font-semibold">{v.t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{v.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Enterprise control preview */}
      <section className="container mx-auto px-4 py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Control room</span>
            <h2 className="mt-2 text-3xl font-bold">Everything visible, everything accountable</h2>
            <p className="mt-3 text-muted-foreground">
              Managers see live journeys, wallet balance, department spend, pending approvals and invoices — without chasing anyone.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {["Live fleet and journey status", "Approval workflow with policy limits", "Corporate wallet and department spend", "eTIMS invoices and monthly reports"].map((l) => (
                <li key={l} className="flex gap-3"><CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden /><span>{l}</span></li>
              ))}
            </ul>
            <Button asChild className="mt-8">
              <Link to={portalEntryHref("/dashboard/charter/portal", authenticated, "employee-mobility-control-room")}>
                Open the corporate portal <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
          <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur-md">
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: BusFront, k: "Live journeys", v: "18 running" },
                { icon: Users, k: "Employees moving", v: "412 today" },
                { icon: Wallet, k: "Wallet balance", v: "KES 1.4M" },
                { icon: ClipboardCheck, k: "Pending approvals", v: "3 awaiting" },
                { icon: CreditCard, k: "Invoices issued", v: "27 this month" },
                { icon: Clock, k: "On-time arrival", v: "99.2%" },
              ].map((c) => (
                <div key={c.k} className="rounded-xl border border-border bg-background/70 p-4">
                  <c.icon className="mb-2 h-5 w-5 text-primary" aria-hidden />
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{c.k}</div>
                  <div className="mt-1 font-semibold">{c.v}</div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Illustrative view of the corporate dashboard.</p>
          </div>
        </div>
      </section>

      {/* Fleet showcase */}
      <section className="bg-secondary/20 border-y border-border">
        <div className="container mx-auto px-4 py-20">
          <div className="max-w-2xl mb-12">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Fleet</span>
            <h2 className="mt-2 text-3xl font-bold">Vehicles your people will be glad to board</h2>
          </div>
          <FleetCarousel vehicles={fleet} authenticated={authenticated} passengers={passengers} />
        </div>
      </section>

      {/* AI mobility concierge */}
      <section id="concierge" className="container mx-auto px-4 py-20">
        <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-start">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Mobility concierge</span>
            <h2 className="mt-2 text-3xl font-bold">Ask for it in plain language</h2>
            <p className="mt-4 max-w-xl text-muted-foreground">
              Book a shuttle, generate a quotation, compare vehicles or estimate a monthly programme.
              The concierge prices against the same governed corporate rate band used in the planner,
              then hands you straight into the booking wizard with your details carried over.
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                "Book and repeat recurring staff runs",
                "Generate an itemised quotation",
                "Estimate a monthly programme cost",
                "Recommend the right vehicle class",
              ].map((b) => (
                <li key={b} className="flex gap-3 text-sm">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden /><span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <MobilityConcierge
            vehicles={conciergeFleet}
            authenticated={authenticated}
            passengers={Number(passengers) || undefined}
            frequency={frequency}
            pickup={pickup}
            destination={dropoff}
            date={date}
          />
        </div>
      </section>

      {/* Corporate savings / ROI calculator */}
      <section id="savings" className="bg-secondary/20 border-y border-border">
        <div className="container mx-auto px-4 py-20">
          <div className="mb-12 max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Business case</span>
            <h2 className="mt-2 text-3xl font-bold">What a managed programme saves you</h2>
            <p className="mt-3 text-muted-foreground">
              Model your current arrangement against a pooled TaxiD programme — cost, admin time,
              carbon and payback period, exportable for your board pack.
            </p>
          </div>
          <CorporateSavingsCalculator authenticated={authenticated} />
        </div>
      </section>

      {/* Testimonials */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-2xl mb-12">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Client voices</span>
          <h2 className="mt-2 text-3xl font-bold">Trusted by the teams that run operations</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <figure key={t.n} className="rounded-2xl border border-border bg-card p-6">
              <Quote className="h-6 w-6 text-primary" aria-hidden />
              <blockquote className="mt-4 text-sm">{t.q}</blockquote>
              <figcaption className="mt-4 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{t.n}</span><br />{t.c}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Benefits + compliance */}
      <section className="bg-secondary/20 border-y border-border">
        <div className="container mx-auto px-4 py-20 grid gap-10 lg:grid-cols-2">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Corporate benefits</span>
            <h2 className="mt-2 text-3xl font-bold">What changes in the first quarter</h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {benefits.map((b) => (
                <li key={b} className="flex gap-3 text-sm"><CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden /><span>{b}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Assurance</span>
            <h2 className="mt-2 text-3xl font-bold">Compliance you can hand to audit</h2>
            <div className="mt-6 flex flex-wrap gap-2">
              {compliance.map((c) => (
                <Badge key={c} variant="secondary" className="gap-1"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />{c}</Badge>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Consultant / CTA */}
      <section id="consultant" className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={corporatesImg} alt="" loading="lazy" className="size-full object-cover" />
          <div className="absolute inset-0 bg-primary/80" />
        </div>
        <div className="relative container mx-auto grid gap-10 px-4 py-20 lg:grid-cols-2">
          <div className="text-primary-foreground">
            <h2 className="text-3xl font-bold">Ready to modernise employee mobility?</h2>
            <p className="mt-3 text-primary-foreground/90">
              Talk to a mobility consultant about your routes, headcount and travel policy. We respond within one business day.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-ice text-primary hover:bg-ice/90">
                <Link to={bookHref} onClick={() => trackEmCta("employee_mobility.closing.book_now", { target: bookHref })}>Book now</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-ice/70 bg-transparent text-primary-foreground hover:bg-ice/20 hover:text-primary-foreground">
                <Link to="/corporate/register">Open business account</Link>
              </Button>
            </div>
          </div>
          <ContactForm
            type="demo"
            sourcePage={PATH}
            onStarted={() => trackEmStep("consultant_form_started")}
            onSubmitted={(r) => trackEmCta("employee_mobility.consultant.submitted", {
              actionType: "submit", target: "contact-submission", step: "consultant_form_submitted",
              metadata: { submission_id: r.submissionId, lead_type: "demo" },
            })}
            onFailed={(reason) => trackEmStep("consultant_form_failed", { reason })}
            showCompany
            showEmployeeCount
            submitLabel="Schedule a demonstration"
            heading="Talk to a mobility consultant"
            subheading="Share your transport needs and we'll design the programme."
          />
        </div>
      </section>

      <CrossLinks heading="Explore TaxiD for business" keys={["corporates", "rentals", "enterprise", "pricing", "security", "support"]} />

      {/* Mobile sticky booking CTA */}
      <div className="h-36 md:hidden" aria-hidden />
      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-border bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <Button asChild size="lg" className="min-h-11 w-full">
          <Link
            to={bookHref}
            onClick={() => trackEmCta("employee_mobility.sticky_cta.book", { target: bookHref, step: "booking_handoff" })}
          >
            Book employee transport
          </Link>
        </Button>
      </div>
    </MarketingPage>
  );
}
