import { NarrativePage } from "@/components/marketing/NarrativePage";

export default function Reliability() {
  return (
    <NarrativePage
      eyebrow="Why TaxiD"
      title="How TaxiD keeps journeys and payments dependable"
      subtitle="What actually happens behind a booking, a payment and a handover — described plainly, without numbers we cannot evidence."
      path="/reliability"
      seoTitle="Reliability at TaxiD — How Bookings Hold Up"
      seoDescription="How TaxiD protects bookings and payments: verified M-Pesa confirmation, no double charges, recorded handovers and daily reconciliation."
      intro={[
        "Reliability, for a mobility platform, is not a slogan. It is whether the vehicle you were promised is actually free, whether the money you paid is actually recorded, and whether someone notices when a step fails.",
        "TaxiD is an early-stage Kenyan company, so instead of publishing service statistics we cannot yet stand behind, this page describes the controls that are built into the platform today.",
      ]}
      sections={[
        {
          heading: "A booking is only confirmed once the money is verified",
          body: [
            "When you pay for a rental or a booking, the platform does not take your word for it and it does not take the payment screen's word for it. It confirms the payment against the M-Pesa record itself. Only then is the booking confirmed and a specific vehicle assigned to your dates.",
            "If the same payment or request arrives twice — a retried tap, a repeated callback, a poor connection — it is recognised as the same request. You cannot be charged twice and the same vehicle cannot be committed twice.",
          ],
        },
        {
          heading: "Availability is worked out by the platform, never assumed",
          body: [
            "A vehicle can only be offered when a real unit of that class is free for your dates, is not in maintenance, and has passed its readiness checks. Prices come from the published rate card, calculated on the server, so a page cannot show you a figure the business has not approved.",
          ],
          bullets: [
            "Overlapping reservations on the same vehicle are rejected at the database level, not by the website.",
            "A vehicle that has not completed readiness checks cannot be booked at all.",
            "Quotes carry a reference and a firm price, and they expire rather than drift.",
          ],
        },
        {
          heading: "When something fails, it is caught rather than lost",
          body: [
            "Every meaningful step — a quote, a payment, an allocation, a handover, a change request — is written to an append-only record with its own reference. Failed steps are retried automatically where that is safe, and where it is not, the case is raised to the operations team instead of quietly disappearing.",
            "Money is reconciled on a schedule against the payment records, so a mismatch surfaces as an item of work rather than as a surprise weeks later.",
          ],
        },
        {
          heading: "Handovers are recorded, not remembered",
          body: [
            "Collection and return are captured with odometer, fuel level, condition notes and photographs. That record is what settles a later question about damage or mileage, which protects the customer as much as the operator.",
          ],
        },
      ]}
      limits={{
        heading: "What this page deliberately does not claim",
        body: [
          "We do not publish an uptime percentage, a payout speed or a transaction count, because we do not yet have an audited measurement period behind those figures. When we do, we will publish the measurement, not an estimate.",
          "Service commitments for enterprise customers are set in the signed contract, which is the only place a response or resolution time is binding.",
        ],
      }}
      cta={{
        label: "Need reliability commitments in writing?",
        to: "/contact",
        note: "Enterprise and corporate agreements can include specific operational commitments. Our commercial team can take you through what is available today.",
      }}
    />
  );
}
