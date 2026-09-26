import { Link } from "react-router-dom";
import { SeoHead } from "@/components/seo/SeoHead";
import { MarketingPage } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck, Gauge, ReceiptText } from "lucide-react";
import { CHARTER_GROUPS, categoriesByGroup, RATE_UNIT_LABEL, formatMoney } from "@/lib/charter/catalog";
import { CharterIcon } from "@/components/charter/CharterIcon";

const assurances = [
  { icon: ShieldCheck, t: "Vetted operators", d: "Licensing, insurance and airworthiness evidence checked before listing." },
  { icon: Gauge, t: "Live availability", d: "Every asset shows real availability state, not a callback form." },
  { icon: ReceiptText, t: "Governed pricing", d: "Transparent rate cards, volume tiers and corporate contract rates." },
];

const CharterHub = () => (
  <MarketingPage>
    <SeoHead
      title="Charter, Leasing & Rentals — aircraft, machinery, vehicles | Yalla Mobility"
      description="Charter aircraft, buses and vessels, lease aircraft, heavy machinery and haulage fleets, or rent cars, equipment and event infrastructure — one governed marketplace."
      path="/charter"
    />

    <section className="relative overflow-hidden border-b border-border bg-gradient-to-br from-primary/10 via-background to-primary-glow/10">
      <div className="container mx-auto px-4 py-20 md:py-28 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary mb-4">Charter, Leasing & Rentals</p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
          One marketplace for chartered services, leasing and rentals.
        </h1>
        <p className="text-lg text-muted-foreground mb-8">
          From a private jet on Friday to a twelve-month excavator lease — search live inventory, model the
          price and contract it on a single governed platform.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button size="lg" asChild>
            <Link to="/charter/aircraft-charter">Charter an aircraft<ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/contact?subject=charter-enquiry">Talk to a specialist</Link>
          </Button>
        </div>
      </div>
    </section>

    {CHARTER_GROUPS.map((group) => (
      <section key={group.key} className="container mx-auto px-4 py-16">
        <div className="mb-8">
          <h2 className="text-2xl md:text-3xl font-bold">{group.title}</h2>
          <p className="text-muted-foreground mt-1">{group.blurb}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {categoriesByGroup(group.key).map((c) => {
            const from = Math.min(...c.inventory.map((i) => i.rate));
            return (
              <Link
                key={c.slug}
                to={`/charter/${c.slug}`}
                className="group rounded-2xl border border-border bg-card p-6 transition-all hover:shadow-elegant hover:border-primary/40"
              >
                <CharterIcon name={c.icon} className="h-8 w-8 text-primary mb-4" />
                <h3 className="font-semibold text-lg">{c.label}</h3>
                <p className="text-sm text-muted-foreground mt-1">{c.menuDesc}</p>
                <p className="text-sm font-medium mt-4">
                  From {formatMoney(from, c.currency)}
                  <span className="text-muted-foreground font-normal"> / {RATE_UNIT_LABEL[c.rateUnit]}</span>
                </p>
                <span className="mt-3 inline-flex items-center text-sm text-primary">
                  Explore<ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    ))}

    <section className="bg-secondary/40 py-16">
      <div className="container mx-auto px-4 grid gap-6 md:grid-cols-3">
        {assurances.map((a) => (
          <div key={a.t} className="rounded-xl border border-border bg-card p-6">
            <a.icon className="h-7 w-7 text-primary mb-3" />
            <h3 className="font-semibold">{a.t}</h3>
            <p className="text-sm text-muted-foreground mt-1">{a.d}</p>
          </div>
        ))}
      </div>
    </section>
  </MarketingPage>
);

export default CharterHub;
