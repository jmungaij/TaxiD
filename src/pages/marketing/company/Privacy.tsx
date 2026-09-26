import { NarrativePage } from "@/components/marketing/NarrativePage";
import { CONTACT } from "@/config/contact";

export default function Privacy() {
  return (
    <NarrativePage
      eyebrow="Trust"
      title="Your personal data at Yalla Mobility"
      subtitle="What we collect to move you or your goods, why we need it, how long we keep it, and how to exercise your rights."
      path="/privacy"
      seoTitle="Privacy at Yalla Mobility — Your Data and Rights"
      seoDescription="What personal data Yalla Mobility collects, why it is needed, who can see it, and how to access, correct, export or delete your information."
      intro={[
        "Moving people and goods requires some personal information: who to collect, where from, how to reach you, and how you paid. We aim to collect what the journey needs and no more.",
        "This page is a plain summary. The full Privacy Policy and Data Protection pages in our legal library are the binding documents.",
      ]}
      sections={[
        {
          heading: "What we collect and why",
          bullets: [
            "Contact details — so a driver, courier or agent can reach you and we can send confirmations.",
            "Booking details, including pickup and drop-off — to plan and complete the journey or delivery.",
            "Payment references from M-Pesa or your chosen method — to confirm payment and issue receipts. We do not store card numbers.",
            "Documents you upload, such as a driving licence for a self-drive rental — to meet the checks required for that service.",
            "Basic device and usage information — to keep accounts secure and detect fraud.",
          ],
        },
        {
          heading: "Who can see it",
          body: [
            "Staff access is limited by role, so a person only sees the data their work requires. Service partners see what they need to complete your job — a driver sees where to collect you, not your payment history.",
            "We share data with providers who process payments, send messages, or host the platform, and with authorities where the law requires it.",
          ],
        },
        {
          heading: "Your rights",
          bullets: [
            "Access — ask for a copy of what we hold about you.",
            "Correction — have inaccurate details fixed.",
            "Deletion — close your account and have personal data removed, except records we must keep for tax or legal reasons.",
            "Portability — receive your data in a machine-readable format.",
            "Object or withdraw consent — including opting out of marketing at any time.",
          ],
        },
        {
          heading: "How long we keep it",
          body: [
            "Booking, payment and invoice records are kept for the periods Kenyan tax and accounting rules require. Data that is no longer needed for a service or a legal obligation is removed.",
          ],
        },
      ]}
      limits={{
        heading: "Where to go next",
        body: [
          "The full Privacy Policy and the Data Protection page in our legal library set out categories, processors and retention periods in detail.",
          `To exercise any right above, email ${CONTACT.supportEmail} from the address on your account, or call ${CONTACT.phoneDisplay}.`,
        ],
      }}
      cta={{
        label: "Read the full policy",
        to: "/legal/privacy",
        note: "The complete Privacy Policy, cookie notice and data-protection statement are in the legal library.",
      }}
    />
  );
}
