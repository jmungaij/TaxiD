/**
 * TRUST PROOF LAYER — four pillars, real platform data only.
 *
 * Numeric figures are rendered ONLY when the platform returns verified rows.
 * If data is unavailable the pillar falls back to a capability statement
 * ("LIVE", "SECURE", "REAL-TIME") instead of an invented number.
 */
import { useEffect, useState } from "react";
import { BadgeCheck, CreditCard, Navigation, Radar } from "lucide-react";
import { fetchMobilityStatus, freshnessLabel, type MobilityStatus } from "@/lib/marketing/mobilityStatus";

const TrustProof = () => {
  const [status, setStatus] = useState<MobilityStatus | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchMobilityStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const live = status?.status === "live";
  const operators = live && status?.verifiedOperators ? status.verifiedOperators : null;
  const assets = live && status?.verifiedAssets ? status.verifiedAssets : null;

  const pillars = [
    {
      icon: BadgeCheck,
      eyebrow: "Verified supply",
      value: operators ? `${operators}` : "VERIFIED",
      label: operators ? "Verified fleet & charter operators" : "Operators verified before listing",
    },
    {
      icon: Radar,
      eyebrow: "Availability",
      value: live ? "LIVE" : "ON REQUEST",
      label: assets ? `${assets} assets published on the platform` : "Availability confirmed at quote time",
    },
    {
      icon: CreditCard,
      eyebrow: "Payments",
      value: "SECURE",
      label: "M-Pesa and card processing with reconciliation",
    },
    {
      icon: Navigation,
      eyebrow: "Tracking",
      value: "REAL-TIME",
      label: "Journey monitoring, SOS and proof of delivery",
    },
  ];

  return (
    <section className="border-y border-border bg-card/60 py-12" aria-labelledby="trust-proof-heading">
      <div className="container mx-auto px-4">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="trust-proof-heading" className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Proof, not promises
          </h2>
          <p className="text-xs text-muted-foreground">
            {live && status
              ? `Verified from platform records · ${freshnessLabel(status.fetchedAt)}`
              : "Platform figures shown only when verified data is available"}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p) => (
            <div key={p.eyebrow} className="rounded-2xl border border-border bg-background p-6">
              <p.icon className="h-6 w-6 text-primary" aria-hidden />
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{p.eyebrow}</p>
              <p className="mt-1 text-2xl font-bold text-primary">{p.value}</p>
              <p className="mt-2 text-sm text-muted-foreground">{p.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrustProof;
