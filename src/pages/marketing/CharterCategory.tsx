/**
 * Public charter category page — PREMIUM MARKETPLACE, MARKETING & LEADS ONLY.
 *
 * Booking, pricing settings, enterprise procurement, approval chain and budget
 * live in the authenticated Charter Business Portal
 * (`/dashboard/charter/portal`). This surface sells outcomes: a cinematic hero,
 * curated experience collections, trust above the fold and an enterprise-grade
 * lead capture that deep-links straight into the portal.
 */
import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { SeoHead } from "@/components/seo/SeoHead";
import { MarketingPage } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CharterIcon } from "@/components/charter/CharterIcon";
import AviationHero from "@/components/charter/AviationHero";
import { CharterLeadForm } from "@/components/charter/CharterLeadForm";
import { vehicleImageFor } from "@/lib/charter/vehicleImages";
import { portalEntryHref, CHARTER_PORTAL_PATH } from "@/lib/charter/portalRoutes";
import { trackPortalLoginRedirect } from "@/lib/charter/portalAnalytics";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowRight, BadgeCheck, BusFront, Clock, Fuel, Headset, Luggage, MapPin, ShieldCheck,
  Snowflake, Sparkles, UserCheck, Wifi, Building2, Radar, FileCheck2, Users,
} from "lucide-react";

import heroArrival from "@/assets/charter/hero-executive-arrival.jpg";
import enterpriseFleet from "@/assets/charter/enterprise-fleet.jpg";

import {
  categoryAssetClass, categoryBySlug, formatMoney, RATE_UNIT_LABEL, hasRateBand, itemFromRate,
  type CharterInventoryItem,
} from "@/lib/charter/catalog";
import { estimateDailyRate } from "@/lib/charter/estimatedDailyRate";
import {
  CHARTER_COLLECTIONS, collectionFleet, collectionFromKes, collectionSeatRange, type AmenityKey,
} from "@/lib/charter/charterCollections";

const AMENITY: Record<AmenityKey, { icon: typeof Wifi; label: string }> = {
  chauffeur: { icon: UserCheck, label: "Chauffeur" },
  aircon: { icon: Snowflake, label: "Air conditioning" },
  luggage: { icon: Luggage, label: "Luggage hold" },
  wifi: { icon: Wifi, label: "Onboard Wi-Fi" },
  insured: { icon: ShieldCheck, label: "Fully insured" },
  tracking: { icon: Radar, label: "Live GPS tracking" },
  washroom: { icon: Sparkles, label: "Onboard washroom" },
  guide: { icon: MapPin, label: "Guide seat" },
  beltsafe: { icon: BadgeCheck, label: "Belted & speed limited" },
};

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "Licensed operators" },
  { icon: FileCheck2, label: "Fully insured" },
  { icon: UserCheck, label: "Background-checked drivers" },
  { icon: Radar, label: "Live GPS tracking" },
  { icon: Headset, label: "24/7 operations desk" },
  { icon: Building2, label: "Corporate billing" },
];

const JOURNEY_TIMELINE = [
  { icon: FileCheck2, t: "Request", d: "Share the mission, not a vehicle code." },
  { icon: Sparkles, t: "AI recommendation", d: "Best-fit class matched to passengers and route." },
  { icon: Headset, t: "Mobility consultant", d: "A named specialist owns your movement." },
  { icon: BusFront, t: "Vehicle reserved", d: "Asset locked with the vetted operator." },
  { icon: UserCheck, t: "Driver assigned", d: "Background-checked chauffeur briefed." },
  { icon: Radar, t: "Journey live", d: "Live tracking shared with your travel desk." },
  { icon: BadgeCheck, t: "Mission complete", d: "Single invoice, full audit trail." },
];

