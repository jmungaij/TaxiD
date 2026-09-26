/**
 * Employee Mobility conversion funnel analytics.
 *
 * Reuses the existing platform telemetry sinks — `logUiEvent` (ui_events) for
 * step-level instrumentation and `trackCta` (cta_events, with UTM/campaign
 * attribution) for commercial CTAs. No new tracking service is introduced.
 *
 * Every event carries a stable `funnel_id` so a visitor's journey from hero
 * impression → widget interaction → quote request → booking hand-off can be
 * reconstructed, including abandonment (last step reached before unload).
 */
import { logUiEvent } from "@/lib/navLog";
import { trackCta, type CtaActionType } from "@/lib/cta";

export const EM_FUNNEL = "employee_mobility";
export const EM_PATH = "/riders/corporate";

/** Ordered lifecycle steps for the Employee Mobility booking funnel. */
export const EM_STEPS = [
  "hero_impression",
  "hero_cta_click",
  "scroll_depth",
  "widget_opened",
  "pickup_entered",
  "destination_entered",
  "date_selected",
  "passengers_entered",
  "frequency_selected",
  "vehicle_viewed",
  "vehicle_compared",
  "vehicle_selected",
  "quote_requested",
  "booking_handoff",
  "consultant_form_opened",
  "consultant_form_started",
  "consultant_form_submitted",
  "consultant_form_failed",
  "concierge_prompt",
  "concierge_action",
  "savings_calculated",
  "draft_resumed",
  "search_saved",
  "offline_parked",
  "funnel_abandoned",
] as const;

export type EmStep = (typeof EM_STEPS)[number];

let funnelId: string | null = null;
let lastStep: EmStep | null = null;
let startedAt = 0;

/** Stable per-session funnel identifier (survives reloads within a tab). */
export function emFunnelId(): string {
  if (funnelId) return funnelId;
  if (typeof window === "undefined") return "ssr";
  const key = "yalla.em_funnel_id";
  const existing = sessionStorage.getItem(key);
  if (existing) {
    funnelId = existing;
    return existing;
  }
  const id = `emf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(key, id);
  funnelId = id;
  return id;
}

/** Furthest step reached — used to attribute abandonment. */
export function emLastStep(): EmStep | null {
  return lastStep;
}

/** Record one funnel step. Fire-and-forget; never throws. */
export function trackEmStep(
  step: EmStep,
  payload: Record<string, unknown> = {},
): void {
  if (startedAt === 0 && typeof performance !== "undefined") startedAt = performance.now();
  const elapsedMs =
    typeof performance !== "undefined" ? Math.round(performance.now() - startedAt) : 0;
  if (step !== "funnel_abandoned" && step !== "scroll_depth") lastStep = step;

  void logUiEvent({
    elementId: `${EM_FUNNEL}.${step}`,
    elementLabel: step,
    action: step.endsWith("_click") ? "click" : "view",
    pageRoute: EM_PATH,
    payload: {
      ...payload,
      funnel: EM_FUNNEL,
      funnel_id: emFunnelId(),
      step,
      step_index: EM_STEPS.indexOf(step),
      elapsed_ms: elapsedMs,
    },
  });
}

/**
 * Commercial CTA click: writes the campaign-attributed cta_events row AND the
 * funnel step so marketing attribution and funnel analysis share one identity.
 */
export function trackEmCta(
  buttonName: string,
  opts: { actionType?: CtaActionType; target?: string; step?: EmStep; metadata?: Record<string, unknown> } = {},
): void {
  void trackCta({
    buttonName,
    actionType: opts.actionType ?? "navigate",
    target: opts.target,
    pageSource: EM_PATH,
    metadata: {
      ...opts.metadata,
      funnel: EM_FUNNEL,
      funnel_id: emFunnelId(),
      landing_page: EM_PATH,
    },
  });
  trackEmStep(opts.step ?? "hero_cta_click", { button: buttonName, target: opts.target, ...opts.metadata });
}

/**
 * Records abandonment when the visitor leaves without reaching the booking
 * hand-off. Returns a cleanup function for use inside `useEffect`.
 */
export function watchEmAbandonment(): () => void {
  if (typeof window === "undefined") return () => {};
  const onLeave = () => {
    if (!lastStep || lastStep === "booking_handoff" || lastStep === "consultant_form_submitted") return;
    trackEmStep("funnel_abandoned", { last_step: lastStep, reason: `left_at_${lastStep}` });
  };
  window.addEventListener("pagehide", onLeave);
  return () => window.removeEventListener("pagehide", onLeave);
}

/** Fires scroll-depth milestones (25/50/75/100%) once each. */
export function watchEmScrollDepth(): () => void {
  if (typeof window === "undefined") return () => {};
  const seen = new Set<number>();
  const onScroll = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return;
    const pct = Math.min(100, Math.round(((window.scrollY || 0) / max) * 100));
    for (const milestone of [25, 50, 75, 100]) {
      if (pct >= milestone && !seen.has(milestone)) {
        seen.add(milestone);
        trackEmStep("scroll_depth", { depth_pct: milestone });
      }
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => window.removeEventListener("scroll", onScroll);
}
