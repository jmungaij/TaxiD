import { useState } from "react";
import { Link } from "react-router-dom";
import { SeoHead } from "@/components/seo/SeoHead";
import { Car, Crown, Gem, Bus, Truck, Building2, ArrowRight, Search, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { ResponsiveImage } from "@/components/marketing/ResponsiveImage";
import { classTierBand, estimateDailyRate, formatFromRate } from "@/lib/charter/estimatedDailyRate";
import type { AssetClass } from "@/lib/charter/assetPricingProfiles";
import {
  RENTAL_CATEGORY_IMAGES,
  RENTAL_CATEGORY_SIZES,
  RENTAL_HERO_SIZES,
  rentalHeroImage,
} from "@/lib/marketing/rentalImagery";
import {
  trackRentalCategorySelect,
  trackRentalCtaImpression,
  trackRentalQuoteRequest,
  trackRentalTabClick,
  trackRentalTabVisible,
} from "@/lib/marketing/rentalsFunnel";
import { useInViewOnce } from "@/hooks/useInViewOnce";


/**
 * Rental tiers price from the administrator's governed band via the estimated
 * daily rate calculator — no figure on this page is hard-coded.
 */
const TIERS: Array<{ icon: typeof Car; t: string; assetClass: AssetClass; tier: number; tiers: number }> = [
  { icon: Car, t: "Economy", assetClass: "car", tier: 0, tiers: 4 },
  { icon: Crown, t: "Executive", assetClass: "car", tier: 1, tiers: 4 },
  { icon: Gem, t: "Luxury", assetClass: "car", tier: 3, tiers: 4 },
  { icon: Truck, t: "SUVs", assetClass: "car", tier: 2, tiers: 4 },
  { icon: Bus, t: "Vans", assetClass: "van", tier: 0, tiers: 3 },
];

const categories = TIERS.map((tier) => ({
  icon: tier.icon,
  t: tier.t,
  d: formatFromRate(
    estimateDailyRate({
      assetClass: tier.assetClass,
      assetLabel: tier.t,
      band: classTierBand(tier.assetClass, tier.tier, tier.tiers),
      days: 1,
    }),
  ),
}));


const options = ["Hourly","Daily","Weekly","Monthly"];
const features = ["Driver included","Self-drive","Corporate rentals","Fleet rentals"];
const flow = ["Search","Select","Verify","Pay","Drive"];

/** Category card — owns its own impression observer so CTA view-through rate is measurable per tier. */
const CategoryCard = ({ c }: { c: { icon: typeof Car; t: string; d: string } }) => {
  const img = RENTAL_CATEGORY_IMAGES[c.t];
  const quoteHref = `/contact?subject=rental-enquiry&category=${encodeURIComponent(c.t)}`;
  const ref = useInViewOnce<HTMLDivElement>(() =>
    trackRentalCtaImpression({
      category: c.t,
      surface: "category_card",
      pageRoute: "/rentals",
      ctaLabel: "Get Quote",
    }),
  );

  return (
    <div ref={ref} className="flex flex-col overflow-hidden rounded-xl bg-card border border-border hover:shadow-elegant transition-shadow">
      {img && (
        <div className="aspect-[4/3] overflow-hidden bg-primary">
          <ResponsiveImage
            picture={img.picture}
            alt={img.alt}
            sizes={RENTAL_CATEGORY_SIZES}
            className="h-full w-full object-cover object-center"
          />
        </div>
      )}
      <div className="p-6 flex flex-col gap-3 flex-1">
        <div>
          <c.icon className="h-7 w-7 text-primary mb-3" aria-hidden="true" />
          <h3 className="font-semibold">{c.t}</h3>
          <p className="text-xs text-muted-foreground">{c.d}</p>
        </div>
        <Button
          asChild
          variant="outline"
          className="mt-auto min-h-11 w-full border-primary/40 text-primary"
        >
          <Link
            to={quoteHref}
            onClick={() => {
              trackRentalCategorySelect({ category: c.t, surface: "category_card", pageRoute: "/rentals" });
              trackRentalQuoteRequest("quote", {
                category: c.t,
                surface: "category_card",
                pageRoute: "/rentals",
                target: quoteHref,
              });
            }}
          >
            Get Quote
          </Link>
        </Button>
      </div>
    </div>
  );
};

const Rentals = () => {
  const hero = rentalHeroImage("/rentals");
  const [activeOption, setActiveOption] = useState(options[1]);
  const heroRef = useInViewOnce<HTMLDivElement>(() =>
    trackRentalCtaImpression({
      category: "rentals-hub",
      surface: "hero_search",
      pageRoute: "/rentals",
      ctaLabel: "Search",
    }),
  );
  const tabsRef = useInViewOnce<HTMLDivElement>(() =>
    trackRentalTabVisible(activeOption, {
      category: "rentals-hub",
      surface: "rental_options",
      pageRoute: "/rentals",
    }),
  );
  const closingRef = useInViewOnce<HTMLDivElement>(() =>
    trackRentalCtaImpression({
      category: "Corporate Fleet",
      surface: "booking_flow",
      pageRoute: "/rentals",
      ctaLabel: "Corporate Fleet Enquiry",
    }),
  );

  return (
  <MarketingPage>
    <SeoHead
      title="Car rentals — self-drive, chauffeur, bus & coach | Yalla Mobility"
      description="Rent by the hour, day or week. Self-drive, chauffeur services, bus & coach booking and corporate fleet leasing across Kenya."
      path="/rentals"
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "Service",
        serviceType: "Vehicle rental",
        name: "Car rentals — self-drive, chauffeur, bus & coach | Yalla Mobility",
        description: "Rent by the hour, day or week. Self-drive, chauffeur services, bus & coach booking and corporate fleet leasing across Kenya.",
        provider: { "@type": "Organization", name: "Yalla Mobility", url: "https://yalla-africa.lovable.app" },
        areaServed: "Africa",
        url: "https://yalla-africa.lovable.app/rentals",
      }}
    />

    <PageHero
      eyebrow="Car Rentals"
      title="The continent's most flexible car rental marketplace."
      subtitle="From an hour in town to a month-long fleet contract — book in minutes."
      image={hero?.picture}
      imageAlt={hero?.alt}
      imageSizes={RENTAL_HERO_SIZES}
    />

    <section className="container mx-auto px-4 -mt-8">
      <div ref={heroRef} className="bg-card rounded-2xl shadow-elegant border border-border p-6 grid md:grid-cols-5 gap-3">
        <Input placeholder="Pickup location" aria-label="Pickup location" />
        <Input type="date" aria-label="Pickup date" />
        <Input type="date" aria-label="Return date" />
        <Input placeholder="Vehicle type" aria-label="Vehicle type" />
        <Button className="bg-primary" type="submit"><Search className="h-4 w-4 mr-1" />Search</Button>
      </div>
    </section>

    <section className="container mx-auto px-4 py-20">
      <h2 className="text-3xl font-bold text-center mb-10">Vehicle Categories</h2>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {categories.map((c) => (
          <CategoryCard key={c.t} c={c} />
        ))}
      </div>
    </section>

    <section className="bg-secondary/40 py-20">
      <div className="container mx-auto px-4 grid md:grid-cols-2 gap-12">
        <div>
          <h2 className="text-2xl font-bold mb-6">Rental options</h2>
          <div ref={tabsRef} role="tablist" aria-label="Rental options" className="grid grid-cols-2 gap-3">
            {options.map((o) => (
              <button
                key={o}
                type="button"
                role="tab"
                aria-selected={activeOption === o}
                onClick={() => {
                  setActiveOption(o);
                  trackRentalTabClick(o, { category: o, surface: "rental_options", pageRoute: "/rentals" });
                }}
                className={`min-h-11 p-4 rounded-lg border text-center font-medium transition-colors ${
                  activeOption === o
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border hover:border-primary/40"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-6">Features</h2>
          <div className="grid grid-cols-2 gap-3">
            {features.map((f) => (
              <div key={f} className="p-4 rounded-lg bg-card border border-border flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-status-success" /><span className="text-sm font-medium">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>

    <section className="container mx-auto px-4 py-20">
      <h2 className="text-3xl font-bold text-center mb-10">Booking flow</h2>
      <div className="flex flex-wrap justify-center gap-4 max-w-4xl mx-auto">
        {flow.map((s, i) => (
          <div key={s} className="flex items-center">
            <div className="px-5 py-3 rounded-full bg-primary text-primary-foreground font-semibold">{s}</div>
            {i < flow.length - 1 && <ArrowRight className="mx-2 h-5 w-5 text-muted-foreground" />}
          </div>
        ))}
      </div>
      <div ref={closingRef} className="text-center mt-10">
        <Button size="lg" asChild>
          <Link
            to="/contact?subject=fleet-rental-enquiry&category=Corporate%20Fleet"
            onClick={() =>
              trackRentalQuoteRequest("enquire", {
                category: "Corporate Fleet",
                surface: "booking_flow",
                pageRoute: "/rentals",
                target: "/contact?subject=fleet-rental-enquiry",
              })
            }
          >
            <Building2 className="h-4 w-4 mr-2" aria-hidden="true" />Corporate Fleet Enquiry
          </Link>
        </Button>
      </div>
    </section>
  </MarketingPage>
  );
};

export default Rentals;
