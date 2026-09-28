/**
 * PARTNER ECONOMICS — photographic commercial story, not a benefits grid.
 *
 * Four economic outcomes rendered as one coherent visual library: authentic
 * daylight mobility photography, a single sapphire identity scrim, one glass
 * caption plate per frame, and a slow cinematic drift that respects
 * prefers-reduced-motion. No statistics, volumes or guarantees are asserted —
 * copy is proposition only.
 *
 * Additions in this revision:
 *  • responsive AVIF/WebP/JPEG variants with sizes, lazy loading below the
 *    lead frame and an eager/high-priority lead frame to protect LCP;
 *  • funnel telemetry per frame — view → interact → cta;
 *  • non-claim credibility cues: each frame states where the record lives,
 *    sourced from platform behaviour rather than invented numbers;
 *  • caption plates and headings constrained so they never wrap awkwardly.
 */
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StagePicture } from "@/components/marketing/partners/StagePicture";
import { trackPartnerCta } from "@/lib/partners/funnelTrack";
import { currentFrameVariant, frameCopy } from "@/lib/partners/abTest";
import type { PictureSet } from "@/components/marketing/ResponsiveImage";

import econAcquire from "@/assets/partners/econ-acquire.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import econServices from "@/assets/partners/econ-services.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import econNetwork from "@/assets/partners/econ-network.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import econMargin from "@/assets/partners/econ-margin.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";

const PAGE_SOURCE = "/partners#economics";

interface Frame {
  id: string;
  n: string;
  t: string;
  d: string;
  /** Where the record of this outcome lives — credibility without numbers. */
  provenance: string;
  image: PictureSet;
  alt: string;
  /** Layout weight — lead frame carries the headline outcome. */
  span: string;
  sizes: string;
  priority?: boolean;
}

const FRAMES: Frame[] = [
  {
    id: "acquire",
    n: "01",
    t: "Acquire customers",
    d: "Sell mobility to the customers you already have, under your own brand.",
    provenance: "Your customer register stays in your partner workspace, under row-level authorisation.",
    image: econAcquire,
    alt: "An executive stepping from a dark navy sedan at an airport terminal as a chauffeur holds the door",
    span: "lg:col-span-7",
    sizes: "(min-width: 1024px) 56vw, 100vw",
    priority: true,
  },
  {
    id: "services",
    n: "02",
    t: "Sell more mobility",
    d: "Rides, charters, deliveries, logistics, rentals and leasing from one order surface.",
    provenance: "Every service line is placed as one partner order type — not separate systems.",
    image: econServices,
    alt: "A travel coordinator arranging a multi-leg journey at a desk in daylight",
    span: "lg:col-span-5",
    sizes: "(min-width: 1024px) 40vw, 100vw",
  },
  {
    id: "network",
    n: "03",
    t: "Fulfil without owning assets",
    d: "A verified supply network executes the movement, so growth is not capped by your fleet.",
    provenance: "Supply admission is document-verified before any order can be allocated to it.",
    image: econNetwork,
    alt: "A line of dark navy executive vehicles, a van and a coach staged at first light",
    span: "lg:col-span-5",
    sizes: "(min-width: 1024px) 40vw, 100vw",
  },
  {
    id: "margin",
    n: "04",
    t: "Earn and manage margin",
    d: "A contracted margin per order, visible before confirmation and reconciled before settlement.",
    provenance: "Pricing is computed server-side from the contracted rate card and pinned to the order.",
    image: econMargin,
    alt: "Two executives concluding an agreement beside a navy sedan outside a glass office building",
    span: "lg:col-span-7",
    sizes: "(min-width: 1024px) 56vw, 100vw",
  },
];

const EQUATION = ["Customers", "More services", "No assets to own", "Margin"];

