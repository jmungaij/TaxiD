/**
 * YALLA PARTNERS — public front door of the mobility distribution platform.
 *
 * Organising principle: three conversion journeys, not one generic partner
 * programme — distribution partners who create demand, supply partners who
 * provide capacity, and technology partners who integrate. Everything stated
 * here is something the platform actually does; no invented volumes, no
 * invented uptime figures, no jurisdiction-specific tax promises.
 */
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Code2, FileText, LifeBuoy, LineChart, Lock, ShieldCheck, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarketingPage } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { CrossLinks } from "@/components/marketing/CrossLinks";
import { PartnersHero } from "@/components/marketing/partners/PartnersHero";
import { LifecycleDemo } from "@/components/marketing/partners/LifecycleDemo";
import { MaturityLadder } from "@/components/marketing/partners/MaturityLadder";
import { PartnerEconomics } from "@/components/marketing/partners/PartnerEconomics";
import { PartnerNetworkStage } from "@/components/marketing/partners/PartnerNetworkStage";
import { PartnerWorkspaceLifecycle } from "@/components/marketing/partners/PartnerWorkspaceLifecycle";
import { PartnerIntentRouter } from "@/components/marketing/partners/PartnerIntentRouter";
import { useDeepParam } from "@/lib/partners/useDeepParam";
import { BRING_KEYS, buildApplyLink, findBring } from "@/lib/partners/intent";

/** The router step is optional — an empty answer means "show every track". */
const BRING_PARAM_VALUES = [...BRING_KEYS, ""];

import { CONTACT, PHONE_TEL } from "@/config/contact";

import trackDistribution from "@/assets/partners/track-distribution.jpg";
import trackSupply from "@/assets/partners/track-supply.jpg";
import trackTechnology from "@/assets/partners/track-technology.jpg";

const TRACKS = [
  {
    key: "distribution",
    kicker: "Business partner",
    title: "I want to sell Yalla mobility to my customers",
    body: "Tour operators, DMCs, travel agencies, OTAs, hotels, corporates, retailers and event companies. You own the customer relationship and the sale; Yalla fulfils the movement.",
    bullets: ["Customer register stays yours", "Book across every service line", "Contracted margin per order"],
    cta: "Start a partner application",
    to: "/partners/apply?track=distribution",
    image: trackDistribution,
    alt: "A travel desk agent arranging ground transport on a tablet at night",
  },
  {
    key: "supply",
    kicker: "Supply partner",
    title: "I operate vehicles, fleets, logistics, aviation or marine capacity",
    body: "Fleet operators, rental companies, bus and coach operators, logistics providers, aircraft and marine operators, and equipment providers who want utilisation from a demand network.",
    bullets: ["Compliance-verified admission", "Demand matched with recorded reasons", "Reconciled settlement per order"],
    cta: "Apply for supply admission",
    to: "/partners/apply?track=supply",
    image: trackSupply,
    alt: "A commercial fleet of vans, a coach and cargo trucks parked at dusk",
  },
  {
    key: "technology",
    kicker: "Technology & enterprise partner",
    title: "I want to integrate Yalla into my platform",
    body: "Platforms, OTAs, ERPs and enterprises that need programmatic quoting and booking, an embedded surface, or a white-label mobility product operated by Yalla behind their brand.",
    bullets: ["API, embed, white label or orchestrate", "Sandbox and certification before production", "Enterprise governance and support"],
    cta: "Open an integration enquiry",
    to: "/partners/apply?track=technology",
    image: trackTechnology,
    alt: "A network operations wall of screens showing route and data visualisations",
  },
];




const ONBOARDING = [
  { t: "Apply", d: "Tell us who you are, what you sell or operate, and how you want to work with Yalla." },
  { t: "Qualify", d: "The partner desk reviews your segment, volumes, service lines and commercial fit." },
  { t: "Verify", d: "Company registration, tax identity, contact and compliance documents are verified and recorded." },
  { t: "Configure", d: "Users, roles, approval routes, customers, cost centres and service scope are set up." },
  { t: "Contract", d: "Commercial model, margin, settlement terms and governance are agreed and recorded." },
  { t: "Test", d: "You place controlled orders — and integrating partners certify in sandbox before production." },
  { t: "Activate", d: "Your workspace goes live, your team is invited and your first customer order can be placed." },
  { t: "Grow", d: "Performance, coverage and exceptions are reviewed with the partner desk as you scale." },
];

