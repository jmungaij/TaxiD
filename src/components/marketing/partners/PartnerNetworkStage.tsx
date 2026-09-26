/**
 * THE NETWORK — interactive two-sided ecosystem experience.
 *
 * Structure preserved from the original section: two ecosystems (distribution
 * demand, supply capacity) and one execution engine between them. What changed
 * is the interaction model: the ecosystem tabs and the category cards now drive
 * a single dominant cinematic stage, a contextual capability panel and a
 * category-specific call to action.
 *
 * Governance:
 *  • every destination comes from `networkRegistry`, which resolves routes and
 *    capability lists from the operational partner taxonomy — nothing invented;
 *  • nothing that looks clickable is inert;
 *  • no counts, volumes or guarantees are stated anywhere in this component;
 *  • motion, parallax and image transitions are suppressed entirely under
 *    prefers-reduced-motion, and the section stays fully usable without imagery.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StagePicture } from "@/components/marketing/partners/StagePicture";
import { trackPartnerCta } from "@/lib/partners/funnelTrack";
import { useDeepParam } from "@/lib/partners/useDeepParam";
import {
  ECOSYSTEMS,
  ENGINE_STAGES,
  NETWORK_OUTCOMES,
  NETWORK_STAGE_SIZES,
  NETWORK_THUMB_SIZES,
  type EcosystemKey,
} from "@/lib/partners/networkRegistry";

const PAGE_SOURCE = "/partners#network";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

export function PartnerNetworkStage() {
  const SIDE_KEYS = useMemo(() => ECOSYSTEMS.map((e) => e.key), []);
  const CATEGORY_IDS = useMemo(
    () => ECOSYSTEMS.flatMap((e) => e.categories.map((c) => c.id)),
    [],
  );
  const [sideParam, setSideParam] = useDeepParam("side", SIDE_KEYS, ECOSYSTEMS[0].key);
  const side = sideParam as EcosystemKey;
  const [catParam, setCatParam] = useDeepParam(
    "cat",
    CATEGORY_IDS,
    ECOSYSTEMS[0].categories[0].id,
  );

  const ecosystem = useMemo(
    () => ECOSYSTEMS.find((e) => e.key === side) ?? ECOSYSTEMS[0],
    [side],
  );
  const active = useMemo(
    () => ecosystem.categories.find((c) => c.id === catParam) ?? ecosystem.categories[0],
    [ecosystem, catParam],
  );

  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const viewed = useRef(false);

  /* ---------- one view event per session on the section ---------- */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || viewed.current) return;
        viewed.current = true;
        void trackPartnerCta({
          buttonName: "partner_network_view",
          actionType: "scroll",
          pageSource: PAGE_SOURCE,
        });
        io.disconnect();
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* ---------- pointer parallax: desktop only, motion-safe only ---------- */
  useEffect(() => {
    const el = stageRef.current;
    if (!el || reduced) return;
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches) return;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width - 0.5;
      const y = (ev.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--px", `${(x * 6).toFixed(2)}px`);
      el.style.setProperty("--py", `${(y * 6).toFixed(2)}px`);
    };
    const onLeave = () => {
      el.style.setProperty("--px", "0px");
      el.style.setProperty("--py", "0px");
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  const selectSide = useCallback((key: EcosystemKey) => {
    setSideParam(key);
    void trackPartnerCta({
      buttonName: "partner_ecosystem_selected",
      actionType: "noop",
      target: key,
      pageSource: PAGE_SOURCE,
      metadata: { funnel_step: "interact" },
    });
  }, [setSideParam]);

  const selectCategory = useCallback(
    (key: EcosystemKey, id: string, event: string) => {
      setCatParam(id);
      void trackPartnerCta({
        buttonName: event,
        actionType: "noop",
        target: id,
        pageSource: PAGE_SOURCE,
        metadata: { ecosystem: key, funnel_step: "interact" },
      });
    },
    [setCatParam],
  );

  const onTabKeyDown = (ev: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = ECOSYSTEMS.length - 1;
    let next = -1;
    if (ev.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (ev.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = last;
    if (next < 0) return;
    ev.preventDefault();
    selectSide(ECOSYSTEMS[next].key);
    tabRefs.current[next]?.focus();
  };

  const drift = reduced
    ? ""
    : "transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform";

  return (
    <section
      ref={sectionRef}
      className="border-y border-border bg-muted/30 py-20"
      aria-labelledby="network-heading"
    >
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">The network</span>
          <h2
            id="network-heading"
            className="mt-3 mb-3 text-balance text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-[1.15] tracking-tight"
          >
            Two ecosystems, one execution engine
          </h2>
          <p className="text-pretty text-muted-foreground">
            Some partners create demand. Others provide the capacity that fulfils it. SAFARID operates the
            layer between them.
          </p>
        </div>

        {/* ---------------- ecosystem tabs ---------------- */}
        <div
          role="tablist"
          aria-label="Partner ecosystems"
          className="mx-auto mb-8 grid max-w-3xl gap-3 sm:grid-cols-2"
        >
          {ECOSYSTEMS.map((eco, i) => {
            const isActive = eco.key === side;
            return (
              <button
                key={eco.key}
                ref={(el) => { tabRefs.current[i] = el; }}
                role="tab"
                id={`network-tab-${eco.key}`}
                aria-selected={isActive}
                aria-controls="network-panel"
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectSide(eco.key)}
                onKeyDown={(ev) => onTabKeyDown(ev, i)}
                className={`rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/50"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 rounded-full ${isActive ? "bg-primary-foreground" : "bg-muted-foreground/50"}`}
                  />
                  {eco.label}
                </span>
                <span
                  className={`mt-1 block text-xs ${isActive ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                >
                  {eco.role}
                </span>
              </button>
            );
          })}
        </div>

        <div
          id="network-panel"
          role="tabpanel"
          aria-labelledby={`network-tab-${side}`}
          className="grid gap-6 lg:grid-cols-12"
        >
          {/* ---------------- dominant stage ---------------- */}
          <div className="lg:col-span-8">
            <div
              ref={stageRef}
              className="relative overflow-hidden rounded-3xl border border-border bg-primary"
            >
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                <StagePicture
                  key={active.id}
                  picture={active.image}
                  alt={active.alt}
                  sizes={NETWORK_STAGE_SIZES}
                  priority
                  className={`absolute inset-0 h-full w-full ${drift} ${reduced ? "" : "motion-safe:animate-fade-in scale-[1.02]"}`}
                />
                <div
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-t from-primary from-5% via-primary/25 via-50% to-transparent"
                  style={reduced ? undefined : { transform: "translate3d(var(--px,0), var(--py,0), 0)" }}
                />
                {/* glass information overlay */}
                <div className="absolute inset-x-4 bottom-4 sm:inset-x-6 sm:bottom-6">
                  <div className="rounded-2xl border border-primary-foreground/20 bg-primary/70 p-4 backdrop-blur-md sm:p-5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
                      {ecosystem.key === "distribution" ? "Demand" : "Capacity"}
                    </span>
                    <h3 className="mt-1 text-balance text-lg font-semibold tracking-tight text-primary-foreground sm:text-2xl">
                      {active.label}
                    </h3>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {active.overlay.map((o) => (
                        <li
                          key={o}
                          className="rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1 text-xs font-medium text-primary-foreground"
                        >
                          {o}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* ---------------- category selectors with previews ---------------- */}
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {ecosystem.categories.map((c) => {
                const isActive = c.id === active.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-pressed={isActive}
                      aria-controls="network-panel"
                      onClick={() => selectCategory(ecosystem.key, c.id, c.analyticsEvent)}
                      className={`group flex h-full w-full flex-col overflow-hidden rounded-2xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        isActive ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"
                      }`}
                    >
                      <span className="relative block aspect-[16/9] w-full overflow-hidden">
                        <StagePicture
                          picture={c.image}
                          alt=""
                          sizes={NETWORK_THUMB_SIZES}
                          className={`h-full w-full ${reduced ? "" : "transition-transform duration-700 group-hover:scale-[1.06]"}`}
                        />
                        {isActive && (
                          <span
                            aria-hidden
                            className="absolute inset-0 border-2 border-primary"
                          />
                        )}
                      </span>
                      <span className="flex flex-1 items-start gap-2 p-3">
                        <CheckCircle2
                          aria-hidden
                          className={`mt-0.5 h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground/40"}`}
                        />
                        <span>
                          <span className="block text-sm font-semibold leading-snug">{c.label}</span>
                          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                            {c.description}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ---------------- contextual information panel ---------------- */}
          <div className="lg:col-span-4">
            <div className="flex h-full flex-col rounded-3xl border border-border bg-card p-6">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                {ecosystem.label}
              </span>
              <p className="mt-2 text-sm text-muted-foreground">{ecosystem.lead}</p>

              <h4 className="mt-6 text-sm font-semibold">SAFARID capability</h4>
              <ul className="mt-3 space-y-2">
                {active.capabilities.map((cap) => (
                  <li key={cap} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden />
                    <span>{cap}</span>
                  </li>
                ))}
              </ul>

              <h4 className="mt-6 text-sm font-semibold">Partner value</h4>
              <p className="mt-2 text-sm text-muted-foreground">{active.partnerValue}</p>

              <p className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span title={active.provenance}>{active.provenance}</span>
              </p>

              <div className="mt-6 space-y-3">
                <Button className="w-full" asChild>
                  <Link
                    to={active.to}
                    onClick={() =>
                      void trackPartnerCta({
                        buttonName: "partner_category_cta_clicked",
                        actionType: "navigate",
                        target: active.to,
                        pageSource: PAGE_SOURCE,
                        metadata: { ecosystem: ecosystem.key, category: active.id },
                      })
                    }
                  >
                    {active.cta}
                    <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                  </Link>
                </Button>
                {active.segmentTo && (
                  <Button variant="outline" className="w-full" asChild>
                    <Link to={active.segmentTo}>Read how this partnership works</Link>
                  </Button>
                )}
                <Button variant="ghost" className="w-full" asChild>
                  <Link
                    to={ecosystem.to}
                    onClick={() =>
                      void trackPartnerCta({
                        buttonName: ecosystem.analyticsEvent,
                        actionType: "navigate",
                        target: ecosystem.to,
                        pageSource: PAGE_SOURCE,
                      })
                    }
                  >
                    {ecosystem.cta}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* ---------------- execution engine between the two sides ---------------- */}
        <div className="mt-10 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Demand
              </span>
              <span aria-hidden className="h-px w-8 bg-border sm:w-12" />
              <span className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground">
                SAFARID execution engine
              </span>
              <span aria-hidden className="h-px w-8 bg-border sm:w-12" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Supply
              </span>
            </div>
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
              {ENGINE_STAGES.map((s, i) => (
                <li key={s} className="flex items-center gap-2">
                  {i > 0 && <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground/60" />}
                  <span className="rounded-lg border border-border bg-background px-3 py-1 text-xs font-medium">
                    {s}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-4">
            {NETWORK_OUTCOMES.map((o) => (
              <div key={o.t}>
                <p className="text-sm font-semibold">{o.t}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{o.d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default PartnerNetworkStage;
