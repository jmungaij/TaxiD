import { NarrativePage } from "@/components/marketing/NarrativePage";

export default function Compliance() {
  return (
    <NarrativePage
      eyebrow="Trust"
      title="Compliance in the Kenyan market"
      subtitle="The documents we check, the records we keep, and the obligations we work to as a Kenyan mobility company."
      path="/compliance"
      seoTitle="Compliance at Yalla Mobility — Kenya Requirements"
      seoDescription="How Yalla Mobility handles Kenyan compliance: partner document checks, KRA tax details, data-protection rights and recorded approvals."
      intro={[
        "Yalla Mobility operates in Kenya, so our compliance work is built around Kenyan requirements first: business registration and tax details, driver and vehicle documents, insurance validity, and the Data Protection Act, 2019.",
        "This page describes what the platform enforces today. Where a framework is not listed, we do not hold it.",
      ]}
      sections={[
        {
          heading: "Partners are onboarded on documents, not promises",
          body: [
            "Driver partners, fleet owners and corporate customers submit their documents through the platform, and those documents are recorded with their issue and expiry dates.",
          ],
          bullets: [
            "Business customers: certificate of incorporation, CR12, KRA PIN and tax compliance status.",
            "Driver and fleet partners: licence, vehicle registration, inspection and insurance documents.",
            "Expiry dates are tracked, and an expired document restricts what the partner can do.",
          ],
        },
        {
          heading: "Tax details are captured where the law requires them",
          body: [
            "KRA PIN details are collected for the customers and partners who need them for invoicing and withholding, and invoices are issued against the record in the platform rather than assembled by hand.",
          ],
        },
        {
          heading: "Data protection under the Kenyan Act",
          body: [
            "We collect personal data to deliver a journey, a rental or a delivery, and to meet legal obligations. You can ask for access to your data, correction of anything wrong, deletion of your account, a copy of your data, or to object to marketing.",
            "Our privacy and data-protection pages set out the detail, and requests are handled by our support team.",
          ],
        },
        {
          heading: "Approvals and access are controlled and recorded",
          body: [
            "Staff access to customer and financial data is limited by role. Sensitive steps — issuing a contract, approving a refund, changing a price — are recorded with who did them, and several require a second person to approve.",
          ],
        },
      ]}
      limits={{
        heading: "What this page deliberately does not claim",
        body: [
          "We do not claim ISO 27001, SOC 2, PCI DSS certification or GDPR representation. If you need a certification for a procurement process, ask us and we will tell you honestly what we hold and what we are working towards.",
          "Card payments, where offered, are processed by licensed payment providers; we do not present ourselves as a certified card processor.",
        ],
      }}
      cta={{
        label: "Procurement or due-diligence questions",
        to: "/contact",
        note: "Send your compliance questionnaire to our commercial team and we will complete it with what we can evidence.",
      }}
    />
  );
}
