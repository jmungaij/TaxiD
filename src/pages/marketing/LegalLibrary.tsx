import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarClock, FileText, Search, ShieldCheck } from "lucide-react";
import { MarketingPage } from "@/components/marketing/PageHero";
import { LazySection } from "@/components/marketing/LazySection";
import { SeoHead } from "@/components/seo/SeoHead";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CONTACT } from "@/config/contact";
import { LEGAL_DOCUMENTS, type LegalDocument } from "@/lib/legal/legalDocuments";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const SITE_URL = "https://yalla-africa.lovable.app";

/** Flattened, lower-cased haystack per document — headings, body and bullets. */
function haystack(doc: LegalDocument): string {
  return [
    doc.title,
    doc.summary,
    doc.scopeNote,
    doc.owner,
    ...doc.sections.flatMap((s) => [s.heading, ...(s.body ?? []), ...(s.bullets ?? [])]),
  ]
    .join(" ")
    .toLowerCase();
}

const INDEX = LEGAL_DOCUMENTS.map((doc) => ({ doc, text: haystack(doc) }));

/** Sections of a document whose heading or text matches the query. */
function matchingSections(doc: LegalDocument, q: string) {
  if (!q) return [];
  return doc.sections
    .filter((s) =>
      [s.heading, ...(s.body ?? []), ...(s.bullets ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
    .slice(0, 4);
}

/**
 * Searchable Legal library index at /legal.
 *
 * Reads exclusively from the canonical registry (src/lib/legal/legalDocuments.ts),
 * so a new policy appears here — and in search — the moment it is published.
 * Searching happens client-side over the same text the documents render, and
 * results deep-link straight to the matching section anchor.
 */
export default function LegalLibrary() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(query, 200);
  const q = debounced.trim().toLowerCase();

  const results = useMemo(() => {
    if (!q) return INDEX.map((i) => i.doc);
    return INDEX.filter((i) => i.text.includes(q)).map((i) => i.doc);
  }, [q]);

  const onChange = (value: string) => {
    setQuery(value);
    const next = new URLSearchParams(params);
    if (value.trim()) next.set("q", value.trim());
    else next.delete("q");
    setParams(next, { replace: true });
  };

  return (
    <MarketingPage>
      <SeoHead
        title="Legal Library | TaxiD"
        description="Search every TaxiD policy — privacy, terms, cookies, data protection, accessibility, community guidelines and regulatory compliance."
        path="/legal"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "TaxiD Legal Library",
            url: `${SITE_URL}/legal`,
            hasPart: LEGAL_DOCUMENTS.map((d) => ({
              "@type": "WebPage",
              name: d.title,
              url: `${SITE_URL}/legal/${d.slug}`,
            })),
          },
        ]}
      />

      <header className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-12 md:py-16">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/80">
            Legal
          </span>
          <h1 className="mt-3 text-3xl md:text-4xl font-bold">Legal library</h1>
          <p className="mt-4 max-w-3xl text-primary-foreground/90 md:text-lg">
            Every policy that governs how TaxiD operates — searchable by
            topic, term or obligation. {LEGAL_DOCUMENTS.length} published documents.
          </p>

          <div className="mt-8 max-w-xl">
            <label htmlFor="legal-search" className="block text-sm font-medium mb-2">
              Search policies and guidance
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              />
              <Input
                id="legal-search"
                type="search"
                value={query}
                onChange={(e) => onChange(e.target.value)}
                placeholder="e.g. retention, refunds, cookies, driver conduct"
                className="pl-9 bg-background text-foreground"
                autoComplete="off"
              />
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {q
            ? `${results.length} of ${LEGAL_DOCUMENTS.length} documents match “${debounced.trim()}”.`
            : `Showing all ${LEGAL_DOCUMENTS.length} documents.`}
        </p>

        {results.length === 0 ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-semibold">No policy matches that term</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Try a broader word, or email{" "}
              <a className="underline" href={`mailto:${CONTACT.supportEmail}`}>
                {CONTACT.supportEmail}
              </a>{" "}
              and our team will point you to the right document.
            </p>
          </div>
        ) : (
          <ul className="mt-6 grid gap-4 md:grid-cols-2">
            {results.map((doc) => {
              const sections = matchingSections(doc, q);
              return (
                <li key={doc.slug}>
                  <article className="h-full rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md">
                    <div className="flex items-start gap-3">
                      <FileText aria-hidden="true" className="mt-0.5 h-5 w-5 text-primary" />
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold">
                          <Link
                            to={`/legal/${doc.slug}`}
                            className="hover:text-primary focus-visible:text-primary"
                          >
                            {doc.title}
                          </Link>
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">{doc.summary}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="font-normal">
                        <CalendarClock aria-hidden="true" className="mr-1 h-3 w-3" />
                        Updated {doc.lastUpdated}
                      </Badge>
                      <Badge variant="outline" className="font-normal">
                        {doc.sections.length} sections
                      </Badge>
                    </div>

                    {sections.length > 0 && (
                      <div className="mt-4 border-t border-border pt-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Matching sections
                        </h3>
                        <ul className="mt-2 space-y-1">
                          {sections.map((s) => (
                            <li key={s.id}>
                              <Link
                                to={`/legal/${doc.slug}#${s.id}`}
                                className="text-sm text-primary hover:underline"
                              >
                                {s.heading}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <Link
                      to={`/legal/${doc.slug}`}
                      className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                    >
                      Read {doc.title}
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </article>
                </li>
              );
            })}
          </ul>
        )}

        {/* Non-critical trailing guidance — deferred until near the viewport. */}
        <LazySection minHeight={220} className="mt-12">
          <section
            aria-labelledby="legal-help-heading"
            className="rounded-xl border border-border bg-secondary/40 p-8"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <h2 id="legal-help-heading" className="text-xl font-semibold">
                  Can’t find what governs your situation?
                </h2>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                  Rider, driver and account questions go to{" "}
                  <a className="underline" href={`mailto:${CONTACT.supportEmail}`}>
                    {CONTACT.supportEmail}
                  </a>
                  . Corporate, procurement, due-diligence and regulator enquiries go to{" "}
                  <a className="underline" href={`mailto:${CONTACT.salesEmail}`}>
                    {CONTACT.salesEmail}
                  </a>
                  .
                </p>
                <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold text-primary">
                  <Link to="/security" className="hover:underline">
                    Security Centre
                  </Link>
                  <Link to="/safety" className="hover:underline">
                    Safety Centre
                  </Link>
                  <Link to="/support" className="hover:underline">
                    Help Centre
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </LazySection>
      </div>
    </MarketingPage>
  );
}
