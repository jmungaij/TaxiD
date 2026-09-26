import { useLocation } from "react-router-dom";
import { Mail, Phone, MapPin, MessageCircle, Briefcase, LifeBuoy } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { ContactForm } from "@/components/marketing/ContactForm";
import { rentalEnquiryCategory, trackRentalEnquiryCompleted } from "@/lib/marketing/rentalsFunnel";
import {
  CONTACT,
  CONTACT_A11Y,
  PHONE_TEL,
  SALES_MAILTO,
  SUPPORT_MAILTO,
  WHATSAPP_LINK,
} from "@/config/contact";

const offices = [
  { city: "Nairobi (HQ)", addr: "ABC Place, Westlands", phone: CONTACT.phoneDisplay },
];

const Contact = () => {
  const { search } = useLocation();
  /** Non-null when this enquiry originated in the Rentals & Leasing module. */
  const rentalCategory = rentalEnquiryCategory(search);

  return (
    <MarketingPage>
      <PageHero
        eyebrow="Contact"
        title="Contact Yalla Mobility support and sales"
        subtitle="Talk to Support for general and customer queries, or to Sales for corporate and commercial enquiries."
      />

      <section className="container mx-auto px-4 py-16 grid lg:grid-cols-2 gap-12">
        <div className="space-y-6">
          <div className="p-6 rounded-2xl bg-card border border-border">
            <div className="flex items-center gap-2 mb-4">
              <LifeBuoy className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-bold">General support</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Bookings, trips, deliveries, accounts and technical assistance.
            </p>
            <div className="space-y-3 text-sm">
              <a
                href={SUPPORT_MAILTO}
                aria-label={CONTACT_A11Y.support}
                data-analytics="contact_support_email_click"
                className="flex items-center gap-3 hover:text-primary"
              >
                <Mail className="h-5 w-5 text-primary" aria-hidden="true" /> {CONTACT.supportEmail}
              </a>
              <a
                href={PHONE_TEL}
                aria-label={CONTACT_A11Y.phone}
                data-analytics="contact_phone_click"
                className="flex items-center gap-3 hover:text-primary"
              >
                <Phone className="h-5 w-5 text-primary" aria-hidden="true" /> {CONTACT.phoneDisplay}
              </a>
              <a
                href={WHATSAPP_LINK}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={CONTACT_A11Y.whatsapp}
                data-analytics="contact_whatsapp_click"
                className="flex items-center gap-3 hover:text-primary"
              >
                <MessageCircle className="h-5 w-5 text-primary" aria-hidden="true" /> WhatsApp {CONTACT.phoneDisplay}
              </a>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/5 to-primary-glow/5 border border-border">
            <div className="flex items-center gap-2 mb-4">
              <Briefcase className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-bold">Sales &amp; corporate enquiries</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Corporate mobility, enterprise accounts, fleet and charter proposals, partnerships and quotes.
            </p>
            <div className="space-y-3 text-sm">
              <a
                href={SALES_MAILTO}
                aria-label={CONTACT_A11Y.sales}
                data-analytics="contact_sales_email_click"
                className="flex items-center gap-3 hover:text-primary"
              >
                <Mail className="h-5 w-5 text-primary" aria-hidden="true" /> {CONTACT.salesEmail}
              </a>
              <a
                href={PHONE_TEL}
                aria-label={CONTACT_A11Y.phone}
                data-analytics="contact_sales_phone_click"
                className="flex items-center gap-3 hover:text-primary"
              >
                <Phone className="h-5 w-5 text-primary" aria-hidden="true" /> {CONTACT.phoneDisplay}
              </a>
            </div>
          </div>

          {offices.map((o) => (
            <div key={o.city} className="p-6 rounded-2xl bg-card border border-border">
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-primary mt-1" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{o.city}</p>
                  <p className="text-sm text-muted-foreground">{o.addr}</p>
                  <p className="text-sm text-muted-foreground">{o.phone}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <ContactForm
          type="contact"
          sourcePage="/contact"
          showCategory
          showCompany
          heading="Send us a message"
          subheading={
            rentalCategory
              ? `Rentals & Leasing enquiry — ${rentalCategory}`
              : "Choose an enquiry category and we route it to the right team."
          }
          submitLabel="Send message"
          onSubmitted={() => {
            if (rentalCategory) {
              trackRentalEnquiryCompleted({
                category: rentalCategory,
                surface: "contact_form",
                pageRoute: "/contact",
              });
            }
          }}
        />
      </section>
    </MarketingPage>
  );
};

export default Contact;
