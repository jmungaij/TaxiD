import { NarrativePage } from "@/components/marketing/NarrativePage";

export default function Sustainability() {
  return (
    <NarrativePage
      eyebrow="Company"
      title="Sustainability: what we can measure, and what we won't guess"
      subtitle="Our position on emissions, vehicle use and livelihoods as a young Kenyan mobility company — written without offsets we have not bought or savings we have not measured."
      path="/sustainability"
      seoTitle="Sustainability at TaxiD — An Honest Position"
      seoDescription="TaxiD's honest sustainability position: measurable vehicle utilisation and paperless operations today, no unverified emissions or offset claims."
      intro={[
        "Transport is a significant source of emissions, and a mobility platform that ignores that is not credible. Nor is one that publishes a carbon figure it cannot substantiate.",
        "So this page states two things: what we can genuinely influence today, and what we refuse to claim until it is measured.",
      ]}
      sections={[
        {
          heading: "Using vehicles better is the first real lever",
          body: [
            "The most immediate environmental gain available to us is simply fewer empty and duplicated trips: matching a request to a vehicle that is already nearby, filling return legs, and helping fleet owners keep their vehicles working rather than idle.",
            "Because every trip, route and rental is recorded, utilisation is something we can actually measure over time rather than estimate.",
          ],
        },
        {
          heading: "Paperless by default",
          body: [
            "Quotes, contracts, receipts, invoices, proof of delivery and handover records are digital and stored against the booking. For corporate customers this removes a paper trail that would otherwise be printed, couriered and filed.",
          ],
        },
        {
          heading: "Cleaner vehicles as the fleet allows",
          body: [
            "The vehicles on the platform belong to driver partners and fleet owners, so our influence is through what we list, what we prioritise and what we help finance. As electric and hybrid vehicles become practical for Kenyan operating conditions, we intend to support them explicitly in our categories and leasing offers.",
          ],
        },
        {
          heading: "Livelihoods count as sustainability too",
          body: [
            "Our partners are small businesses and individual drivers. Predictable work, payment that arrives when it should, and clear terms are part of whether this industry is sustainable for the people in it — and they are things we control directly.",
          ],
        },
      ]}
      limits={{
        heading: "What this page deliberately does not claim",
        body: [
          "We publish no emissions figure, no carbon-per-trip number, no offset programme and no net-zero date. We have not measured or purchased any of those, and an unverified figure would be worse than silence.",
          "When we begin measuring, we will publish the method alongside the result so it can be challenged.",
        ],
      }}
      cta={{
        label: "Corporate reporting needs",
        to: "/contact",
        note: "If your organisation needs travel data for its own sustainability reporting, tell us what you must report and we will explain what we can supply from your booking records.",
      }}
    />
  );
}
