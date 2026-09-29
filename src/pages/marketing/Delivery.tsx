import { JsonLd } from "@/components/seo/JsonLd";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import deliveryScene from "@/assets/delivery/taxid-delivery-scene.jpg";
import parcelScene from "@/assets/delivery/taxid-parcel-scene.jpg";
import logisticsScene from "@/assets/delivery/taxid-logistics-scene.jpg";
import { DeliveryHero } from "@/components/delivery/landing/DeliveryHero";
import {
  DeliveryMarketplace,
  DeliveryValue,
  DeliveryJourney,
  DeliveryTracking,
  DeliveryBusiness,
  DeliveryNetwork,
  DeliveryStories,
  DeliveryAssistant,
  DeliveryFinalCta,
} from "@/components/delivery/landing/DeliverySections";

/**
 * Public Delivery & Logistics Experience Platform (DLEP) landing page.
 *
 * Presentation and journey only: Discover → Understand → Trust → Quote →
 * Book → Track. All booking hand-offs route into the existing delivery
 * surfaces; no operational metrics are exposed here.
 */
const Delivery = () => (
  <MarketingLayout>
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Service",
        serviceType: "Delivery and logistics",
        provider: { "@type": "Organization", name: "TaxiD" },
        areaServed: { "@type": "Country", name: "Kenya" },
        description:
          "Parcel delivery, courier, express city delivery, freight, truck dispatch, warehousing and corporate logistics across Kenya and East Africa.",
      }}
    />
    <DeliveryHero />
    <section className="border-b border-border bg-background py-14" aria-label="TaxiD delivery services">
      <div className="container mx-auto grid gap-10 px-4 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="text-sm font-semibold text-primary">TaxiD Delivery</p>
          <h2 className="mt-2 text-3xl font-bold">From your door to theirs.</h2>
          <p className="mt-4 max-w-xl text-muted-foreground">Packages, important documents and time-sensitive collections. Tell us what you are sending, compare your options and keep track of the handoff.</p>
           <div className="mt-6 flex flex-wrap gap-3"><Button asChild><Link to="/delivery/package">Send a package</Link></Button><Button variant="outline" asChild><Link to="/business/portal?service=delivery">Request business parcel services</Link></Button><Button variant="outline" asChild><Link to="/track">Track a shipment</Link></Button></div>
        </div>
        <img src={parcelScene} width={1200} height={912} loading="lazy" alt="A courier hands a sealed parcel to its recipient" className="aspect-[4/3] w-full object-cover" />
      </div>
    </section>
    <section className="container mx-auto grid gap-6 px-4 py-14 md:grid-cols-2" aria-label="More ways to move">
      <Link to="/delivery/courier" className="group block overflow-hidden border border-border"><img src={deliveryScene} width={1600} height={1008} loading="lazy" alt="TaxiD courier and van serving city deliveries" className="aspect-[16/9] w-full object-cover" /><div className="p-5"><h2 className="text-xl font-semibold group-hover:text-primary">Courier & express</h2><p className="mt-2 text-sm text-muted-foreground">Explore document delivery and urgent city collections.</p></div></Link>
      <Link to="/logistics/solutions" className="group block overflow-hidden border border-border"><img src={logisticsScene} width={1600} height={1008} loading="lazy" alt="Freight trucks and parcels at a logistics hub" className="aspect-[16/9] w-full object-cover" /><div className="p-5"><h2 className="text-xl font-semibold group-hover:text-primary">Business logistics</h2><p className="mt-2 text-sm text-muted-foreground">Explore freight, distribution and managed delivery for businesses.</p></div></Link>
    </section>
    <DeliveryMarketplace />
    <DeliveryValue />
    <DeliveryJourney />
    <DeliveryTracking />
    <DeliveryBusiness />
    <DeliveryNetwork />
    <DeliveryStories />
    <DeliveryAssistant />
    <DeliveryFinalCta />
  </MarketingLayout>
);

export default Delivery;
