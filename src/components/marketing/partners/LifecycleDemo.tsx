/**
 * Interactive product demonstration — the partner order lifecycle.
 *
 * Nine stages, driven by a real tablist (arrow keys, Home/End, focus ring), an
 * auto-advance that pauses on interaction and never runs for visitors who ask
 * for reduced motion. The content mirrors the stages the platform actually
 * records: quote, approval, allocation, execution, reconciliation, settlement.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck, CircleCheck, Coins, FileSignature, MapPinned, Pause, Play,
  Radio, Route as RouteIcon, Truck, UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";

interface Stage {
  key: string;
  label: string;
  icon: typeof UserRound;
  headline: string;
  detail: string;
  facts: { k: string; v: string }[];
}

const STAGES: Stage[] = [
  {
    key: "customer", label: "Customer", icon: UserRound,
    headline: "Your customer stays yours",
    detail: "You register the customer in your own workspace with their references, cost centres and preferences. SAFARID never markets to them.",
    facts: [{ k: "Owner", v: "Partner" }, { k: "Record", v: "Partner customer register" }, { k: "Visibility", v: "Scoped to your organisation" }],
  },
  {
    key: "journey", label: "Journey", icon: RouteIcon,
    headline: "One journey, several legs",
    detail: "Arrival transfer, upcountry charter, courier drop and a rental can sit in a single customer journey with one commercial view.",
    facts: [{ k: "Legs", v: "Ride · Charter · Delivery · Rental" }, { k: "Grouping", v: "Journey reference" }, { k: "Owner", v: "Partner" }],
  },
  {
    key: "quote", label: "Quote", icon: FileSignature,
    headline: "Server-computed pricing",
    detail: "Pricing is computed on the server from the contracted rate card — never in the browser — so the figure you show your customer is the figure the platform will honour.",
    facts: [{ k: "Source", v: "Contracted rate card" }, { k: "Computed", v: "Server-side" }, { k: "Validity", v: "Versioned per quote" }],
  },
  {
    key: "supply", label: "Supply", icon: MapPinned,
    headline: "Explainable supply matching",
    detail: "Available, compliance-verified capacity is matched to the demand with the reasons recorded — why a supplier qualified, and why another was excluded.",
    facts: [{ k: "Pool", v: "Verified drivers, fleets, operators" }, { k: "Scoring", v: "Coverage · compliance · risk" }, { k: "Evidence", v: "Reasons stored per match" }],
  },
  {
    key: "margin", label: "Margin", icon: Coins,
    headline: "You see the split before you confirm",
    detail: "Supplier cost, SAFARID margin, your contracted margin and the applicable taxes are shown on the order before confirmation.",
    facts: [{ k: "Margin", v: "Contracted and versioned" }, { k: "Models", v: "Net rate · markup · commission · revenue share · fee · tiered" }, { k: "Taxes", v: "Per transaction and jurisdiction" }],
  },
  {
    key: "confirm", label: "Confirmation", icon: BadgeCheck,
    headline: "Approval and authorisation",
    detail: "Confirmation records who approved the order, on which terms and against which budget or wallet position.",
    facts: [{ k: "Control", v: "Maker–checker where configured" }, { k: "Funding", v: "Wallet or contracted credit" }, { k: "Artefact", v: "Sealed order document" }],
  },
  {
    key: "dispatch", label: "Dispatch", icon: Radio,
    headline: "Allocation and execution",
    detail: "The order is allocated to the assigned supply and executed on SAFARID's operating stack, with status flowing back into your workspace.",
    facts: [{ k: "Allocation", v: "Assigned asset and operator" }, { k: "Tracking", v: "Status events per leg" }, { k: "Exceptions", v: "Raised as operational cases" }],
  },
  {
    key: "complete", label: "Completion", icon: Truck,
    headline: "Proof of delivery and service record",
    detail: "Completion captures the operational evidence — arrival, proof of delivery, waiting time and any variation from the plan.",
    facts: [{ k: "Evidence", v: "POD · timestamps · variations" }, { k: "SLA", v: "Measured per order" }, { k: "Disputes", v: "Opened against the record" }],
  },
  {
    key: "settle", label: "Settlement", icon: CircleCheck,
    headline: "Reconciliation, then settlement",
    detail: "Orders are reconciled line by line before settlement. Corrections, refunds and adjustments are recorded, authorised and auditable rather than silently overwritten.",
    facts: [{ k: "Basis", v: "Order-level reconciliation" }, { k: "Adjustments", v: "Recorded, authorised, auditable" }, { k: "Ledger", v: "Append-only" }],
  },
];

const ADVANCE_MS = 4200;

export function LifecycleDemo() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const reducedMotion = useMemo(
    () => typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    if (!playing || reducedMotion) return;
    const t = setInterval(() => setActive((i) => (i + 1) % STAGES.length), ADVANCE_MS);
    return () => clearInterval(t);
  }, [playing, reducedMotion]);

  const select = useCallback((i: number) => {
    setActive(i);
    setPlaying(false);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = STAGES.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = active === last ? 0 : active + 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = active === 0 ? last : active - 1;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  const stage = STAGES[active];
  const Icon = stage.icon;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Step through the lifecycle the platform records for every partner order.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPlaying((p) => !p)}
          aria-pressed={playing}
        >
          {playing ? (
            <><Pause className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Pause walkthrough</>
          ) : (
            <><Play className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Play walkthrough</>
          )}
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Partner order lifecycle"
        onKeyDown={onKeyDown}
        className="flex snap-x gap-2 overflow-x-auto pb-2"
      >
        {STAGES.map((s, i) => {
          const StageIcon = s.icon;
          const selected = i === active;
          return (
            <button
              key={s.key}
              ref={(el) => { tabRefs.current[i] = el; }}
              role="tab"
              id={`lifecycle-tab-${s.key}`}
              aria-selected={selected}
              aria-controls={`lifecycle-panel-${s.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(i)}
              className={`flex shrink-0 snap-start items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              <StageIcon className="h-3.5 w-3.5" aria-hidden />
              <span>{i + 1}. {s.label}</span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`lifecycle-panel-${stage.key}`}
        aria-labelledby={`lifecycle-tab-${stage.key}`}
        className="glass-panel grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]"
      >
        <div key={stage.key} className="motion-safe:animate-fade-in">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            <Icon className="h-3.5 w-3.5" aria-hidden /> Stage {active + 1} of {STAGES.length}
          </span>
          <h3 className="mt-4 text-2xl font-bold">{stage.headline}</h3>
          <p className="mt-3 text-muted-foreground">{stage.detail}</p>
        </div>

        <dl className="space-y-3 rounded-xl border border-border bg-card/70 p-5">
          {stage.facts.map((f) => (
            <div key={f.k} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{f.k}</dt>
              <dd className="mt-1 text-sm font-medium">{f.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export default LifecycleDemo;