export const PartnerEconomics = () => {
  /**
   * Messaging experiment arm for this visitor. Assignment is deterministic from
   * the analytics session, so the copy never changes mid-visit, and every funnel
   * event below carries the variant through `trackPartnerCta`.
   */
  const variant = useMemo(() => currentFrameVariant(), []);
  const sectionRef = useRef<HTMLElement | null>(null);
  const frameRefs = useRef<Record<string, HTMLElement | null>>({});
  const seen = useRef<Set<string>>(new Set());

  /* ---------- funnel: per-frame view ---------- */
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.frame;
          if (!id || seen.current.has(id)) continue;
          seen.current.add(id);
          void trackPartnerCta({
            buttonName: "partner_economics_frame_view",
            actionType: "scroll",
            target: id,
            pageSource: PAGE_SOURCE,
            metadata: { funnel_step: "view", frame: id },
          });
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.4 },
    );
    Object.values(frameRefs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const onInteract = (id: string) =>
    void trackPartnerCta({
      buttonName: "partner_economics_frame_interact",
      actionType: "noop",
      target: id,
      pageSource: PAGE_SOURCE,
      metadata: { funnel_step: "interact", frame: id },
    });

  const onCta = (target: string) =>
    void trackPartnerCta({
      buttonName: "partner_economics_cta",
      actionType: "navigate",
      target,
      pageSource: PAGE_SOURCE,
      metadata: { funnel_step: "cta" },
    });

  return (
    <section
      ref={sectionRef}
      id="economics"
      className="border-y border-border bg-primary py-20 text-primary-foreground"
      aria-labelledby="economics-heading"
    >
      <div className="container mx-auto px-4">
        <div className="max-w-3xl">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/70">
            Why build on TaxiD
          </span>
          <h2
            id="economics-heading"
            className="mt-3 text-balance text-[clamp(1.5rem,3.2vw,2.4rem)] font-semibold leading-[1.15] tracking-tight"
          >
            The economics of selling mobility you do not have to own
          </h2>
          <p className="mt-3 max-w-xl text-pretty text-primary-foreground/80">
            Four outcomes decide whether a partnership is worth signing.
          </p>
        </div>

        {/* The 10-second answer, before any prose. */}
        <ul className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium">
          {EQUATION.map((item, i) => (
            <li key={item} className="flex items-center gap-3">
              {i > 0 && <span aria-hidden className="text-primary-foreground/40">+</span>}
              <span className="rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-4 py-1.5">
                {item}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-10 grid gap-5 lg:grid-cols-12">
          {FRAMES.map((f) => {
            const copy = frameCopy(variant, f.id, { t: f.t, d: f.d });
            return (
            <figure
              key={f.id}
              ref={(el) => { frameRefs.current[f.id] = el; }}
              data-frame={f.id}
              onPointerEnter={() => onInteract(f.id)}
              onFocusCapture={() => onInteract(f.id)}
              className={`group relative overflow-hidden rounded-2xl border border-primary-foreground/15 ${f.span}`}
            >
              <div className="relative aspect-[16/11] w-full overflow-hidden">
                <StagePicture
                  picture={f.image}
                  alt={f.alt}
                  sizes={f.sizes}
                  priority={f.priority}
                  className="absolute inset-0 h-full w-full transition-transform duration-[9000ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-safe:group-hover:scale-[1.06] motion-reduce:transition-none"
                />
                {/* Identity layer, not a colour filter: the photograph keeps its
                    daylight; sapphire is carried only where type sits. */}
                <div
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-t from-primary from-5% via-primary/20 via-45% to-transparent"
                />
              </div>
              <figcaption className="absolute inset-x-4 bottom-4 rounded-xl border border-primary-foreground/20 bg-primary/70 p-4 backdrop-blur-md sm:bottom-5 sm:left-5 sm:right-auto sm:max-w-[26rem] sm:p-5">
                <span className="text-[11px] font-semibold tracking-[0.22em] text-primary-foreground/60">
                  {f.n}
                </span>
                <h3 className="mt-1.5 text-balance text-[clamp(1rem,1.6vw,1.25rem)] font-semibold leading-snug tracking-tight text-primary-foreground">
                  {copy.t}
                </h3>
                <p className="mt-1.5 text-pretty text-sm leading-relaxed text-primary-foreground/85">
                  {copy.d}
                </p>
                <p className="mt-3 flex items-start gap-2 border-t border-primary-foreground/15 pt-3 text-[11px] leading-relaxed text-primary-foreground/70">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{f.provenance}</span>
                </p>
              </figcaption>
            </figure>
            );
          })}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Button
            className="bg-ice text-primary hover:bg-ice/90"
            asChild
            onClick={() => onCta("/partners/apply?track=distribution")}
          >
            <Link to="/partners/apply?track=distribution">
              Start a partner application <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button
            variant="outline"
            className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
            asChild
            onClick={() => onCta("/partners#workspace")}
          >
            <Link to="/partners?stage=commercials#workspace">See how commercials appear</Link>
          </Button>
        </div>
      </div>
    </section>
  );
};
