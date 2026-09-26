import { NarrativePage } from "@/components/marketing/NarrativePage";

export default function Transparency() {
  return (
    <NarrativePage
      eyebrow="Why Yalla"
      title="What you can see before, during and after a booking"
      subtitle="Prices you can check, references you can quote, records you can ask for — and a clear answer when a number simply is not available."
      path="/transparency"
      seoTitle="Transparency at Yalla Mobility — Prices and Records"
      seoDescription="See how Yalla Mobility shows prices before payment, issues references and receipts, and reports corporate spending without hidden fees."
      intro={[
        "Most disputes in transport come from someone not being able to check something: the fare, the extras, who authorised the trip, what the vehicle looked like at collection.",
        "This page sets out what Yalla Mobility shows you, and where the record lives when you need to go back to it.",
      ]}
      sections={[
        {
          heading: "Prices come from a published rate card",
          body: [
            "Rental and chauffeur rates, included kilometres and the charge for exceeding them are published on the service pages before you commit to anything. The amount you are asked to pay is calculated on our servers from that same rate card.",
            "A quote is issued with a reference and a firm total, so what you were offered can be checked against what you were charged.",
          ],
        },
        {
          heading: "Every step leaves a record with a reference",
          bullets: [
            "Quote references you can quote back to support.",
            "Payments matched to the M-Pesa record, with a receipt.",
            "Collection and return recorded with condition notes and photographs.",
            "Change and cancellation requests logged with who asked and when.",
          ],
        },
        {
          heading: "Corporate customers see their own spending",
          body: [
            "Organisations that book through Yalla get a view of their own bookings, who requested them, which cost centre they belong to and what was invoiced. Approval steps are recorded, so a finance team can see not just the cost but the authorisation behind it.",
          ],
        },
        {
          heading: "When we do not know, we say so",
          body: [
            "Our internal dashboards are built to show \"not available\" rather than fill a gap with an estimate, and we hold public pages to the same rule. If a figure is not on this site, it is because we cannot yet evidence it.",
          ],
        },
      ]}
      limits={{
        heading: "What this page deliberately does not claim",
        body: [
          "We do not currently run a public status page or publish an audit report, so please do not read this page as either.",
          "Requests for records about your own bookings or personal data go to our support team, who work to the rights set out in our privacy pages.",
        ],
      }}
      cta={{
        label: "Ask for a record",
        to: "/contact",
        note: "Need a receipt, a quote breakdown or a copy of a handover record? Contact support with the reference and we will retrieve it.",
      }}
    />
  );
}
