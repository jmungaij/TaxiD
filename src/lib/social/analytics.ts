/**
 * SOCIAL EVENT TAXONOMY + FIRST-PARTY INSTRUMENTATION
 *
 * One canonical naming convention (`<domain>.<surface>.<action>`), one sink:
 * the existing first-party analytics table. No third-party SDK, no pixel and
 * no consent-bearing tracker is introduced merely to count an outbound click.
 *
 * Analytics failure must NEVER prevent a user reaching a social destination —
 * every function here is fire-and-forget and swallows its own errors.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { firstTouch, lastTouch } from "./attribution";

export const SocialEvents = {
  IMPRESSION: "social.link.impression",
  CLICK: "social.link.click",
  PROFILE_VISIT: "social.profile.visit",
  CAMPAIGN_LANDING: "social.campaign.landing_visit",
  WHATSAPP_CLICK: "social.whatsapp.click",
  // Governance / observability (system health, NOT marketing)
  CONFIG_ERROR: "social.system.configuration_error",
  VALIDATION_ERROR: "social.system.destination_validation_error",
  ACTIVATION_ERROR: "social.system.account_activation_error",
  RENDER_ERROR: "social.system.link_render_error",
} as const;

export type SocialEventName = (typeof SocialEvents)[keyof typeof SocialEvents];

let sessionId: string | null = null;
function getSessionId(): string | null {
  if (sessionId) return sessionId;
  try {
    const key = "yalla_social_sid";
    let s = localStorage.getItem(key);
    if (!s) {
      s = crypto.randomUUID();
      localStorage.setItem(key, s);
    }
    sessionId = s;
    return s;
  } catch {
    return null;
  }
}

export interface SocialEventPayload {
  platform?: string;
  account_id?: string;
  location?: string;
  destination?: string;
  campaign_id?: string;
  [k: string]: unknown;
}

export function trackSocialEvent(event: SocialEventName, payload: SocialEventPayload = {}): void {
  try {
    void (untypedDb)
      .from("driver_analytics_events")
      .insert({
        event_name: event,
        session_id: getSessionId(),
        page_route: typeof window !== "undefined" ? window.location.pathname : null,
        funnel_stage: "social_distribution",
        metadata: {
          ...payload,
          first_touch: firstTouch(),
          last_touch: lastTouch(),
        } as never,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  } catch {
    // never surface analytics failures
  }
}
