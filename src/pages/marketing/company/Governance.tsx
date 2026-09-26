import { NarrativePage } from "@/components/marketing/NarrativePage";

export default function Governance() {
  return (
    <NarrativePage
      eyebrow="Company"
      title="How Yalla Mobility controls its own decisions"
      subtitle="Separation of duties, recorded approvals and release gates that cannot be waved through — the controls a small company needs most."
      path="/governance"
      seoTitle="Governance at Yalla Mobility — Controls and Approvals"
      seoDescription="How Yalla Mobility governs decisions: role-based access, second-approver rules, recorded audit trails and evidence-based release gates."
      intro={[
        "Governance in an early-stage company is usually the first thing to be skipped. We have taken the opposite approach and put the controls into the platform, where they apply whether or not anyone is watching.",
        "This page describes the controls that exist today, in the systems our own staff use.",
      ]}
      sections={[
        {
          heading: "Access follows the job, not the person",
          body: [
            "Every staff dashboard and every operation is tied to a specific permission. There is no general-purpose administrator shortcut for business data, and access to sensitive records is denied unless a role explicitly grants it.",
          ],
        },
        {
          heading: "Sensitive actions need a second pair of eyes",
          bullets: [
            "Issuing or sealing a contract or a formal document.",
            "Approving a refund, a credit or a payout.",
            "Publishing a rate card or changing a price.",
            "Confirming that a vehicle is ready to be rented out.",
          ],
        },
        {
          heading: "Records cannot be quietly rewritten",
          body: [
            "Financial entries, document issuance, approvals and operational events are append-only: a correction is a new, attributed entry rather than an edit over the old one. That is what lets us reconstruct a decision later, and what makes an internal review meaningful.",
          ],
        },
        {
          heading: "A capability is released only against evidence",
          body: [
            "Before a service is opened to customers it must clear a register of controls — money handling, access isolation, availability integrity, recovery — and each control passes only on a recorded result from a real test. Where a business rule has not been decided, the release gate stays shut and the platform says which decision is missing.",
            "This is why some parts of the platform are visibly marked as not yet certified rather than quietly switched on.",
          ],
        },
        {
          heading: "Issues are escalated, not absorbed",
          body: [
            "Failures, payment mismatches, suspected fraud and disputes open a case with a severity and an owner. Serious matters are escalated for a human decision rather than resolved automatically.",
          ],
        },
      ]}
      limits={{
        heading: "What this page deliberately does not claim",
        body: [
          "We do not yet have an independent board or formally constituted audit, risk or remuneration committees, and we will not describe ourselves as if we do. As the company and its obligations grow, this page will be updated with the structures actually in place.",
          "We do not publish external audit reports, because none has been carried out.",
        ],
      }}
      cta={{
        label: "Ask about our controls",
        to: "/contact",
        note: "Investors, corporate customers and regulators are welcome to ask for detail on any control described here.",
      }}
    />
  );
}
