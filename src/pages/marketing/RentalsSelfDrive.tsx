/**
 * SELF-DRIVE RENTALS — a real commercial page, not a placeholder.
 *
 * Every figure on this page comes from the administrator's published rate card
 * (`asset_pricing_versions` / `asset_pricing_bands`) through the public
 * projection. Nothing is hard-coded: when no rate card is published the page
 * says the price is confirmed on quotation instead of inventing one.
 *
 * The page also refuses to claim fleet availability. Vehicles are supplied by
 * verified operators, so the honest promise is the verification standard and
 * the governed rate card — not a vehicle count.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, FileText, GaugeCircle, ShieldCheck } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RENTAL_HERO_SIZES, rentalHeroImage } from "@/lib/marketing/rentalImagery";
import { BASIS_LABEL, fetchPublicRateCard, kes, type PublicRateCard } from "@/lib/marketing/publicRateCard";
import { trackRentalCtaImpression, trackRentalQuoteRequest } from "@/lib/marketing/rentalsFunnel";
import { useInViewOnce } from "@/hooks/useInViewOnce";
import { CONTACT } from "@/config/contact";
import { RentalQuoteForm } from "@/components/marketing/RentalQuoteForm";

const ROUTE = "/rentals/self-drive";
const QUOTE_HREF = "#quote";

/** Self-drive covers road classes a customer may drive themselves. */
const SELF_DRIVE_CLASSES = ["car", "van", "shuttle"];

/** Rental agreement fields the platform issues on every self-drive contract. */
const AGREEMENT_FIELDS = [
  "Vehicle and registration",
  "Rental period",
  "Mileage at handover and return",
  "Fuel policy",
  "Insurance cover in force",
  "Damage deposit",
  "Keys issued",
  "Vehicle inspection record",
];

const VERIFICATION = [
  {
    icon: ShieldCheck,
    t: "Operators verified before activation",
    d: "Driving licence, vehicle registration, insurance, inspection and operating authorisation are verified before an operator may list a vehicle, and re-verified when a document expires.",
  },
  {
    icon: GaugeCircle,
    t: "Mileage metered, not estimated",
    d: "Each class includes a daily kilometre allowance. Distance beyond the allowance is metered at the published per-kilometre rate — there is no discretionary surcharge.",
  },
  {
    icon: FileText,
    t: "Written agreement and receipt",
    d: "Every rental issues an agreement and a receipt carrying the vehicle, period, mileage, fuel policy, insurance, deposit and inspection record.",
  },
];

