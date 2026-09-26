/**
 * "WHAT DO YOU BRING TO SAFARID?" — the routing step that comes before a visitor
 * is asked to choose a partner category.
 *
 * Three answers: customers (demand), capacity (supply), technology reach
 * (integration). The answer is written to the URL as `?bring=`, so it is
 * shareable and restorable, it filters the conversion tracks below, it opens the
 * matching ecosystem in "The network", and it is carried into the partner
 * application form as a prefill.
 *
 * Governance: destinations are the validated /partners/apply route and the
 * existing /partners anchors only; no volumes, rates, SLAs or guarantees.
 */
import { Link } from "react-router-dom";
import { ArrowRight, Building2, Code2, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { trackPartnerCta } from "@/lib/partners/funnelTrack";
import {
  BRING_OPTIONS, buildApplyLink, findBring, findLevel, type BringKey,
} from "@/lib/partners/intent";

const PAGE_SOURCE = "/partners#bring";

const ICON: Record<BringKey, typeof Building2> = {
  demand: Building2,
  supply: Truck,
  technology: Code2,
};

export interface PartnerIntentRouterProps {
  /** Empty string means the visitor has not answered yet. */
  value: string;
  onChange: (next: string) => void;
}

export function PartnerIntentRouter({ value, onChange }: PartnerIntentRouterProps) {
  const active = findBring(value);

  const select = (key: BringKey) => {
    onChange(key === value ? "" : key);
    void trackPartnerCta({
      buttonName: "partner_bring_selected",
      actionType: "noop",
      target: key,
      pageSource: PAGE_SOURCE,
      metadata: { funnel_step: "interact", bring: key },
    });
  };

  const onApply = (to: string, key: BringKey) =>
    void trackPartnerCta({
      buttonName: "partner_bring_apply",
      actionType: "navigate",
      target: to,
      pageSource: PAGE_SOURCE,
      metadata: { funnel_step: "cta", bring: key },
    });

  return (
    <section id="bring" className="container mx-auto px-4 pt-20" aria-labelledby="bring-heading">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">Start here</span>
        <h2
          id="bring-heading"
          className="mt-3 mb-3 text-balance text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-[1.15] tracking-tight"
        >
          What do you bring to SAFARID?
        </h2>
        <p className="text-pretty text-muted-foreground">
          Answer this first and the rest of this page — the partnership on offer, the ecosystem you
          belong to and the application you complete — follows your answer.
        </p>
      </div>

      <div role="radiogroup" aria-labelledby="bring-heading" className="grid gap-4 lg:grid-cols-3">
        {BRING_OPTIONS.map((o) => {
          const Icon = ICON[o.key];
          const isActive = o.key === value;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => select(o.key)}
              className={`flex h-full flex-col rounded-3xl border p-6 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground shadow-[var(--shadow-md)]"
                  : "border-border bg-card/80 backdrop-blur-sm hover:border-primary/50"
              }`}
            >
              <span
                className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${
                  isActive ? "bg-primary-foreground/15 text-primary-foreground" : "bg-primary/10 text-primary"
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-lg font-semibold leading-snug">{o.answer}</h3>
              <p className={`mt-2 text-sm ${isActive ? "text-primary-foreground/85" : "text-muted-foreground"}`}>
                {o.who}
              </p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {o.brings.map((b) => (
                  <li
                    key={b}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      isActive
                        ? "border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground"
                        : "border-border bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    {b}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="mt-6 rounded-3xl border border-primary/25 bg-primary/5 p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-8">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                Your route into SAFARID
              </span>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{active.lead}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                Suggested starting point:{" "}
                <span className="font-semibold text-foreground">
                  {findLevel(active.suggestedLevel)?.label}
                </span>{" "}
                on the integration maturity ladder — you can change it below before you apply.
              </p>
            </div>
            <div className="grid gap-2 lg:col-span-4">
              <Button
                asChild
                onClick={() =>
                  onApply(buildApplyLink({ bring: active.key, level: active.suggestedLevel }), active.key)
                }
              >
                <Link to={buildApplyLink({ bring: active.key, level: active.suggestedLevel })}>
                  Continue to onboarding <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/partners?bring=${active.key}&side=${active.ecosystem}#network`}>
                  See where you belong in the network
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default PartnerIntentRouter;
