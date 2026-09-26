/**
 * YALLA PARTNERS — segment landing page.
 *
 * One page component driven by the Partner Capability Registry
 * (`src/lib/partners/taxonomy.ts`), so a segment can never appear in the
 * mega-menu without a real destination, and no segment page can claim a
 * capability the registry has not declared.
 */
import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";

import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { Button } from "@/components/ui/button";
import { CONTACT } from "@/config/contact";
import { PARTNER_SEGMENTS, SIDE_LABEL, findSegment, segmentsBySide } from "@/lib/partners/taxonomy";

export default function PartnerSegment() {
  const { segment: slug } = useParams();
  const segment = findSegment(slug);

  if (!segment) return <Navigate to="/partners" replace />;

  const siblings = segmentsBySide(segment.side).filter((s) => s.slug !== segment.slug);

  return (
    <MarketingPage>
      <SeoHead
        title={`${segment.label} | Yalla Partners`}
        description={segment.lead}
        path={`/partners/${segment.slug}`}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: segment.label,
          serviceType: SIDE_LABEL[segment.side],
          provider: { "@type": "Organization", name: "Yalla Mobility" },
          areaServed: "KE",
          description: segment.lead,
        }}
      />

      <PageHero eyebrow={SIDE_LABEL[segment.side]} title={segment.headline} subtitle={segment.lead}>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" variant="secondary">
            <Link to={segment.applyRoute}>
              {segment.capability === "operational" ? "Apply to join" : "Open a partner enquiry"}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10">
            <Link to={segment.workspaceRoute}>{segment.workspaceLabel}</Link>
          </Button>
        </div>
      </PageHero>

      <section className="container mx-auto max-w-5xl px-4 py-16">
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">Who this is for</h2>
            <p className="text-sm text-muted-foreground">{segment.audience}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">What you can {segment.side === "SUPPLY" ? "supply" : "offer"}</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {segment.services.map((s) => (
                <li key={s} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden />
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">Commercial relationship</h2>
            <p className="text-sm text-muted-foreground">{segment.commercial}</p>
            {segment.capability === "application_only" && (
              <p className="mt-4 flex gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Admitted through the partner desk — there is no self-serve console for this partnership yet.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="bg-muted/30 py-16">
        <div className="container mx-auto max-w-5xl px-4">
          <h2 className="mb-8 text-2xl font-bold md:text-3xl">How the relationship runs</h2>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {segment.workflow.map((step, i) => (
              <li key={step} className="rounded-xl border border-border bg-card p-5">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-primary">
                  Step {i + 1}
                </span>
                <span className="text-sm text-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="container mx-auto max-w-5xl px-4 py-16">
        <div className="rounded-2xl border border-border bg-card p-8">
          <h2 className="mb-2 text-2xl font-bold">Ready to start?</h2>
          <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
            Applications are reviewed against company registration, tax and contact verification before any commercial
            terms are issued. Speak to the partner desk if you would rather discuss the relationship first.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild><Link to={segment.applyRoute}>Start an application</Link></Button>
            <Button variant="outline" asChild>
              <a href={`mailto:${CONTACT.salesEmail}?subject=${encodeURIComponent(`${segment.label} enquiry`)}`}>
                Email the partner desk
              </a>
            </Button>
            <Button variant="ghost" asChild><Link to="/partners">All partner programmes</Link></Button>
          </div>
        </div>
      </section>

      <section className="container mx-auto max-w-5xl px-4 pb-20">
        <h2 className="mb-6 text-xl font-semibold">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...segment.related.map((r) => ({ to: r.to, label: r.label, desc: "" })),
            ...siblings.map((s) => ({ to: `/partners/${s.slug}`, label: s.label, desc: s.navDesc }))].map((item) => (
            <Link
              key={item.to + item.label}
              to={item.to}
              className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <span className="flex items-center justify-between gap-3 text-sm font-semibold">
                {item.label}
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden />
              </span>
              {item.desc && <span className="mt-1 block text-xs text-muted-foreground">{item.desc}</span>}
            </Link>
          ))}
        </div>
      </section>
    </MarketingPage>
  );
}

/** Exported for the sitemap and route-integrity tests. */
export const PARTNER_SEGMENT_PATHS = PARTNER_SEGMENTS.map((s) => `/partners/${s.slug}`);
