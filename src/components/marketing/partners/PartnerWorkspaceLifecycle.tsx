/**
 * PARTNER WORKSPACE — a control surface, not six feature cards.
 *
 * The workspace itself is the story: one continuous record moving customer →
 * demand → booking → commercials → capacity → execution → journey →
 * reconciliation → customer experience. A horizontal lifecycle rail drives one
 * dominant stage, and every stage resolves to a real destination.
 *
 * Governance:
 *  • stages, copy and destinations come from `workspaceLifecycle` only;
 *  • the selected stage is shareable and restorable via `?stage=`;
 *  • funnel telemetry is view → interact → cta, per stage;
 *  • motion is suppressed under prefers-reduced-motion and the section stays
 *    usable without imagery.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buildApplyLink } from "@/lib/partners/intent";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { StagePicture } from "@/components/marketing/partners/StagePicture";
import { useDeepParam } from "@/lib/partners/useDeepParam";
import { trackPartnerCta } from "@/lib/partners/funnelTrack";
import { recordLifecycleSignal } from "@/lib/partners/signals";
import {
  LIFECYCLE,
  LIFECYCLE_IDS,
  LIFECYCLE_STAGE_SIZES,
  OWNER_LABEL,
} from "@/lib/partners/workspaceLifecycle";

const PAGE_SOURCE = "/partners#workspace";

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

export function PartnerWorkspaceLifecycle() {
  const [stageId, setStageId] = useDeepParam("stage", LIFECYCLE_IDS, LIFECYCLE[0].id);
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const railRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const viewed = useRef(false);
  const interacted = useRef(false);

  const index = useMemo(() => Math.max(0, LIFECYCLE.findIndex((s) => s.id === stageId)), [stageId]);
  const active = LIFECYCLE[index];

  /** Onboarding link prefilled with the visitor's intent, category, level and stage. */
  const [params] = useSearchParams();
  const applyTo = buildApplyLink({
    bring: params.get("bring"),
    cat: params.get("cat"),
    level: params.get("level"),
    stage: active.id,
  });

  /* ---------- funnel: view ---------- */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || viewed.current) return;
        viewed.current = true;
        void trackPartnerCta({
          buttonName: "partner_workspace_view",
          actionType: "scroll",
          pageSource: PAGE_SOURCE,
          metadata: { funnel_step: "view", stage: stageId },
        });
        io.disconnect();
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- funnel: interact ---------- */
  const select = (id: string) => {
    setStageId(id);
    const first = !interacted.current;
    interacted.current = true;
    /**
     * A stage change is also a commercial signal, not only telemetry: it raises
     * a partner-desk work item and notification carrying the stage together with
     * what the visitor said they bring, the category and the maturity level they
     * selected. The routine deduplicates per session and stage and is rate
     * limited server-side, so repeated clicking cannot flood the desk, and a
     * failure is silent for the visitor.
     */
    void recordLifecycleSignal({
      stage: id,
      level: params.get("level"),
      category: params.get("cat"),
      bring: params.get("bring"),
      page: PAGE_SOURCE,
    });
    void trackPartnerCta({
      buttonName: "partner_workspace_stage_selected",
      actionType: "noop",
      target: id,
      pageSource: PAGE_SOURCE,
      metadata: { funnel_step: first ? "first_interact" : "interact", stage: id },
    });
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = LIFECYCLE.length - 1;
    let next = -1;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") next = i === last ? 0 : i + 1;
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") next = i === 0 ? last : i - 1;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = last;
    if (next < 0) return;
    ev.preventDefault();
    select(LIFECYCLE[next].id);
    railRefs.current[next]?.focus();
  };

  /* ---------- funnel: cta ---------- */
  const onCta = (target: string, kind: "primary" | "secondary" | "signin" | "apply") =>
    void trackPartnerCta({
      buttonName: "partner_workspace_cta",
      actionType: "navigate",
      target,
      pageSource: PAGE_SOURCE,
      metadata: { funnel_step: "cta", stage: active.id, kind },
    });

  const progress = ((index + 1) / LIFECYCLE.length) * 100;

  return (
    <section
      ref={sectionRef}
      id="workspace"
      className="border-y border-border bg-muted/40 py-20"
      aria-labelledby="workspace-heading"
    >
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Partner workspace
          </span>
          <h2
            id="workspace-heading"
            className="mt-3 mb-3 text-balance text-[clamp(1.45rem,3vw,2.25rem)] font-bold leading-[1.15] tracking-tight"
          >
            The operational bridge between your customer and our network
          </h2>
          <p className="text-pretty text-muted-foreground">
            My customer. My order. My commercial. Yalla&apos;s supply. One execution engine.
            One customer experience.
          </p>
        </div>

        {/* ---------------- lifecycle rail ---------------- */}
        <div className="mb-4 flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={LIFECYCLE.length}
            aria-valuenow={index + 1}
            aria-label="Partner order lifecycle progression"
          >
            <div
              className={`h-full rounded-full bg-primary ${reduced ? "" : "transition-[width] duration-500 ease-out"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Stage {index + 1} of {LIFECYCLE.length}
          </span>
        </div>

        <ol
          role="tablist"
          aria-label="Partner order lifecycle stages"
          className="-mx-4 mb-6 flex snap-x gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-9 lg:overflow-visible lg:px-0"
        >
          {LIFECYCLE.map((s, i) => {
            const isActive = s.id === active.id;
            const reached = i <= index;
            return (
              <li key={s.id} className="snap-start">
                <button
                  ref={(el) => { railRefs.current[i] = el; }}
                  role="tab"
                  id={`workspace-tab-${s.id}`}
                  aria-selected={isActive}
                  aria-controls="workspace-panel"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => select(s.id)}
                  onKeyDown={(ev) => onKeyDown(ev, i)}
                  className={`flex h-full w-[7.5rem] flex-col rounded-2xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:w-full ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : reached
                        ? "border-primary/40 bg-card hover:border-primary"
                        : "border-border bg-card hover:border-primary/50"
                  }`}
                >
                  <span
                    className={`text-[10px] font-semibold tracking-[0.2em] ${
                      isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {s.n}
                  </span>
                  <span className="mt-1 block text-sm font-semibold leading-tight">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* ---------------- dominant stage ---------------- */}
        <div
          id="workspace-panel"
          role="tabpanel"
          aria-labelledby={`workspace-tab-${active.id}`}
          className="grid gap-6 lg:grid-cols-12"
        >
          <div className="lg:col-span-7">
            <div className="overflow-hidden rounded-3xl border border-border bg-primary">
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                <StagePicture
                  key={active.id}
                  picture={active.image}
                  alt={active.alt}
                  sizes={LIFECYCLE_STAGE_SIZES}
                  priority
                  className={`absolute inset-0 h-full w-full ${reduced ? "" : "motion-safe:animate-fade-in"}`}
                />
                <div
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-t from-primary from-5% via-primary/25 via-50% to-transparent"
                />
                <div className="absolute inset-x-4 bottom-4 sm:inset-x-6 sm:bottom-6">
                  <div className="max-w-[32rem] rounded-2xl border border-primary-foreground/20 bg-primary/70 p-4 backdrop-blur-md sm:p-5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
                      Stage {active.n} · {OWNER_LABEL[active.owner]}
                    </span>
                    <h3 className="mt-1.5 text-balance text-xl font-semibold leading-tight tracking-tight text-primary-foreground sm:text-2xl">
                      {active.claim}
                    </h3>
                    <p className="mt-2 text-pretty text-sm leading-relaxed text-primary-foreground/85">
                      {active.lead}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ---------------- contextual detail ---------------- */}
          <div className="lg:col-span-5">
            <div className="flex h-full flex-col rounded-3xl border border-border bg-card p-6">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                {active.label}
              </span>
              <h4 className="mt-2 text-base font-semibold leading-snug">
                What happens at this stage
              </h4>
              <ul className="mt-3 space-y-2.5">
                {active.does.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-sm">
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 text-pretty">{d}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="font-semibold text-foreground">Where the record lives: </span>
                  {active.provenance}
                </span>
              </p>

              <div className="mt-auto grid gap-2 pt-6 sm:grid-cols-2">
                <Button asChild onClick={() => onCta(active.to, "primary")}>
                  <Link to={active.to}>
                    {active.cta} <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                  </Link>
                </Button>
                <AppButton variant="outline" analytics="partner_workspace_lifecycle_apply" action="navigate" target={applyTo} onClick={() => onCta(applyTo, "apply")}>
                  Apply with this stage
                </AppButton>
                {active.secondary && (
                  <Button variant="ghost" className="sm:col-span-2" asChild onClick={() => onCta(active.secondary!.to, "secondary")}>
                    <Link to={active.secondary.to}>{active.secondary.label}</Link>
                  </Button>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Workspace links require a partner sign-in.{" "}
                <Link
                  to="/partner/workspace"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => onCta("/partner/workspace", "signin")}
                >
                  Partner sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