const TECHNICAL_TRACK = [
  { t: "Technical discovery", d: "Use cases, service lines, volumes, data flows and the systems on both sides." },
  { t: "Credentials", d: "Scoped keys issued per environment, with the permissions your integration actually needs." },
  { t: "Sandbox", d: "Quote, book, track, cancel and settle against non-production data until your flows are stable." },
  { t: "Certification", d: "Agreed scenarios are executed and evidenced before any production access is granted." },
  { t: "Production", d: "Controlled go-live with monitoring, support routing and an agreed rollback position." },
];

const TRUST = [
  { icon: Lock, t: "Access control", d: "Role-based access with row-level authorisation in the database, so a partner only ever reaches its own customers, orders and settlements." },
  { icon: FileText, t: "Auditability", d: "Partner, commercial and document events are written to append-only trails; financial ledgers cannot be edited in place." },
  { icon: ShieldCheck, t: "Document integrity", d: "Issued commercial documents are sealed with a content fingerprint and a digital signature, and can be verified independently." },
  { icon: Wallet, t: "Payment handling", d: "Wallet credits are recognised only from verified payment callbacks — never from a client instruction." },
  { icon: LineChart, t: "Operational governance", d: "Service exceptions, compliance findings and risk flags are raised as tracked cases with owners and resolution trails." },
  { icon: LifeBuoy, t: "Support & escalation", d: "A named partner desk with commercial and operational escalation paths, contactable by phone and email." },
];

const JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Yalla Partners — mobility distribution platform",
    serviceType: "Mobility distribution and fulfilment infrastructure",
    provider: { "@type": "Organization", name: "Yalla Mobility", url: "https://yalla.africa" },
    areaServed: "Kenya",
    audience: { "@type": "BusinessAudience", audienceType: "Travel, hospitality, corporate, commerce, logistics and technology partners" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Who can become a Yalla Partner?",
        acceptedAnswer: { "@type": "Answer", text: "Distribution partners who sell mobility to their own customers, supply partners who operate vehicles, fleets, logistics, aviation or marine capacity, and technology partners who integrate Yalla into their own platform." },
      },
      {
        "@type": "Question",
        name: "How is partner pricing calculated?",
        acceptedAnswer: { "@type": "Answer", text: "Pricing is computed server-side from the contracted rate card. Supplier cost, Yalla margin, partner margin and applicable taxes are shown on the order before confirmation, and are versioned at order level." },
      },
      {
        "@type": "Question",
        name: "How do partners integrate technically?",
        acceptedAnswer: { "@type": "Answer", text: "Through an integration maturity ladder — refer, book, manage, embed, API, and white label or orchestrate. API and white-label partners complete technical discovery, receive scoped credentials, build in sandbox and certify agreed scenarios before production access." },
      },
    ],
  },
];

function SectionHead({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <span className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</span>
      <h2 className="mt-3 mb-3 text-[clamp(1.6rem,3vw,2.25rem)] font-bold leading-tight">{title}</h2>
      {lead && <p className="text-muted-foreground">{lead}</p>}
    </div>
  );
}