const OUTCOMES = [
  { t: "Corporate conferences", d: "Delegate movement between hotels, venues and airports on one schedule.", collection: "corporate" },
  { t: "Government & diplomatic missions", d: "Protocol-ready transport with vetted chauffeurs and escorts.", collection: "vip" },
  { t: "Tourism & safaris", d: "Comfortable, guided travel across circuits and coastal routes.", collection: "tourism" },
  { t: "Schools & universities", d: "Safety-certified transport with belted seating and speed governance.", collection: "education" },
  { t: "Airport & hotel transfers", d: "Reliable arrivals and departures for groups of every size.", collection: "executive" },
];

const SECTORS = [
  "Government agencies", "International NGOs", "Hotels & resorts", "Universities",
  "Multinationals", "Conference organisers", "Tour operators", "School groups",
];

const ENTERPRISE_FEATURES = [
  "Dedicated account manager", "Monthly consolidated billing", "Purchase orders", "Cost centres",
  "Volume agreements", "Fleet reservation windows", "SLA guarantees", "24/7 enterprise support",
];

const STATUS_VARIANT: Record<CharterInventoryItem["status"], { label: string; cls: string }> = {
  available: { label: "Available", cls: "bg-primary/15 text-primary border-primary/30" },
  limited: { label: "Limited", cls: "bg-primary/15 text-primary border-primary/30" },
  "on-request": { label: "On request", cls: "bg-muted text-muted-foreground border-border" },
};

const money = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

