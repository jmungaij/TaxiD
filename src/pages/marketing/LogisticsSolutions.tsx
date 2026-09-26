/**
 * LOGISTICS SOLUTIONS.
 *
 * This page is a projection of the live service activation record. An offering
 * appears as bookable only when operations has activated it as BOOKABLE with
 * self-service booking; everything else is presented honestly as quoted by the
 * desk. Coverage, operating hours, delivery-evidence requirements and the
 * returns, claims and restricted-goods policies are read from that record, so
 * the website cannot promise a service the platform will refuse to accept.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Camera, Clock, FileCheck2, MapPin, PackageCheck, Scale, ShieldAlert } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchPublicOfferings,
  formatHours,
  podLabel,
  type PublicOffering,
} from "@/lib/marketing/publicServiceability";
import { CONTACT } from "@/config/contact";

const ROUTE = "/logistics/solutions";

const OfferingCard = ({ o }: { o: PublicOffering }) => {
  const hours = formatHours(o.hours);
  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold capitalize">{o.name}</h3>
        <Badge variant={o.lifecycle === "BOOKABLE" ? "default" : "outline"} className="shrink-0">
          {o.lifecycle === "BOOKABLE" ? "Book online" : "By quotation"}
        </Badge>
      </div>

      {o.description && <p className="text-sm text-muted-foreground mb-4">{o.description}</p>}

      <dl className="space-y-2 text-sm">
        {o.weightLimitKg && (
          <div className="flex items-start gap-2">
            <Scale className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dt className="sr-only">Weight range</dt>
              <dd className="text-muted-foreground">
                {o.weightLimitKg.min}–{o.weightLimitKg.max} kg per consignment
              </dd>
            </div>
          </div>
        )}
        {o.serviceAreas.length > 0 && (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dt className="sr-only">Coverage</dt>
              <dd className="text-muted-foreground capitalize">{o.serviceAreas.join(", ").toLowerCase()}</dd>
            </div>
          </div>
        )}
        {hours && (
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dt className="sr-only">Collection hours</dt>
              <dd className="text-muted-foreground">{hours}</dd>
            </div>
          </div>
        )}
        {o.slaTarget && (
          <div className="flex items-start gap-2">
            <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dt className="sr-only">Service target</dt>
              <dd className="text-muted-foreground">
                Target: {o.slaTarget}.{" "}
                {o.slaQualifier && <span className="italic">{o.slaQualifier}</span>}
              </dd>
            </div>
          </div>
        )}
        {o.podRequired.length > 0 && (
          <div className="flex items-start gap-2">
            <Camera className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dt className="sr-only">Proof of delivery</dt>
              <dd className="text-muted-foreground">
                Proof of delivery: {o.podRequired.map(podLabel).join(" + ")}
              </dd>
            </div>
          </div>
        )}
        {o.partnerEligibilityRequired && (
          <div className="flex items-start gap-2">
            <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dt className="sr-only">Carrier requirement</dt>
              <dd className="text-muted-foreground">
                Handled by an accredited carrier — capacity is committed per load before we confirm.
              </dd>
            </div>
          </div>
        )}
      </dl>

      <div className="mt-6 pt-4 border-t border-border">
        <Button asChild variant={o.lifecycle === "BOOKABLE" ? "default" : "outline"} className="w-full">
          <Link to={o.actionHref}>
            {o.actionLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </article>
  );
};

const LogisticsSolutions = () => {
  const [offerings, setOfferings] = useState<PublicOffering[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchPublicOfferings()
      .then((rows) => alive && setOfferings(rows))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const bookable = offerings.filter((o) => o.lifecycle === "BOOKABLE");
  const quoted = offerings.filter((o) => o.lifecycle === "ENQUIRY_ONLY");
  const policies = offerings.find((o) => o.returnsPolicy || o.claimsPolicy || o.restrictedGoodsPolicy);

  return (
    <MarketingPage>
      <SeoHead
        title="Logistics & delivery services in Kenya | Yalla Mobility"
        description="Parcel delivery, same-day city express, document courier, freight and e-commerce fulfilment in Kenya — with live coverage, collection hours and proof-of-delivery requirements."
        path={ROUTE}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: "Logistics and delivery services",
          serviceType: "Courier and freight logistics",
          provider: { "@type": "Organization", name: "Yalla Mobility", url: "https://yalla-africa.lovable.app" },
          areaServed: { "@type": "Country", name: "Kenya" },
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: "Logistics services",
            itemListElement: offerings.map((o) => ({
              "@type": "Offer",
              itemOffered: { "@type": "Service", name: o.name },
            })),
          },
        }}
      />

      <PageHero
        eyebrow="Logistics"
        title="Delivery and freight, only where we can actually serve you."
        subtitle="This page shows what our operations desk has activated right now — what you can book yourself, what we quote per load, and the coverage, hours and delivery evidence that apply to each."
      >
        <div className="flex flex-wrap gap-3">
          <Button size="lg" asChild className="bg-ice text-primary hover:bg-ice/90">
            <Link to="/logistics/quote">
              Get a business quote
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="border-2 border-ice text-ice bg-primary/40 hover:bg-ice/20">
            <Link to="/delivery/package">Send a parcel</Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="border-2 border-ice text-ice bg-primary/40 hover:bg-ice/20">
            <Link to="/delivery/enquiry">Talk to the freight desk</Link>
          </Button>
        </div>
      </PageHero>

      <section className="container mx-auto px-4 py-16">
        {loading ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-72 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        ) : offerings.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 max-w-2xl">
            <h2 className="text-2xl font-bold mb-2">Availability is confirmed by our desk</h2>
            <p className="text-sm text-muted-foreground">
              We could not read live serviceability just now, so this page will not state what is available. Call{" "}
              {CONTACT.phoneDisplay} or email {CONTACT.salesEmail} and the desk will confirm coverage for your route.
            </p>
          </div>
        ) : (
          <>
            {bookable.length > 0 && (
              <div className="mb-16">
                <h2 className="text-3xl font-bold mb-2">Book it yourself</h2>
                <p className="text-muted-foreground mb-8 max-w-3xl">
                  These services are live for self-service booking. Availability is checked against capacity and the
                  collection window at the moment you book, so a confirmed order is a real order.
                </p>
                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {bookable.map((o) => (
                    <OfferingCard key={o.code} o={o} />
                  ))}
                </div>
              </div>
            )}

            {quoted.length > 0 && (
              <div>
                <h2 className="text-3xl font-bold mb-2">Quoted per load</h2>
                <p className="text-muted-foreground mb-8 max-w-3xl">
                  Freight and fulfilment are not sold from a price list. We match your load to an accredited carrier,
                  commit the capacity and then quote — which is why these start with a conversation, not a checkout.
                </p>
                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {quoted.map((o) => (
                    <OfferingCard key={o.code} o={o} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {policies && (
        <section className="bg-secondary/40 py-16">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold mb-8">Before you ship</h2>
            <div className="grid gap-5 md:grid-cols-3">
              {policies.restrictedGoodsPolicy && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <ShieldAlert className="h-6 w-6 text-primary mb-3" aria-hidden="true" />
                  <h3 className="font-semibold mb-2">Restricted goods</h3>
                  <p className="text-sm text-muted-foreground">{policies.restrictedGoodsPolicy}</p>
                </div>
              )}
              {policies.returnsPolicy && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <PackageCheck className="h-6 w-6 text-primary mb-3" aria-hidden="true" />
                  <h3 className="font-semibold mb-2">Failed deliveries and returns</h3>
                  <p className="text-sm text-muted-foreground">{policies.returnsPolicy}</p>
                </div>
              )}
              {policies.claimsPolicy && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <FileCheck2 className="h-6 w-6 text-primary mb-3" aria-hidden="true" />
                  <h3 className="font-semibold mb-2">Claims</h3>
                  <p className="text-sm text-muted-foreground">{policies.claimsPolicy}</p>
                </div>
              )}
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Service targets are targets, not guarantees — they are subject to serviceability and available capacity.
              Freight desk: {CONTACT.phoneDisplay} · {CONTACT.salesEmail}
            </p>
          </div>
        </section>
      )}
    </MarketingPage>
  );
};

export default LogisticsSolutions;
