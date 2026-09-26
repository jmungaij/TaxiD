import { NarrativePage } from "@/components/marketing/NarrativePage";

export default function Innovation() {
  return (
    <NarrativePage
      eyebrow="Why SAFARID"
      title="How SAFARID is engineered"
      subtitle="An event-driven platform where rules are configured rather than coded, and where automated reasoning explains itself instead of deciding on its own."
      path="/innovation"
      seoTitle="Engineering & Innovation at SAFARID"
      seoDescription="How SAFARID is built: event-driven operations, configurable business rules, evidence-gated releases and AI used as a reasoning layer, not a decider."
      intro={[
        "SAFARID is being built as an operating platform for African mobility rather than a single booking app: rides, corporate travel, rentals and leasing, delivery and freight all run on the same core.",
        "Three engineering choices shape everything else — events, configurable policy, and evidence before release.",
      ]}
      sections={[
        {
          heading: "Everything that happens is an event",
          body: [
            "A quote, a payment, an allocation, a collection, a failure — each is recorded as an event that cannot be edited after the fact. Work is then driven from those events: notifications, reconciliation, escalations and reporting all read the same history instead of keeping private copies of the truth.",
            "That is what makes it possible to answer \"what actually happened on this booking?\" months later, in order, with references.",
          ],
        },
        {
          heading: "Business rules are configured, not buried in code",
          body: [
            "Rules such as when a vehicle may be offered, when full payment is required, or when an approval is needed are held as policies with a defined point at which they are evaluated. Changing a rule is a business decision recorded in the platform, not a code change nobody can trace.",
            "Where a rule has not been decided yet, the platform says so and blocks the action rather than guessing a default.",
          ],
        },
        {
          heading: "Automated reasoning that has to show its evidence",
          body: [
            "We use AI to read across our own operational records — to summarise a situation, rank what needs attention, and draft a recommendation. It is a reasoning layer over verified data; it is not the source of truth and it does not approve money, contracts or access.",
            "Answers are expected to distinguish a fact from an estimate, and to cite the records behind them.",
          ],
        },
        {
          heading: "Nothing is declared ready because the code exists",
          body: [
            "Each capability has a register of controls, and a control only passes when a real test against real infrastructure has produced a recorded result. Passing a unit test, or a developer's confidence, is explicitly not enough — which is why parts of the platform are visibly marked as not yet certified.",
          ],
        },
      ]}
      limits={{
        heading: "What this page deliberately does not claim",
        body: [
          "We do not publish model counts, latency figures or data-centre claims here. Where performance matters to a contract, it is measured and stated in that contract.",
        ],
      }}
      cta={{
        label: "Build on SAFARID",
        to: "/developers",
        note: "Partners and operators can integrate with the platform. The developer pages describe what is available today.",
      }}
    />
  );
}
