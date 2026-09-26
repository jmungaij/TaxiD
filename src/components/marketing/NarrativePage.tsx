/**
 * Shared layout for the company & trust narrative pages (reliability,
 * transparency, innovation, compliance, privacy, leadership, governance,
 * sustainability).
 *
 * Deliberately prose-first: these pages exist to state, in plain language,
 * what Yalla Mobility actually does today. There are no metrics, badges or
 * certifications in this layout, because a figure or standard we cannot
 * evidence must never appear on a public page.
 *
 * One <h1> comes from PageHero; every section heading is an <h2>.
 */
import { Link } from "react-router-dom";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Info } from "lucide-react";
import { CONTACT } from "@/config/contact";

export interface NarrativeSection {
  heading: string;
  /** One paragraph per entry. */
  body?: string[];
  bullets?: string[];
}

export interface NarrativePageProps {
  eyebrow: string;
  /** The page's single H1. */
  title: string;
  subtitle: string;
  path: string;
  seoTitle: string;
  seoDescription: string;
  intro: string[];
  sections: NarrativeSection[];
  /** Statements we deliberately do not make, and why. */
  limits?: { heading: string; body: string[] };
  cta?: { label: string; to: string; note?: string };
}

export function NarrativePage({
  eyebrow, title, subtitle, path, seoTitle, seoDescription,
  intro, sections, limits, cta,
}: NarrativePageProps) {
  return (
    <MarketingPage>
      <SeoHead title={seoTitle} description={seoDescription} path={path} />
      <PageHero eyebrow={eyebrow} title={title} subtitle={subtitle} />

      <div className="container mx-auto max-w-4xl px-4 py-14 md:py-20">
        <div className="space-y-4 text-lg leading-relaxed text-foreground">
          {intro.map((p) => <p key={p.slice(0, 32)}>{p}</p>)}
        </div>

        <div className="mt-12 space-y-12">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">{s.heading}</h2>
              {s.body && (
                <div className="mt-3 space-y-3 leading-relaxed text-muted-foreground">
                  {s.body.map((p) => <p key={p.slice(0, 32)}>{p}</p>)}
                </div>
              )}
              {s.bullets && (
                <ul className="mt-4 space-y-2">
                  {s.bullets.map((b) => (
                    <li key={b.slice(0, 32)} className="flex gap-3 text-muted-foreground">
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        {limits && (
          <Card className="mt-12 border-primary/20 bg-muted/40">
            <CardContent className="flex gap-3 p-5">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-foreground">{limits.heading}</h2>
                <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
                  {limits.body.map((p) => <p key={p.slice(0, 32)}>{p}</p>)}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mt-12 rounded-lg border p-6">
          <h2 className="text-lg font-semibold text-foreground">{cta?.label ?? "Talk to us"}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {cta?.note ?? `Questions about this page? Email ${CONTACT.supportEmail} or call ${CONTACT.phoneDisplay}.`}
          </p>
          <Button asChild className="mt-4">
            <Link to={cta?.to ?? "/contact"}>Contact Yalla Mobility</Link>
          </Button>
        </div>
      </div>
    </MarketingPage>
  );
}

export default NarrativePage;
