import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Boxes,
  ClipboardCheck,
  Headphones,
  Phone,
  ShieldCheck,
  Siren,
  Users,
} from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { AppButton } from "@/components/nav/AppButton";
import { CONTACT, CONTACT_A11Y, PHONE_TEL } from "@/config/contact";

const SITE_URL = "https://yalla-africa.lovable.app";

/**
 * Safety Centre — the public safety information architecture.
 *
 * Every action on this page routes to a capability that exists in the
 * application today (rider safety tools, driver safety tools, Help Centre,
 * enquiry submission, Community Guidelines). No fabricated emergency control
 * is rendered here: emergency actions live inside the authenticated trip
 * surfaces where a trip context exists to escalate.
 */

const PILLARS = [
  {
    icon: BadgeCheck,
    title: "Before the trip — verification",
    body: "Drivers, couriers and operators are verified before activation: identity, driving licence, vehicle registration, insurance and inspection. Documents are re-checked on expiry, and an expired document removes the partner from dispatch.",
  },
  {
    icon: Activity,
    title: "During the trip — monitoring",
    body: "Every trip is recorded against a driver, vehicle and route. Trip records, timestamps and status changes are retained so an incident can be reconstructed accurately rather than argued from memory.",
  },
  {
    icon: ClipboardCheck,
    title: "After the trip — review",
    body: "Ratings, complaints and safety reports are reviewed by Trust & Safety against the trip, payment and document record. Outcomes range from re-training and re-verification to suspension or permanent removal.",
  },
];

const AUDIENCES = [
  {
    icon: Users,
    heading: "Rider safety",
    body: "Trip sharing, driver and vehicle details before pickup, and in-trip safety tools on your active trip.",
    to: "/rider/safety",
    label: "Open rider safety tools",
  },
  {
    icon: ShieldCheck,
    heading: "Driver safety",
    body: "Safety standards, incident escalation and the support channels available to driver partners.",
    to: "/driver/safety",
    label: "Open driver safety",
  },
  {
    icon: Boxes,
    heading: "Parcel & courier safety",
    body: "Verified couriers, tracked handovers and proof of delivery on every parcel movement.",
    to: "/delivery/package",
    label: "See parcel delivery",
  },
  {
    icon: Headphones,
    heading: "Report an issue",
    body: "Raise a safety report or complaint and we will review it against the trip or booking record.",
    to: "/support",
    label: "Go to the Help Centre",
  },
];

export default function SafetyCentre() {
  return (
    <MarketingPage>
      <SeoHead
        title="Safety Centre | TaxiD"
        description="How TaxiD protects riders, drivers, couriers and corporate travellers: partner verification, trip monitoring, incident review and how to report a safety concern."
        path="/safety"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "TaxiD Safety Centre",
          url: `${SITE_URL}/safety`,
          description:
            "Partner verification, trip monitoring, incident review and safety reporting across TaxiD services.",
        }}
      />

      <PageHero
        eyebrow="Safety Centre"
        title="Safety is engineered, not promised"
        subtitle="Verification before a partner can work, an accurate record of every trip, and a review process that acts on what the record shows."
      >
        <div className="flex flex-wrap gap-3">
          <AppButton
            size="lg"
            className="bg-ice text-primary hover:bg-ice/90"
            analytics="safety.report_issue"
            action="navigate"
            target="/support"
          >
            Report a safety concern
          </AppButton>
          <AppButton
            size="lg"
            variant="outline"
            className="border-ice/70 bg-transparent text-ice hover:bg-ice/20"
            analytics="safety.community_guidelines"
            action="navigate"
            target="/legal/community"
          >
            Read the Community Guidelines
          </AppButton>
        </div>
      </PageHero>

      {/* Emergency guidance — honest routing, no fake emergency control. */}
      <section className="border-b border-border bg-secondary/40">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-3 text-sm text-muted-foreground max-w-2xl">
              <Siren className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                In an emergency, contact the emergency services first. Then tell us, so we can support you
                and preserve the trip record for the investigation. Safety tools for an active trip are
                available inside the trip itself.
              </span>
            </p>
            <a
              href={PHONE_TEL}
              aria-label={CONTACT_A11Y.phone}
              data-analytics="safety_phone_click"
              className="inline-flex items-center gap-2 self-start whitespace-nowrap rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-primary hover:bg-secondary focus-visible:bg-secondary"
            >
              <Phone className="h-4 w-4" aria-hidden="true" /> {CONTACT.phoneDisplay}
            </a>
          </div>
        </div>
      </section>

      <section>
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              How safety works
            </span>
            <h2 className="mt-2 text-3xl font-bold">Three points of control</h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Safety on a mobility platform is decided before the trip starts, observed while it runs and
              enforced after it ends.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.title} className="rounded-xl border border-border bg-card p-6">
                <p.icon className="mb-3 h-7 w-7 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-secondary/30">
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Safety by audience
            </span>
            <h2 className="mt-2 text-3xl font-bold">Find the tools that apply to you</h2>
          </div>
          <ul className="mt-10 grid gap-5 md:grid-cols-2">
            {AUDIENCES.map((a) => (
              <li key={a.heading} className="rounded-xl border border-border bg-card p-6">
                <a.icon className="mb-3 h-7 w-7 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">{a.heading}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
                <Link
                  to={a.to}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {a.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Standards we hold partners to
            </span>
            <h2 className="mt-2 text-3xl font-bold">What we require, and what we enforce</h2>
          </div>
          <ul className="mt-8 grid max-w-4xl gap-3 md:grid-cols-2">
            {[
              "Valid driving licence, vehicle registration and insurance for the service being offered.",
              "Vehicle inspection and roadworthiness maintained for the vehicle class in use.",
              "One verified identity per account — account sharing removes the partner from the platform.",
              "Zero tolerance for driving under the influence, violence, harassment or discrimination.",
              "Corporate and charter movements fulfilled by the assigned, verified vehicle and driver.",
              "Good-faith reports are protected; retaliation is itself a removable breach.",
            ].map((s) => (
              <li key={s} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-sm text-muted-foreground">{s}</span>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-wrap gap-4 text-sm">
            <Link
              to="/legal/community"
              className="inline-flex items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
            >
              Community Guidelines <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Link
              to="/security"
              className="inline-flex items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
            >
              Security Centre <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Link
              to="/legal/privacy"
              className="inline-flex items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
            >
              Privacy Policy <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Link
              to="/faq"
              className="inline-flex items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
            >
              FAQs <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