const CharterCategoryPage = () => {
  const { slug = "" } = useParams();
  const category = categoryBySlug(slug);
  const [openCollection, setOpenCollection] = useState<string | null>(null);
  const { user } = useAuth();
  /** Single resolver for every portal entry point on this page (images, cards, buttons). */
  const portalHref = portalEntryHref(CHARTER_PORTAL_PATH, !!user);
  /** Attributes the portal entry point that initiated a login redirect. */
  const trackEntry = (source: string) => () => {
    if (!user) trackPortalLoginRedirect(source, CHARTER_PORTAL_PATH);
  };

  /** Road charter renders its own collection blocks, so the inventory grid is aviation/marine only. */
  const isRoad = category?.slug === "bus-charter";
  const nonRoadInventory = useMemo(
    () => (isRoad || !category ? [] : category.inventory),
    [category, isRoad],
  );

  if (!category) return <Navigate to="/charter" replace />;

  const unit = RATE_UNIT_LABEL[category.rateUnit];
  const assetClass = categoryAssetClass(category);

  const estimateFor = (item: CharterInventoryItem) =>
    estimateDailyRate({
      assetClass,
      assetLabel: item.name,
      band: item.rateBand,
      days: category.defaultDuration ?? 1,
      passengers: 1,
      distanceKm: (category.defaultDuration ?? 1) * 150,
      demandIndex: item.status === "limited" ? 0.7 : item.status === "on-request" ? 0.9 : 0.2,
    });

  return (
    <MarketingPage>
      <SeoHead
        title={`${category.label} — Move People. Impress Everyone. | SAFARID`}
        description={`${category.subhead} Executive coaches, premium shuttles, safari vehicles, school transport and corporate fleet solutions — professionally managed from booking to arrival.`}
        path={`/charter/${category.slug}`}
      />

      {/* ── Cinematic hero ─────────────────────────────────────────── */}
      {category.slug === "aircraft-charter" ? (
        <AviationHero />
      ) : (
        <section className="relative isolate overflow-hidden">
          <img
            src={heroArrival}
            alt="Executive coach arriving at a luxury hotel entrance with a chauffeur receiving corporate guests"
            width={1920}
            height={1088}
            className="absolute inset-0 h-full w-full scale-105 object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/25" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />

          <div className="container relative mx-auto px-4 py-24 md:py-32">
            <Link to="/charter" className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
              Charter, Leasing &amp; Rentals
            </Link>
            <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
              Move People. Impress Everyone.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              Executive coaches, premium shuttles, safari vehicles, school transport and corporate fleet
              solutions — professionally managed from booking to arrival.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <a href="#plan-my-journey">Plan my journey<ArrowRight className="ml-2 h-4 w-4" /></a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#collections">Explore our fleet</a>
              </Button>
            </div>

            {/* Trust above the fold */}
            <ul className="mt-10 flex max-w-3xl flex-wrap gap-2">
              {TRUST_BADGES.map((b) => (
                <li
                  key={b.label}
                  className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-medium backdrop-blur-md"
                >
                  <b.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  {b.label}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── Curated collections ────────────────────────────────────── */}
      {isRoad ? (
        <section id="collections" className="container mx-auto scroll-mt-24 px-4 py-16 md:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Curated collections</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Start with the outcome. We reveal the fleet.
            </h2>
            <p className="mt-3 text-muted-foreground">
              Five collections, each with a governed fleet behind it. Choose the journey you need to deliver —
              never a specification sheet.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {CHARTER_COLLECTIONS.map((c) => {
              const fleet = collectionFleet(c);
              const open = openCollection === c.id;
              return (
                <article
                  key={c.id}
                  className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card/60 shadow-elegant backdrop-blur-xl transition-all duration-500 hover:border-primary/40"
                >
                  <Link
                    to={portalHref}
                    onClick={trackEntry("category_collection_image")}
                    aria-label={`${c.title} — open the charter portal`}
                    className="relative block h-52 overflow-hidden"
                  >
                    <img
                      src={c.cover}
                      alt={`${c.title} — ${c.tagline}`}
                      loading="lazy"
                      width={1280}
                      height={832}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
                    {c.badge && (
                      <Badge className="absolute left-4 top-4 border-none bg-primary/90 text-primary-foreground">
                        {c.badge}
                      </Badge>
                    )}
                  </Link>

                  <div className="relative -mt-10 space-y-4 p-6">
                    <div>
                      <h3 className="text-xl font-semibold">{c.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{c.tagline}</p>
                    </div>

                    <ul className="space-y-1.5">
                      {c.missions.map((m) => (
                        <li key={m} className="flex items-start gap-2 text-sm">
                          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
                          {m}
                        </li>
                      ))}
                    </ul>

                    <ul className="flex flex-wrap gap-2" aria-label={`${c.title} amenities`}>
                      {c.amenities.map((a) => {
                        const Icon = AMENITY[a].icon;
                        return (
                          <li
                            key={a}
                            title={AMENITY[a].label}
                            className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground"
                          >
                            <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                            <span>{AMENITY[a].label}</span>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="flex items-center justify-between border-t border-border/60 pt-4">
                      <div>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Users className="h-3.5 w-3.5" aria-hidden="true" /> {collectionSeatRange(c)}
                        </p>
                        <p className="mt-1 text-sm">
                          <span className="text-muted-foreground">From </span>
                          <span className="font-semibold">{money(collectionFromKes(c))}</span>
                          <span className="text-muted-foreground"> / {unit}</span>
                        </p>
                      </div>
                      <Button size="sm" asChild>
                        <a href="#plan-my-journey">Request quote</a>
                      </Button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setOpenCollection(open ? null : c.id)}
                      aria-expanded={open}
                      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {open ? "Hide the fleet" : `View the ${fleet.length}-vehicle fleet`}
                    </button>

                    {open && (
                      <ul className="space-y-3 rounded-2xl border border-border/60 bg-background/40 p-3">
                        {fleet.map((v) => (
                          <li key={v.key} className="flex items-center gap-3">
                            <img
                              src={vehicleImageFor(v.key)}
                              alt={`${v.label} ${v.seats} seater`}
                              loading="lazy"
                              width={96}
                              height={64}
                              className="h-14 w-20 shrink-0 rounded-lg object-cover"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{v.label} {v.seats}</p>
                              <p className="text-xs text-muted-foreground">
                                {v.seats} seats · from {money(v.minKes)} / {unit}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section id="collections" className="container mx-auto scroll-mt-24 px-4 py-16">
          <div className="mb-8 flex items-start gap-4">
            <CharterIcon name={category.icon} className="h-10 w-10 shrink-0 text-primary" />
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{category.headline}</h2>
              <p className="mt-2 text-muted-foreground">{category.subhead}</p>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {nonRoadInventory.map((item) => (
              <article
                key={item.name}
                className="rounded-3xl border border-border/60 bg-card/60 p-6 shadow-elegant backdrop-blur-xl transition-all hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{item.name}</h3>
                  <Badge variant="outline" className={STATUS_VARIANT[item.status].cls}>
                    {STATUS_VARIANT[item.status].label}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{item.spec}</p>
                <p className="text-xs text-muted-foreground">{item.capacity}</p>
                <p className="mt-4 text-sm">
                  <span className="text-muted-foreground">From </span>
                  <span className="font-semibold">
                    {formatMoney(hasRateBand(item) ? estimateFor(item).fromKes : itemFromRate(item), category.currency)}
                  </span>
                  <span className="text-muted-foreground"> / {unit}</span>
                </p>
                <Button variant="outline" size="sm" className="mt-4 w-full" asChild>
                  <a href="#plan-my-journey">Request quote</a>
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ── Outcome-oriented sections ──────────────────────────────── */}
      <section className="border-y border-border/60 bg-secondary/30 py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Built around what you need to deliver</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {OUTCOMES.map((o) => (
              <div
                key={o.t}
                className="rounded-2xl border border-border/60 bg-card/60 p-6 backdrop-blur-xl transition-colors hover:border-primary/40"
              >
                <h3 className="font-semibold">{o.t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{o.d}</p>
                <a href="#plan-my-journey" className="mt-4 inline-flex items-center text-sm text-primary">
                  Plan this movement<ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Lead capture ───────────────────────────────────────────── */}
      <section id="plan-my-journey" className="container mx-auto scroll-mt-24 px-4 py-16 md:py-20">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Concierge quotation</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Tell us the mission. We orchestrate the rest.
            </h2>
            <p className="mt-4 text-muted-foreground">
              A named mobility consultant returns a formal quotation with vehicle recommendation, route
              intelligence and governed pricing — plus portal access for procurement and approvals.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                { icon: Clock, t: "Response within one business day" },
                { icon: Sparkles, t: "AI vehicle recommendation with every quote" },
                { icon: Fuel, t: "Transparent booking fee, surcharge and commission" },
                { icon: FileCheck2, t: "Quote pre-fills your portal mission automatically" },
              ].map((r) => (
                <li key={r.t} className="flex items-start gap-3">
                  <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  {r.t}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trusted by</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {SECTORS.map((s) => (
                  <li key={s} className="rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur-md">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <CharterLeadForm categorySlug={category.slug} categoryLabel={category.label} />
        </div>
      </section>

      {/* ── Luxury journey timeline ────────────────────────────────── */}
      <section className="border-y border-border/60 bg-secondary/30 py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">How a SAFARID charter unfolds</h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {JOURNEY_TIMELINE.map((s, i) => (
              <li key={s.t} className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10">
                    <s.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Step {i + 1}
                  </span>
                </div>
                <h3 className="mt-3 font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Enterprise mobility ────────────────────────────────────── */}
      <section className="container mx-auto px-4 py-16 md:py-20">
        <div className="overflow-hidden rounded-3xl border border-border/60 bg-card/60 shadow-elegant backdrop-blur-xl">
          <div className="grid lg:grid-cols-2">
            <img
              src={enterpriseFleet}
              alt="Fleet manager reviewing charter operations in front of a row of executive coaches"
              loading="lazy"
              width={1280}
              height={832}
              className="h-64 w-full object-cover lg:h-full"
            />
            <div className="p-8 md:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Enterprise</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">Enterprise Mobility Solutions</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Procurement-ready charter for organisations that move people every week — governed pricing,
                authorised spend and a single audited invoice.
              </p>
              <ul className="mt-6 grid gap-2 sm:grid-cols-2">
                {ENTERPRISE_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild>
                  <Link to={portalHref} onClick={trackEntry("category_portal_button")}>Open the charter portal<ArrowRight className="ml-2 h-4 w-4" /></Link>
                </Button>
                <Button variant="outline" asChild>
                  <a href="#plan-my-journey">Talk to enterprise sales</a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
};

export default CharterCategoryPage;
