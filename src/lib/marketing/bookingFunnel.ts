/**
 * Homepage booking funnel — business events, not visual interactions.
 *
 * Reuses the existing sinks: `logUiEvent` (ui_events) for step telemetry and
 * `trackCta` (cta_events, UTM attribution) for commercial hand-offs.
 * A CTA click is instrumentation; only `booking_confirmed` is a conversion.
 *
 * Search → Compare → Book → Pay → Confirm
 */
import { logUiEvent } from "@/lib/navLog";
import { trackCta } from "@/lib/cta";

export const BOOKING_STEPS = [
  "booking_started",
  "service_selected",
  "search_submitted",
  "results_viewed",
  "vehicle_selected",
  "quote_viewed",
  "payment_started",
  "payment_completed",
  "booking_confirmed",
  "booking_abandoned",
] as const;

export type BookingStep = (typeof BOOKING_STEPS)[number];

export interface BookingContext {
  serviceCategory: string;
  origin?: string;
  destination?: string;
  vehicleCategory?: string;
  customerType?: "guest" | "authenticated" | "corporate";
  bookingId?: string;
  [k: string]: unknown;
}

let funnelId: string | null = null;

export function bookingFunnelId(): string {
  if (funnelId) return funnelId;
  if (typeof window === "undefined") return "ssr";
  const key = "yalla.booking_funnel_id";
  const existing = sessionStorage.getItem(key);
  if (existing) {
    funnelId = existing;
    return existing;
  }
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  funnelId = id;
  return id;
}

function deviceType(): string {
  if (typeof window === "undefined") return "ssr";
  const w = window.innerWidth;
  return w < 768 ? "mobile" : w < 1280 ? "tablet" : "desktop";
}

/** Fire-and-forget funnel step. Never throws, never blocks the UI. */
export function trackBookingStep(step: BookingStep, ctx: BookingContext): void {
  void logUiEvent({
    elementId: `booking.${step}`,
    elementLabel: ctx.serviceCategory,
    action: step,
    payload: {
      funnel_id: bookingFunnelId(),
      step,
      device_type: deviceType(),
      customer_type: ctx.customerType ?? "guest",
      ts: new Date().toISOString(),
      ...ctx,
    },
  }).catch(() => undefined);
}

/** Commercial hand-off out of the hero (keeps UTM/campaign attribution). */
export function trackBookingHandoff(buttonName: string, target: string, ctx: BookingContext): void {
  trackBookingStep("search_submitted", ctx);
  void trackCta({
    buttonName,
    actionType: "navigate",
    target,
    metadata: { funnel_id: bookingFunnelId(), device_type: deviceType(), ...ctx },
  }).catch(() => undefined);
}
