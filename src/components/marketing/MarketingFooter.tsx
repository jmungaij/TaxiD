import { Link, useLocation } from "react-router-dom";
import { Mail, Phone, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import BrandLogo from "@/components/brand/BrandLogo";
import SocialLinks from "@/components/marketing/SocialLinks";
import SocialSameAs from "@/components/seo/SocialSameAs";
import { CONTACT, CONTACT_A11Y, PHONE_TEL, SALES_MAILTO, SUPPORT_MAILTO } from "@/config/contact";
import { appLink } from "@/lib/appLinks";
import { buildFooterColumns, buildPrimaryNav, isNavItemActive, navHref, STAFF_ACCESS } from "@/lib/navigation/primaryNav";
import { cn } from "@/lib/utils";

/**
 * The footer is DERIVED from the canonical navigation registry
 * (src/lib/navigation/primaryNav.ts) — never hand-maintained. One source of
 * truth keeps header, mega menu, footer and sitemap synchronized.
 */
const cols = buildFooterColumns(
  buildPrimaryNav({
    riderAndroid: appLink({ audience: "rider", platform: "android", placement: "footer" }),
    riderIos: appLink({ audience: "rider", platform: "ios", placement: "footer" }),
    driverAndroid: appLink({ audience: "driver", platform: "android", placement: "footer" }),
    driverIos: appLink({ audience: "driver", platform: "ios", placement: "footer" }),
  }),
);


const MarketingFooter = () => {
  const { pathname, search } = useLocation();
  return (
    <footer className="bg-nav-strong text-nav-foreground mt-16">
      <div className="container mx-auto px-4 py-14">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8">
          <div className="col-span-2 lg:col-span-1">
            <div className="flex items-center mb-4">
              <BrandLogo tone="light" className="h-8 sm:h-9 md:h-10 max-w-[190px]" />

            </div>

            <p className="text-sm text-nav-muted-foreground mb-4">
              Africa's most trusted mobility ecosystem.
            </p>
            <div className="space-y-2 text-sm text-nav-muted-foreground">
              <a
                href={PHONE_TEL}
                aria-label={CONTACT_A11Y.phone}
                data-analytics="footer_phone_click"
                className="flex items-center gap-2 hover:text-nav-accent transition-colors"
              >
                <Phone className="h-4 w-4" aria-hidden="true" /> {CONTACT.phoneDisplay}
              </a>
              <a
                href={SUPPORT_MAILTO}
                aria-label={CONTACT_A11Y.support}
                data-analytics="footer_support_email_click"
                className="flex items-center gap-2 hover:text-nav-accent transition-colors"
              >
                <Mail className="h-4 w-4" aria-hidden="true" /> {CONTACT.supportEmail}
              </a>
              <a
                href={SALES_MAILTO}
                aria-label={CONTACT_A11Y.sales}
                data-analytics="footer_sales_email_click"
                className="flex items-center gap-2 hover:text-nav-accent transition-colors"
              >
                <Mail className="h-4 w-4" aria-hidden="true" /> {CONTACT.salesEmail}
              </a>
              <div className="flex items-center gap-2"><MapPin className="h-4 w-4" aria-hidden="true" /> {CONTACT.addressLocality}</div>
            </div>

          </div>

          {cols.map((col) => {
            const columnActive = col.links.some((link) => isNavItemActive(link.to, pathname, search));
            const headingId = `footer-col-${col.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
            return (
              <nav key={col.title} aria-labelledby={headingId} className="min-w-0">
                <h2
                  id={headingId}
                  className={cn(
                    "font-semibold mb-4 text-sm uppercase tracking-wider break-words",
                    columnActive && "text-nav-accent",
                  )}
                >
                  {col.title}
                  {columnActive && <span className="sr-only"> — current section</span>}
                </h2>
                <ul className="space-y-2">
                  {col.links.map((link) => {
                    const isActive = isNavItemActive(link.to, pathname, search);
                    return (
                      <li key={link.to + link.label}>
                        <Link
                          to={navHref(link)}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "block text-sm transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isActive
                              ? "text-nav-accent font-medium"
                              : "text-nav-muted-foreground hover:text-nav-accent",
                          )}
                        >
                          {link.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            );
          })}
        </div>

        <div className="mt-12 pt-8 border-t border-nav-border/60 grid md:grid-cols-2 gap-6">
          <div>
            <h2 className="font-semibold mb-3">Stay in the loop</h2>
            <form className="flex gap-2 max-w-md" onSubmit={(e) => e.preventDefault()}>
              <Input
                type="email"
                placeholder="you@company.com"
                aria-label="Email address for newsletter"
                className="bg-nav/60 border-nav-border/60 text-nav-foreground placeholder:text-nav-muted-foreground/60"
              />
              <Button type="submit" className="bg-primary text-primary-foreground hover:bg-accent/90">Subscribe</Button>
            </form>
          </div>
          {/*
            Social destinations are NOT authored here. They are published by the
            Social Distribution control plane only after ownership verification
            and activation, so the footer can never ship a guessed handle.
          */}
          <div className="flex md:justify-end items-center gap-4">
            <SocialLinks location="footer" showHeading={false} />
          </div>
        </div>
        <SocialSameAs />

        <div className="mt-8 pt-6 border-t border-nav-border/60 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-nav-muted-foreground/80">
          <div className="flex flex-wrap items-center gap-4">
            <p>© 2026 SAFARID. All Rights Reserved.</p>
            {/* Secondary discoverability for the SAME canonical Staff Access route. */}
            <Link
              to={STAFF_ACCESS.to}
              data-analytics="footer_staff_access"
              className="hover:text-nav-accent transition-colors"
            >
              {STAFF_ACCESS.label} →
            </Link>
          </div>
          <div className="flex gap-4">
            <select aria-label="Language" className="bg-nav/60 border border-nav-border/60 rounded px-2 py-1 text-xs">
              <option>English</option><option>Swahili</option><option>French</option><option>Arabic</option>
            </select>
            <select aria-label="Country" className="bg-nav/60 border border-nav-border/60 rounded px-2 py-1 text-xs">
              <option>Kenya</option><option>Uganda</option><option>Tanzania</option><option>Rwanda</option>
            </select>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default MarketingFooter;
