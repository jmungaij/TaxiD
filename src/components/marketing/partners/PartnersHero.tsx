/**
 * Yalla Partners hero — the proposition and the product in one frame.
 *
 * The right half is not decoration: it is a labelled *illustration* of the
 * partner workspace (order book, commercial split, supply coverage). Every
 * figure carries an "illustrative" label, because inventing live network
 * numbers on a public page would be a fabrication.
 */
import { Link } from "react-router-dom";
import { ArrowRight, CircleDot, Layers, Route as RouteIcon, ShieldCheck, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import heroImage from "@/assets/partners/partners-hero.jpg";

const ORDER_ROWS = [
  { ref: "BT-78291", service: "Airport transfer", leg: "JKIA → Westlands", state: "Confirmed" },
  { ref: "BT-78290", service: "Safari charter", leg: "Nairobi → Maasai Mara", state: "On the way" },
  { ref: "BT-78289", service: "Courier delivery", leg: "CBD → Thika Road", state: "Completed" },
];

const SPLIT = [
  { label: "Customer price", value: "KES 50,000" },
  { label: "Supplier cost", value: "KES 40,000" },
  { label: "Yalla margin", value: "KES 5,000" },
  { label: "Your margin", value: "KES 5,000" },
];

export function PartnersHero() {
  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      <div className="absolute inset-0">
        <img
          src={heroImage}
          alt="Coaches, vans and city traffic moving through an African city at night"
          width={1920}
          height={1088}
          loading="eager"
          decoding="sync"
          fetchPriority="high"
          className="h-full w-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-primary/70" />
        <div className="absolute inset-0 bg-gradient-to-r from-primary via-primary/75 to-primary/30" />

      </div>

      <div className="container relative mx-auto grid items-center gap-12 px-4 py-20 md:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="motion-safe:animate-fade-in">
          <span className="inline-block rounded-full bg-ice/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
            Mobility distribution infrastructure
          </span>
          <h1 className="mt-4 text-[clamp(2rem,4.6vw,3.4rem)] font-bold leading-[1.05] tracking-tight">
            Build your mobility offering on Yalla.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-primary-foreground/85">
            Yalla Partners gives travel, hospitality, corporate, commerce and logistics businesses the
            infrastructure to sell and fulfil transportation under their own customer relationships.
            You keep the customer, the brand and the margin. Yalla is the execution layer — supply,
            dispatch, journey, settlement.
          </p>

          <ul className="mt-6 grid gap-2 text-sm text-primary-foreground/80 sm:grid-cols-2">
            {[
              "Your customers, your brand",
              "Sell rides, charters, deliveries, rentals, leasing",
              "Fulfil without owning the assets",
              "Commercials versioned at order level",
            ].map((x) => (
              <li key={x} className="flex items-start gap-2">
                <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-ice" aria-hidden />
                <span>{x}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" className="bg-ice text-primary hover:bg-ice/90" asChild>
              <Link to="/partners/apply?track=distribution">
                Start a partner application <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
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

        {/* Illustrated workspace — architectural glazing, no fabricated live data */}
        <div
          className="glass-card space-y-4 p-4 sm:p-5 motion-safe:animate-scale-in"
          role="img"
          aria-label="Illustration of the Yalla partner workspace showing an order book, the commercial split of an order and supply coverage"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary-foreground">
              <Layers className="h-4 w-4 text-ice" aria-hidden /> Partner workspace
            </div>
            <span className="rounded-full border border-ice/25 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary-foreground/70">
              Illustrative
            </span>
          </div>

          <div className="rounded-lg border border-ice/15 bg-primary/30 p-3">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground/70">
              <RouteIcon className="h-3.5 w-3.5" aria-hidden /> Order book
            </p>
            <ul className="space-y-2">
              {ORDER_ROWS.map((r) => (
                <li key={r.ref} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-primary-foreground/60">{r.ref}</span>
                  <span className="flex-1 text-primary-foreground/90">{r.service}</span>
                  <span className="hidden text-primary-foreground/60 sm:inline">{r.leg}</span>
                  <span className="rounded-full border border-ice/25 px-2 py-0.5 text-[10px] text-primary-foreground/80">
                    {r.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-ice/15 bg-primary/30 p-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground/70">
                <Wallet className="h-3.5 w-3.5" aria-hidden /> Commercial split
              </p>
              <dl className="space-y-1.5 text-xs">
                {SPLIT.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-2">
                    <dt className="text-primary-foreground/65">{s.label}</dt>
                    <dd className="font-medium tabular-nums text-primary-foreground">{s.value}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2 border-t border-ice/15 pt-1.5">
                  <dt className="text-primary-foreground/65">Applicable taxes</dt>
                  <dd className="text-primary-foreground/80">Shown per transaction</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-ice/15 bg-primary/30 p-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground/70">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Supply coverage
              </p>
              <div className="space-y-2">
                {[
                  { city: "Nairobi", level: "w-[86%]" },
                  { city: "Mombasa", level: "w-[64%]" },
                  { city: "Kisumu", level: "w-[41%]" },
                  { city: "Nakuru", level: "w-[33%]" },
                ].map((c) => (
                  <div key={c.city} className="text-xs">
                    <div className="mb-1 flex items-center justify-between text-primary-foreground/70">
                      <span>{c.city}</span>
                      <span className="text-primary-foreground/50">capacity</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ice/10">
                      <div className={`h-full rounded-full bg-ice/70 ${c.level}`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PartnersHero;
