import { Link, useParams } from "react-router-dom";
import { ArrowRight, CalendarClock, Mail, Phone, ShieldCheck } from "lucide-react";
import { MarketingPage } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { LazySection } from "@/components/marketing/LazySection";
import { CONTACT, CONTACT_A11Y, PHONE_TEL } from "@/config/contact";
import { LEGAL_BY_SLUG, LEGAL_INDEX } from "@/lib/legal/legalDocuments";
import NotFound from "@/pages/NotFound";

const SITE_URL = "https://yalla-africa.lovable.app";

/**
 * Canonical legal document surface for every /legal/:slug destination.
 *
 * One implementation, one content registry (src/lib/legal/legalDocuments.ts) —
 * no per-page duplication, no marketing CTAs dressed up as legal text.
 */
export default function LegalDocument() {
  const { slug = "" } = useParams();
  const doc = LEGAL_BY_SLUG[slug];

  // Unknown legal slug → the canonical 404 surface, never a blank page.
  if (!doc) return <NotFound />;

  const path = `/legal/${doc.slug}`;

  return (
    <MarketingPage>
      <SeoHead
        title={doc.seoTitle}
        description={doc.seoDescription}
        path={path}
        type="article"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
              { "@type": "ListItem", position: 2, name: "Legal", item: `${SITE_URL}/legal/terms` },
              { "@type": "ListItem", position: 3, name: doc.title, item: `${SITE_URL}${path}` },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: doc.title,
            description: doc.seoDescription,
            url: `${SITE_URL}${path}`,
            publisher: { "@type": "Organization", name: "Yalla Mobility" },
          },
        ]}
      />

      {/* Document masthead — restrained, legible, no hero photography. */}
      <header className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-12 md:py-16">
          {/* Breadcrumb trail is rendered globally by the marketing layout —
              not duplicated here. Structured breadcrumbs ship via JSON-LD above. */}
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/80">
            Legal
          </span>
          <h1 className="mt-3 text-3xl md:text-4xl font-bold max-w-3xl">{doc.title}</h1>
          <p className="mt-4 max-w-3xl text-primary-foreground/90 md:text-lg">{doc.summary}</p>

          <dl className="mt-8 grid gap-4 sm:grid-cols-3 max-w-3xl text-sm">
            <div>
              <dt className="text-primary-foreground/70">Effective</dt>
              <dd className="font-semibold">{doc.effectiveDate}</dd>
            </div>
            <div>
              <dt className="text-primary-foreground/70">Last updated</dt>
              <dd className="font-semibold">{doc.lastUpdated}</dd>
            </div>
            <div>
              <dt className="text-primary-foreground/70">Owner</dt>
              <dd className="font-semibold">{doc.owner}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12 grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* In-page contents + legal library. Semantic nav, keyboard-operable. */}
        <aside className="lg:sticky lg:top-24 lg:self-start space-y-8">
          <nav aria-labelledby="legal-contents-heading">
            <h2
              id="legal-contents-heading"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3"
            >
              On this page
            </h2>
            <ul className="space-y-1.5">
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground transition-colors"
                  >
                    {s.heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="legal-library-heading">
            <h2
              id="legal-library-heading"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3"
            >
              Legal library
            </h2>
            <Link
              to="/legal"
              className="mb-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Search all policies
            </Link>
            <ul className="space-y-1.5">
              {LEGAL_INDEX.map((item) => {
                const current = item.to === path;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      aria-current={current ? "page" : undefined}
                      className={
                        current
                          ? "block rounded-md bg-secondary px-2 py-1.5 text-sm font-semibold text-primary"
                          : "block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:bg-secondary transition-colors"
                      }
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <article className="max-w-3xl">
          <p className="flex items-start gap-3 rounded-xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span>{doc.scopeNote}</span>
          </p>

          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-28 mt-10">
              <h2 className="text-2xl font-bold text-foreground">{s.heading}</h2>
              {s.body?.map((p) => (
                <p key={p} className="mt-4 leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
              {s.bullets && (
                <ul className="mt-4 space-y-2.5">
                  {s.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-3 leading-relaxed text-muted-foreground">
                      <span
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {/* Contact + return paths: a legal page must never be a dead end.
              Non-critical for first paint, so it mounts on approach/idle. */}
          <LazySection minHeight={260}>
          <section className="mt-12 rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Questions about this document</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {doc.owner} maintains this page. Reach us and we will respond in writing.
            </p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <a
                href={`mailto:${doc.contactEmail}`}
                className="inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:underline"
              >
                <Mail className="h-4 w-4" aria-hidden="true" /> {doc.contactEmail}
              </a>
              <a
                href={PHONE_TEL}
                aria-label={CONTACT_A11Y.phone}
                className="inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:underline"
              >
                <Phone className="h-4 w-4" aria-hidden="true" /> {CONTACT.phoneDisplay}
              </a>
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <CalendarClock className="h-4 w-4" aria-hidden="true" /> Updated {doc.lastUpdated}
              </span>
            </div>

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Related
            </h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {doc.related.map((r) => (
                <li key={r.to}>
                  <Link
                    to={r.to}
                    className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {r.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          </LazySection>
        </article>
      </div>
    </MarketingPage>
  );
}