export default function YallaPartners() {
  const [bring, setBring] = useDeepParam("bring", BRING_PARAM_VALUES, "");
  const intent = findBring(bring);
  const visibleTracks = intent ? TRACKS.filter((t) => intent.trackKeys.includes(t.key)) : TRACKS;

  return (
    <MarketingPage>
      <SeoHead
        title="Yalla Partners — mobility distribution platform"
        description="Sell and fulfil rides, charters, deliveries, rentals and leasing under your own brand. Distribution, supply and API partnerships on Yalla's mobility infrastructure."
        path="/partners"
        jsonLd={JSON_LD}
      />

      <PartnersHero />

      {/* Routing step — answered before any category is chosen */}
      <PartnerIntentRouter value={bring} onChange={setBring} />

      {/* Conversion journeys — filtered by what the visitor brings */}
      <section className="container mx-auto px-4 py-20" aria-labelledby="tracks-heading">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            {intent ? "Your partnership" : "Three ways in"}
          </span>
          <h2 id="tracks-heading" className="mt-3 mb-3 text-[clamp(1.6rem,3vw,2.25rem)] font-bold leading-tight">
            {intent ? "The partnership that matches your answer" : "Choose the partnership that matches your business"}
          </h2>
          <p className="text-muted-foreground">
            {intent
              ? intent.lead
              : "Yalla Partners is a two-sided network plus a distribution platform. Start where you belong — the desk that reviews your application is the one that owns your track."}
          </p>
          {intent && (
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => setBring("")}>
              Show all three partnerships
            </Button>
          )}
        </div>

        <div className={`grid gap-6 ${visibleTracks.length > 1 ? "lg:grid-cols-3" : "mx-auto max-w-xl"}`}>
          {visibleTracks.map((t) => (
            <article key={t.key} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]">
              <img
                src={t.image}
                alt={t.alt}
                width={1024}
                height={768}
                loading="lazy"
                decoding="async"
                className="h-44 w-full object-cover"
              />
              <div className="flex flex-1 flex-col p-6">
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">{t.kicker}</span>
                <h3 className="mt-2 text-lg font-semibold leading-snug">{t.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground">{t.body}</p>
                <ul className="mt-4 space-y-2">
                  {t.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <Button className="mt-6 w-full" asChild>
                  <Link to={intent ? buildApplyLink({ bring: intent.key, level: intent.suggestedLevel }) : t.to}>
                    {t.cta} <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Economic engine — photographic commercial story */}
      <PartnerEconomics />


      {/* Two ecosystems — interactive network experience */}
      <PartnerNetworkStage />


      {/* Integration maturity ladder */}
      <section className="border-y border-border bg-muted/40 py-20">
        <div className="container mx-auto px-4">
          <SectionHead
            eyebrow="Integration maturity"
            title="Start simple. Scale when your business grows."
            lead="Six levels of integration, in order. You can enter at any level and move up without changing platform."
          />
          <MaturityLadder />
        </div>
      </section>

      {/* Interactive product demonstration */}
      <section className="container mx-auto px-4 py-20" aria-labelledby="lifecycle-heading">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Product demonstration</span>
          <h2 id="lifecycle-heading" className="mt-3 mb-3 text-[clamp(1.6rem,3vw,2.25rem)] font-bold leading-tight">
            Customer to settlement, one continuous record
          </h2>
          <p className="text-muted-foreground">
            This is the actual sequence a partner order moves through — each stage recorded, priced and
            auditable rather than described in a brochure.
          </p>
        </div>
        <LifecycleDemo />
      </section>

      {/* Partner workspace — lifecycle control surface */}
      <PartnerWorkspaceLifecycle />


      {/* Commercial clarity */}
      <section className="container mx-auto px-4 py-20">
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Commercial clarity</span>
            <h2 className="mt-3 mb-4 text-[clamp(1.6rem,3vw,2.25rem)] font-bold leading-tight">
              You always see how the money splits
            </h2>
            <p className="mb-6 text-muted-foreground">
              Every partner order shows the supplier cost, the Yalla margin, your contracted margin and the
              applicable taxes before you confirm it. Commercial terms are versioned at order level, and any
              later adjustment — correction, cancellation, refund, tax adjustment or dispute outcome — is
              recorded, authorised and auditable.
            </p>
            <ul className="space-y-3">
              {[
                "Contracted margin per partner, recorded and versioned",
                "Net rate, markup, commission, revenue share, fixed fee or tiered rate",
                "Applicable taxes calculated and disclosed per transaction and jurisdiction",
                "Order-level reconciliation before settlement, on an append-only ledger",
                "Adjustments captured as authorised entries, never silent overwrites",
              ].map((x) => (
                <li key={x} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass-panel p-6 sm:p-8">
            <h3 className="mb-4 font-semibold">Talk to the partner desk</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              For volume commitments, supply admission at scale, API access or a white-label programme,
              speak to the commercial team before applying.
            </p>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Commercial:</span>{" "}
                <a className="font-medium text-primary hover:underline" href={`mailto:${CONTACT.salesEmail}`}>{CONTACT.salesEmail}</a>
              </p>
              <p>
                <span className="text-muted-foreground">Phone:</span>{" "}
                <a className="font-medium text-primary hover:underline" href={PHONE_TEL}>{CONTACT.phoneDisplay}</a>
              </p>
            </div>
            <div className="mt-6 grid gap-2">
              <Button asChild><Link to="/partners/apply?track=distribution">Start a partner application</Link></Button>
              <Button variant="outline" asChild><Link to="/partners/apply?track=technology">Open an integration enquiry</Link></Button>
            </div>
          </div>
        </div>
      </section>

      {/* Onboarding lifecycle */}
      <section className="border-y border-border bg-muted/40 py-20">
        <div className="container mx-auto px-4">
          <SectionHead
            eyebrow="Partner lifecycle"
            title="From application to your first order — and beyond"
            lead="Eight controlled stages. Nothing goes live before verification, configuration and contracting are recorded."
          />
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ONBOARDING.map((s, i) => (
              <li key={s.t} className="rounded-2xl border border-border bg-card p-5">
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">Stage {i + 1}</span>
                <h3 className="mt-2 mb-2 font-semibold">{s.t}</h3>
                <p className="text-sm text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>

          <div className="mt-10 rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <span className="rounded-xl bg-primary/10 p-2 text-primary"><Code2 className="h-5 w-5" aria-hidden /></span>
              <div>
                <h3 className="font-semibold">Additional track for API and white-label partners</h3>
                <p className="text-sm text-muted-foreground">Controlled integration — no production access before certification.</p>
              </div>
            </div>
            <ol className="grid gap-4 md:grid-cols-5">
              {TECHNICAL_TRACK.map((s, i) => (
                <li key={s.t} className="rounded-xl border border-border/70 bg-background/60 p-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step {i + 1}</span>
                  <p className="mt-1.5 text-sm font-semibold">{s.t}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.d}</p>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild><Link to="/partners/apply?track=technology&model=API">Request API access</Link></Button>
              <Button variant="outline" asChild><Link to="/developers">Read the developer overview</Link></Button>
            </div>
          </div>
        </div>
      </section>

      {/* Enterprise trust */}
      <section className="container mx-auto px-4 py-20">
        <SectionHead
          eyebrow="Enterprise trust"
          title="Controls an enterprise buyer can actually inspect"
          lead="These are platform controls in force today — stated without invented certifications or uptime claims."
        />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {TRUST.map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-2xl border border-border bg-card p-6">
              <Icon className="mb-4 h-6 w-6 text-primary" aria-hidden />
              <h3 className="mb-2 font-semibold">{t}</h3>
              <p className="text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button variant="outline" asChild><Link to="/security">Security centre</Link></Button>
          <Button variant="outline" asChild><Link to="/legal">Legal library</Link></Button>
          <Button variant="outline" asChild><Link to="/support">Support</Link></Button>
        </div>
      </section>

      {/* Closing conversion band */}
      <section className="bg-gradient-hero-band py-16 text-primary-foreground">
        <div className="container mx-auto grid items-center gap-8 px-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <h2 className="text-[clamp(1.6rem,3vw,2.25rem)] font-bold leading-tight">
              Your customers. Your brand. Your margin. Yalla's mobility infrastructure.
            </h2>
            <p className="mt-3 max-w-xl text-primary-foreground/85">
              Tell us whether you sell mobility, supply capacity or integrate platforms — the partner desk
              routes your application to the right track.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Button size="lg" className="bg-ice text-primary hover:bg-ice/90" asChild>
              <Link to="/partners/apply?track=distribution">
                Become a Yalla Partner <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
              asChild
            >
              <Link to="/partner/workspace">Partner sign in</Link>
            </Button>
          </div>
        </div>
      </section>

      <CrossLinks heading="Related Yalla capabilities" keys={["corporates", "delivery", "rentals", "enterprise"]} />
    </MarketingPage>
  );
}
