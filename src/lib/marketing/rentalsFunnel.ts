/**
 * Rentals & Leasing commercial funnel telemetry.
 *
 * Reuses the platform's existing sinks — `logUiEvent` (ui_events) for
 * interaction telemetry and `trackCta` (cta_events, UTM attribution) for
 * commercial hand-offs. Only `rentals.enquiry.completed` is a conversion.
 *
 * Every event carries the rental category so performance can be compared
 * per tier (Economy / Executive / Luxury / SUVs / Vans) and per service
 * (self-drive / chauffeur / bus-coach / corporate-leasing / marketplace).
 */
import { logUiEvent } from "@/lib/navLog";
import { trackCta } from "@/lib/cta";

export const RENTAL_EVENTS = {
  TAB_CLICK: "rentals.tab.click",
  CATEGORY_VIEW: "rentals.category.select",
  GET_QUOTE: "rentals.quote.requested",
  ENQUIRE: "rentals.enquiry.started",
  ENQUIRY_COMPLETED: "rentals.enquiry.completed",
  CTA_IMPRESSION: "rentals.cta.impression",
  TAB_VISIBLE: "rentals.tab.visible",
} as const;

export interface RentalEventContext {
  /** Tier or service label, e.g. "Executive" or "self-drive". */
  category: string;
  /** Sub-surface that raised the event, e.g. "category_card". */
  surface?: string;
  pageRoute?: string;
  [k: string]: unknown;
}

function base(ctx: RentalEventContext) {
  return {
    module: "rentals_leasing",
    category: ctx.category,
    surface: ctx.surface ?? "unknown",
    ...ctx,
  };
}

/** Tab / segmented-control click inside the Rentals & Leasing module. */
export function trackRentalTabClick(tab: string, ctx: RentalEventContext): void {
  void logUiEvent({
    elementId: RENTAL_EVENTS.TAB_CLICK,
    elementLabel: tab,
    action: "click",
    pageRoute: ctx.pageRoute,
    payload: { ...base(ctx), tab },
  });
}

/** A category card was activated (drill-down intent). */
export function trackRentalCategorySelect(ctx: RentalEventContext): void {
  void logUiEvent({
    elementId: RENTAL_EVENTS.CATEGORY_VIEW,
    elementLabel: ctx.category,
    action: "click",
    pageRoute: ctx.pageRoute,
    payload: base(ctx),
  });
}

/** "Get Quote" / "Enquire" click — commercial hand-off, attributed via UTM. */
export function trackRentalQuoteRequest(
  kind: "quote" | "enquire",
  ctx: RentalEventContext & { target?: string },
): void {
  const buttonName = kind === "quote" ? RENTAL_EVENTS.GET_QUOTE : RENTAL_EVENTS.ENQUIRE;
  void logUiEvent({
    elementId: buttonName,
    elementLabel: ctx.category,
    action: "click",
    pageRoute: ctx.pageRoute,
    payload: base(ctx),
  });
  void trackCta({
    buttonName,
    actionType: "navigate",
    target: ctx.target,
    metadata: base(ctx),
  });
}

/** Conversion: the enquiry form was submitted for a rentals category. */
export function trackRentalEnquiryCompleted(ctx: RentalEventContext): void {
  void logUiEvent({
    elementId: RENTAL_EVENTS.ENQUIRY_COMPLETED,
    elementLabel: ctx.category,
    action: "submit",
    pageRoute: ctx.pageRoute,
    payload: base(ctx),
  });
  void trackCta({
    buttonName: RENTAL_EVENTS.ENQUIRY_COMPLETED,
    actionType: "submit",
    metadata: base(ctx),
  });
}

/**
 * Resolves the rentals category from enquiry URL params, or null when the
 * enquiry did not originate in the Rentals & Leasing module.
 */
export function rentalEnquiryCategory(search: string): string | null {
  const p = new URLSearchParams(search);
  const category = p.get("category");
  const subject = p.get("subject") ?? "";
  if (category && /rental|lease|leasing|charter|chauffeur|fleet/i.test(subject)) return category;
  if (/rental|leasing/i.test(subject)) return category ?? subject;
  return null;
}

/**
 * Impression: a hero or category CTA became visible in the viewport.
 * Fired once per surface per page view (see `useInViewOnce`), so
 * impression → click gives a true CTA conversion rate per category.
 */
export function trackRentalCtaImpression(
  ctx: RentalEventContext & { ctaLabel?: string },
): void {
  void logUiEvent({
    elementId: RENTAL_EVENTS.CTA_IMPRESSION,
    elementLabel: ctx.ctaLabel ?? ctx.category,
    action: "view",
    pageRoute: ctx.pageRoute,
    payload: base(ctx),
  });
}

/** Visibility: a Rentals & Leasing tablist scrolled into view. */
export function trackRentalTabVisible(
  tab: string,
  ctx: RentalEventContext,
): void {
  void logUiEvent({
    elementId: RENTAL_EVENTS.TAB_VISIBLE,
    elementLabel: tab,
    action: "view",
    pageRoute: ctx.pageRoute,
    payload: { ...base(ctx), tab },
  });
}
