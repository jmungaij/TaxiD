import { NarrativePage } from "@/components/marketing/NarrativePage";
import { CONTACT } from "@/config/contact";

export default function Leadership() {
  return (
    <NarrativePage
      eyebrow="Company"
      title="Who runs SAFARID"
      subtitle="An early-stage, founder-led Kenyan company. Here is how responsibility is divided while the team is being built."
      path="/leadership"
      seoTitle="Leadership at SAFARID — How the Company Is Run"
      seoDescription="How responsibility is divided at SAFARID, an early-stage founder-led Kenyan mobility company, and how to reach the right team."
      intro={[
        "SAFARID is a young company based in Nairobi. Rather than list titles we have not filled, this page explains how the work is currently organised and who to contact for what.",
        "Named profiles will be published here as appointments are confirmed.",
      ]}
      sections={[
        {
          heading: "How the work is divided today",
          bullets: [
            "Commercial — corporate accounts, charter, rentals and leasing, partnerships and pricing.",
            "Operations — driver and fleet partner onboarding, dispatch, deliveries and day-to-day service quality.",
            "Finance — payments, settlements to partners, invoicing and tax.",
            "Technology — the platform itself, security and data protection.",
            "People — recruitment, training and the internship programme.",
          ],
        },
        {
          heading: "How decisions are kept honest at this size",
          body: [
            "A small team makes speed easy and control hard, so the platform carries the controls instead of relying on seniority: access is limited by role, sensitive actions are recorded, and money, contracts and pricing changes need a recorded approval.",
            "Our governance page describes those controls, including where a second approver is required.",
          ],
        },
        {
          heading: "Growing the team",
          body: [
            "We recruit through the platform's own recruitment process, including a structured internship programme for Kenyan graduates. Open roles are published on the careers page.",
          ],
        },
      ]}
      limits={{
        heading: "What this page deliberately does not claim",
        body: [
          "We do not list executives, advisers or board members we have not appointed, and we do not publish biographies we cannot stand behind.",
          `If you need to reach the office of the founders — for partnership, investment or press — email ${CONTACT.salesEmail} and mark it for leadership.`,
        ],
      }}
      cta={{
        label: "Work with us",
        to: "/careers",
        note: "Open roles and the internship programme are listed on the careers page.",
      }}
    />
  );
}
