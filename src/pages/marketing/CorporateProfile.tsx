/**
 * /corporate — the public corporate profile page.
 *
 * Embeds the published six-page company profile, offers a download, and gives
 * partners, clients and institutions a direct way to reach the commercial team
 * through the existing contact-routing service.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, FileText, Mail, Phone, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { ContactForm } from "@/components/marketing/ContactForm";
import { ProfileDocumentViewer } from "@/components/collateral/ProfileDocumentViewer";
import {
  COMPANY_PROFILE_FALLBACK,
  COMPANY_PROFILE_SLUG,
  fetchPublishedCollateral,
  formatFileSize,
  type Collateral,
} from "@/lib/collateral/companyProfile";
import { CONTACT } from "@/config/contact";
import corporatesImg from "@/assets/corporates.jpg";

const AUDIENCES = [
  "Corporates and procurement teams",
  "Government and public institutions",
  "NGOs and development organisations",
  "Embassies and international organisations",
  "Hotels, airlines and travel companies",
  "Fleet owners and mobility operators",
];

const CorporateProfile = () => {
  const [doc, setDoc] = useState<Collateral | null>(null);

  useEffect(() => {
    void fetchPublishedCollateral().then((rows) => {
      setDoc(rows.find((r) => r.slug === COMPANY_PROFILE_SLUG) ?? null);
    });
  }, []);

  const title = doc?.title ?? COMPANY_PROFILE_FALLBACK.title;
  const url = doc?.file_url ?? COMPANY_PROFILE_FALLBACK.file_url;
  const version = doc?.version ?? COMPANY_PROFILE_FALLBACK.version;
  const pages = doc?.page_count ?? COMPANY_PROFILE_FALLBACK.page_count;
  const size = formatFileSize(doc?.file_size ?? COMPANY_PROFILE_FALLBACK.file_size);

  return (
    <MarketingPage>
      <PageHero
        eyebrow="Company Profile"
        title="TaxiD — Corporate Company Profile"
        subtitle="Yalla Beena Limited. Our capability statement for corporate, institutional and partner engagements."
        image={corporatesImg}
        imageAlt="Executive travelling with TaxiD"
      >
        <Button size="lg" className="bg-ice text-primary hover:bg-ice/90" asChild data-analytics="corporate-profile-hero-download">
          <a href={url} download data-analytics="corporate-profile-hero-download">
            Download the profile <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </a>
        </Button>
      </PageHero>

      <section className="container mx-auto px-4 py-16" aria-labelledby="profile-doc">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <h2 id="profile-doc" className="text-2xl font-bold tracking-tight md:text-3xl">
              Read the profile
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {pages} pages · {version} · {size}
            </p>
            <div className="mt-6">
              <ProfileDocumentViewer url={url} title={title} />
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-6">
              <FileText className="h-6 w-6 text-primary" aria-hidden="true" />
              <h3 className="mt-3 text-lg font-semibold">Who this is for</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {AUDIENCES.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <h3 className="text-lg font-semibold">Next steps</h3>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link to="/corporate/register" data-analytics="corporate-profile-open-account">
                  <Building2 className="mr-2 h-4 w-4" aria-hidden="true" /> Open a corporate account
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link to="/provider/capacity" data-analytics="corporate-profile-submit-capacity">
                  <Truck className="mr-2 h-4 w-4" aria-hidden="true" /> Operators: submit capacity
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link to="/enterprise/demo" data-analytics="corporate-profile-enterprise-demo">
                  <ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" /> See the enterprise walkthrough
                </Link>
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 text-sm">
              <h3 className="text-lg font-semibold">Talk to us</h3>
              <p className="mt-2 flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" aria-hidden="true" /> {CONTACT.phoneDisplay}
              </p>
              <p className="mt-1 flex items-center gap-2 text-muted-foreground">
                <Mail className="h-4 w-4" aria-hidden="true" /> {CONTACT.salesEmail}
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section className="border-t border-border bg-secondary/20 py-16" aria-labelledby="profile-contact">
        <div className="container mx-auto max-w-3xl px-4">
          <h2 id="profile-contact" className="text-center text-2xl font-bold tracking-tight md:text-3xl">
            Start a conversation
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
            Tell us what you need to move — people, parcels or fleets — and the right team will respond
            within one business day.
          </p>
          <div className="mt-8">
            <ContactForm
              type="sales"
              sourcePage="/corporate"
              showCompany
              showEmployeeCount
              showCategory
              defaultCategory="corporate_sales"
              submitLabel="Send enquiry"
            />
          </div>
        </div>
      </section>
    </MarketingPage>
  );
};

export default CorporateProfile;
