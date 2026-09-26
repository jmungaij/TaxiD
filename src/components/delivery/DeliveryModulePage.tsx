import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ModuleShell, type ModuleMeta } from "./ModuleShell";
import { ModuleQuoteCard } from "./ModuleQuoteCard";
import { DeliveryHero, type SendIntent } from "./landing/DeliveryHero";
import {
  Section,
  DeliveryMarketplace,
  DeliveryValue,
  DeliveryJourney,
  DeliveryTracking,
  DeliveryBusiness,
  DeliveryNetwork,
  DeliveryStories,
  DeliveryAssistant,
  DeliveryFinalCta,
} from "./landing/DeliverySections";
import { ShieldCheck, Truck, Sparkles } from "lucide-react";

/** Code-split: the onboarding wizard, KYC panel and vehicle registry only load on demand. */
const PartnerNetworkTabs = lazy(() => import("./PartnerNetworkTabs"));

/** Which send intents the glass widget offers for each delivery module. */
const MODULE_INTENTS: Record<string, SendIntent[]> = {
  package: ["parcel", "express", "business"],
  courier: ["documents", "express", "parcel"],
  fleet: ["truck", "freight", "business"],
  logistics: ["freight", "truck", "business"],
};

/** Mounts children only once the section scrolls into view. */
function DeferUntilVisible({ children, height = "h-64" }: { children: React.ReactNode; height?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div ref={ref}>
      {visible ? (
        <Suspense fallback={<Skeleton className={`w-full rounded-2xl ${height}`} />}>{children}</Suspense>
      ) : (
        <Skeleton className={`w-full rounded-2xl ${height}`} />
      )}
    </div>
  );
}

/**
 * Public, customer-facing DLEP module page for each delivery category.
 *
 * Journey: Discover (cinematic hero + module-scoped glass send widget) →
 * Understand (capabilities, marketplace, value) → Trust (journey, network,
 * stories) → Quote (module quote rail) → Book / Track (tracking lookup) →
 * Business (enterprise logistics) → Assist (AI logistics assistant).
 *
 * Operational intelligence (live ops map, AI dispatcher, SLA exposure, revenue,
 * network health, procurement and governance) is intentionally NOT rendered
 * here — it lives in the admin Delivery Operations Control Tower at
 * /dashboard/admin/delivery-operations.
 */
export function DeliveryModulePage({
  module,
  overview,
}: {
  module: ModuleMeta;
  overview: React.ReactNode;
}) {
  const intents = useMemo(() => MODULE_INTENTS[module.id] ?? undefined, [module.id]);

  return (
    <ModuleShell module={module} variant="bare">
      {/* 1 · Cinematic layered hero with intent-adaptive glass send widget */}
      <DeliveryHero
        eyebrow={module.tagline}
        headline={
          <>
            {module.label}.
            <span className="block text-ice/70">Sent with certainty.</span>
          </>
        }
        lead={module.description}
        intents={intents}
        scope={`delivery_${module.id}_hero`}
      />

      {/* 2 · Capabilities + quote rail */}
      <Section
        id="capabilities"
        eyebrow="What you get"
        title={`Everything included with ${module.label.toLowerCase()}`}
        lead="Priced up front, tracked end to end and closed with electronic proof of delivery."
      >
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
          <div className="space-y-6">
            {overview}

            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <div className="text-sm font-semibold">Vetted, checked, accountable</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Every operator clears identity, tax and conduct checks before their first job — and stays
                      continuously monitored.
                    </p>
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <Truck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <div className="text-sm font-semibold">Right vehicle for the job</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {module.vehicleCategories.map((v) => (
                        <Badge key={v} variant="outline" className="text-[11px]">
                          {v}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <ModuleQuoteCard module={module} />
        </div>
      </Section>

      {/* 3 · Filterable service marketplace */}
      <DeliveryMarketplace />

      {/* 4 · Outcome-led value */}
      <DeliveryValue />

      {/* 5 · Journey */}
      <DeliveryJourney />

      {/* 6 · Tracking lookup */}
      <DeliveryTracking />

      {/* 7 · Business & enterprise logistics */}
      <DeliveryBusiness />

      {/* 8 · Network proof */}
      <DeliveryNetwork />

      {/* 9 · Customer stories */}
      <DeliveryStories />

      {/* 10 · AI logistics assistant */}
      <DeliveryAssistant />

      {/* 11 · Partner onboarding — opt-in, code-split, partner facing only */}
      <Section
        id="partner"
        tone="muted"
        eyebrow="Partner network"
        title={`Join the ${module.label.toLowerCase()} network`}
        lead="Operate a bike, van or truck? Onboard, submit compliance documents and register vehicles to start receiving jobs."
      >
        <DeferUntilVisible>
          <PartnerNetworkTabs module={module} />
        </DeferUntilVisible>
      </Section>

      <DeliveryFinalCta />

      <p className="sr-only">
        <Sparkles aria-hidden /> Operational dashboards for {module.label} are available to authorised staff only.
      </p>
    </ModuleShell>
  );
}
