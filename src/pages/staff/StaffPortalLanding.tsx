import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { canEnterStaffPortal } from "@/lib/staff/access";
import { DEPARTMENTS } from "@/lib/staff/organisation";
import { STAFF_PORTAL_SECTIONS } from "@/lib/navigation/primaryNav";

/** Public entry point for the Yalla Mobility staff portal. */
export default function StaffPortalLanding() {
  const { user, roles } = useAuth();
  const authorised = !!user && canEnterStaffPortal(roles);


  return (
    <MarketingLayout>
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:py-24">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ice">Internal</div>
          <h1 className="mt-2 text-3xl sm:text-5xl font-bold tracking-tight">Yalla Mobility Staff Portal</h1>
          <p className="mt-4 max-w-2xl text-base text-ice">
            Staff 360 is the internal operating system of Yalla Mobility — people, organisation, customers,
            marketplace, revenue and intelligence connected in one model. Access requires an authorised staff role.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {authorised ? (
              <Button asChild size="lg" variant="secondary"><Link to="/staff/360">Enter Staff 360</Link></Button>
            ) : (
              <Button asChild size="lg" variant="secondary">
                <Link to="/staff/access?redirect=/staff/360">Staff sign in</Link>
              </Button>
            )}
            <Button asChild size="lg" variant="outline" className="border-ice/70 text-primary-foreground">
              <Link to="/careers">Careers at Yalla</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Portal dashboard — every staff surface is launched from here, not from
          the public header. Unauthorised visitors are routed to staff sign-in. */}
      <section className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-xl font-semibold tracking-tight">Portal dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {authorised
            ? "Open any Staff 360 surface directly."
            : "Sign in with an authorised staff role to open these surfaces."}
        </p>
        <div className="mt-6 space-y-8">
          {STAFF_PORTAL_SECTIONS.map((group) => (
            <div key={group.heading}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {group.heading}
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {group.items.map((item) => (
                  <Card
                    key={item.to}
                    className="group transition-colors hover:border-primary/40 focus-within:border-primary/40"
                  >
                    <CardContent className="pt-5">
                      <Link
                        to={authorised ? item.to : `/staff/access?redirect=${encodeURIComponent(item.to)}`}
                        className="block focus-visible:outline-none"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{item.label}</span>
                          <ArrowRight
                            className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{item.desc}</p>
                      </Link>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>


      <section className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-xl font-semibold tracking-tight">Departmental operating systems</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Eighteen connected departments, each accountable for a defined contribution to customers, marketplace and revenue.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DEPARTMENTS.map((d) => (
            <Card key={d.slug}>
              <CardContent className="pt-5">
                <div className="text-sm font-semibold">{d.label}</div>
                <div className="mt-1 text-xs text-primary">{d.operatingSystem}</div>
                <p className="mt-2 text-sm text-muted-foreground">{d.mandate}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </MarketingLayout>
  );
}
