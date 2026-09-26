import { Link } from "react-router-dom";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { JsonLd } from "@/components/seo/JsonLd";

type Faq = { q: string; a: string };

const groups: { title: string; items: Faq[] }[] = [
  {
    title: "Booking",
    items: [
      {
        q: "How do I book a ride, delivery, charter or lease?",
        a: "Choose your journey type on the homepage, enter pickup and destination (or asset and dates), review the transparent SmartFare quote, then confirm. Rides and deliveries are dispatched instantly; charter and leasing requests are matched to verified operators and confirmed once availability is validated.",
      },
      {
        q: "Can I book in advance or schedule recurring trips?",
        a: "Yes. Airport transfers, corporate shuttles and courier runs can be scheduled ahead of time, and corporate accounts can set up recurring trips with pre-approved cost centres and policy limits.",
      },
      {
        q: "Do I need an account to book?",
        a: "You can explore pricing without an account, but confirming a booking requires a free account so we can attach your trip history, receipts and support records.",
      },
    ],
  },
  {
    title: "Availability",
    items: [
      {
        q: "Where does SAFARID operate?",
        a: "Rides, deliveries and corporate mobility operate across major Kenyan urban corridors, with freight, charter and leasing available regionally through licensed partner operators.",
      },
      {
        q: "What happens if no vehicle or aircraft is available?",
        a: "The platform searches alternative operators and comparable asset classes automatically, and shows empty-leg or nearby-fleet options. If nothing meets your requirements, no quote is issued and you are not charged.",
      },
    ],
  },
  {
    title: "Payments",
    items: [
      {
        q: "Which payment methods are supported?",
        a: "M-Pesa is the primary payment and settlement rail, alongside corporate wallets, invoicing for approved enterprise accounts, and card payments where enabled.",
      },
      {
        q: "How is pricing calculated?",
        a: "Every quote uses the SmartFare engine: a base rate for the asset class plus distance/time, applicable charges, crew or driver costs, minus any corporate savings. Each component is itemised so you can see exactly what you pay for.",
      },
      {
        q: "When are drivers and operators paid?",
        a: "Driver and partner payouts settle in real time via M-Pesa once a trip or delivery is completed, with full reconciliation records available to both parties.",
      },
    ],
  },
  {
    title: "Tracking",
    items: [
      {
        q: "Can I track my trip or shipment live?",
        a: "Yes. Rides, deliveries and flights stream live status updates, ETAs and route progress. Logistics customers also get milestone events and proof-of-delivery evidence with timestamps.",
      },
      {
        q: "What proof do I get after a delivery?",
        a: "Each completed delivery records proof-of-delivery — recipient confirmation, timestamp and location evidence — attached permanently to the shipment record.",
      },
    ],
  },
  {
    title: "Enterprise mobility",
    items: [
      {
        q: "How do corporate accounts control spend?",
        a: "Corporate admins set travel policies, budgets per department or cost centre, approval workflows and trip-purpose categorisation. Spend is visible in real time with immutable audit logs and ERP-ready exports.",
      },
      {
        q: "What compliance and security controls are in place?",
        a: "Enterprise accounts get role-based access control, MFA, KYB verification (including CR12 and KRA PIN checks), insurance and licence validity monitoring, and complete audit trails for every action.",
      },
      {
        q: "How long does enterprise onboarding take?",
        a: "Most organisations are live within days. A specialist guides KYB verification, wallet funding, policy configuration and employee rollout.",
      },
    ],
  },
];

const allItems = groups.flatMap((g) => g.items);

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: allItems.map((i) => ({
    "@type": "Question",
    name: i.q,
    acceptedAnswer: { "@type": "Answer", text: i.a },
  })),
};

const HomeFaq = () => (
  <section id="faq" className="scroll-mt-24 bg-secondary/30 py-20" aria-labelledby="faq-heading">
    <JsonLd data={faqJsonLd} />
    <div className="container mx-auto px-4">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">FAQ</span>
        <h2 id="faq-heading" className="mt-3 text-3xl font-bold md:text-4xl">
          Everything you need to know.
        </h2>
        <p className="mt-4 text-muted-foreground">
          Booking, availability, payments, tracking and enterprise mobility — answered.
        </p>
      </div>

      <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </h3>
            <Accordion type="single" collapsible className="rounded-xl border border-border bg-card px-4">
              {group.items.map((item) => (
                <AccordionItem key={item.q} value={item.q}>
                  <AccordionTrigger className="text-left text-sm font-medium">{item.q}</AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        ))}
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground">
        Still have questions?{" "}
        <Link to="/contact" className="font-medium text-primary underline">
          Contact our team
        </Link>{" "}
        or{" "}
        <a href="#talk-to-sales" className="font-medium text-primary underline">
          talk to sales
        </a>
        .
      </p>
    </div>
  </section>
);

export default HomeFaq;
