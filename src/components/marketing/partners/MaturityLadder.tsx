/**
 * INTEGRATION MATURITY — interactive visual progression.
 *
 * Refer → Book → Manage → Embed → API → White label / Orchestrate, presented as
 * one ladder with a dominant visual per level rather than six equivalent cards,
 * so a prospective partner reads the message: start simple, scale when the
 * business grows.
 *
 * Governance: every destination is the validated /partners/apply route with the
 * commercial model carried in the query; no counts, volumes or guarantees are
 * stated; motion and image transitions are suppressed under
 * prefers-reduced-motion, and the section works without imagery.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight, Code2, FileDown, Layers, LineChart, Loader2, Route as RouteIcon, ShieldCheck, Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StagePicture } from "@/components/marketing/partners/StagePicture";
import { trackPartnerCta } from "@/lib/partners/funnelTrack";
import { buildApplyLink } from "@/lib/partners/intent";
import {
  buildReadinessChecklist, downloadReadinessChecklistPdf, readinessItemCount,
} from "@/lib/partners/readinessChecklist";
import { useDeepParam } from "@/lib/partners/useDeepParam";
import type { PictureSet } from "@/components/marketing/ResponsiveImage";

import imgRefer from "@/assets/partners/network/travel-tourism.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgBook from "@/assets/partners/network/corporate-institutions.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgManage from "@/assets/partners/network/maturity-manage.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgEmbed from "@/assets/partners/network/maturity-embed.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgApi from "@/assets/partners/network/maturity-api.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgOrchestrate from "@/assets/partners/network/maturity-orchestrate.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";

const PAGE_SOURCE = "/partners#maturity";
const SIZES = "(min-width: 1024px) 58vw, 100vw";

interface Rung {
  id: string;
  level: string;
  t: string;
  icon: typeof Users;
  to: string;
  d: string;
  needs: string;
  does: string[];
  image: PictureSet;
  alt: string;
}

const RUNGS: Rung[] = [
  {
    id: "refer",
    level: "Level 1", t: "Refer", icon: Users, to: "/partners/apply?track=distribution&model=REFER",
    d: "Send the customer to TaxiD and earn on the completed movement. No operations for you to run.",
    needs: "Commercial agreement only",
    does: [
      "Refer a customer with your partner reference attached",
      "TaxiD quotes, books and executes the movement",
      "Your earning is recorded against the completed order",
    ],
    image: imgRefer,
    alt: "A travel adviser handing an arriving guest over to a waiting TaxiD chauffeur at a Nairobi terminal",
  },
  {
    id: "book",
    level: "Level 2", t: "Book", icon: RouteIcon, to: "/partners/apply?track=distribution&model=BOOK",
    d: "Arrange rides, charters, deliveries, rentals and leasing on your customer's behalf from your workspace.",
    needs: "Verified partner account",
    does: [
      "Register your customer and keep the relationship",
      "Quote from your contracted rate card",
      "Confirm the order and track execution per leg",
    ],
    image: imgBook,
    alt: "An account manager booking executive transport on a laptop in a Nairobi business district office",
  },
  {
    id: "manage",
    level: "Level 3", t: "Manage", icon: LineChart, to: "/partners/apply?track=distribution&model=ORCHESTRATE",
    d: "Run your own team, customers, approvals, journeys and margin reporting inside the workspace.",
    needs: "Users, roles and approval routes configured",
    does: [
      "Add users with roles and approval routes",
      "Group legs into journeys with one commercial view",
      "Read margin and reconciliation reporting",
    ],
    image: imgManage,
    alt: "Operations staff monitoring a mobility control room wall of live route and order dashboards",
  },
  {
    id: "embed",
    level: "Level 4", t: "Embed", icon: Layers, to: "/partners/apply?track=technology&model=EMBED",
    d: "Place TaxiD mobility inside your own product journey, so booking never leaves your experience.",
    needs: "Embedded surface and commercial scope agreed",
    does: [
      "Embed quoting and booking in your own journey",
      "Keep your branding on the customer-facing surface",
      "TaxiD holds execution, documents and settlement behind it",
    ],
    image: imgEmbed,
    alt: "A product team reviewing an embedded mobility booking flow on a tablet held over a design desk",
  },
  {
    id: "api",
    level: "Level 5", t: "API", icon: Code2, to: "/partners/apply?track=technology&model=API",
    d: "Programmatic quoting, booking, status, documents and settlement data for high-volume partners.",
    needs: "Credentials, sandbox and certification",
    does: [
      "Quote, book and track programmatically",
      "Pull documents and settlement data into your systems",
      "Certify in sandbox before production credentials issue",
    ],
    image: imgApi,
    alt: "An engineer inspecting API request traces and route data visualisations across two monitors",
  },
  {
    id: "orchestrate",
    level: "Level 6", t: "White label / Orchestrate", icon: ShieldCheck, to: "/partners/apply?track=technology&model=WHITE_LABEL",
    d: "Your brand at the front, TaxiD's execution engine behind it — across multi-service journeys.",
    needs: "Technical discovery, certification and go-live plan",
    does: [
      "Operate a mobility product under your own brand",
      "Orchestrate ride, charter, delivery, logistics and rental together",
      "Governed go-live with enterprise support in place",
    ],
    image: imgOrchestrate,
    alt: "A multi-modal line-up of executive sedans, vans and a coach staged at dusk for a coordinated operation",
  },
];

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

export function MaturityLadder() {
  const LEVEL_IDS = useMemo(() => RUNGS.map((r) => r.id), []);
  const [activeId, setActiveId] = useDeepParam("level", LEVEL_IDS, RUNGS[0].id);
  const reduced = useReducedMotion();
  const rungRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [params] = useSearchParams();
  const [downloading, setDownloading] = useState(false);

  const index = useMemo(() => RUNGS.findIndex((r) => r.id === activeId), [activeId]);
  const active = RUNGS[index] ?? RUNGS[0];

  const select = (id: string) => {
    setActiveId(id);
    void trackPartnerCta({
      buttonName: "maturity_level_selected",
      actionType: "noop",
      target: id,
      pageSource: PAGE_SOURCE,
      metadata: { funnel_step: "interact", level: id },
    });
  };

  /** Onboarding link carrying everything the visitor has already told us. */
  const applyTo = buildApplyLink({
    bring: params.get("bring"),
    cat: params.get("cat"),
    stage: params.get("stage"),
    level: active.id,
  });

  const checklist = buildReadinessChecklist(active.id);

  const onDownloadChecklist = async () => {
    setDownloading(true);
    void trackPartnerCta({
      buttonName: "maturity_readiness_checklist_download",
      actionType: "submit",
      target: active.id,
      pageSource: PAGE_SOURCE,
      metadata: { funnel_step: "cta", level: active.id },
    });
    try {
      await downloadReadinessChecklistPdf(active.id);
      toast.success(`Readiness checklist for ${active.t} downloaded`);
    } catch {
      toast.error("Could not generate the checklist. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = RUNGS.length - 1;
    let next = -1;
    if (ev.key === "ArrowDown" || ev.key === "ArrowRight") next = i === last ? 0 : i + 1;
    else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") next = i === 0 ? last : i - 1;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = last;
    if (next < 0) return;
    ev.preventDefault();
    select(RUNGS[next].id);
    rungRefs.current[next]?.focus();
  };

  const progress = ((index + 1) / RUNGS.length) * 100;

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* ---------------- ladder rail ---------------- */}
      <div className="lg:col-span-5">
        <div className="mb-4 flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={RUNGS.length}
            aria-valuenow={index + 1}
            aria-label="Integration maturity progression"
          >
            <div
              className={`h-full rounded-full bg-primary ${reduced ? "" : "transition-[width] duration-500 ease-out"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {index + 1} of {RUNGS.length}
          </span>
        </div>

        <ol role="tablist" aria-label="Integration maturity levels" aria-orientation="vertical" className="space-y-2">
          {RUNGS.map(({ id, level, t, icon: Icon, needs }, i) => {
            const isActive = id === activeId;
            const isReached = i <= index;
            return (
              <li key={id}>
                <button
                  ref={(el) => { rungRefs.current[i] = el; }}
                  role="tab"
                  id={`maturity-tab-${id}`}
                  aria-selected={isActive}
                  aria-controls="maturity-panel"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => select(id)}
                  onKeyDown={(ev) => onKeyDown(ev, i)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:border-primary/50"
                  }`}
                >
                  <span
                    className={`rounded-full p-2 ${
                      isActive
                        ? "bg-primary-foreground/15 text-primary-foreground"
                        : isReached
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[11px] font-semibold uppercase tracking-wider ${
                        isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                      }`}
                    >
                      {level}
                    </span>
                    <span className="block truncate text-sm font-semibold">{t}</span>
                  </span>
                  <span
                    className={`hidden max-w-[9rem] text-right text-[11px] leading-tight sm:block ${
                      isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {needs}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ---------------- dominant level stage ---------------- */}
      <div
        id="maturity-panel"
        role="tabpanel"
        aria-labelledby={`maturity-tab-${active.id}`}
        className="lg:col-span-7"
      >
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-primary">
            <StagePicture
              key={active.id}
              picture={active.image}
              alt={active.alt}
              sizes={SIZES}
              priority
              className={`absolute inset-0 h-full w-full ${reduced ? "" : "motion-safe:animate-fade-in"}`}
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-primary from-5% via-primary/20 via-55% to-transparent"
            />
            <div className="absolute inset-x-4 bottom-4 sm:inset-x-6 sm:bottom-6">
              <div className="rounded-2xl border border-primary-foreground/20 bg-primary/70 p-4 backdrop-blur-md">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
                  {active.level}
                </span>
                <h3 className="mt-1 text-balance text-lg font-semibold tracking-tight text-primary-foreground sm:text-2xl">
                  {active.t}
                </h3>
              </div>
            </div>
          </div>

          <div className="p-6">
            <p className="text-sm text-muted-foreground">{active.d}</p>

            <h4 className="mt-6 text-sm font-semibold">What you do at this level</h4>
            <ul className="mt-3 space-y-2">
              {active.does.map((d) => (
                <li key={d} className="flex items-start gap-2 text-sm">
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span>{d}</span>
                </li>
              ))}
            </ul>

            <p className="mt-6 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">What you need: </span>
              {active.needs}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link
                  to={applyTo}
                  onClick={() =>
                    void trackPartnerCta({
                      buttonName: "maturity_level_cta_clicked",
                      actionType: "navigate",
                      target: applyTo,
                      pageSource: PAGE_SOURCE,
                      metadata: { funnel_step: "cta", level: active.id },
                    })
                  }
                >
                  Start at {active.t}
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Button variant="outline" onClick={() => void onDownloadChecklist()} disabled={downloading}>
                {downloading
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  : <FileDown className="mr-2 h-4 w-4" aria-hidden />}
                Readiness checklist (PDF)
              </Button>
              {index < RUNGS.length - 1 && (
                <Button variant="ghost" onClick={() => select(RUNGS[index + 1].id)}>
                  See {RUNGS[index + 1].t}
                </Button>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              The checklist covers {readinessItemCount(checklist)} preparation points across{" "}
              {checklist.sections.length} areas, tailored to {active.t}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MaturityLadder;