const RentalsSelfDrive = () => {
  const hero = rentalHeroImage(ROUTE);
  const [card, setCard] = useState<PublicRateCard | null>(null);
  const [loading, setLoading] = useState(true);

  const heroRef = useInViewOnce<HTMLDivElement>(() =>
    trackRentalCtaImpression({ category: "self-drive", surface: "hero", pageRoute: ROUTE, ctaLabel: "Get a quotation" }),
  );

  useEffect(() => {
    let alive = true;
    fetchPublicRateCard(SELF_DRIVE_CLASSES)
      .then((c) => alive && setCard(c))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const rows = card?.rows ?? [];
  const cheapest = rows.length ? rows[0] : null;

  return (
    <MarketingPage>
      <SeoHead
        title="Self-drive car & van rental in Nairobi | TaxiD"
        description="Self-drive cars, vans and shuttles in Kenya on a published rate card: daily band, included kilometres, metered excess mileage, corporate discount and VAT stated up front."
        path={ROUTE}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: "Self-drive vehicle rental",
          serviceType: "Car rental",
          provider: { "@type": "Organization", name: "TaxiD", url: "https://yalla-africa.lovable.app" },
          areaServed: { "@type": "Country", name: "Kenya" },
          ...(cheapest
            ? {
                offers: {
                  "@type": "Offer",
                  priceCurrency: "KES",
                  price: cheapest.minKes,
                  description: `From ${kes(cheapest.minKes)} per day, ${cheapest.includedKmPerDay} km included`,
                },
              }
            : {}),
        }}
      />

      <PageHero
        eyebrow="Rentals & Leasing"
        title="Self-drive rentals on a published rate card."
        subtitle="Cars, vans and shuttles by the day, week or month — with the daily band, included kilometres and every metered charge stated before you book."
        image={hero?.picture}
        imageAlt={hero?.alt}
        imageSizes={RENTAL_HERO_SIZES}
      >
        <div ref={heroRef} className="flex flex-wrap gap-3">
          <Button size="lg" asChild className="bg-ice text-primary hover:bg-ice/90">
            <Link
              to={QUOTE_HREF}
              onClick={() =>
                trackRentalQuoteRequest("quote", { category: "self-drive", surface: "hero", pageRoute: ROUTE, target: QUOTE_HREF })
              }
            >
              Get a quotation
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="border-2 border-ice text-ice bg-primary/40 hover:bg-ice/20">
            <Link to="/rentals">See all rental categories</Link>
          </Button>
        </div>
      </PageHero>

      {/* ---------------- Governed rate card ---------------- */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-bold mb-3">What a self-drive rental costs</h2>
          <p className="text-muted-foreground">
            These bands are the administrator's published rate card. The final figure on your quotation depends on the
            dates, the distance and your account terms — the band, the included kilometres and the metered rates never
            change without a new published version.
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
              The published rate card could not be read just now, so this page will not show a price. Request a
              quotation and the desk will confirm the governed rate for your dates, or call {CONTACT.phoneDisplay}.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Published self-drive rate card, version {card?.version}
                </caption>
                <thead className="bg-secondary/50 text-left">
                  <tr>
                    <th scope="col" className="p-4 font-semibold">Vehicle class</th>
                    <th scope="col" className="p-4 font-semibold">Seats</th>
                    <th scope="col" className="p-4 font-semibold">Daily band</th>
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
                        <span className="block text-xs font-normal text-muted-foreground">
                          {BASIS_LABEL[r.basis]}
                        </span>
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

      {/* ---------------- What is verified ---------------- */}
      <section className="bg-secondary/40 py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold mb-8">What you can rely on</h2>
          <div className="grid gap-5 md:grid-cols-3">
            {VERIFICATION.map((v) => (
              <div key={v.t} className="rounded-xl border border-border bg-card p-6">
                <v.icon className="h-6 w-6 text-primary mb-3" aria-hidden="true" />
                <h3 className="font-semibold mb-2">{v.t}</h3>
                <p className="text-sm text-muted-foreground">{v.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Agreement contents ---------------- */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold mb-3">On your rental agreement</h2>
            <p className="text-muted-foreground mb-6">
              Self-drive is a custody handover, so the paperwork records the state of the vehicle in both directions.
              Every rental issues these fields — before you drive away and again when you return the vehicle.
            </p>
            <ul className="space-y-2">
              {AGREEMENT_FIELDS.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-card p-8">
            <h2 className="text-2xl font-bold mb-3">Rent for a day, a month or a fleet</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Single vehicles are quoted from the rate card above. Multi-vehicle and multi-month requirements are
              contracted through corporate leasing, where the rate is fixed for the term of the agreement.
            </p>
            <div className="flex flex-col gap-3">
              <Button asChild className="bg-primary">
                <Link
                  to={QUOTE_HREF}
                  onClick={() =>
                    trackRentalQuoteRequest("quote", {
                      category: "self-drive",
                      surface: "booking_flow",
                      pageRoute: ROUTE,
                      target: QUOTE_HREF,
                    })
                  }
                >
                  Request a self-drive quotation
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/rentals/corporate-leasing">Corporate leasing for fleets</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/rentals/chauffeur">Prefer a chauffeur? See chauffeured travel</Link>
              </Button>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Commercial desk: {CONTACT.phoneDisplay} · {CONTACT.salesEmail}
            </p>
          </div>
        </div>
      </section>
      {/* ---------------- Quote & book ---------------- */}
      <section id="quote" className="container mx-auto scroll-mt-24 px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <RentalQuoteForm
            category="SELF_DRIVE"
            rateCard={card}
            pageRoute={ROUTE}
            heading="Get a firm self-drive quote"
            intro="Choose the vehicle, your dates and the distance you expect to cover. We price it from the published rate card and give you a reference, a full breakdown and a payment link."
          />
        </div>
      </section>
    </MarketingPage>
  );
};

export default RentalsSelfDrive;
