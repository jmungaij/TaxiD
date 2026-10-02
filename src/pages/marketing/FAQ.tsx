import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { Search, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { JsonLd } from "@/components/seo/JsonLd";

const data: Record<string, { q: string; a: string }[]> = {
  Riders: [
    { q: "How do I book a ride?", a: "Open the app, set your destination, choose a vehicle tier and confirm." },
    { q: "What payment methods are supported?", a: "M-Pesa, Visa/Mastercard, corporate wallet, personal wallet and cash." },
    { q: "How does airport transfer work?", a: "Flat fares with flight tracking and 60 minutes of free wait time." },
  ],
  Drivers: [
    { q: "How long does activation take?", a: "Typically 24–72 hours after documents are verified." },
    { q: "When do I get paid?", a: "Earnings settle to your M-Pesa wallet after every completed trip." },
  ],
  "Corporate Travel": [
    { q: "Can we enforce travel policies?", a: "Yes — geofences, time windows, vehicle tiers and budget caps are configurable per cost center." },
    { q: "Do you support ERP integrations?", a: "Yes. We export to SAP, Oracle, NetSuite, Xero and QuickBooks via API." },
  ],
  Deliveries: [
    { q: "Do you offer same-day delivery?", a: "Yes, in all major cities for orders placed before 2pm." },
    { q: "Is proof of delivery captured?", a: "Photo, signature and OTP-based ePOD is available on every parcel." },
  ],
  Rentals: [
    { q: "Can I rent without a driver?", a: "Yes — self-drive is available on Economy, SUV and Executive tiers." },
    { q: "What's the minimum rental period?", a: "1 hour for hourly rentals, 24 hours for daily contracts." },
  ],
  Payments: [
    { q: "Is M-Pesa Daraja used?", a: "Yes — Paybill 4573823 with automated reconciliation." },
    { q: "How are refunds handled?", a: "Refunds return to the original payment method within 1–3 business days." },
  ],
};

const FAQ = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQ);

  const handleSearch = (value: string) => {
    setQ(value);
    // Keep the ?q= parameter in sync so a Sitelinks Searchbox arrival
    // (and any shared/refreshed URL) reproduces the filtered view.
    setSearchParams(value ? { q: value } : {}, { replace: true });
  };

  const cats = Object.keys(data);

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: cats.flatMap((cat) =>
      data[cat].map((i) => ({
        "@type": "Question",
        name: i.q,
        acceptedAnswer: { "@type": "Answer", text: i.a },
      }))
    ),
  };

  return (
    <MarketingPage>
      <JsonLd data={faqJsonLd} />
      <PageHero eyebrow="FAQ" title="Help Center" subtitle="Search our knowledge base or chat with the TaxiD AI assistant.">
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-3 h-5 w-5 text-primary-foreground/60" />
          <Input value={q} onChange={(e) => handleSearch(e.target.value)} placeholder="Search the help center..." className="pl-10 bg-ice text-foreground border-0 h-12" />
        </div>
      </PageHero>

      <section className="container mx-auto px-4 py-16 max-w-4xl">
        {cats.map((cat) => {
          const items = data[cat].filter(i => !q || (i.q + i.a).toLowerCase().includes(q.toLowerCase()));
          if (!items.length) return null;
          return (
            <div key={cat} className="mb-8">
              <h2 className="text-xl font-bold mb-3 text-primary">{cat}</h2>
              <Accordion type="single" collapsible className="bg-card rounded-xl border border-border px-4">
                {items.map((i, idx) => (
                  <AccordionItem key={idx} value={`${cat}-${idx}`}>
                    <AccordionTrigger className="text-left">{i.q}</AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">{i.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          );
        })}
      </section>

      <div className="fixed bottom-6 right-6 z-40">
        <Button size="lg" className="rounded-full shadow-elegant bg-primary" asChild>
          <Link to="/support"><MessageCircle className="h-5 w-5 mr-2" />Chat with TaxiD AI</Link>
        </Button>
      </div>
    </MarketingPage>
  );
};

export default FAQ;
