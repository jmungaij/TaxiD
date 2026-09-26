/**
 * CHAUFFEUR-DRIVEN TRAVEL.
 *
 * Same discipline as self-drive: the day rate band, included kilometres,
 * metered distance and extra-hour rate come from the published rate card, and
 * the additional cost components shown are the governed fee components of the
 * road pricing profile — not marketing estimates. Nothing here claims a fleet
 * size, a response time or an inclusion the platform does not enforce.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, Clock, Route as RouteIcon, UserCheck } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RENTAL_HERO_SIZES, rentalHeroImage } from "@/lib/marketing/rentalImagery";
import { fetchPublicRateCard, kes, type PublicRateCard } from "@/lib/marketing/publicRateCard";
import { ASSET_PRICING_PROFILES } from "@/lib/charter/assetPricingProfiles";
import { trackRentalCtaImpression, trackRentalQuoteRequest } from "@/lib/marketing/rentalsFunnel";
import { useInViewOnce } from "@/hooks/useInViewOnce";
import { CONTACT } from "@/config/contact";
import { RentalQuoteForm } from "@/components/marketing/RentalQuoteForm";

const ROUTE = "/rentals/chauffeur";
const QUOTE_HREF = "#quote";

/** Chauffeured travel is quoted on the passenger road classes. */
const CHAUFFEUR_CLASSES = ["car", "van", "shuttle", "bus", "coach"];

const UNIT_LABEL: Record<string, string> = {
  per_day: "per day",
  per_km: "per kilometre",
  per_trip: "per trip",
  per_hour: "per hour",
  per_night: "per night",
};

const STANDARDS = [
  {
    icon: UserCheck,
    t: "Named, verified chauffeur",
    d: "The chauffeur assigned to your movement is a verified driver on the platform: licence, identity, police clearance status and vehicle documents are checked before activation, and the name appears on your confirmation.",
  },
  {
    icon: RouteIcon,
    t: "Distance and waiting are metered",
    d: "Your quotation carries a daily allowance of kilometres. Distance beyond it and hours beyond the booked window are charged at the published per-kilometre and extra-hour rates.",
  },
  {
    icon: Clock,
    t: "Multi-day movements priced as a schedule",
    d: "Airport transfers, roadshows and up-country trips are quoted as a schedule of days, with driver allowance and overnight costs shown as separate lines rather than folded into the day rate.",
  },
  {
    icon: BadgeCheck,
    t: "One governed price, then a contract",
    d: "Corporate movements are confirmed on a quotation drawn from the published rate card and executed under a mobility service contract, so the invoice can only match what you approved.",
  },
];

