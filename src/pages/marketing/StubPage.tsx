import { useLocation, Link } from "react-router-dom";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { STUB_CONTENT, type StubContent } from "./stubContent";
import { Icon } from "@/components/marketing/Icon";
import { SeoHead } from "@/components/seo/SeoHead";
import { rentalHeroImage, RENTAL_HERO_SIZES } from "@/lib/marketing/rentalImagery";
import { trackRentalCtaImpression, trackRentalQuoteRequest } from "@/lib/marketing/rentalsFunnel";
import { useInViewOnce } from "@/hooks/useInViewOnce";

const NotFoundStub: StubContent = {
  eyebrow: "Page",
  title: "Coming soon",
  subtitle: "This page is being prepared.",
  sections: [],
};

export default function StubPage() {
  const { pathname } = useLocation();
  const c = STUB_CONTENT[pathname] ?? NotFoundStub;
  const hero = rentalHeroImage(pathname);
  /** Rentals & Leasing surfaces get category-scoped commercial CTAs. */
  const rentalCategory = pathname.startsWith("/rentals")
    ? pathname.replace("/rentals/", "").replace("/rentals", "rentals-hub")
    : null;
  const rentalQuoteHref = rentalCategory
    ? `/contact?subject=rental-enquiry&category=${encodeURIComponent(rentalCategory)}`
    : null;
  /** Hero CTA impression — impression ÷ click gives view-through rate per rentals category. */
  const heroCtaRef = useInViewOnce<HTMLDivElement>(() => {
    if (!rentalCategory) return;
    trackRentalCtaImpression({
      category: rentalCategory,
      surface: "hero",
      pageRoute: pathname,
      ctaLabel: "Get Quote / Enquire",
    });
  });

  return (
    <MarketingPage>
      <SeoHead
        title={`${c.title} | Yalla Mobility`}
        description={c.subtitle}
        path={pathname}
      />
      <PageHero eyebrow={c.eyebrow} title={c.title} subtitle={c.subtitle} image={hero?.picture} imageAlt={hero?.alt} imageSizes={RENTAL_HERO_SIZES}>

        <div ref={heroCtaRef} className="flex flex-wrap gap-3">
          {rentalCategory && rentalQuoteHref ? (
            <>
              <Button size="lg" asChild className="bg-ice text-primary hover:bg-ice/90">
                <Link
                  to={rentalQuoteHref}
                  onClick={() =>
                    trackRentalQuoteRequest("quote", {
                      category: rentalCategory,
                      surface: "hero",
                      pageRoute: pathname,
                      target: rentalQuoteHref,
                    })
                  }
                >
                  Get Quote
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="border-ice/70 bg-transparent text-ice hover:bg-ice/20">
                <Link
                  to={rentalQuoteHref}
                  onClick={() =>
                    trackRentalQuoteRequest("enquire", {
                      category: rentalCategory,
                      surface: "hero",
                      pageRoute: pathname,
                      target: rentalQuoteHref,
                    })
                  }
                >
                  Enquire
                </Link>
              </Button>
            </>
          ) : (
            <>
              <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90"
                analytics="marketing.get_started" action="navigate" target="/auth?mode=register">
                Get Started
              </AppButton>
              <AppButton size="lg" variant="outline" className="border-ice/70 bg-transparent text-ice hover:bg-ice/20"
                analytics="marketing.talk_to_sales" action="navigate" target="/contact">
                Talk to us
              </AppButton>
            </>
          )}
        </div>
      </PageHero>

      {c.highlights && c.highlights.length > 0 && (
        <section className="border-y border-border bg-secondary/30">
          <div className="container mx-auto px-4 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
            {c.highlights.map((h) => (
              <div key={h.label}>
                <div className="text-2xl md:text-3xl font-bold text-primary">{h.value}</div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{h.label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {c.sections.map((s, idx) => (
        <section key={s.heading} className={idx % 2 === 1 ? "bg-secondary/30" : ""}>
          <div className="container mx-auto px-4 py-16">
            <div className="max-w-3xl mb-10">
              {s.eyebrow && <span className="text-xs font-semibold uppercase tracking-wider text-primary">{s.eyebrow}</span>}
              <h2 className="text-3xl font-bold mt-2 mb-3">{s.heading}</h2>
              {s.body && <p className="text-muted-foreground text-lg">{s.body}</p>}
            </div>
            {s.items && (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                {s.items.map((it) => (
                  <div key={it.title} className="p-6 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors">
                    {it.icon && <Icon name={it.icon} className="h-7 w-7 text-primary mb-3" />}
                    <h3 className="font-semibold mb-2">{it.title}</h3>
                    <p className="text-sm text-muted-foreground">{it.desc}</p>
                  </div>
                ))}
              </div>
            )}
            {s.bullets && (
              <ul className="grid md:grid-cols-2 gap-3 max-w-3xl">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3 p-3 rounded-lg bg-card border border-border">
                    <CheckCircle2 className="h-5 w-5 text-status-success shrink-0 mt-0.5" />
                    <span className="text-sm">{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}

      <section className="bg-primary text-primary-foreground py-16">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl font-bold mb-3">{c.ctaTitle ?? "Ready to move with Yalla Mobility?"}</h2>
          <p className="opacity-90 mb-6">{c.ctaSubtitle ?? "Join the operating system powering Africa's mobility."}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90"
              analytics="marketing.get_started" action="navigate" target="/auth?mode=register">
              Get Started <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </AppButton>
            <AppButton size="lg" variant="outline" className="border-ice/70 bg-transparent text-ice hover:bg-ice/20"
              analytics="enterprise.contact_sales" action="navigate" target="/contact">
              Contact Sales
            </AppButton>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
