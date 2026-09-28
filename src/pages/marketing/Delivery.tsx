import { JsonLd } from "@/components/seo/JsonLd";
import MarketingLayout from "@/components/marketing/MarketingLayout";
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