const RentalsChauffeur = () => {
  const hero = rentalHeroImage(ROUTE);
  const [card, setCard] = useState<PublicRateCard | null>(null);
  const [loading, setLoading] = useState(true);

  const heroRef = useInViewOnce<HTMLDivElement>(() =>
    trackRentalCtaImpression({ category: "chauffeur", surface: "hero", pageRoute: ROUTE, ctaLabel: "Get a quotation" }),
  );

  useEffect(() => {
    let alive = true;
    fetchPublicRateCard(CHAUFFEUR_CLASSES)
      .then((c) => alive && setCard(c))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const rows = card?.rows ?? [];
  const cheapest = rows.length ? rows[0] : null;
  /** Governed additional components for road movements (shuttle/van share ROAD_FEES). */
  const fees = ASSET_PRICING_PROFILES.shuttle.fees.filter((f) => !f.optional);

  return (
    <MarketingPage>
      <SeoHead
        title="Chauffeur service & executive transfers Kenya | SAFARID"
        description="Chauffeur-driven cars, vans, shuttles and coaches in Kenya. Verified chauffeurs, a published day-rate band, metered distance and every additional cost line stated up front."
        path={ROUTE}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: "Chauffeur-driven vehicle hire",
          serviceType: "Chauffeur service",
          provider: { "@type": "Organization", name: "SAFARID", url: "https://yalla-africa.lovable.app" },
          areaServed: { "@type": "Country", name: "Kenya" },
          ...(cheapest
            ? {
                offers: {
                  "@type": "Offer",
                  priceCurrency: "KES",
                  price: cheapest.minKes,
                  description: `From ${kes(cheapest.minKes)} per day with driver, ${cheapest.includedKmPerDay} km included`,
                },
              }
            : {}),
        }}
      />

      <PageHero
        eyebrow="Rentals & Leasing"
        title="Chauffeur-driven travel, priced before you travel."
        subtitle="Executive transfers, full-day movements, delegations and up-country trips — with a verified chauffeur and a quotation drawn from the published rate card."
        image={hero?.picture}
        imageAlt={hero?.alt}
        imageSizes={RENTAL_HERO_SIZES}
      >
        <div ref={heroRef} className="flex flex-wrap gap-3">
          <Button size="lg" asChild className="bg-ice text-primary hover:bg-ice/90">
            <Link
              to={QUOTE_HREF}
              onClick={() =>
                trackRentalQuoteRequest("quote", { category: "chauffeur", surface: "hero", pageRoute: ROUTE, target: QUOTE_HREF })
              }
            >
              Get a quotation
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="border-2 border-ice text-ice bg-primary/40 hover:bg-ice/20">
            <Link to="/corporate">Corporate mobility programmes</Link>
          </Button>
        </div>
      </PageHero>

      {/* ---------------- Rate card ---------------- */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-bold mb-3">Day rates with a chauffeur</h2>
          <p className="text-muted-foreground">
            Chauffeured movements are priced per operating day plus metered distance. The bands below are the published
            rate card; your quotation states the exact figure for your dates, your route and your account terms.
          </p>
        </div>

        {loading ? (
          <div className="mt-8 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-6">
            <h3 className="font-semibold mb-2">Rates are confirmed on quotation</h3>
            <p className="text-sm text-muted-foreground">
              The published rate card could not be read just now, so this page will not show a price. Send your
              itinerary and the desk will confirm the governed rate, or call {CONTACT.phoneDisplay}.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <caption className="sr-only">Published chauffeur rate card, version {card?.version}</caption>
                <thead className="bg-secondary/50 text-left">
                  <tr>
                    <th scope="col" className="p-4 font-semibold">Vehicle</th>
                    <th scope="col" className="p-4 font-semibold">Seats</th>
                    <th scope="col" className="p-4 font-semibold">Day band (with driver)</th>
                    <th scope="col" className="p-4 font-semibold">Included / day</th>
                    <th scope="col" className="p-4 font-semibold">Excess km</th>
                    <th scope="col" className="p-4 font-semibold">Extra hour</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.assetClass}-${r.label}-${r.minKes}`} className="border-t border-border">
                      <th scope="row" className="p-4 text-left font-medium">
                        {r.label}
                        {r.fleetGroup && (
                          <span className="block text-xs font-normal text-muted-foreground">{r.fleetGroup}</span>
                        )}
                      </th>
                      <td className="p-4 text-muted-foreground">{r.seats ?? "—"}</td>
                      <td className="p-4 font-semibold">
                        {kes(r.minKes)} – {kes(r.maxKes)}
                      </td>
                      <td className="p-4 text-muted-foreground">{r.includedKmPerDay} km</td>
                      <td className="p-4 text-muted-foreground">{kes(r.perKmKes)}/km</td>
                      <td className="p-4 text-muted-foreground">{kes(r.extraHourKes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="outline">Rate card version {card?.version}</Badge>
              <span>VAT {rows[0].vatPct}% applies.</span>
              <span>Corporate framework accounts are quoted contracted rates on account.</span>
            </div>
          </>
        )}
      </section>

      {/* ---------------- Additional components ---------------- */}
      <section className="bg-secondary/40 py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold mb-3">Additional lines you may see</h2>
          <p className="text-muted-foreground max-w-3xl mb-8">
            Road movements carry costs that depend on where you go, not on which vehicle you take. They are quoted as
            named lines at these governed defaults, so nothing appears on the invoice that was not on the quotation.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {fees.map((f) => (
              <div key={f.key} className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-semibold mb-1">{f.label}</h3>
                <p className="text-sm text-muted-foreground">
                  {kes(f.defaultKes)} {UNIT_LABEL[f.unit] ?? f.unit}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Standards ---------------- */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold mb-8">How a chauffeured movement is run</h2>
        <div className="grid gap-5 md:grid-cols-2">
          {STANDARDS.map((s) => (
            <div key={s.t} className="rounded-xl border border-border bg-card p-6">
              <s.icon className="h-6 w-6 text-primary mb-3" aria-hidden="true" />
              <h3 className="font-semibold mb-2">{s.t}</h3>
              <p className="text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-border bg-card p-8 max-w-3xl">
          <h2 className="text-2xl font-bold mb-3">Send your itinerary</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Give the desk your dates, pickup points and passenger numbers and you will receive a quotation drawn from the
            published rate card, with the vehicle class, kilometre allowance and additional lines itemised.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="bg-primary">
              <Link
                to={QUOTE_HREF}
                onClick={() =>
                  trackRentalQuoteRequest("quote", {
                    category: "chauffeur",
                    surface: "booking_flow",
                    pageRoute: ROUTE,
                    target: QUOTE_HREF,
                  })
                }
              >
                Request a chauffeur quotation
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/rentals/self-drive">Prefer to drive yourself?</Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Commercial desk: {CONTACT.phoneDisplay} · {CONTACT.salesEmail}
          </p>
        </div>
      </section>
      {/* ---------------- Quote & book ---------------- */}
      <section id="quote" className="container mx-auto scroll-mt-24 px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <RentalQuoteForm
            category="CHAUFFEUR"
            rateCard={card}
            pageRoute={ROUTE}
            heading="Get a firm chauffeured quote"
            intro="Choose the vehicle, your dates and the distance you expect to cover. We price it from the published rate card and give you a reference, a full breakdown and a payment link."
          />
        </div>
      </section>
    </MarketingPage>
  );
};

export default RentalsChauffeur;
