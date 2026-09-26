/**
 * PARTNER FUNNEL TELEMETRY — one entry point for the public partner experience.
 *
 * Wraps `trackCta` so every partner funnel event automatically carries the
 * messaging variant the visitor was assigned. Without this the A/B report at
 * /staff/partners/funnel cannot attribute an event to an arm of the experiment,
 * and every partner component would have to remember to add it by hand.
 */
import { trackCta, type CtaPayload } from "@/lib/cta";
import { currentFrameVariant } from "@/lib/partners/abTest";

export function trackPartnerCta(payload: CtaPayload): Promise<void> {
  return trackCta({
    ...payload,
    metadata: { ...(payload.metadata ?? {}), variant: currentFrameVariant() },
  });
}
